/**
 * Facturapi Integration Layer
 * Handles all communication with the Facturapi REST API for CFDI 4.0 timbrado.
 * Docs: https://www.facturapi.io/docs
 */

import { redondear, type CfdiImpuesto } from './cfdi';

const FACTURAPI_BASE = 'https://www.facturapi.io/v2';
const FACTURAPI_KEY = import.meta.env.VITE_FACTURAPI_KEY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sandbox o producción — lo dice el prefijo de la llave, no una config aparte
 *  que se pueda desincronizar. Todo lo que dependa del modo (el saldo de las
 *  facturas, los avisos en pantalla) debe leerlo de aquí. */
export type FacturapiModo = 'live' | 'test' | 'sin-llave';

export function facturapiModo(): FacturapiModo {
    if (!FACTURAPI_KEY) return 'sin-llave';
    return FACTURAPI_KEY.startsWith('sk_test') ? 'test' : 'live';
}

/**
 * Sólo el prefijo de la llave (`sk_test_…` / `sk_live_…`), para poder
 * compararla de un vistazo con la que está puesta en Vercel.
 *
 * Nunca devuelve el resto: es un secreto y no tiene por qué aparecer en
 * pantalla ni en una captura.
 */
export function facturapiPrefijoLlave(): string {
    if (!FACTURAPI_KEY) return 'ninguna';
    return `${FACTURAPI_KEY.slice(0, 7)}_…`;
}

function authHeaders(): HeadersInit {
    if (!FACTURAPI_KEY) {
        throw new Error('La clave de Facturapi no está configurada. Verifica tu archivo .env.local (VITE_FACTURAPI_KEY).');
    }
    // Facturapi uses HTTP Basic Auth: key as username, empty password
    const encoded = btoa(`${FACTURAPI_KEY}:`);
    return {
        Authorization: `Basic ${encoded}`,
        'Content-Type': 'application/json',
    };
}

/**
 * Parses Facturapi error responses and surfaces a human-readable message.
 */
