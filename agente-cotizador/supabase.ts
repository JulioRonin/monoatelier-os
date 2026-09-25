/**
 * Acceso a Supabase desde el servidor MCP.
 *
 * Cliente propio contra la API REST en vez de @supabase/supabase-js: ese vive
 * en el navegador y lee su configuración de `import.meta.env`, que en Node no
 * existe. Aquí las llaves salen del entorno, como en el worker de Forge.
 *
 * Nunca se escriben llaves en el código.
 */

import { raizRepo } from './rutas.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Llaves del entorno, y si no están, del .env.local del repo.
 *
 * La plataforma ya guarda ahí VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
 * Obligar a copiarlas también al config de Hermes es pedir que el día que
 * roten una, quede a medias en un lado y nadie sepa por qué.
 */
let cacheEnv: Record<string, string> | null = null;

function delEnvLocal(clave: string): string | undefined {
    if (cacheEnv === null) {
        cacheEnv = {};
        try {
            const txt = readFileSync(join(raizRepo(), '.env.local'), 'utf8');
            for (const linea of txt.split(/\r?\n/)) {
                const m = linea.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
                if (m && !linea.trimStart().startsWith('#')) {
                    cacheEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
                }
            }
        } catch { /* sin .env.local: se usa sólo el entorno */ }
    }
    return cacheEnv[clave];
}

export const urlSupabase = (): string | undefined =>
    (process.env.SUPABASE_URL ?? delEnvLocal('VITE_SUPABASE_URL'))?.replace(/\/$/, '');

export const llaveSupabase = (): string | undefined =>
    process.env.SUPABASE_KEY
    ?? delEnvLocal('SUPABASE_KEY')
    ?? delEnvLocal('VITE_SUPABASE_ANON_KEY');

const URL_BASE = () => {
    const u = urlSupabase();
    if (!u) throw new Error(
        'Falta SUPABASE_URL. Ponla en el config de Hermes, o deja VITE_SUPABASE_URL ' +
        'en el .env.local del repo.');
    return u;
};

const LLAVE = () => {
    const k = llaveSupabase();
    if (!k) throw new Error(
        'Falta SUPABASE_KEY. Ponla en el config de Hermes, o deja ' +
        'VITE_SUPABASE_ANON_KEY en el .env.local del repo.');
    return k;
};

async function pedir(ruta: string, init: RequestInit = {}): Promise<any> {
    const k = LLAVE();
    const res = await fetch(`${URL_BASE()}/rest/v1${ruta}`, {
        ...init,
        headers: {
            apikey: k,
            Authorization: `Bearer ${k}`,
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
        },
    });
    const texto = await res.text();
    if (!res.ok) {
        // El mensaje crudo de PostgREST dice qué columna o tabla falta; tragarlo
        // y poner "error al consultar" obliga a adivinar.
        throw new Error(`Supabase ${res.status}: ${texto.slice(0, 300)}`);
    }
    return texto ? JSON.parse(texto) : null;
}

/**
 * Los ids, siempre como texto.
 *
 * PostgREST devuelve un `bigint` como NÚMERO de JSON y un `uuid` como cadena,
 * y las tablas de la plataforma mezclan los dos: `quotes.id` es bigint y los
 * servicios son uuid. Ese detalle se filtraba a todo el servidor — `corto(id)`
 * hace `id.slice(0, 8)` y truena con un número, y un `Map` con claves de texto
 * nunca encuentra una clave numérica, así que los clientes salían todos como
 * "sin cliente" sin dar error.
 *
 * Se normaliza aquí, en la frontera, en vez de poner `String(...)` en cada
 * uso: basta olvidarlo en uno para que vuelva el mismo fallo callado.
 */
function idsDeTexto<T extends Record<string, any>>(fila: T, campos: string[]): T {
    const out: Record<string, any> = { ...fila };
    for (const c of campos) {
        if (out[c] !== null && out[c] !== undefined) out[c] = String(out[c]);
    }
    return out as T;
}

const mapear = <T extends Record<string, any>>(filas: T[] | null, campos: string[]): T[] =>
    (filas ?? []).map(f => idsDeTexto(f, campos));

// ── Lecturas ─────────────────────────────────────────────────────────────

