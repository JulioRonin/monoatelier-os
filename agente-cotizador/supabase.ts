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

export const leerServicios = () =>
    pedir('/services?select=*&order=name') as Promise<FilaServicio[]>;

export const leerVariantes = () =>
    pedir('/service_variables?select=*&order=sort_order') as Promise<FilaVariante[]>;

export const leerClientes = () =>
    pedir('/clients?select=id,full_name,fiscal_name,rfc,email&order=full_name') as Promise<any[]>;

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
export function leerCotizaciones(opts: {
    cliente?: string; estado?: string; limite?: number;
} = {}): Promise<FilaCotizacion[]> {
    const q = new URLSearchParams({
        select: '*',
        order: 'created_at.desc',
        limit: String(Math.min(Math.max(opts.limite ?? 10, 1), 50)),
    });
    if (opts.cliente) q.set('client_name', `ilike.*${opts.cliente}*`);
    if (opts.estado) q.set('status', `eq.${opts.estado}`);
    return pedir(`/quotes?${q}`) as Promise<FilaCotizacion[]>;
}

/** Una cotización por id exacto. */
export async function leerCotizacion(id: string): Promise<FilaCotizacion | null> {
    const filas = await pedir(`/quotes?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    return filas?.[0] ?? null;
}

// ── Escritura ────────────────────────────────────────────────────────────

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
    return filas?.[0];
}
