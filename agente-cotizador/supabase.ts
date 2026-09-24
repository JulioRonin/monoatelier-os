/**
 * Acceso a Supabase desde el servidor MCP.
 *
 * Cliente propio contra la API REST en vez de @supabase/supabase-js: ese vive
 * en el navegador y lee su configuración de `import.meta.env`, que en Node no
 * existe. Aquí las llaves salen del entorno, como en el worker de Forge.
 *
 * Nunca se escriben llaves en el código.
 */

const URL_BASE = () => {
    const u = process.env.SUPABASE_URL?.replace(/\/$/, '');
    if (!u) throw new Error('Falta SUPABASE_URL en el entorno.');
    return u;
};

const LLAVE = () => {
    const k = process.env.SUPABASE_KEY;
    if (!k) throw new Error('Falta SUPABASE_KEY en el entorno (service_role o anon).');
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
