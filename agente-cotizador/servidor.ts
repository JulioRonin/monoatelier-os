/**
 * Servidor MCP del cotizador de Mono Atelier.
 *
 * Hermes ya resuelve el chat: Discord, WhatsApp, la sesión, el modelo. Lo que
 * NO sabe es cuánto cuesta una cocina. Eso vive aquí, y Hermes lo descubre
 * conectándose a este servidor.
 *
 * La regla, igual que en mono-forge: el modelo decide QUÉ preguntar y cómo
 * interpretar la respuesta; el sistema decide CUÁNTO CUESTA. Ninguna
 * herramienta de aquí acepta que el modelo invente un precio — salvo
 * `agregar_partida` con `precio_directo`, que es Julio dictándolo a propósito.
 *
 * Los precios salen de lib/cotizador.ts, EL MISMO módulo que usa la
 * plataforma. Si esto recalculara por su cuenta, el chat y la pantalla darían
 * números distintos para la misma cocina.
 *
 *     node agente-cotizador/dist/servidor.js      (lo lanza Hermes por stdio)
 *
 * Variables de entorno:
 *     SUPABASE_URL, SUPABASE_KEY     obligatorias
 *     COTIZADOR_PLANTILLA            ruta al PDF de plantilla
 *     COTIZADOR_SALIDA               carpeta donde escribir los PDF
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rutaPlantilla, rutaSalida } from './rutas.js';

import {
    buscarServicios, clasificarVariantes, partidasDe, totalesDe,
    precioUnitario, cantidadDe, sospechaDeClasificacion, precioDesdeCosto,
    importeDe, redondear, cantidadDeMedidas, MedidasInvalidas, margenDe,
    puntajeDeNombre,
} from '../lib/cotizador.js';
import { generarCotizacionPdf } from '../lib/cotizacionPdf.js';
import {
    generarReporteVentasPdf, type ClienteDeVentas,
} from '../lib/reporteVentasPdf.js';
import type { Service, ServiceVariable, QuoteItem, Quote } from '../types.js';
import {
    leerServicios, leerVariantes, leerAjustes, guardarCotizacion,
    leerCotizaciones, leerCotizacion, crearServicio,
    leerProyectos, leerProyectosSinFechaDeVenta, leerFacturas, leerClientesMin,
    leerCotizacionesTodas, leerCotizacionesVendidas, leerProyectosTodos, leerPagos,
    type FilaServicio, type FilaVariante, type FilaCotizacion,
    type FilaProyecto, type FilaFactura, type FilaPago,
} from './supabase.js';

const IVA_DEFAULT = 0.08;   // franja fronteriza norte

// Las rutas se resuelven contra el repo, no contra el directorio donde Hermes
// lanzó el proceso. Ver rutas.ts.
const PLANTILLA = rutaPlantilla;
const SALIDA = rutaSalida;

// ── Mapeo de filas ───────────────────────────────────────────────────────

const aServicio = (f: FilaServicio): Service => ({
    id: f.id, name: f.name, category: f.category ?? undefined,
    description: f.description ?? undefined, basePrice: Number(f.base_price) || 0,
    cost: f.cost == null ? null : Number(f.cost), units: f.units ?? undefined,
    active: f.active !== false, sku: f.sku, priceUpdatedAt: f.price_updated_at,
});

const aVariante = (f: FilaVariante): ServiceVariable => ({
    id: f.id, serviceId: f.service_id, name: f.name, kind: f.kind as any,
    price: f.price == null ? null : Number(f.price),
    cost: f.cost == null ? null : Number(f.cost),
    units: f.units, active: f.active !== false, sortOrder: f.sort_order ?? 0,
});

/** Catálogo leído en cada llamada: si Julio corrige un precio en la pantalla
 *  de Precios, la siguiente cotización ya lo usa. Cachearlo obligaría a
 *  reiniciar Hermes para ver un cambio. */
async function catalogo() {
    const [s, v, a] = await Promise.all([leerServicios(), leerVariantes(), leerAjustes()]);
    return {
        servicios: s.map(aServicio).filter(x => x.active),
        variantes: v.map(aVariante).filter(x => x.active),
        iva: typeof a.iva === 'number' ? a.iva : IVA_DEFAULT,
        margen: typeof a.margen_objetivo === 'number' ? a.margen_objetivo : null,
        tieneAjustes: Object.keys(a).length > 0,
    };
}