export interface FilaServicio {
    id: string; name: string; category: string | null; description: string | null;
    base_price: number | null; cost: number | null; units: string | null;
    active: boolean | null; sku: string | null; price_updated_at: string | null;
}

export interface FilaVariante {
    id: string; service_id: string; name: string; kind: string;
    price: number | null; cost: number | null; units: string | null;
    active: boolean | null; sort_order: number | null;
}

export const leerServicios = async (): Promise<FilaServicio[]> =>
    mapear(await pedir('/services?select=*&order=name'), ['id']);

export const leerVariantes = async (): Promise<FilaVariante[]> =>
    mapear(await pedir('/service_variables?select=*&order=sort_order'), ['id', 'service_id']);

export const leerClientes = async (): Promise<any[]> =>
    mapear(await pedir('/clients?select=id,full_name,fiscal_name,rfc,email&order=full_name'), ['id']);

export async function leerAjustes(): Promise<Record<string, any>> {
    try {
        const filas = await pedir('/ajustes?select=clave,valor');
        return Object.fromEntries((filas ?? []).map((r: any) => [r.clave, r.valor]));
    } catch {
        // Sin la tabla se sigue pudiendo cotizar; el IVA cae al default y se avisa.
        return {};
    }
}

export interface FilaCotizacion {
    id: string;
    project_name: string | null;
    client_name: string | null;
    date: string | null;
    delivery_time: string | null;
    items: any;
    notes: string | null;
    status: string | null;
    total_amount: number | null;
    created_at: string | null;
}

/**
 * Cotizaciones ya guardadas, de la más reciente a la más vieja.
 *
 * El filtro por cliente va en el servidor (`ilike`) y no trayendo todo para
 * filtrar aquí: con doscientas cotizaciones, traerlas completas para descartar
 * ciento noventa es tráfico y memoria por nada.
 */
export async function leerCotizaciones(opts: {
    cliente?: string; estado?: string; limite?: number;
} = {}): Promise<FilaCotizacion[]> {
    const q = new URLSearchParams({
        select: '*',
        order: 'created_at.desc',
        limit: String(Math.min(Math.max(opts.limite ?? 10, 1), 50)),
    });
    if (opts.cliente) q.set('client_name', `ilike.*${opts.cliente}*`);
    if (opts.estado) q.set('status', `eq.${opts.estado}`);
    return mapear(await pedir(`/quotes?${q}`), ['id']);
}

/**
 * Cotizaciones para medir un periodo: todas, sin límite, con lo mínimo.
 *
 * No filtra por fecha en el servidor y no es descuido: hay cotizaciones con
 * `date` vacío, y en PostgREST un `date=gte.X` las deja fuera en silencio.
 * Quedarían invisibles justo en el reporte que debería contarlas. Aquí se
 * traen todas —son cientos, no millones, es un taller— y el filtro cae del
 * lado del servidor MCP, que puede usar `created_at` cuando `date` falta.
 */
export async function leerCotizacionesTodas(): Promise<FilaCotizacion[]> {
    return mapear(await pedir(
        '/quotes?select=id,project_name,client_name,date,total_amount,status,created_at'
        + '&order=date.desc'), ['id']);
}

