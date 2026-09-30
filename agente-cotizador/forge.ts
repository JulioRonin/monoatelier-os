/**
 * Forge desde el chat: todo lo que no es hablar con Supabase ni con MCP.
 *
 * Pedirle un diseño al agente sigue el mismo camino que en la plataforma:
 *
 *   foto → LECTURA (Claude llena una ficha) → Julio confirma medidas →
 *   CONSTRUCCIÓN (el motor deriva cutlist, planos y cotización).
 *
 * La foto casi nunca trae escala y una hecha con IA miente, así que el paso de
 * confirmar medidas no se salta: `aplicarMedidas` no deja construir hasta que
 * cada medida esté confirmada, y rechaza las que parecen centímetros.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_IMAGENES = 6;
const MAX_BYTES = 15 * 1024 * 1024;
/** Una medida de mueble menor a esto casi seguro son cm o metros: 220 → 2200. */
export const MEDIDA_MIN_MM = 100;
export const MEDIDA_MAX_MM = 20000;

export const corto = (id: string) => String(id).slice(0, 8);

// ── Fotos ────────────────────────────────────────────────────────────────

export interface TipoImagen { mime: string; ext: string }

/**
 * El tipo por el CONTENIDO, no por la extensión. Sólo imágenes: además de
 * evitar que Claude rechace un archivo, impide que un ruta equivocada (o
 * inyectada en un mensaje) suba a un bucket PÚBLICO cualquier archivo de la PC.
 */