const pesos = (n: number) =>
    `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Borrador en curso ────────────────────────────────────────────────────

interface Borrador {
    cliente: string;
    proyecto: string;
    fecha: string;
    entrega: string;
    notas?: string;
    items: QuoteItem[];
    avisos: string[];
}

/**
 * Un borrador por sesión de chat. Vive en memoria: el servidor es un proceso
 * que Hermes mantiene abierto. Si se reinicia, el borrador se pierde — por eso
 * `cerrar_cotizacion` guarda en Supabase en cuanto se aprueba, y no antes.
 */
const borradores = new Map<string, Borrador>();

const tomar = (sesion: string): Borrador => {
    const b = borradores.get(sesion);
    if (!b) throw new Error(
        'No hay una cotización abierta en esta conversación. ' +
        'Usa iniciar_cotizacion con el cliente y el nombre del proyecto.');
    return b;
};

function resumen(b: Borrador, iva: number): string {
    if (!b.items.length) return `Cotización para ${b.cliente} — ${b.proyecto}\n(sin partidas todavía)`;
    const t = totalesDe(b.items, iva);
    const lineas = b.items.map((i, n) =>
        `${n + 1}. ${i.description} — ${i.quantity} × ${pesos(i.unitPrice)} = ${pesos(importeDe(i))}`);
    return [
        `Cotización para ${b.cliente} — ${b.proyecto}`,
        `Fecha ${b.fecha} · entrega ${b.entrega}`,
        '',
        ...lineas,
        '',
        `Subtotal:  ${pesos(t.subtotal)}`,
        `IVA ${(iva * 100).toFixed(0)}%:   ${pesos(t.iva)}`,
        `TOTAL:     ${pesos(t.total)}`,
        ...(b.notas ? ['', `Notas: ${b.notas}`] : []),
        ...(b.avisos.length ? ['', 'Avisos:', ...b.avisos.map(a => `  · ${a}`)] : []),
    ].join('\n');
}

const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/**
 * Un bloque listo para copiar, en monoespaciado.
 *
 * Las columnas se alinean con espacios, y fuera de un bloque de código Discord
 * las dibuja con tipografía proporcional: la tabla sale chueca aunque el
 * modelo la copie bien.
 *
 * Y hay una razón más de fondo: pedirle al modelo que REDACTE una tabla de
 * cifras es pedirle que la reescriba, y un modelo chico la reescribe mal —
 * cambia un número, se salta un renglón, o se le va la respuesta entera.
 * Copiar un bloque es la operación más simple que se le puede pedir.
 *
 * OJO: Hermes ignora a propósito las rutas de archivo dentro de un bloque de
 * código, así que la ruta de un PDF nunca va aquí dentro.
 */
const bloque = (lineas: string[]) => '```\n' + lineas.join('\n') + '\n```';

const COPIA_TAL_CUAL =
    '\n\nCopia el bloque de arriba TAL CUAL en tu respuesta, con sus comillas ' +
    'invertidas incluidas, sin reescribirlo ni recalcular nada. Si quieres ' +
    'comentar algo, ponlo debajo del bloque.';

/**
 * Cómo pedirle al agente que entregue el archivo.
 *
 * El gateway de Hermes sube el PDF como adjunto nativo cuando detecta su ruta
 * absoluta en la respuesta, pero con dos reglas que hay que respetar o el
 * usuario recibe una ruta en vez del archivo:
 *
 *   1. Sólo mira el TEXTO FINAL del agente, no la salida de las herramientas.
 *   2. Ignora a propósito las rutas dentro de bloques de código o `comillas`
 *      invertidas, para no romper ejemplos de código.
 *
 * Los modelos tienden a formatear las rutas como código, que es justo lo que
 * la desactiva. Por eso se dice explícito.
 */
const comoEntregar = (ruta: string) =>
    `Para que el usuario reciba el PDF como archivo adjunto y no como texto, ` +
    `escribe esta ruta TAL CUAL en tu respuesta, en texto plano y en su propio ` +
    `renglón, SIN comillas invertidas y SIN bloque de código:\n${ruta}`;

// ── Servidor ─────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'mono-cotizador', version: '1.0.0' });

server.registerTool('ver_catalogo', {
    title: 'Ver catálogo de servicios',
    description:
        'Lista los servicios que Mono Atelier cotiza, con su precio base, unidad y variantes. ' +
        'Úsala ANTES de agregar una partida para saber qué existe y cómo se llama. ' +
        'Cada variante dice si SUSTITUYE el precio base, se SUMA a él, o no lo mueve.',
    inputSchema: {
        busqueda: z.string().optional()
            .describe('Texto para filtrar por nombre o categoría. Vacío = todo el catálogo.'),
    },
}, async ({ busqueda }) => {
    const { servicios, variantes } = await catalogo();
    const lista = busqueda ? buscarServicios(servicios, busqueda) : servicios;
    if (!lista.length) {
        return texto(`No hay servicios que coincidan con "${busqueda}". ` +
                     `Llama ver_catalogo sin búsqueda para ver todo.`);
    }

    const partes = lista.map(s => {
        const { sustituciones, adicionales, opciones } = clasificarVariantes(variantes, s.id);
        const l = [`${s.name}${s.category ? ` [${s.category}]` : ''} — ${pesos(s.basePrice)}${s.units ? ` por ${s.units}` : ''}`];
        if (s.description) l.push(`    ${s.description}`);
        const bloque = (titulo: string, vs: ServiceVariable[]) => {
            if (!vs.length) return;
            l.push(`    ${titulo}:`);
            for (const v of vs) {
                const aviso = sospechaDeClasificacion(s, v);
                l.push(`      - ${v.name}: ${v.price == null ? 'sin precio' : pesos(v.price)}` +
                       (v.units ? ` por ${v.units}` : '') + (aviso ? '   ⚠' : ''));
            }
        };
        bloque('SUSTITUYEN el precio base', sustituciones);
        bloque('SE SUMAN al precio base', adicionales);
        bloque('No mueven el precio', opciones);
        return l.join('\n');
    });

    return texto(partes.join('\n\n'));
});

server.registerTool('iniciar_cotizacion', {
    title: 'Iniciar una cotización',
    description:
        'Abre un borrador de cotización. Pregunta al usuario los datos que falten antes de llamarla. ' +
        'No guarda nada todavía: el borrador se arma con agregar_partida y sólo se guarda al cerrarlo.',
    inputSchema: {
        cliente: z.string().describe('Nombre del cliente como debe salir impreso.'),
        proyecto: z.string().describe('Nombre del proyecto.'),
        entrega: z.string().describe('Fecha comprometida de entrega, AAAA-MM-DD. El PDF imprime los días HÁBILES entre hoy y esa fecha.'),
        fecha: z.string().optional().describe('Fecha de la cotización AAAA-MM-DD. Por omisión, hoy.'),
        sesion: z.string().optional().describe('Identificador de la conversación. Úsalo si atiendes varias a la vez.'),
    },
}, async ({ cliente, proyecto, entrega, fecha, sesion }) => {
    const id = sesion ?? 'default';
    const hoy = new Date().toISOString().slice(0, 10);
    borradores.set(id, {
        cliente, proyecto, entrega, fecha: fecha ?? hoy, items: [], avisos: [],
    });
    const { tieneAjustes } = await catalogo();
    return texto(
        `Cotización abierta para ${cliente} — ${proyecto} (entrega ${entrega}).\n` +
        `Agrega partidas con agregar_partida.` +
        (tieneAjustes ? '' : '\n⚠ No encontré la tabla ajustes: usaré IVA 8% por omisión.'));
});

server.registerTool('agregar_partida', {
    title: 'Agregar una partida',
    description:
        'Agrega un servicio a la cotización. Tres formas de poner el precio, en este orden de preferencia:\n' +
        '1. De LISTA (lo normal): da `servicio` y `cantidad`; el precio sale del catálogo.\n' +
        '2. Por COSTO: da además `costo_directo` y se le aplica el margen objetivo del taller.\n' +
        '3. DICTADO: da `precio_directo` sólo si el usuario te dijo explícitamente el precio.\n' +
        'Nunca inventes un precio: si no lo sabes, consulta ver_catalogo o pregunta.',
    inputSchema: {
        servicio: z.string().describe('Nombre del servicio tal como aparece en el catálogo.'),
        cantidad: z.number().positive().describe('Cantidad en la unidad del servicio (metros lineales, piezas…).'),
        sustitucion: z.string().optional().describe('Nombre de la variante que SUSTITUYE el precio base.'),
        adicionales: z.array(z.string()).optional().describe('Nombres de las variantes que SE SUMAN.'),
        precio_directo: z.number().optional().describe('Precio unitario dictado por el usuario. Reemplaza al del catálogo.'),
        costo_directo: z.number().optional().describe('Costo directo unitario; el precio sale de aplicarle el margen objetivo.'),
        sesion: z.string().optional(),
    },
}, async ({ servicio, cantidad, sustitucion, adicionales, precio_directo, costo_directo, sesion }) => {
    const b = tomar(sesion ?? 'default');
    const { servicios, variantes, iva, margen } = await catalogo();

    const candidatos = buscarServicios(servicios, servicio);
    if (!candidatos.length) {
        return texto(`No encontré ningún servicio parecido a "${servicio}". ` +
                     `Llama ver_catalogo para ver los nombres exactos.`);
    }
    // Ambigüedad: preguntar, no elegir. Un servicio mal elegido es una
    // cotización mal hecha, y el cliente la recibe sin que nadie lo note.
    if (candidatos.length > 1 &&
        candidatos[0].name.toLowerCase() !== servicio.toLowerCase().trim()) {
        return texto(
            `"${servicio}" coincide con varios servicios. Pregunta al usuario cuál:\n` +
            candidatos.slice(0, 6).map(s => `  · ${s.name} — ${pesos(s.basePrice)}${s.units ? `/${s.units}` : ''}`).join('\n'));
    }
    const s = candidatos[0];
    const { sustituciones, adicionales: disponibles } = clasificarVariantes(variantes, s.id);

    const buscarVar = (nombre: string, lista: ServiceVariable[]) =>
        lista.find(v => v.name.toLowerCase().trim() === nombre.toLowerCase().trim())
        ?? lista.find(v => v.name.toLowerCase().includes(nombre.toLowerCase().trim()));

    let sus: ServiceVariable | null = null;
    if (sustitucion) {
        sus = buscarVar(sustitucion, sustituciones) ?? null;
        if (!sus) {
            const alt = buscarVar(sustitucion, disponibles);
            if (alt) {
                return texto(`"${alt.name}" no sustituye el precio: se SUMA. ` +
                             `Pásala en "adicionales", no en "sustitucion".`);
            }
            return texto(`"${sustitucion}" no es una variante de ${s.name}. ` +
                         `Opciones: ${sustituciones.map(v => v.name).join(', ') || 'ninguna'}.`);
        }
        const aviso = sospechaDeClasificacion(s, sus);
        if (aviso && !b.avisos.includes(aviso)) b.avisos.push(aviso);
    }

    const ads: ServiceVariable[] = [];
    for (const nombre of adicionales ?? []) {
        const v = buscarVar(nombre, disponibles);
        if (!v) {
            return texto(`"${nombre}" no es un adicional de ${s.name}. ` +
                         `Disponibles: ${disponibles.map(x => x.name).join(', ') || 'ninguno'}.`);
        }
        ads.push(v);
    }

    // Las tres rutas de precio
    let nuevas: QuoteItem[];
    if (precio_directo != null) {
        nuevas = [{ description: sus ? `${s.name} - ${sus.name}` : s.name, quantity: cantidad, unitPrice: precio_directo }];
        for (const a of ads) nuevas.push({ description: a.name, quantity: cantidadDe(a, s, cantidad), unitPrice: Number(a.price) || 0 });
    } else if (costo_directo != null) {
        if (margen == null) {
            return texto('No hay margen objetivo configurado en ajustes, así que no puedo ' +
                         'sacar el precio desde el costo. Captúralo en la pantalla de Precios ' +
                         '(margen_objetivo) o dime el precio directo.');
        }
        const p = precioDesdeCosto(costo_directo, margen);
        nuevas = [{ description: sus ? `${s.name} - ${sus.name}` : s.name, quantity: cantidad, unitPrice: p }];
        for (const a of ads) nuevas.push({ description: a.name, quantity: cantidadDe(a, s, cantidad), unitPrice: Number(a.price) || 0 });
    } else {
        nuevas = partidasDe({ servicio: s, cantidad, sustitucion: sus, adicionales: ads });
    }

    b.items.push(...nuevas);

    const detalle = nuevas.map(i => `  ${i.quantity} × ${i.description} @ ${pesos(i.unitPrice)} = ${pesos(importeDe(i))}`).join('\n');
    const t = totalesDe(b.items, iva);
    return texto(
        `Agregado:\n${detalle}\n\nSubtotal de la cotización: ${pesos(t.subtotal)} · ` +
        `con IVA ${(iva * 100).toFixed(0)}%: ${pesos(t.total)}` +
        (costo_directo != null ? `\n(precio derivado del costo con margen ${(margen! * 100).toFixed(0)}%)` : ''));
});

server.registerTool('agregar_concepto', {
    title: 'Agregar un concepto fuera de catálogo',
    description:
        'Agrega una partida que NO existe en el catálogo: tú dictas la descripción, la cantidad, ' +
        'la unidad y el precio. Para proyectos específicos, trabajos únicos o cualquier cosa que ' +
        'no esté en la lista de servicios.\n' +
        'El precio se puede dar de dos formas: `precio_unitario` (lo que se le cobra al cliente) ' +
        'o `costo_directo` (lo que cuesta producirlo, al que se le aplica el margen objetivo).\n' +
        'Si el concepto SÍ está en el catálogo, usa agregar_partida: así el precio sale de la ' +
        'lista y no de lo que alguien recuerde.',
    inputSchema: {
        descripcion: z.string().min(1).describe('Qué es, como debe salir impreso en la cotización.'),
        cantidad: z.number().positive().optional()
            .describe('Cuántas unidades. Si te dan medidas en lugar de cantidad, usa `medidas` y NO calcules tú.'),
        medidas: z.object({
            largo: z.number().positive().describe('Largo en metros.'),
            ancho: z.number().positive().optional().describe('Ancho en metros (superficies horizontales).'),
            alto: z.number().positive().optional().describe('Alto en metros (muros). Es la misma dimensión que ancho: usa uno u otro.'),
            piezas: z.number().positive().optional().describe('Cuántas repeticiones de esa medida.'),
        }).optional().describe(
            'Medidas en METROS. El servidor calcula la cantidad y te devuelve la operación. ' +
            'Con largo solo sale metro lineal; con largo y ancho (o alto) sale metro cuadrado.'),
        unidad: z.string().optional().describe('Unidad de medida (m², ml, pieza, servicio…). Con `medidas` se deduce sola.'),
        precio_unitario: z.number().nonnegative().optional().describe('Precio por unidad que se le cobra al cliente.'),
        costo_directo: z.number().nonnegative().optional().describe('Costo por unidad; el precio sale de aplicarle el margen objetivo.'),
        costo_materiales: z.number().nonnegative().optional().describe('Costo de materiales por unidad. Se suma a la mano de obra.'),
        costo_mano_obra: z.number().nonnegative().optional().describe('Costo de mano de obra por unidad. Se suma a los materiales.'),
        notas: z.string().optional().describe('Nota que acompaña a la cotización (condiciones, alcances, exclusiones).'),
        sesion: z.string().optional(),
    },
}, async ({ descripcion, cantidad, medidas, unidad, precio_unitario, costo_directo,
            costo_materiales, costo_mano_obra, notas, sesion }) => {
    const b = tomar(sesion ?? 'default');
    const { iva, margen } = await catalogo();

    // ── cantidad: dictada o calculada de las medidas ─────────────────────
    let deMedidas = '';
    if (medidas) {
        if (cantidad != null) {
            return texto('Mandaste `cantidad` y `medidas` a la vez. Usa una sola: si tienes las ' +
                         'medidas manda sólo ésas y yo saco la cantidad.');
        }
        try {
            const c = cantidadDeMedidas(medidas);
            cantidad = c.cantidad;
            unidad = unidad ?? c.unidad;
            deMedidas = c.explicacion;
        } catch (e: any) {
            if (e instanceof MedidasInvalidas) return texto(e.message);
            throw e;
        }
    }
    if (cantidad == null) {
        return texto('Falta la cantidad. Dame `cantidad`, o `medidas` (largo, y ancho o alto) ' +
                     'y yo la calculo.');
    }

    // ── costo por partes, si viene desglosado ────────────────────────────
    let desglosaCosto = '';
    if (costo_materiales != null || costo_mano_obra != null) {
        if (costo_directo != null) {
            return texto('Mandaste `costo_directo` y además el desglose por materiales/mano de obra. ' +
                         'Usa uno solo: o el costo total, o sus partes.');
        }
        const mat = costo_materiales ?? 0;
        const mo = costo_mano_obra ?? 0;
        costo_directo = redondear(mat + mo);
        desglosaCosto = ` (materiales ${pesos(mat)} + mano de obra ${pesos(mo)})`;
    }

    // Uno de los dos, no los dos ni ninguno: si el modelo manda ambos habría
    // que elegir por él, y elegir precio por alguien más es justo lo que este
    // servidor no hace.
    if (precio_unitario == null && costo_directo == null) {
        return texto('Falta el precio: manda `precio_unitario` (lo que se cobra) o ' +
                     '`costo_directo` (lo que cuesta, para aplicarle el margen). ' +
                     'Si no lo sabes, pregúntaselo al usuario.');
    }
    if (precio_unitario != null && costo_directo != null) {
        return texto('Mandaste `precio_unitario` y `costo_directo` a la vez y no sé cuál quiere ' +
                     'el usuario. Pregúntale y manda sólo uno.');
    }

    let unitario: number;
    let comoSeCalculo = '';
    if (precio_unitario != null) {
        unitario = redondear(precio_unitario);
    } else {
        if (margen == null || margen <= 0) {
            return texto('No hay margen objetivo configurado en ajustes, así que no puedo sacar ' +
                         'el precio desde el costo. Captúralo en la pantalla de Precios ' +
                         '(margen_objetivo) o dime el precio directo.');
        }
        unitario = precioDesdeCosto(costo_directo!, margen);
        comoSeCalculo = ` (de un costo de ${pesos(costo_directo!)}${desglosaCosto} ` +
                        `con margen ${(margen * 100).toFixed(0)}%)`;
    }

    // La unidad va pegada a la descripción porque la plantilla sólo tiene
    // columnas de Descripción, Cantidad, Costo e Importe: no hay dónde
    // imprimirla aparte, y perderla dejaría "4 × Lambrín" sin decir 4 de qué.
    const linea: QuoteItem = {
        description: unidad ? `${descripcion.trim()} (${unidad.trim()})` : descripcion.trim(),
        quantity: cantidad,
        unitPrice: unitario,
    };
    b.items.push(linea);

    if (notas?.trim()) {
        b.notas = [b.notas, notas.trim()].filter(Boolean).join(' · ');
    }

    const t = totalesDe(b.items, iva);
    return texto(
        (deMedidas ? `Medidas: ${deMedidas}\n` : '') +
        `Agregado:\n  ${linea.quantity} × ${linea.description} @ ${pesos(linea.unitPrice)} = ` +
        `${pesos(importeDe(linea))}${comoSeCalculo}\n` +
        (notas?.trim() ? `Nota registrada: "${notas.trim()}"\n` : '') +
        `\nSubtotal de la cotización: ${pesos(t.subtotal)} · ` +
        `con IVA ${(iva * 100).toFixed(0)}%: ${pesos(t.total)}`);
});

server.registerTool('ver_borrador', {
    title: 'Ver la cotización en curso',
    description:
        'Muestra las partidas y los totales. Enséñaselo al usuario y PIDE SU APROBACIÓN ' +
        'antes de cerrar la cotización y generar el PDF.',
    inputSchema: { sesion: z.string().optional() },
}, async ({ sesion }) => {
    const b = tomar(sesion ?? 'default');
    const { iva } = await catalogo();
    return texto(resumen(b, iva));
});

server.registerTool('quitar_partida', {
    title: 'Quitar una partida',
    description: 'Elimina una partida por su número, tal como lo muestra ver_borrador.',
    inputSchema: {
        numero: z.number().int().positive().describe('Número de la partida (empezando en 1).'),
        sesion: z.string().optional(),
    },
}, async ({ numero, sesion }) => {
    const b = tomar(sesion ?? 'default');
    if (numero > b.items.length) {
        return texto(`Sólo hay ${b.items.length} partida(s). Llama ver_borrador para verlas.`);
    }
    const [fuera] = b.items.splice(numero - 1, 1);
    const { iva } = await catalogo();
    return texto(`Quitada: ${fuera.description}.\n\n${resumen(b, iva)}`);
});

server.registerTool('cerrar_cotizacion', {
    title: 'Cerrar la cotización y generar el PDF',
    description:
        'Guarda la cotización y genera el PDF. Llámala SÓLO después de que el usuario haya ' +
        'visto los totales con ver_borrador y los haya aprobado explícitamente. ' +
        'Devuelve la ruta del archivo para que lo adjuntes en el chat.',
    inputSchema: {
        notas: z.string().optional().describe('Notas que salen impresas (máx. 80 caracteres visibles).'),
        sesion: z.string().optional(),
    },
}, async ({ notas, sesion }) => {
    const id = sesion ?? 'default';
    const b = tomar(id);
    if (!b.items.length) return texto('La cotización no tiene partidas. Agrega al menos una.');

    const { iva } = await catalogo();
    // Se acumulan: si agregar_concepto ya dejó notas, reemplazarlas aquí
    // borraría condiciones que el usuario ya dictó.
    if (notas?.trim()) b.notas = [b.notas, notas.trim()].filter(Boolean).join(' · ');
    const t = totalesDe(b.items, iva);

    const quote: Quote = {
        id: '', projectName: b.proyecto, clientName: b.cliente,
        deliveryTime: b.entrega, date: b.fecha, items: b.items,
        notes: b.notas, status: 'Draft', totalAmount: t.subtotal,
    };

    // Primero el PDF: si falla, no queda una cotización guardada sin documento.
    let plantilla: Buffer;
    try {
        plantilla = readFileSync(PLANTILLA());
    } catch {
        return texto(`No encontré la plantilla en ${PLANTILLA()}. ` +
                     `Define COTIZADOR_PLANTILLA con la ruta al PDF.`);
    }
    const bytes = await generarCotizacionPdf(quote, { plantilla, iva });

    mkdirSync(SALIDA(), { recursive: true });
    const limpio = `${b.cliente}_${b.proyecto}`.replace(/[^\w\-]+/g, '_').slice(0, 60);
    const ruta = join(SALIDA(), `Cotizacion_${limpio}_${Date.now()}.pdf`);
    writeFileSync(ruta, bytes);

    let guardado = '';
    try {
        const fila = await guardarCotizacion({ ...quote, status: 'Draft' });
        guardado = fila?.id ? `Guardada en la plataforma (id ${fila.id}).` : 'Guardada en la plataforma.';
    } catch (e: any) {
        // El PDF ya existe: decirlo es mejor que fingir que todo salió bien.
        guardado = `⚠ El PDF se generó pero NO se pudo guardar en la plataforma: ${e.message}`;
    }

    borradores.delete(id);
    return texto(
        `${resumen({ ...b, avisos: [] }, iva)}\n\n` +
        `${guardado}\n\n${comoEntregar(ruta)}`);
});

server.registerTool('guardar_en_catalogo', {
    title: 'Dar de alta un concepto en el catálogo',
    description:
        'Registra un concepto en la lista maestra de servicios para poder cotizarlo después ' +
        'sin volver a dictar el precio. Úsala cuando el usuario diga que algo que acaba de ' +
        'cotizar se repite, o pida explícitamente guardarlo.\n' +
        'Puede tomar los datos de una partida del borrador (`desde_partida`) o recibirlos ' +
        'directo. Avisa si ya existe algo con nombre parecido en vez de duplicarlo.',
    inputSchema: {
        desde_partida: z.number().int().positive().optional()
            .describe('Número de partida del borrador, como la muestra ver_borrador. Toma de ahí descripción y precio.'),
        nombre: z.string().optional().describe('Nombre del servicio en el catálogo. Con desde_partida, por omisión usa su descripción.'),
        precio_base: z.number().nonnegative().optional().describe('Precio de venta por unidad.'),
        costo: z.number().nonnegative().optional().describe('Lo que cuesta producirlo. Sin esto no se puede saber el margen después.'),
        unidad: z.string().optional().describe('Unidad (ml, m², pieza, servicio…).'),
        categoria: z.string().optional().describe('Categoría para agruparlo en el catálogo.'),
        descripcion: z.string().optional().describe('Descripción larga, para reconocerlo dentro de un año.'),
        confirmar_duplicado: z.boolean().optional()
            .describe('Ponlo en true sólo si el usuario ya confirmó que quiere darlo de alta aunque exista uno parecido.'),
        sesion: z.string().optional(),
    },
}, async ({ desde_partida, nombre, precio_base, costo, unidad, categoria, descripcion,
            confirmar_duplicado, sesion }) => {
    // De una partida del borrador, o de lo que manden suelto.
    if (desde_partida != null) {
        const b = tomar(sesion ?? 'default');
        if (desde_partida > b.items.length) {
            return texto(`El borrador sólo tiene ${b.items.length} partida(s). Llama ver_borrador.`);
        }
        const p = b.items[desde_partida - 1];
        // La unidad se guardó pegada a la descripción al capturarla: se separa
        // para que el catálogo la tenga en su columna y no dentro del nombre.
        const m = /^(.*?)\s*\(([^()]{1,12})\)\s*$/.exec(p.description);
        nombre = nombre ?? (m ? m[1] : p.description);
        unidad = unidad ?? (m ? m[2] : undefined);
        precio_base = precio_base ?? p.unitPrice;
    }

    if (!nombre?.trim()) return texto('Falta el nombre con el que se va a guardar en el catálogo.');
    if (precio_base == null) {
        return texto('Falta el precio de venta. Dímelo, o usa `desde_partida` para tomarlo de una ' +
                     'partida que ya esté en el borrador.');
    }

    // Un catálogo con "Cocina", "Cocinas" y "Cocina minimalista" es justo el
    // desorden que ya costó trabajo limpiar: mejor preguntar que duplicar.
    if (!confirmar_duplicado) {
        const { servicios } = await catalogo();
        const parecidos = buscarServicios(servicios, nombre).slice(0, 4);
        if (parecidos.length) {
            return texto(
                `Ya hay servicios parecidos a "${nombre}" en el catálogo:\n` +
                parecidos.map(s => `  · ${s.name} — ${pesos(s.basePrice)}${s.units ? `/${s.units}` : ''}`).join('\n') +
                `\n\nPregúntale al usuario si quiere dar de alta uno nuevo de todos modos ` +
                `(entonces vuelve a llamarme con confirmar_duplicado=true) o si prefiere ` +
                `cotizar con alguno de esos.`);
        }
    }

    let fila;
    try {
        fila = await crearServicio({
            name: nombre.trim(),
            category: categoria ?? null,
            description: descripcion ?? null,
            base_price: redondear(precio_base),
            cost: costo == null ? null : redondear(costo),
            units: unidad ?? null,
        });
    } catch (e: any) {
        return texto(`No se pudo guardar en el catálogo: ${e.message}`);
    }

    const m = margenDe(redondear(precio_base), costo == null ? null : redondear(costo));
    return texto(
        `Dado de alta en el catálogo:\n` +
        `  ${fila?.name ?? nombre} — ${pesos(redondear(precio_base))}${unidad ? `/${unidad}` : ''}` +
        (m != null ? ` · margen ${(m * 100).toFixed(1)}%` : ' · sin costo cargado') + '\n\n' +
        (costo == null
            ? 'Sin costo no se puede saber si ese precio deja margen. Conviene capturarlo en la pantalla de Precios.'
            : 'Ya se puede cotizar con agregar_partida usando ese nombre.'));
});

// ── Datos de venta ───────────────────────────────────────────────────────

/**
 * El margen y el costo NO son información de cliente.
 *
 * Es la misma regla que en mono-forge, donde hay un test que abre los PDF en
 * binario y falla si el margen se filtró a un documento del cliente. Aquí no
 * hay cómo impedirlo por código —el agente redacta texto libre— así que se
 * dice en cada respuesta que los lleva.
 */
const SOLO_INTERNO =
    '\n\n⚠ INTERNO: los costos y márgenes de arriba son para Julio, NUNCA para ' +
    'un cliente. No los copies a una cotización, a un correo ni a un mensaje ' +
    'dirigido a un cliente.';

const mes = (f?: string | null) => (f ?? '').slice(0, 7);

/**
 * Las tablas se leen en un chat, no en una hoja.
 *
 * Un renglón de 136 caracteres dentro de un bloque de código se sale del ancho
 * de Discord y hay que arrastrarlo de lado; en un teléfono es ilegible. El
 * tope son 76, que es lo que entra sin scroll horizontal.
 */
const ANCHO = 76;

/**
 * Parte un párrafo en renglones que quepan en el ancho del chat.
 *
 * Dentro de un bloque de código el texto NO se acomoda solo: una nota de tres
 * líneas escrita de corrido sale como un solo renglón larguísimo que hay que
 * arrastrar. Se parte aquí, en palabras enteras.
 */
function renglones(t: string, ancho = ANCHO): string[] {
    const out: string[] = [];
    let linea = '';
    for (const palabra of t.split(/\s+/)) {
        if (linea && `${linea} ${palabra}`.length > ancho) { out.push(linea); linea = palabra; }
        else linea = linea ? `${linea} ${palabra}` : palabra;
    }
    if (linea) out.push(linea);
    return out;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                      'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const mesCorto = (m: string) => {
    const [a, n] = m.split('-');
    const i = Number(n) - 1;
    return MESES_CORTOS[i] ? `${MESES_CORTOS[i]} ${a}` : m;
};

const nombreMes = (m: string) => {
    const [a, n] = m.split('-');
    const d = new Date(Number(a), Number(n) - 1, 1);
    return isNaN(d.getTime()) ? m
        : d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
};

/** Rango por omisión: los últimos 12 meses completos más el corriente. */
function rango(desde?: string, hasta?: string) {
    const hoy = new Date();
    const fin = hasta ?? hoy.toISOString().slice(0, 10);
    const ini = desde ?? new Date(hoy.getFullYear(), hoy.getMonth() - 11, 1)
        .toISOString().slice(0, 10);
    return { desde: ini, hasta: fin };
}

interface MesVentas {
    mes: string; cotizado: number; vendido: number;
    costo: number; facturado: number; n: number;
    /** De lo cotizado ESE mes, cuánto acabó cerrándose — en cualquier mes
     *  posterior. Así se mide la conversión sin cruzar cohortes. */
    convertido: number;
}

interface Ventas {
    desde: string; hasta: string;
    meses: MesVentas[];
    total: MesVentas;
    /** Proyectos que no dicen en qué mes entró la venta. */
    sinFecha: FilaProyecto[];
    /** Si NINGUNA cotización del periodo trae proyecto ligado, la conversión no
     *  es 0%: es que todavía no se sabe. El enlace existe desde la migración
     *  20260925 y lo viejo no lo tiene. */
    conversionMedible: boolean;
}

/**
 * Los números del periodo, una sola vez.
 *
 * El texto del chat y el PDF del reporte salen de aquí los dos. Si cada uno
 * sumara por su cuenta, el día que cambie una regla —qué factura cuenta, con
 * qué fecha— quedaría cambiada en uno y no en el otro, y el PDF diría una cosa
 * y el chat otra sobre el mismo mes.
 */
async function juntarVentas(desde?: string, hasta?: string): Promise<Ventas> {
    const r = rango(desde, hasta);
    const [proyectos, huerfanos, facturas, cotizaciones, vendidas] = await Promise.all([
        leerProyectos(r.desde, r.hasta),
        leerProyectosSinFechaDeVenta().catch(() => [] as FilaProyecto[]),
        leerFacturas(r.desde, r.hasta).catch(() => [] as FilaFactura[]),
        leerCotizacionesTodas().catch(() => [] as FilaCotizacion[]),
        leerCotizacionesVendidas().catch(() => new Set<string>()),
    ]);

    const mapa = new Map<string, MesVentas>();
    const fila = (m: string) => {
        if (!mapa.has(m)) mapa.set(m, {
            mes: m, cotizado: 0, vendido: 0, costo: 0, facturado: 0, n: 0, convertido: 0,
        });
        return mapa.get(m)!;
    };
    const dentro = (m: string) => !!m && m >= mes(r.desde) && m <= mes(r.hasta);

    let algunaLigada = false;
    for (const c of cotizaciones) {
        const m = mes(c.date ?? c.created_at);
        if (!dentro(m)) continue;
        const f = fila(m);
        f.cotizado += Number(c.total_amount) || 0;
        if (vendidas.has(c.id)) {
            f.convertido += Number(c.total_amount) || 0;
            algunaLigada = true;
        }
    }
    for (const p of proyectos) {
        if (!p.sold_at) continue;   // el filtro del servidor ya los excluyó
        const f = fila(mes(p.sold_at));
        f.vendido += Number(p.budget) || 0;
        f.costo += Number(p.live_cost) || 0;
        f.n++;
    }
    // Las de sandbox nunca llegaron al SAT y las canceladas ya no existen:
    // ninguna de las dos es ingreso.
    for (const f of facturas) {
        if (f.modo === 'test' || f.status === 'canceled') continue;
        const m = mes(f.date ?? f.created_at);
        if (!dentro(m)) continue;
        fila(m).facturado += Number(f.total) || 0;
    }

    const meses = [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes));
    const total = meses.reduce<MesVentas>((a, v) => ({
        mes: 'total', cotizado: a.cotizado + v.cotizado, vendido: a.vendido + v.vendido,
        costo: a.costo + v.costo, facturado: a.facturado + v.facturado, n: a.n + v.n,
        convertido: a.convertido + v.convertido,
    }), { mes: 'total', cotizado: 0, vendido: 0, costo: 0, facturado: 0, n: 0, convertido: 0 });

    return {
        desde: r.desde, hasta: r.hasta, meses, total,
        sinFecha: huerfanos, conversionMedible: algunaLigada,
    };
}

const porcentaje = (parte: number, sobre: number, dec = 0) =>
    sobre > 0 ? `${((parte / sobre) * 100).toFixed(dec)}%` : '—';

/** Margen del periodo. Devuelve null cuando no hay costo capturado: un 100%
 *  por falta de datos se lee como negocio redondo y es un dato que no existe. */
const margenDelMes = (v: { vendido: number; costo: number }) =>
    v.vendido > 0 && v.costo > 0 ? (v.vendido - v.costo) / v.vendido : null;

server.registerTool('resumen_ventas', {
    title: 'Resumen de ventas por mes',
    description:
        'Qué se ofertó, qué se vendió y qué se facturó, mes por mes. Responde preguntas como ' +
        '"¿cuánto vendimos este trimestre?" o "¿cómo vamos contra el mes pasado?".\n' +
        'Cada cifra usa SU fecha: lo cotizado por fecha de cotización, lo vendido por la fecha ' +
        'en que la cotización se volvió proyecto, y lo facturado por la fecha de la factura. ' +
        'Son tres momentos distintos y mezclarlos da números que no cuadran.\n' +
        'Incluye margen, que es información INTERNA.',
    inputSchema: {
        desde: z.string().optional().describe('Fecha inicial AAAA-MM-DD. Por omisión, hace 12 meses.'),
        hasta: z.string().optional().describe('Fecha final AAAA-MM-DD. Por omisión, hoy.'),
    },
}, async ({ desde, hasta }) => {
    const v = await juntarVentas(desde, hasta);
    if (!v.meses.length) return texto(`No hay movimientos entre ${v.desde} y ${v.hasta}.`);

    // Tabla en columnas con encabezado, en vez de repetir "cotizado"/"vendido"
    // en cada renglón: los rótulos repetidos gastaban 40 caracteres por línea
    // y empujaban la tabla más allá del ancho del chat.
    const fila = (c1: string, c2: string, c3: string, c4: string,
                  c5: string, c6: string, c7: string) =>
        `${c1.padEnd(9)}${c2.padStart(13)}${c3.padStart(13)}${c4.padStart(3)}` +
        `${c5.padStart(13)}${c6.padStart(8)}${c7.padStart(6)}`;

    const mgTotal = margenDelMes(v.total);
    const partes = [
        `Ventas de ${v.desde} a ${v.hasta}`,
        '',
        fila('mes', 'cotizado', 'vendido', '#', 'facturado', 'margen', 'conv'),
        '─'.repeat(ANCHO - 11),
        ...v.meses.map(m => {
            const mg = margenDelMes(m);
            return fila(
                mesCorto(m.mes), pesos(m.cotizado), pesos(m.vendido), String(m.n),
                pesos(m.facturado),
                mg == null ? '—' : porcentaje(mg, 1),
                v.conversionMedible && m.cotizado > 0
                    ? porcentaje(m.convertido, m.cotizado) : '—');
        }),
        '─'.repeat(ANCHO - 11),
        fila('TOTAL', pesos(v.total.cotizado), pesos(v.total.vendido), String(v.total.n),
            pesos(v.total.facturado),
            mgTotal == null ? '—' : porcentaje(mgTotal, 1, 1),
            v.conversionMedible && v.total.cotizado > 0
                ? porcentaje(v.total.convertido, v.total.cotizado) : '—'),
        '',
    ];
    if (mgTotal == null) {
        partes.push(...renglones(
            'Margen no calculable: falta capturar el costo real de los proyectos.'));
    }
    // Conversión por cohorte: de lo COTIZADO en el periodo, cuánto se cerró.
    // No es lo vendido entre lo cotizado del mismo mes — eso compara la venta
    // de noviembre contra la oferta de noviembre, cuando la que se cerró era
    // la de septiembre, y sale un 300%.
    if (!v.conversionMedible) {
        partes.push(...renglones(
            'conv: no medible todavía. Se calcula ligando cada cotización con el ' +
            'proyecto en que se convirtió, y ese enlace se guarda desde ahora; las ' +
            'cotizaciones anteriores no lo traen.'));
    } else {
        partes.push(...renglones(
            'conv: de lo cotizado en ese mes, cuánto acabó cerrándose — aunque se ' +
            'cerrara meses después.'));
    }
    if (v.sinFecha.length) {
        partes.push(
            '',
            ...renglones(`⚠ ${v.sinFecha.length} proyecto(s) sin fecha de venta — no entran en ningún mes:`),
            ...v.sinFecha.slice(0, 8).map(p =>
                `   · ${(p.name ?? p.id).slice(0, 40)} (${pesos(Number(p.budget) || 0)})`),
            ...renglones('Se arregla asignándoles su fecha de venta en la pantalla de Proyectos.'));
    }
    return texto(bloque(partes) + COPIA_TAL_CUAL + SOLO_INTERNO);
});

server.registerTool('ventas_por_cliente', {
    title: 'Ventas y margen por cliente',
    description:
        'Cuánto se le ha vendido y facturado a cada cliente, y con qué margen. Responde ' +
        '"¿quién es mi mejor cliente?" o "¿cuál me deja más margen?". Información INTERNA.',
    inputSchema: {
        desde: z.string().optional().describe('Fecha inicial AAAA-MM-DD.'),
        hasta: z.string().optional().describe('Fecha final AAAA-MM-DD.'),
        limite: z.number().int().min(1).max(50).optional().describe('Cuántos clientes mostrar. Por omisión 10.'),
    },
}, async ({ desde, hasta, limite }) => {
    const r = rango(desde, hasta);
    const clientes = await juntarClientes(r.desde, r.hasta, limite ?? 10);
    if (!clientes.length) return texto(`Sin movimientos entre ${r.desde} y ${r.hasta}.`);

    const fila = (c1: string, c2: string, c3: string, c4: string, c5: string) =>
        `${c1.slice(0, 23).padEnd(24)}${c2.padStart(14)}${c3.padStart(3)}` +
        `${c4.padStart(14)}${c5.padStart(8)}`;

    return texto(bloque([
        `Clientes de ${r.desde} a ${r.hasta} (por venta)`,
        '',
        fila('cliente', 'vendido', '#', 'facturado', 'margen'),
        '─'.repeat(63),
        ...clientes.map(v => {
            const mg = margenDelMes(v);
            return fila(v.nombre, pesos(v.vendido), String(v.n), pesos(v.facturado),
                mg == null ? '—' : porcentaje(mg, 1));
        }),
    ]) + COPIA_TAL_CUAL + SOLO_INTERNO);
});

/**
 * Ventas por cliente, de mayor a menor.
 *
 * El nombre viene de `clients` por `client_id` para los proyectos, y del
 * nombre impreso en la factura para lo facturado. No siempre coinciden —el
 * CFDI lleva la razón social y el proyecto puede estar a nombre de la persona—
 * y forzarlos a cuadrar aquí sería inventar una relación que la base no tiene.
 */
async function juntarClientes(desde: string, hasta: string, limite: number): Promise<ClienteDeVentas[]> {
    const [proyectos, facturas, clientes] = await Promise.all([
        leerProyectos(desde, hasta),
        leerFacturas(desde, hasta).catch(() => [] as FilaFactura[]),
        leerClientesMin().catch(() => [] as any[]),
    ]);
    const nombreDe = new Map<string, string>(
        clientes.map(c => [String(c.id), String(c.fiscal_name || c.full_name || c.id)]));

    const acc = new Map<string, ClienteDeVentas>();
    const f = (nombre: string) => {
        if (!acc.has(nombre)) acc.set(nombre, { nombre, vendido: 0, costo: 0, facturado: 0, n: 0 });
        return acc.get(nombre)!;
    };
    for (const p of proyectos) {
        const x = f(nombreDe.get(p.client_id ?? '') ?? 'sin cliente');
        x.vendido += Number(p.budget) || 0;
        x.costo += Number(p.live_cost) || 0;
        x.n++;
    }
    for (const fa of facturas) {
        if (fa.modo === 'test' || fa.status === 'canceled') continue;
        f(fa.client_name ?? 'sin cliente').facturado += Number(fa.total) || 0;
    }
    return [...acc.values()].sort((a, b) => b.vendido - a.vendido).slice(0, limite);
}

server.registerTool('reporte_ventas', {
    title: 'Reporte de ventas en PDF',
    description:
        'El mismo resumen de ventas, pero como PDF con el formato de la plataforma: A4 ' +
        'horizontal, encabezado, tarjetas de resumen y tabla por mes, más el detalle por ' +
        'cliente. Úsalo cuando pidan "un reporte", "mándame el PDF" o algo para guardar o ' +
        'imprimir; para responder una cifra suelta basta resumen_ventas.\n' +
        'El documento lleva costos y márgenes y sale marcado de USO INTERNO. Es para Julio, ' +
        'NO se le manda a un cliente.',
    inputSchema: {
        desde: z.string().optional().describe('Fecha inicial AAAA-MM-DD. Por omisión, hace 12 meses.'),
        hasta: z.string().optional().describe('Fecha final AAAA-MM-DD. Por omisión, hoy.'),
        clientes: z.boolean().optional().describe('Incluir el desglose por cliente. Por omisión sí.'),
    },
}, async ({ desde, hasta, clientes }) => {
    const v = await juntarVentas(desde, hasta);
    if (!v.meses.length) return texto(`No hay movimientos entre ${v.desde} y ${v.hasta}: no hay qué reportar.`);

    const porCliente = clientes === false ? undefined
        : await juntarClientes(v.desde, v.hasta, 15);

    const bytes = await generarReporteVentasPdf({
        desde: v.desde, hasta: v.hasta,
        meses: v.meses,
        clientes: porCliente,
        conversionMedible: v.conversionMedible,
        sinFechaDeVenta: v.sinFecha.map(p => ({
            nombre: p.name ?? p.id, monto: Number(p.budget) || 0,
        })),
    });

    mkdirSync(SALIDA(), { recursive: true });
    const archivo = `Reporte-ventas-${v.desde}-a-${v.hasta}.pdf`;
    const ruta = join(SALIDA(), archivo);
    writeFileSync(ruta, bytes);

    const mg = margenDelMes(v.total);
    return texto(
        `Reporte listo: ${v.meses.length} mes(es), ${v.desde} a ${v.hasta}.\n` +
        `Vendido ${pesos(v.total.vendido)} · facturado ${pesos(v.total.facturado)}` +
        (mg == null ? '' : ` · margen ${porcentaje(mg, 1, 1)}`) + '\n\n' +
        comoEntregar(ruta) + SOLO_INTERNO);
});

// ── Proyectos y cobranza ─────────────────────────────────────────────────

/**
 * Nada de lo que sale de aquí lleva costo ni margen, a propósito.
 *
 * Un estado de cuenta es justo el documento que uno acaba reenviándole al
 * cliente —"te debo esto", "ya te pagué aquello"— y si trajera el margen, el
 * descuido sería cuestión de tiempo. Lo que se cobra y lo que se debe son
 * cifras que el cliente ya conoce; lo que costó hacerlo, no. Para margen está
 * `resumen_ventas`, que sí va marcado como interno.
 */

/** Los estados vienen como "In Progress" o "In_Progress" según quién escribió. */
const estadoNormal = (s?: string | null) => (s ?? '').replace(/_/g, ' ').trim();
const MUERTOS = ['Cancelled', 'No Achieve'];
const vivo = (s?: string | null) => !MUERTOS.includes(estadoNormal(s));
const enMarcha = (s?: string | null) => estadoNormal(s) === 'In Progress';

interface ProyectoConSaldo {
    id: string; nombre: string; cliente: string; estado: string;
    contratado: number; pagado: number; saldo: number;
    inicio: string; entrega: string; vendido: string;
    ultimoAbono: string | null;
}

/**
 * Proyectos con su cobranza al día.
 *
 * El saldo sale de la tabla `payments`, sumando abonos por proyecto, igual que
 * lo calcula la pantalla de Financials. No se usa `downpayment`: ése es el
 * anticipo pactado, no lo que entró.
 */
async function juntarProyectos(): Promise<ProyectoConSaldo[]> {
    const [proyectos, clientes] = await Promise.all([
        leerProyectosTodos(),
        leerClientesMin().catch(() => [] as any[]),
    ]);
    const pagos = await leerPagos(proyectos.map(p => p.id)).catch(() => [] as FilaPago[]);

    const nombreDe = new Map<string, string>(
        clientes.map(c => [String(c.id), String(c.fiscal_name || c.full_name || c.id)]));

    const abonos = new Map<string, { suma: number; ultimo: string | null }>();
    for (const g of pagos) {
        const k = g.project_id ?? '';
        if (!abonos.has(k)) abonos.set(k, { suma: 0, ultimo: null });
        const a = abonos.get(k)!;
        a.suma += Number(g.amount) || 0;
        const f = (g.date ?? '').slice(0, 10);
        if (f && (!a.ultimo || f > a.ultimo)) a.ultimo = f;
    }

    return proyectos.map(p => {
        const a = abonos.get(p.id) ?? { suma: 0, ultimo: null };
        const contratado = Number(p.budget) || 0;
        const pagado = redondear(a.suma);
        return {
            id: p.id,
            nombre: p.name ?? `proyecto ${p.id}`,
            cliente: nombreDe.get(p.client_id ?? '') ?? 'sin cliente',
            estado: estadoNormal(p.status) || 'sin estado',
            contratado, pagado, saldo: redondear(contratado - pagado),
            inicio: (p.start_date ?? '').slice(0, 10),
            entrega: (p.due_date ?? '').slice(0, 10),
            vendido: (p.sold_at ?? '').slice(0, 10),
            ultimoAbono: a.ultimo,
        };
    });
}

/** Un peso de tolerancia: un saldo de $0.004 no es una deuda. */
const DEBE = 1;
const liquidado = (p: ProyectoConSaldo) => p.saldo < DEBE;

/**
 * ¿Estaba vivo el proyecto en ese mes?
 *
 * Arrancó en ese mes o antes, y su entrega no fue antes. Sin fecha de entrega
 * se toma como abierto: un proyecto sin cierre sigue en la mesa.
 */
function vigenteEn(p: ProyectoConSaldo, mes: string): boolean {
    const ini = (p.inicio || p.vendido).slice(0, 7);
    const fin = p.entrega.slice(0, 7);
    if (!ini) return false;
    if (ini > mes) return false;
    if (fin && fin < mes) return false;
    return true;
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

/** Marca de cobranza: vencido, debe, o liquidado. */
function marca(p: ProyectoConSaldo): string {
    if (liquidado(p)) return '✓ PAGADO ';
    if (p.entrega && p.entrega < hoyISO()) return '⚠ VENCIDO';
    return '· DEBE   ';
}

const conPorcentaje = (p: ProyectoConSaldo) =>
    p.contratado > 0 ? `${((p.pagado / p.contratado) * 100).toFixed(0)}%` : '—';

server.registerTool('proyectos_activos', {
    title: 'Proyectos en marcha y su cobranza',
    description:
        'Los proyectos en curso con lo que se ha cobrado y lo que falta. Responde ' +
        '"¿qué traigo activo?", "¿quién me debe?", "¿cuáles ya me pagaron completo?".\n' +
        'Con `mes` se limita a los que estaban vivos ese mes (arrancaron en él o antes y ' +
        'su entrega no fue antes). Con `cliente` se filtra por nombre aproximado.\n' +
        'No lleva costos ni márgenes: son cifras de cobranza.',
    inputSchema: {
        cliente: z.string().optional().describe('Nombre del cliente, aproximado.'),
        mes: z.string().optional().describe('AAAA-MM. Por omisión, todos los que estén en marcha.'),
        pago: z.enum(['pendiente', 'pagado', 'todos']).optional()
            .describe('Filtra por estado de pago. Por omisión, todos.'),
        incluir_terminados: z.boolean().optional()
            .describe('Incluir los ya entregados. Por omisión no, salvo que deban dinero.'),
    },
}, async ({ cliente, mes, pago, incluir_terminados }) => {
    const todos = await juntarProyectos();
    let lista = todos.filter(p => vivo(p.estado));

    if (cliente) {
        const filtrados = lista.filter(p => puntajeDeNombre(p.cliente, cliente) > 0);
        if (!filtrados.length) {
            const nombres = [...new Set(todos.map(p => p.cliente))].slice(0, 12);
            return texto(
                `No encuentro proyectos de "${cliente}".\n\nClientes con proyectos:\n` +
                nombres.map(n => `  · ${n}`).join('\n'));
        }
        lista = filtrados;
    }

    // Un proyecto entregado que todavía debe dinero SÍ sale: el saldo no se
    // cierra cuando se entrega la cocina, y esconderlo es perder la cobranza.
    if (!incluir_terminados) lista = lista.filter(p => enMarcha(p.estado) || !liquidado(p));
    if (mes) lista = lista.filter(p => vigenteEn(p, mes));
    if (pago === 'pendiente') lista = lista.filter(p => !liquidado(p));
    if (pago === 'pagado') lista = lista.filter(p => liquidado(p));

    if (!lista.length) {
        return texto(`No hay proyectos que cumplan eso${mes ? ` en ${nombreMes(mes)}` : ''}.`);
    }

    lista.sort((a, b) => b.saldo - a.saldo || a.entrega.localeCompare(b.entrega));

    // Dos renglones por proyecto en vez de uno larguísimo: el de identidad y
    // el de dinero. En una sola línea esto medía 136 caracteres y había que
    // arrastrar la tabla de lado para ver el saldo, que es justo el dato.
    const unSoloCliente = new Set(lista.map(p => p.cliente)).size === 1;
    const lineas = lista.flatMap(p => [
        `${marca(p)} ${p.nombre.slice(0, 38)}` +
        (unSoloCliente ? '' : ` — ${p.cliente.slice(0, 22)}`) +
        (p.entrega ? ` · entrega ${p.entrega}` : ''),
        `          ${pesos(p.contratado).padStart(13)} · pagado ${pesos(p.pagado).padStart(13)}` +
        ` (${conPorcentaje(p).padStart(4)})` +
        (liquidado(p) ? '' : ` · falta ${pesos(p.saldo)}`),
    ]);

    const porCobrar = redondear(lista.reduce((s, p) => s + Math.max(p.saldo, 0), 0));
    const contratado = redondear(lista.reduce((s, p) => s + p.contratado, 0));
    const vencidos = lista.filter(p => !liquidado(p) && p.entrega && p.entrega < hoyISO());

    // El encabezado dice lo que la lista trae de verdad: si incluye uno ya
    // entregado que sigue debiendo, llamarla "en marcha" es mentir en la
    // primera línea.
    const soloEnMarcha = lista.every(p => enMarcha(p.estado));
    const deQuien = [...new Set(lista.map(p => p.cliente))];
    const encabezado =
        `${lista.length} proyecto(s) ${soloEnMarcha ? 'en marcha' : 'en marcha o con saldo pendiente'}` +
        (mes ? `, vivos en ${nombreMes(mes)}` : '') +
        (deQuien.length === 1 ? ` — ${deQuien[0]}` : '');

    const partes = [
        encabezado, '',
        ...lineas, '',
        `Contratado ${pesos(contratado)} · cobrado ${pesos(redondear(contratado - porCobrar))} · ` +
        `POR COBRAR ${pesos(porCobrar)}`,
    ];
    if (vencidos.length) {
        partes.push(...renglones(
            `⚠ ${vencidos.length} con fecha de entrega pasada y saldo pendiente: ` +
            vencidos.map(p => p.nombre).join(', ')));
    }
    return texto(bloque(partes) + COPIA_TAL_CUAL);
});

server.registerTool('estado_de_cuenta', {
    title: 'Relación de un cliente: qué debe y qué pagó',
    description:
        'La relación completa de un cliente: todos sus proyectos, cuánto se contrató, cuánto ' +
        'abonó y cuánto falta, más lo facturado. Responde "¿cómo voy con Iván Díaz?" o ' +
        '"¿cuánto me debe?".\n' +
        'Incluye los proyectos terminados que todavía deben: un saldo no se cierra al ' +
        'entregar. No lleva costos ni márgenes, así que se puede leer con el cliente enfrente.',
    inputSchema: {
        cliente: z.string().describe('Nombre del cliente, aproximado.'),
        incluir_cancelados: z.boolean().optional()
            .describe('Incluir cancelados y no ganados. Por omisión no.'),
    },
}, async ({ cliente, incluir_cancelados }) => {
    const todos = await juntarProyectos();
    const candidatos = todos.filter(p => puntajeDeNombre(p.cliente, cliente) > 0);

    if (!candidatos.length) {
        const nombres = [...new Set(todos.map(p => p.cliente))].slice(0, 15);
        return texto(
            `No encuentro a "${cliente}" entre los clientes con proyectos.\n\n` +
            nombres.map(n => `  · ${n}`).join('\n'));
    }

    // Si el nombre pega con más de un cliente, se pregunta en vez de sumar dos
    // cuentas distintas en un mismo saldo.
    const nombres = [...new Set(candidatos.map(p => p.cliente))];
    if (nombres.length > 1) {
        return texto(
            `"${cliente}" coincide con ${nombres.length} clientes. ¿Cuál?\n` +
            nombres.map(n => `  · ${n}`).join('\n'));
    }
    const nombre = nombres[0];

    const lista = candidatos.filter(p => incluir_cancelados || vivo(p.estado));
    if (!lista.length) return texto(`${nombre} no tiene proyectos vigentes.`);

    lista.sort((a, b) => b.saldo - a.saldo || (b.vendido || b.inicio).localeCompare(a.vendido || a.inicio));

    const deben = lista.filter(p => !liquidado(p));
    const contratado = redondear(lista.reduce((s, p) => s + p.contratado, 0));
    const pagado = redondear(lista.reduce((s, p) => s + p.pagado, 0));
    const saldo = redondear(contratado - pagado);

    // Lo facturado se cruza por el NOMBRE impreso en el CFDI, no por client_id:
    // la tabla de facturas no lo trae. Puede quedarse corto si la razón social
    // difiere, así que se dice de dónde sale en vez de darlo por exacto.
    const facturas = await leerFacturas().catch(() => [] as FilaFactura[]);
    const suyas = facturas.filter(f =>
        f.modo !== 'test' && f.status !== 'canceled' &&
        puntajeDeNombre(f.client_name ?? '', nombre) > 0);
    const facturado = redondear(suyas.reduce((s, f) => s + (Number(f.total) || 0), 0));

    const lineas = lista.flatMap(p => [
        `${marca(p)} ${p.nombre.slice(0, 38)} · ${p.estado}`,
        `          ${pesos(p.contratado).padStart(13)} · pagado ${pesos(p.pagado).padStart(13)}` +
        (liquidado(p) ? '' : ` · debe ${pesos(p.saldo)}`),
        `          ${p.ultimoAbono ? `último abono ${p.ultimoAbono}` : 'sin abonos'}`,
    ]);

    return texto(bloque([
        `Estado de cuenta — ${nombre}`,
        `${lista.length} proyecto(s), ${deben.length} con saldo`,
        '',
        ...lineas,
        '',
        `Contratado ${pesos(contratado)} · pagado ${pesos(pagado)} · SALDO ${pesos(saldo)}`,
        saldo < DEBE
            ? 'Al corriente: no debe nada.'
            : `Debe ${pesos(saldo)} en ${deben.length} proyecto(s).`,
        '',
        ...renglones(facturado > 0
            ? `Facturado (CFDI timbrado): ${pesos(facturado)} en ${suyas.length} factura(s).` +
              (Math.abs(facturado - pagado) >= DEBE
                  ? ` Ojo: facturado y cobrado no son lo mismo — hay ${pesos(Math.abs(facturado - pagado))} de diferencia.`
                  : '')
            : 'Sin facturas timbradas a su nombre. Se cruzan por el nombre impreso en el CFDI, ' +
              'así que si la razón social difiere puede no encontrarlas.'),
    ]) + COPIA_TAL_CUAL);
});

// ── Consultar lo ya cotizado ─────────────────────────────────────────────

/** Las partidas llegan como JSONB; de una base vieja pueden venir como texto. */
function partidasDeFila(f: FilaCotizacion): QuoteItem[] {
    const crudo = typeof f.items === 'string' ? safeJson(f.items) : f.items;
    return Array.isArray(crudo) ? crudo : [];
}

function safeJson(t: string): any {
    try { return JSON.parse(t); } catch { return []; }
}

/** Referencia corta y estable para que el usuario pueda decir "la 3f2a". */
const corto = (id: string) => id.slice(0, 8);

const ESTADOS = ['Draft', 'Sent', 'Approved', 'Awaiting Approval', 'Rejected'] as const;

server.registerTool('listar_cotizaciones', {
    title: 'Listar cotizaciones guardadas',
    description:
        'Consulta las cotizaciones YA guardadas en la plataforma, de la más reciente a la más ' +
        'vieja. Úsala cuando pregunten por cotizaciones pasadas ("mis últimas cotizaciones", ' +
        '"qué le cotizamos a EMDICO"). No sirve para crear: para eso es iniciar_cotizacion.',
    inputSchema: {
        cliente: z.string().optional().describe('Filtra por nombre de cliente (coincidencia parcial).'),
        estado: z.enum(ESTADOS).optional().describe('Filtra por estado.'),
        limite: z.number().int().min(1).max(50).optional().describe('Cuántas traer. Por omisión 10.'),
    },
}, async ({ cliente, estado, limite }) => {
    const filas = await leerCotizaciones({ cliente, estado, limite });
    if (!filas.length) {
        return texto(cliente
            ? `No hay cotizaciones guardadas para "${cliente}".`
            : 'Todavía no hay cotizaciones guardadas.');
    }
    const { iva } = await catalogo();
    // Dos renglones: arriba la referencia y el dinero, abajo quién y qué. En
    // uno solo esto pasaba de 90 caracteres y se salía del ancho del chat.
    const lineas = filas.flatMap(f => {
        const items = partidasDeFila(f);
        const t = totalesDe(items, iva);
        const fecha = (f.date ?? f.created_at ?? '').slice(0, 10);
        return [
            `${corto(f.id).padEnd(9)} ${fecha} · ${pesos(t.total)} con IVA · ` +
            `${f.status ?? 'sin estado'}`,
            `          ${(f.client_name ?? 'sin cliente').slice(0, 28)} — ` +
            `${(f.project_name ?? 'sin proyecto').slice(0, 28)} · ${items.length} partida(s)`,
        ];
    });
    return texto(
        bloque([`${filas.length} cotización(es):`, '', ...lineas]) +
        '\n\nPara el detalle usa ver_cotizacion con la referencia de la izquierda.' +
        COPIA_TAL_CUAL);
});

server.registerTool('ver_cotizacion', {
    title: 'Ver una cotización guardada',
    description:
        'Muestra el detalle completo de una cotización ya guardada: sus partidas y totales. ' +
        'La referencia son los primeros caracteres del id, como los muestra listar_cotizaciones.',
    inputSchema: {
        referencia: z.string().describe('Referencia corta o id completo de la cotización.'),
    },
}, async ({ referencia }) => {
    const f = await buscarCotizacion(referencia);
    if (typeof f === 'string') return texto(f);

    const items = partidasDeFila(f);
    const { iva } = await catalogo();
    const t = totalesDe(items, iva);
    const lineas = items.map((i, n) =>
        `${n + 1}. ${i.description} — ${i.quantity} × ${pesos(i.unitPrice)} = ${pesos(importeDe(i))}`);

    return texto([
        `Cotización ${corto(f.id)} — ${f.client_name ?? 'sin cliente'}`,
        `Proyecto: ${f.project_name ?? 'sin proyecto'}`,
        `Fecha ${(f.date ?? '').slice(0, 10)} · entrega ${(f.delivery_time ?? '').slice(0, 10)} · ${f.status ?? 'sin estado'}`,
        '',
        ...(lineas.length ? lineas : ['(sin partidas)']),
        '',
        `Subtotal:  ${pesos(t.subtotal)}`,
        `IVA ${(iva * 100).toFixed(0)}%:   ${pesos(t.iva)}`,
        `TOTAL:     ${pesos(t.total)}`,
        ...(f.notes ? ['', `Notas: ${f.notes}`] : []),
    ].join('\n'));
});

server.registerTool('pdf_de_cotizacion', {
    title: 'Regenerar el PDF de una cotización guardada',
    description:
        'Vuelve a generar el PDF de una cotización ya guardada, para reenviarlo. ' +
        'No la modifica ni crea una nueva. Devuelve la ruta del archivo.',
    inputSchema: {
        referencia: z.string().describe('Referencia corta o id completo de la cotización.'),
    },
}, async ({ referencia }) => {
    const f = await buscarCotizacion(referencia);
    if (typeof f === 'string') return texto(f);

    const items = partidasDeFila(f);
    if (!items.length) return texto(`La cotización ${corto(f.id)} no tiene partidas: no hay qué imprimir.`);

    const { iva } = await catalogo();
    const t = totalesDe(items, iva);
    const quote: Quote = {
        id: f.id, projectName: f.project_name ?? '', clientName: f.client_name ?? '',
        deliveryTime: (f.delivery_time ?? '').slice(0, 10), date: (f.date ?? '').slice(0, 10),
        items, notes: f.notes ?? undefined, status: (f.status as any) ?? 'Draft',
        totalAmount: t.subtotal,
    };

    let plantilla: Buffer;
    try { plantilla = readFileSync(PLANTILLA()); }
    catch { return texto(`No encontré la plantilla en ${PLANTILLA()}.`); }

    const bytes = await generarCotizacionPdf(quote, { plantilla, iva });
    mkdirSync(SALIDA(), { recursive: true });
    const limpio = `${quote.clientName}_${quote.projectName}`.replace(/[^\w\-]+/g, '_').slice(0, 60);
    const ruta = join(SALIDA(), `Cotizacion_${limpio}_${corto(f.id)}.pdf`);
    writeFileSync(ruta, bytes);

    return texto(
        `PDF de la cotización ${corto(f.id)} (${quote.clientName} — ${quote.projectName}, ` +
        `${pesos(t.total)} con IVA).\n\n${comoEntregar(ruta)}`);
});

/**
 * Busca por referencia corta o id completo.
 *
 * Si la referencia coincide con varias, devuelve el texto para que el agente
 * PREGUNTE: mandarle al cliente el PDF de otra cotización por adivinar cuál
 * era es peor que pedir que lo aclare.
 */
async function buscarCotizacion(referencia: string): Promise<FilaCotizacion | string> {
    const ref = referencia.trim().toLowerCase();
    const exacta = ref.includes('-') ? await leerCotizacion(ref) : null;
    if (exacta) return exacta;

    const filas = await leerCotizaciones({ limite: 50 });
    const coinciden = filas.filter(f => f.id.toLowerCase().startsWith(ref));
    if (!coinciden.length) {
        return `No encontré ninguna cotización con la referencia "${referencia}". ` +
               `Usa listar_cotizaciones para ver las disponibles.`;
    }
    if (coinciden.length > 1) {
        return `"${referencia}" coincide con varias. Pregunta al usuario cuál:\n` +
               coinciden.map(f => `  · ${corto(f.id)} — ${f.client_name} · ${f.project_name}`).join('\n');
    }
    return coinciden[0];
}

// ── Arranque ─────────────────────────────────────────────────────────────

const transporte = new StdioServerTransport();
await server.connect(transporte);