async function parseFacturapiError(res: Response): Promise<string> {
    try {
        const body = await res.json();
        // Facturapi returns { message: "...", status: ... }
        if (body?.message) return body.message;
        return JSON.stringify(body);
    } catch {
        return `Error HTTP ${res.status}: ${res.statusText}`;
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FacturapiCustomerPayload {
    legal_name: string;      // Razón social sin régimen societario
    tax_id: string;          // RFC
    tax_system: string;      // Régimen fiscal (3 dígitos)
    address: { zip: string };
    email?: string;
}

export interface FacturapiItem {
    quantity: number;
    product: {
        description: string;
        product_key: string;  // ClaveProdServ SAT
        unit_key?: string;    // ClaveUnidad SAT
        price: number;        // Precio unitario BRUTO (sin impuestos)
        tax_included?: boolean; // false = taxes added ON TOP (default behavior we use)
        taxes: {
            type: 'IVA' | 'ISR';
            rate: number;
            withholding?: boolean;  // true for ISR retention
        }[];
    };
}

export interface FacturapiInvoicePayload {
    customer: string;                         // Facturapi customer ID
    type?: 'I' | 'E' | 'T' | 'N' | 'P';     // 'I' = Ingreso
    use: string;                              // Uso CFDI
    payment_method: 'PUE' | 'PPD';
    payment_form: string;                     // Forma de pago (2 dígitos)
    currency?: string;
    exchange?: number;
    items: FacturapiItem[];
    series?: string;
    folio_number?: number;
    /** TipoRelacion del SAT. '04' = sustitución de los CFDI previos. */
    relation?: string;
    /** UUID(s) del CFDI al que se relaciona esta factura. */
    related?: string[];
    // Required by SAT when receiver RFC is XAXX010101000 (Público en General)
    global_information?: {
        periodicity: 'day' | 'week' | 'fortnight' | 'month' | 'bimonthly';
        months: string; // '01'–'12'
        year: number;
    };
}

export interface FacturapiInvoiceResult {
    id: string;
    uuid: string;
    status: 'valid' | 'canceled' | 'draft';
    total: number;
    created_at: string;
    folio_number: number;
    series: string;
    /** true = se timbró, pero SIN el CFDI relacionado que se pidió. Ver
     *  facturapiCreateInvoice: la liga de sustitución queda en la cancelación. */
    relacionOmitida?: boolean;
}

// ---------------------------------------------------------------------------
// Complemento de Pago (REP) Types
// ---------------------------------------------------------------------------

/** A tax paid within a related document of a REP.
 *  `amount` is intentionally absent: Facturapi derives it from base × rate, so
 *  there is only one rounding and it can't disagree with ours. */
export interface FacturapiTaxPaid {
    base: number;          // Base gravable de esta parcialidad
    type: 'IVA' | 'ISR' | 'IEPS';
    rate: number;          // e.g. 0.08 for IVA 8%
    withholding?: boolean; // true = retención (se resta)
}

/** One related document (factura PPD) within a payment */
export interface FacturapiRelatedDocument {
    uuid: string;                 // UUID de la factura PPD original
    amount: number;               // Monto pagado en esta parcialidad
    installment: number;          // Número de parcialidad (1, 2, 3…)
    last_balance: number;         // Saldo anterior de la factura
    taxes?: FacturapiTaxPaid[];
}

/** One payment event inside a REP */
export interface FacturapiPaymentPayload {
    date: string;                 // ISO 8601 fecha/hora del pago
    payment_form: string;         // Clave SAT (e.g. "03")
    currency: string;             // MXN, USD, EUR
    exchange?: number;            // Tipo de cambio (si no es MXN)
    related_documents: FacturapiRelatedDocument[];
}

/** Full payload to POST /v2/invoices with type "P" */
export interface FacturapiPaymentComplementPayload {
    customer: string;             // Facturapi customer ID
    payments: FacturapiPaymentPayload[];
    type?: 'P';
    series?: string;
}


/** Full invoice record returned by GET /v2/invoices */
export interface FacturapiInvoiceRecord {
    id: string;
    uuid: string;
    status: 'valid' | 'canceled' | 'draft';
    type: string;
    series: string;
    folio_number: number;
    created_at: string;
    total: number;
    currency: string;
    payment_method: string;
    payment_form: string;
    use: string;
    customer: {
        id: string;
        legal_name: string;
        tax_id: string;
        tax_system?: string;
        address?: { zip?: string };
    };
    /** 'pending' = cancelación solicitada, esperando que el receptor la acepte. */
    cancellation_status?: string;
    items: {
        quantity: number;
        product: {
            description: string;
            price: number;
            product_key?: string;   // ClaveProdServ del SAT
            unit_key?: string;      // ClaveUnidad del SAT
            tax_included?: boolean;
            taxes?: { type: 'IVA' | 'ISR' | 'IEPS'; rate: number; withholding?: boolean }[];
        };
    }[];
}

export interface FacturapiInvoiceListParams {
    limit?: number;    // default 50, max 100
    page?: number;     // 1-indexed
    q?: string;        // search by customer name, RFC or folio
    status?: 'valid' | 'canceled' | 'draft';
    date?: { gt?: string; lt?: string }; // ISO date strings
}

export interface FacturapiInvoiceListResponse {
    page: number;
    total_pages: number;
    total_results: number;
    data: FacturapiInvoiceRecord[];
}


// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/**
 * Step 1 – Create or verify a customer in Facturapi.
 * Returns the Facturapi customer ID to use in the invoice payload.
 */
export async function facturapiCreateCustomer(
    payload: FacturapiCustomerPayload
): Promise<string> {
    const res = await fetch(`${FACTURAPI_BASE}/customers`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const msg = await parseFacturapiError(res);
        throw new Error(`Error al sincronizar cliente con Facturapi: ${msg}`);
    }

    const data = await res.json();
    return data.id as string;
}

/**
 * Step 2 – Create (timbre) a CFDI 4.0 invoice via Facturapi.
 * Returns the stamped invoice result including UUID and ID.
 */
export async function facturapiCreateInvoice(
    payload: FacturapiInvoicePayload
): Promise<FacturapiInvoiceResult> {
    // SAT Business Rule: PPD requires payment_form "99" (Por definir)
    const finalPayload = {
        ...payload,
        type: payload.type ?? 'I',
        currency: payload.currency ?? 'MXN',
        payment_form:
            payload.payment_method === 'PPD' ? '99' : payload.payment_form,
    };

    const res = await fetch(`${FACTURAPI_BASE}/invoices`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(finalPayload),
    });

    if (!res.ok) {
        const msg = await parseFacturapiError(res);

        // Si lo único que estorbó fue el CFDI relacionado, se timbra sin él y
        // se avisa. Quedarse sin factura por un campo accesorio es peor: la
        // liga de sustitución vive de todos modos en la cancelación (motivo
        // 01 lleva el UUID que sustituye), que es lo que el SAT registra.
        const esProblemaDeRelacion =
            !!payload.relation &&
            /relation|related|relacionad/i.test(msg);

        if (esProblemaDeRelacion) {
            const { relation, related, ...sinRelacion } = finalPayload as any;
            const reintento = await fetch(`${FACTURAPI_BASE}/invoices`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(sinRelacion),
            });
            if (reintento.ok) {
                const data = await reintento.json();
                return { ...data, relacionOmitida: true } as FacturapiInvoiceResult;
            }
        }

        throw new Error(`Error al timbrar factura con Facturapi: ${msg}`);
    }

    return res.json() as Promise<FacturapiInvoiceResult>;
}