/** Una cotización por id exacto. */
export async function leerCotizacion(id: string): Promise<FilaCotizacion | null> {
    const filas = await pedir(`/quotes?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    return filas?.[0] ? idsDeTexto(filas[0], ['id']) : null;
}

// ── Escritura ────────────────────────────────────────────────────────────

// ── Datos de venta (sólo lectura) ────────────────────────────────────────

export interface FilaProyecto {
    id: string; name: string | null; client_id: string | null;
    status: string | null; budget: number | null; live_cost: number | null;
    start_date: string | null; due_date: string | null;
    sold_at: string | null; quote_id: string | null; created_at: string | null;
}

export interface FilaFactura {
    id: string; series: string | null; folio: number | null; date: string | null;
    client_name: string | null; client_rfc: string | null;
    subtotal: number | null; total: number | null; status: string | null;
    uuid: string | null; modo: string | null; created_at: string | null;
}

/**
 * Proyectos en un rango, por FECHA DE VENTA.
 *
 * Se filtra por `sold_at` y no por `start_date` ni `due_date` a propósito: una
 * cotización de septiembre que se cierra en noviembre y arranca en enero
 * aparece en tres meses distintos según con cuál se mida. La venta entró en
 * noviembre. Ver migración 20260925_fecha_de_venta.
 */
export async function leerProyectos(desde?: string, hasta?: string): Promise<FilaProyecto[]> {
    const q = new URLSearchParams({ select: '*', order: 'sold_at.desc' });
    if (desde) q.append('sold_at', `gte.${desde}`);
    if (hasta) q.append('sold_at', `lte.${hasta}`);
    return mapear(await pedir(`/projects?${q}`), ['id', 'client_id', 'quote_id']);
}

/**
 * Proyectos SIN fecha de venta.
 *
 * Va aparte a propósito: `leerProyectos` filtra por `sold_at` en el servidor,
 * así que un proyecto sin esa fecha no vuelve en NINGÚN rango. Si no se
 * preguntara por ellos explícitamente, no saldrían en ningún mes y tampoco en
 * ninguna advertencia — desaparecerían del reporte sin ruido, que es
 * exactamente el problema que esta migración vino a arreglar.
 */
export async function leerProyectosSinFechaDeVenta(): Promise<FilaProyecto[]> {
    return mapear(
        await pedir('/projects?select=*&sold_at=is.null&order=created_at.desc'),
        ['id', 'client_id', 'quote_id']);
}

/**
 * Ids de las cotizaciones que sí se volvieron proyecto. TODAS, sin rango.
 *
 * La conversión hay que medirla por cohorte: de lo cotizado en septiembre,
 * cuánto se cerró — sin importar si se cerró en noviembre o en marzo. Dividir
 * lo vendido de un mes entre lo cotizado del mismo mes compara dos grupos
 * distintos y da cosas como "300% de conversión".
 */
export async function leerCotizacionesVendidas(): Promise<Set<string>> {
    const filas = await pedir('/projects?select=quote_id&quote_id=not.is.null');
    return new Set<string>((filas ?? []).map((f: any) => String(f.quote_id)));
}

/** Facturas timbradas en un rango. Sólo las reales: las de sandbox no se cuentan. */
export async function leerFacturas(desde?: string, hasta?: string): Promise<FilaFactura[]> {
    const q = new URLSearchParams({ select: '*', order: 'date.desc' });
    if (desde) q.append('date', `gte.${desde}`);
    if (hasta) q.append('date', `lte.${hasta}`);
    return mapear(await pedir(`/invoices?${q}`), ['id']);
}

export const leerClientesMin = async (): Promise<any[]> =>
    mapear(await pedir('/clients?select=id,full_name,fiscal_name'), ['id']);

/**
 * Da de alta un servicio en la lista maestra.
 *
 * Sella `price_updated_at` con la fecha de hoy: un precio recién capturado y
 * uno de hace dos años se ven idénticos si nadie anota cuándo se revisó.
 */
export async function crearServicio(s: {
    name: string; category?: string | null; description?: string | null;
    base_price: number; cost?: number | null; units?: string | null;
    sku?: string | null; notes?: string | null;
}): Promise<FilaServicio> {
    const filas = await pedir('/services', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{
            name: s.name,
            category: s.category ?? null,
            description: s.description ?? null,
            base_price: s.base_price,
            cost: s.cost ?? null,
            units: s.units ?? null,
            sku: s.sku || null,
            notes: s.notes ?? null,
            active: true,
            price_updated_at: new Date().toISOString().slice(0, 10),
        }]),
    });
    return idsDeTexto(filas?.[0] ?? {}, ['id']);
}

export async function guardarCotizacion(c: {
    projectName: string; clientName: string; deliveryTime: string; date: string;
    items: { description: string; quantity: number; unitPrice: number }[];
    notes?: string; totalAmount: number; status: string;
}): Promise<{ id: string }> {
    const filas = await pedir('/quotes', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{
            project_name: c.projectName,
            client_name: c.clientName,
            delivery_time: c.deliveryTime,
            date: c.date,
            items: c.items,
            notes: c.notes ?? null,
            total_amount: c.totalAmount,
            status: c.status,
        }]),
    });
    return idsDeTexto(filas?.[0] ?? {}, ['id']);
}
