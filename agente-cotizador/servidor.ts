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
    importeDe, redondear,
} from '../lib/cotizador.js';
import { generarCotizacionPdf } from '../lib/cotizacionPdf.js';
import type { Service, ServiceVariable, QuoteItem, Quote } from '../types.js';
import {
    leerServicios, leerVariantes, leerAjustes, guardarCotizacion,
    type FilaServicio, type FilaVariante,
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
        ...(b.avisos.length ? ['', 'Avisos:', ...b.avisos.map(a => `  · ${a}`)] : []),
    ].join('\n');
}

const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

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
    if (notas) b.notas = notas;
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
        `PDF: ${ruta}\n${guardado}\n` +
        `Adjúntaselo al usuario en el chat.`);
});

// ── Arranque ─────────────────────────────────────────────────────────────

const transporte = new StdioServerTransport();
await server.connect(transporte);