// ---------------------------------------------------------------------------
// Cancelación (esquema SAT vigente desde 2022)
// ---------------------------------------------------------------------------

/** Motivos de cancelación del catálogo del SAT. */
export const MOTIVOS_CANCELACION: {
    value: string; label: string; ayuda: string; requiereSustitucion: boolean;
}[] = [
    {
        value: '01',
        label: '01 — Comprobante emitido con errores CON relación',
        ayuda: 'Se equivocó y YA existe (o vas a emitir) una factura nueva que la sustituye. ' +
               'Hay que indicar el folio fiscal de esa factura nueva.',
        requiereSustitucion: true,
    },
    {
        value: '02',
        label: '02 — Comprobante emitido con errores SIN relación',
        ayuda: 'Estaba mal y NO se va a volver a facturar esa operación.',
        requiereSustitucion: false,
    },
    {
        value: '03',
        label: '03 — No se llevó a cabo la operación',
        ayuda: 'La venta o el servicio nunca ocurrió.',
        requiereSustitucion: false,
    },
    {
        value: '04',
        label: '04 — Operación nominativa relacionada en una factura global',
        ayuda: 'La operación ya quedó incluida en una factura global.',
        requiereSustitucion: false,
    },
];

export interface FacturapiCancelResult {
    id: string;
    uuid: string;
    status: string;
    /** 'pending' = el receptor todavía tiene que aceptarla en su buzón. */
    cancellation_status?: string;
}

/**
 * Cancela un CFDI ante el SAT.
 *
 * Con el motivo '01' hay que mandar `substitution`: el folio fiscal (UUID) o el
 * id de Facturapi de la factura que la sustituye, **y esa factura ya debe
 * existir**. Por eso el orden correcto es emitir primero la corregida y
 * cancelar después — no al revés.
 *
 * Ojo con el resultado: arriba de $1,000 el receptor tiene que aceptar la
 * cancelación en su buzón tributario, así que lo normal es recibir
 * `cancellation_status: 'pending'` y NO una cancelación consumada.
 */
