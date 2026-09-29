/**
 * Núcleo del proxy de Facturapi. Corre en el SERVIDOR (función de Vercel, o
 * el middleware de `npm run dev`); nunca en el navegador.
 *
 * Antes la llave secreta vivía en VITE_FACTURAPI_KEY, y todo lo que lleva
 * VITE_ se incrusta en el JavaScript que descarga cualquier visitante: con
 * abrir la página se podía sacar la llave y timbrar o cancelar CFDIs a nombre
 * de Mono Atelier. Ahora la llave está sólo aquí (FACTURAPI_KEY) y:
 *
 *   · Sólo atiende a una sesión de Supabase con perfil en `users`.
 *   · Sólo deja pasar las operaciones que la plataforma usa — no es un túnel
 *     abierto a toda la API de Facturapi.
 *   · Cada respuesta dice en qué modo se hizo (live / test), para que una
 *     factura de pruebas nunca se guarde como real.
 *
 * El archivo empieza con _ para que Vercel no lo publique como función.
 */

export interface Entorno {
    FACTURAPI_KEY?: string;
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
}

export interface Peticion {
    metodo: string;
    /** ruta de Facturapi, sin /v2: "invoices", "invoices/abc/pdf", "modo" */
    ruta: string;
    query: Record<string, string | string[] | undefined>;
    cuerpo?: unknown;
    authorization?: string;
}

export interface Respuesta {
    status: number;
    headers: Record<string, string>;
    body: string | Uint8Array;
}

const FACTURAPI = 'https://www.facturapi.io/v2';
const ID = '[A-Za-z0-9_-]{1,64}';

/** Lo único que la plataforma le pide a Facturapi, con los parámetros que usa. */
const PERMITIDAS: { metodo: string; patron: RegExp; params: string[] }[] = [
    { metodo: 'GET', patron: /^invoices$/, params: ['limit', 'page', 'q', 'status', 'date[gt]', 'date[lt]'] },
    { metodo: 'GET', patron: new RegExp(`^invoices/${ID}$`), params: [] },
    { metodo: 'GET', patron: new RegExp(`^invoices/${ID}/(pdf|xml|zip)$`), params: [] },
    { metodo: 'POST', patron: /^invoices$/, params: [] },
    { metodo: 'DELETE', patron: new RegExp(`^invoices/${ID}$`), params: ['motive', 'substitution'] },
    { metodo: 'GET', patron: /^customers$/, params: ['q', 'limit'] },
    { metodo: 'POST', patron: /^customers$/, params: [] },
];

export const modoDeLlave = (k?: string): 'live' | 'test' | 'sin-llave' =>
    !k ? 'sin-llave' : k.startsWith('sk_test') ? 'test' : 'live';

const json = (status: number, datos: unknown, extra: Record<string, string> = {}): Respuesta => ({
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
    body: JSON.stringify(datos),
});

/** ¿La sesión es de alguien del equipo? Pregunta a Supabase con el token de
 *  la persona: si el token es falso o caducó, Supabase no la reconoce. */
async function esMiembro(authorization: string | undefined, env: Entorno,
                         f: typeof fetch): Promise<Respuesta | null> {
    const token = (authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { message: 'Inicia sesión para facturar.' });
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        return json(500, { message: 'El servidor no tiene SUPABASE_URL / SUPABASE_ANON_KEY.' });
    }
    const cab = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
    const usuario = await f(`${env.SUPABASE_URL}/auth/v1/user`, { headers: cab });
    if (!usuario.ok) return json(401, { message: 'Tu sesión caducó. Vuelve a iniciar sesión.' });

    const r = await f(`${env.SUPABASE_URL}/rest/v1/rpc/es_miembro`, {
        method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (r.status === 404) {
        return json(503, { message: 'Falta la migración 20260929_auth_perfiles.sql en Supabase.' });
    }
    if (!r.ok || (await r.json()) !== true) {
        return json(403, { message: 'Tu cuenta no tiene perfil en Mono Atelier OS.' });
    }
    return null;
}

export async function atender(p: Peticion, env: Entorno, f: typeof fetch = fetch): Promise<Respuesta> {
    const modo = modoDeLlave(env.FACTURAPI_KEY);
    const cabModo = { 'X-Facturapi-Modo': modo };
    const metodo = p.metodo.toUpperCase();
    const ruta = p.ruta.replace(/^\/+|\/+$/g, '');

    const negado = await esMiembro(p.authorization, env, f);
    if (negado) return negado;

    // el modo y el prefijo (nunca la llave), para el aviso de pruebas/producción
    if (ruta === 'modo' && metodo === 'GET') {
        const k = env.FACTURAPI_KEY;
        return json(200, { modo, prefijo: k ? `${k.slice(0, 7)}_…` : 'ninguna' }, cabModo);
    }

    const regla = PERMITIDAS.find(r => r.metodo === metodo && r.patron.test(ruta));
    if (!regla) return json(404, { message: `Operación no permitida: ${metodo} ${ruta}` }, cabModo);
    if (!env.FACTURAPI_KEY) {
        return json(500, { message: 'El servidor no tiene FACTURAPI_KEY: agrégala en Vercel → Settings → Environment Variables.' }, cabModo);
    }

    const qs = new URLSearchParams();
    for (const nombre of regla.params) {
        const v = p.query[nombre];
        if (typeof v === 'string' && v) qs.set(nombre, v);
    }

    const init: RequestInit = {
        method: metodo,
        headers: {
            Authorization: `Basic ${Buffer.from(`${env.FACTURAPI_KEY}:`).toString('base64')}`,
            ...(metodo === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
    };
    if (metodo === 'POST') {
        if (!p.cuerpo || typeof p.cuerpo !== 'object') {
            return json(400, { message: 'Falta el cuerpo JSON de la petición.' }, cabModo);
        }
        init.body = JSON.stringify(p.cuerpo);
    }

    const r = await f(`${FACTURAPI}/${ruta}${qs.toString() ? `?${qs}` : ''}`, init);
    const headers: Record<string, string> = {
        ...cabModo,
        'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-store',
    };
    const disposicion = r.headers.get('content-disposition');
    if (disposicion) headers['Content-Disposition'] = disposicion;
    return { status: r.status, headers, body: new Uint8Array(await r.arrayBuffer()) };
}

/** Las variables del servidor. En Vercel las VITE_ también están, así que
 *  sirven de respaldo para la URL y la llave pública de Supabase. */
export function entornoDe(e: Record<string, string | undefined>): Entorno {
    return {
        FACTURAPI_KEY: e.FACTURAPI_KEY,
        SUPABASE_URL: (e.SUPABASE_URL || e.VITE_SUPABASE_URL || '').replace(/\/$/, '') || undefined,
        SUPABASE_ANON_KEY: e.SUPABASE_ANON_KEY || e.VITE_SUPABASE_ANON_KEY,
    };
}