export function tipoDeImagen(b: Uint8Array): TipoImagen | 'heic' | null {
    const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
    if (b.length > 8 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return { mime: 'image/png', ext: 'png' };
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
    if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
    if (ascii(4, 4) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(ascii(8, 4))) return 'heic';
    return null;
}

/** La ruta tal como la escriba un modelo: con comillas, `MEDIA:`, `file://`, `~/`. */
export function limpiarRuta(ref: string): string {
    let r = ref.trim().replace(/^[`"'<(]+|[`"'>).,;]+$/g, '').replace(/^(MEDIA:|path:)\s*/i, '');
    if (/^file:/i.test(r)) {
        try { r = fileURLToPath(r); } catch { r = r.replace(/^file:\/+/i, ''); }
    }
    if (r === '~' || r.startsWith('~/') || r.startsWith('~\\')) r = join(homedir(), r.slice(1));
    return r;
}

const nombreCorto = (ref: string) => {
    const r = ref.replace(/[?#].*$/, '');
    const b = basename(r.replace(/\\/g, '/'));
    return b.length > 40 ? `…${b.slice(-38)}` : b || ref.slice(0, 40);
};

/** Trae los bytes de una foto: de una URL (Discord) o de una ruta local. */
export async function traerImagen(ref: string): Promise<Uint8Array> {
    if (/^https?:\/\//i.test(ref.trim())) {
        const res = await fetch(ref.trim(), { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`no se pudo descargar (respondió ${res.status}); Discord borra los enlaces viejos`);
        const largo = Number(res.headers.get('content-length') || 0);
        if (largo > MAX_BYTES) throw new Error('pesa más de 15 MB');
        return new Uint8Array(await res.arrayBuffer());
    }
    const ruta = limpiarRuta(ref);
    if (!existsSync(ruta)) {
        throw new Error(`no encuentro el archivo en «${ruta}». Usa la ruta COMPLETA tal como aparece en el mensaje de la foto`);
    }
    if (!statSync(ruta).isFile()) throw new Error('esa ruta es una carpeta, no una foto');
    if (statSync(ruta).size > MAX_BYTES) throw new Error('pesa más de 15 MB');
    return readFileSync(ruta);
}

export type SubirImagen = (bytes: Uint8Array, ext: string, mime: string) => Promise<string>;

/**
 * Sube las fotos y devuelve sus URLs públicas. Si UNA falla no se encola nada:
 * un diseño leído con dos fotos de tres, sin avisar, sale con la mitad del
 * mueble.
 */
export async function prepararImagenes(
    refs: string[], subir: SubirImagen, traer: typeof traerImagen = traerImagen,
): Promise<{ urls: string[]; errores: string[] }> {
    const urls: string[] = [];
    const errores: string[] = [];
    for (const ref of refs.slice(0, MAX_IMAGENES)) {
        try {
            const bytes = await traer(ref);
            const tipo = tipoDeImagen(bytes);
            if (tipo === 'heic') throw new Error('es HEIC (iPhone) y Forge no la puede leer; mándala como JPG');
            if (!tipo) throw new Error('no es una imagen JPG, PNG, WEBP ni GIF');
            urls.push(await subir(bytes, tipo.ext, tipo.mime));
        } catch (e: any) {
            errores.push(`${nombreCorto(ref)}: ${e.message}`);
        }
    }
    if (refs.length > MAX_IMAGENES) errores.push(`Son ${refs.length} fotos y el máximo es ${MAX_IMAGENES}.`);
    return { urls, errores };
}

// ── Ficha ────────────────────────────────────────────────────────────────

const NOMBRE_TIPO: Record<string, string> = {
    gabinete_base: 'Gabinete de piso', cajonera: 'Cajonera', tarja: 'Módulo de tarja',
    torre: 'Torre', alacena: 'Alacena', hueco: 'Hueco',
    closet_colgado_sencillo: 'Colgado sencillo', closet_colgado_doble: 'Colgado doble',
    closet_entrepanos: 'Entrepaños', closet_cajonera: 'Cajonera de closet',
    closet_zapatera: 'Zapatera', closet_vitrina: 'Vitrina', closet_maletero: 'Maletero',
    esquinero: 'Esquinero', repisa_abierta: 'Repisa abierta', isla: 'Isla',
    panel_decorativo: 'Panel decorativo', otro: 'Otro',
};

/** Parte un párrafo para que quepa en el chat, con sangría opcional. */
export function envolver(t: string, ancho = 76, sangria = ''): string[] {
    const salida: string[] = [];
    let linea = '';
    for (const palabra of t.replace(/\s+/g, ' ').trim().split(' ')) {
        if (linea && (sangria + linea + ' ' + palabra).length > ancho) {
            salida.push(sangria + linea);
            linea = palabra;
        } else {
            linea = linea ? `${linea} ${palabra}` : palabra;
        }
    }
    if (linea) salida.push(sangria + linea);
    return salida;
}

export interface Medida { clave: string; pregunta: string; estimado_mm: number; base?: string; valor_mm?: number | null }

const bloqueCodigo = (l: string[]) => '```\n' + l.join('\n') + '\n```';

/** La ficha como texto de chat: qué se ve, qué no se fabrica y qué medir. */
export function fichaEnTexto(ficha: any, ref: string): string {
    const L: string[] = [];
    L.push(`Lectura lista — ${ficha.nombre_proyecto || 'sin nombre'} (ref ${ref})`);
    if (ficha.resumen) L.push(...envolver(ficha.resumen));

    const omitidos = new Set<string>(ficha.omitidos ?? []);
    for (const muro of ficha.muros ?? []) {
        L.push('', `Muro ${muro.id}${muro.descripcion ? ` — ${muro.descripcion}` : ''}`);
        (muro.elementos ?? []).forEach((e: any, i: number) => {
            const partes = [`~${Math.round(e.ancho_estimado_mm)} mm`];
            if (e.puertas) partes.push(`${e.puertas} puerta(s)`);
            if (e.cajones) partes.push(`${e.cajones} cajón(es)`);
            if (e.entrepanos) partes.push(`${e.entrepanos} entrepaño(s)`);
            if (e.led) partes.push('LED');
            if (omitidos.has(e.tipo)) partes.push('SIN GENERADOR');
            L.push(`  ${i + 1}. ${NOMBRE_TIPO[e.tipo] ?? e.tipo} · ${partes.join(' · ')}`);
            if (e.detalle) L.push(...envolver(e.detalle, 76, '     '));
        });
    }

    const acabados = (ficha.acabados ?? []).map((a: any) => `${a.zona}: ${a.descripcion}`);
    if (acabados.length || ficha.apertura) {
        L.push('', ...envolver(
            `Acabados — ${acabados.join('; ') || 'no se distinguen'}. ` +
            `Apertura: ${String(ficha.apertura ?? '').replace(/_/g, ' ')}.`));
    }

    const nombres = [...omitidos].map(t => NOMBRE_TIPO[t] ?? t).join(', ');
    if (!ficha.construible) {
        L.push('', ...envolver(
            `⚠ Forge todavía no tiene generador para esto (${nombres || 'sin elementos'}). ` +
            `La ficha sirve de levantamiento, pero NO se puede construir.`));
    } else if (omitidos.size) {
        L.push('', ...envolver(`Se construye todo menos: ${nombres}.`));
    }

    if ((ficha.no_fabricable ?? []).length) {
        L.push('', 'NO SE FABRICA COMO EN LA FOTO');
        for (const x of ficha.no_fabricable) {
            L.push(...envolver(`${x.elemento} — ${x.por_que} Propuesta: ${x.propuesta}`, 76, '  ').map((l: string, i: number) => i ? l : `·${l.slice(1)}`));
        }
    }

    const medidas: Medida[] = ficha.medidas ?? [];
    if (medidas.length) {
        const bloque: string[] = ['MEDIDAS POR CONFIRMAR (milímetros)'];
        for (const m of medidas) {
            bloque.push(`${m.clave} — estimado ${Math.round(m.estimado_mm)}`);
            bloque.push(...envolver(m.pregunta, 74, '  '));
        }
        L.push('', bloqueCodigo(bloque));
    }
    return L.join('\n');
}

// ── Confirmar medidas ────────────────────────────────────────────────────

export type ResultadoMedidas =
    | { ok: true; ficha: any; estimadasUsadas: string[] }
    | { ok: false; motivo: string };

/**
 * Aplica las medidas que confirmó el usuario a la ficha leída.
 *
 * Una medida sin confirmar NO se da por buena: la ficha trae estimaciones
 * sacadas de una foto, y construir con ellas sin que nadie las revise es
 * cortar tablero con medidas inventadas. Sólo con `usarEstimadas` (que el
 * usuario pidió a propósito) se aceptan.
 */
export function aplicarMedidas(
    ficha: any, medidas: Record<string, number> | undefined, usarEstimadas: boolean,
): ResultadoMedidas {
    const lista: Medida[] = ficha.medidas ?? [];
    const claves = lista.map(m => m.clave);
    const dadas = medidas ?? {};

    const desconocidas = Object.keys(dadas).filter(k => !claves.includes(k));
    if (desconocidas.length) {
        return { ok: false, motivo:
            `No existe la medida ${desconocidas.map(k => `«${k}»`).join(', ')}. ` +
            `Las de esta ficha son: ${claves.join(', ')}.` };
    }
    for (const [k, v] of Object.entries(dadas)) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
            return { ok: false, motivo: `«${k}» debe ser un número de milímetros mayor que cero.` };
        }
        if (v < MEDIDA_MIN_MM) {
            return { ok: false, motivo:
                `«${k}» = ${v} parece estar en centímetros o metros. Las medidas van en MILÍMETROS: ` +
                `100 cm = 1000, 2.2 m = 2200. Confirma con el usuario y vuelve a mandarla.` };
        }
        if (v > MEDIDA_MAX_MM) {
            return { ok: false, motivo: `«${k}» = ${v} mm son más de ${MEDIDA_MAX_MM / 1000} metros: ¿sobra un cero?` };
        }
    }

    const faltan = lista.filter(m => !(m.clave in dadas));
    if (faltan.length && !usarEstimadas) {
        return { ok: false, motivo:
            `Faltan por confirmar ${faltan.length} medida(s). NO las adivines ni uses las estimadas: ` +
            `pregúntaselas al usuario y vuelve a llamar con todas.\n` +
            faltan.map(m => `  · ${m.clave} — ${m.pregunta} (estimado ${Math.round(m.estimado_mm)} mm)`).join('\n') +
            `\nSi el usuario dice que se usen las estimadas tal cual, llama con usar_estimadas=true.` };
    }

    const nueva = structuredClone(ficha);
    for (const m of nueva.medidas ?? []) if (m.clave in dadas) m.valor_mm = dadas[m.clave];
    return { ok: true, ficha: nueva, estimadasUsadas: faltan.map(m => m.clave) };
}

// ── Estado ───────────────────────────────────────────────────────────────

export function hace(iso: string, ahora = Date.now()): string {
    const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}

export const LIMITE_EN_COLA_MS = 2 * 60 * 1000;

/** Un trabajo que lleva más de 2 minutos en cola casi siempre es que el Forge Agent no está corriendo. */
export function avisoSinAgente(
    trabajos: { status: string; created_at: string }[], ahora = Date.now(),
): string | null {
    const viejos = trabajos.filter(t => t.status === 'pending'
        && ahora - new Date(t.created_at).getTime() > LIMITE_EN_COLA_MS);
    if (!viejos.length) return null;
    return `⚠ Hay ${viejos.length} trabajo(s) esperando desde ${hace(viejos[viejos.length - 1].created_at)}: ` +
           `el Forge Agent no parece estar corriendo en tu PC. Ábrelo en la carpeta del repo con ` +
           `.venv\\Scripts\\activate y python -m forge_agent.worker, y déjalo abierto.`;
}

/** Busca un trabajo por su referencia corta (o el último si no se da). */
export function buscarTrabajo<T extends { id: string }>(
    lista: T[], referencia?: string,
): { trabajo: T } | { mensaje: string } {
    if (!lista.length) return { mensaje: 'No hay trabajos de diseño todavía. Pide uno con disenar_mueble.' };
    if (!referencia?.trim()) return { trabajo: lista[0] };
    const r = referencia.trim().toLowerCase().replace(/^ref\s*/, '');
    const coinciden = lista.filter(t => t.id.toLowerCase().startsWith(r));
    if (coinciden.length === 1) return { trabajo: coinciden[0] };
    const recientes = lista.slice(0, 5).map(t => `  · ${corto(t.id)}`).join('\n');
    return { mensaje: coinciden.length
        ? `«${referencia}» coincide con varios trabajos: usa más caracteres.\n${recientes}`
        : `No encuentro el trabajo «${referencia}». Los más recientes:\n${recientes}` };
}