export async function facturapiCancelInvoice(
    invoiceId: string,
    motive: string,
    substitution?: string,
): Promise<FacturapiCancelResult> {
    const motivo = MOTIVOS_CANCELACION.find(m => m.value === motive);
    if (!motivo) {
        throw new Error(`Motivo de cancelación '${motive}' desconocido.`);
    }
    if (motivo.requiereSustitucion && !substitution) {
        throw new Error(
            'El motivo 01 exige el folio fiscal de la factura que sustituye a ésta. ' +
            'Emite primero la factura corregida y vuelve a intentar.');
    }

    const qs = new URLSearchParams({ motive });
    if (substitution) qs.set('substitution', substitution);

    const res = await fetch(`${FACTURAPI_BASE}/invoices/${invoiceId}?${qs.toString()}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    if (!res.ok) {
        const msg = await parseFacturapiError(res);
        throw new Error(`Error al cancelar la factura: ${msg}`);
    }
    return res.json() as Promise<FacturapiCancelResult>;
}

/**
 * Step 3a – Download the PDF for a stamped invoice as a Blob.
 */
export async function facturapiDownloadPdf(invoiceId: string): Promise<Blob> {
    const encoded = btoa(`${FACTURAPI_KEY}:`);
    const res = await fetch(`${FACTURAPI_BASE}/invoices/${invoiceId}/pdf`, {
        method: 'GET',
        headers: { Authorization: `Basic ${encoded}` },
    });
    if (!res.ok) {
        const msg = await parseFacturapiError(res);
        throw new Error(`Error al descargar PDF: ${msg}`);
    }
    return res.blob();
}

/**
 * Step 3b – Download the XML for a stamped invoice as a Blob.
 */
export async function facturapiDownloadXml(invoiceId: string): Promise<Blob> {
    const encoded = btoa(`${FACTURAPI_KEY}:`);
    const res = await fetch(`${FACTURAPI_BASE}/invoices/${invoiceId}/xml`, {
        method: 'GET',
        headers: { Authorization: `Basic ${encoded}` },
    });
    if (!res.ok) {
        const msg = await parseFacturapiError(res);
        throw new Error(`Error al descargar XML: ${msg}`);
    }
    return res.blob();
}

/**
 * Step 3c – Download the ZIP (XML + PDF) for a stamped invoice.
 * Falls back to separate PDF + XML downloads if ZIP fails.
 */
export async function facturapiDownloadZip(invoiceId: string): Promise<Blob> {
    const encoded = btoa(`${FACTURAPI_KEY}:`);
    const res = await fetch(`${FACTURAPI_BASE}/invoices/${invoiceId}/zip`, {
        method: 'GET',
        headers: { Authorization: `Basic ${encoded}` },
    });
    if (!res.ok) {
        const msg = await parseFacturapiError(res);
        throw new Error(`Error al descargar ZIP: ${msg}`);
    }
    return res.blob();
}

/**
 * List invoices from Facturapi with optional search + filters.
 * Uses GET /v2/invoices
 */
export async function facturapiListInvoices(
    params: FacturapiInvoiceListParams = {}
): Promise<FacturapiInvoiceListResponse> {
    const encoded = btoa(`${FACTURAPI_KEY}:`);
    const qs = new URLSearchParams();
    if (params.limit)  qs.set('limit', String(params.limit));
    if (params.page)   qs.set('page',  String(params.page));
    if (params.q)      qs.set('q', params.q);
    if (params.status) qs.set('status', params.status);
    if (params.date?.gt) qs.set('date[gt]', params.date.gt);
    if (params.date?.lt) qs.set('date[lt]', params.date.lt);

    const url = `${FACTURAPI_BASE}/invoices${qs.toString() ? '?' + qs.toString() : ''}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Basic ${encoded}` },
    });
    if (!res.ok) {
        const msg = await parseFacturapiError(res);
        throw new Error(`Error al obtener facturas: ${msg}`);
    }
    return res.json() as Promise<FacturapiInvoiceListResponse>;
}

/**
 * Retrieve a single invoice with its full detail (items and their taxes).
 *
 * The list endpoint returns a trimmed record; the REP needs the tax structure
 * of the original invoice to split it proportionally, and that only comes with
 * the full document.
 */
export async function facturapiRetrieveInvoice(
    invoiceId: string
): Promise<FacturapiInvoiceRecord> {
    const res = await fetch(`${FACTURAPI_BASE}/invoices/${invoiceId}`, {
        method: 'GET',
        headers: authHeaders(),
    });
    if (!res.ok) {
        const msg = await parseFacturapiError(res);
        throw new Error(`Error al leer la factura: ${msg}`);
    }
    return res.json() as Promise<FacturapiInvoiceRecord>;
}

/**
 * Reconstruye la estructura fiscal de una factura de Facturapi a partir de sus
 * conceptos, en el mismo formato que se lee de un XML externo.
 *
 * Devuelve null cuando no se puede derivar (factura sin conceptos o sin
 * impuestos declarados): quien llama debe entonces decir en pantalla que la
 * estructura es supuesta, no dar por hecho que el pago es base × 1.08.
 */
export function estructuraDeFactura(
    inv: FacturapiInvoiceRecord
): { subtotal: number; impuestos: CfdiImpuesto[]; cuadra: boolean } | null {
    if (!inv.items?.length) return null;

    const acumulado = new Map<string, CfdiImpuesto>();
    let subtotal = 0;
    let hayImpuestos = false;

    for (const item of inv.items) {
        // Según el endpoint, product puede venir nulo o como un id plano en
        // lugar del objeto completo. Sin el objeto no hay tasas que leer:
        // se devuelve null y quien llama usa la estructura supuesta (avisando).
        const product = item?.product;
        if (!product || typeof product !== 'object') return null;

        const impuestos = product.taxes ?? [];
        let base = (item.quantity ?? 1) * (product.price ?? 0);

        // En Facturapi tax_included es true por omisión: el precio ya trae los
        // traslados dentro y hay que sacarlos para llegar a la base.
        if (item.product.tax_included !== false) {
            const trasladadas = impuestos
                .filter(t => !t.withholding)
                .reduce((s, t) => s + (t.rate ?? 0), 0);
            if (trasladadas > 0) base = base / (1 + trasladadas);
        }
        base = redondear(base);
        subtotal += base;

        for (const t of impuestos) {
            if (!t?.type || t.rate == null) continue;
            hayImpuestos = true;
            const retencion = t.withholding === true;
            const llave = `${t.type}|${t.rate}|${retencion}`;
            const previo = acumulado.get(llave);
            const importe = redondear(base * t.rate);
            if (previo) {
                previo.base = redondear(previo.base + base);
                previo.importe = redondear(previo.importe + importe);
            } else {
                acumulado.set(llave, {
                    tipo: t.type, tasa: t.rate, base, importe, retencion,
                });
            }
        }
    }

    if (!hayImpuestos) return null;

    subtotal = redondear(subtotal);
    const impuestos = Array.from(acumulado.values());
    const trasladado = impuestos.filter(i => !i.retencion).reduce((s, i) => s + i.importe, 0);
    const retenido = impuestos.filter(i => i.retencion).reduce((s, i) => s + i.importe, 0);
    // Un peso de tolerancia: si no reconcilia contra el total timbrado, la
    // derivación no es de fiar y quien llama debe avisarlo.
    const cuadra = Math.abs(redondear(subtotal + trasladado - retenido) - inv.total) <= 1;

    return { subtotal, impuestos, cuadra };
}

/**
 * Find a customer by RFC, or create it.
 *
 * POST /customers always creates a NEW record, so calling it on every timbrado
 * fills the account with duplicates of the same client. Worse for a REP: the
 * receiver's régimen fiscal and postal code must match the original invoice
 * exactly, and a duplicate created with placeholder data would carry the wrong
 * ones into the stamped complement.
 */
export async function facturapiFindOrCreateCustomer(
    payload: FacturapiCustomerPayload
): Promise<string> {
    const rfc = payload.tax_id.trim().toUpperCase();
    try {
        const res = await fetch(
            `${FACTURAPI_BASE}/customers?q=${encodeURIComponent(rfc)}&limit=50`,
            { method: 'GET', headers: authHeaders() });
        if (res.ok) {
            const body = await res.json();
            const hit = (body?.data ?? []).find(
                (c: any) => (c.tax_id ?? '').toUpperCase() === rfc);
            if (hit?.id) return hit.id as string;
        }
    } catch {
        // la búsqueda es una optimización: si falla, se intenta crear
    }
    return facturapiCreateCustomer({ ...payload, tax_id: rfc });
}

/**
 * Utility – Triggers a browser download for a Blob.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
    // Force application/octet-stream so the browser never tries to display
    // the content inline (e.g. text/xml would open in the XML viewer without this).
    const forceDownload = new Blob([blob], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(forceDownload);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Small delay before revoking so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Create a Complemento de Pago (REP) — type "P" invoice.
 * Called when a PPD invoice receives a full or partial payment.
 *
 * Facturapi does NOT take the payments at the top level: a type "P" invoice
 * carries them inside `complements`, and sending `payments` is exactly what
 * produced `El campo "complements" es requerido`. The ergonomic shape stays in
 * this signature and the wire shape is built here:
 *
 *     { type: "P", customer, complements: [{ type: "pago", data: { … } }] }
 *
 * Each payment becomes its own complement entry.
 */
export async function facturapiCreatePaymentComplement(
    payload: FacturapiPaymentComplementPayload
): Promise<FacturapiInvoiceResult> {
    const { payments, ...resto } = payload;

    if (!payments?.length) {
        throw new Error('El REP no lleva ningún pago. Selecciona la factura y captura el monto.');
    }

    const complements = payments.map(p => ({
        type: 'pago',
        data: {
            payment_form: p.payment_form,
            date: p.date,
            currency: p.currency,
            // Facturapi rechaza exchange en MXN; sólo va cuando de verdad aplica
            ...(p.currency !== 'MXN' && p.exchange ? { exchange: p.exchange } : {}),
            related_documents: p.related_documents,
        },
    }));

    const finalPayload = { ...resto, type: 'P', complements };

    const res = await fetch(`${FACTURAPI_BASE}/invoices`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(finalPayload),
    });
    if (!res.ok) {
        const msg = await parseFacturapiError(res);
        throw new Error(`Error al timbrar Complemento de Pago: ${msg}`);
    }
    return res.json() as Promise<FacturapiInvoiceResult>;
}
