/**
 * Facturapi Integration Layer
 * Handles all communication with the Facturapi REST API for CFDI 4.0 timbrado.
 * Docs: https://www.facturapi.io/docs
 */

const FACTURAPI_BASE = 'https://www.facturapi.io/v2';
const FACTURAPI_KEY = import.meta.env.VITE_FACTURAPI_KEY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Complemento de Pago (REP) Types
// ---------------------------------------------------------------------------

/** A tax paid within a related document of a REP */
export interface FacturapiTaxPaid {
    base: number;          // Base gravable
    type: 'IVA' | 'ISR';
    rate: number;          // e.g. 0.08 for IVA 8%
    amount: number;        // Monto del impuesto
    withholding?: boolean;
}

/** One related document (factura PPD) within a payment */
export interface FacturapiRelatedDocument {
    uuid: string;                 // UUID de la factura PPD original
    amount: number;               // Monto pagado en esta parcialidad
    installment: number;          // Número de parcialidad (1, 2, 3…)
    last_balance: number;         // Saldo anterior de la factura
    taxes_paid?: FacturapiTaxPaid[];
}

/** One payment event inside a REP */
export interface FacturapiPaymentPayload {
    date: string;                 // ISO 8601 fecha/hora del pago
    payment_form: string;         // Clave SAT (e.g. "03")
    currency: string;             // MXN, USD, EUR
    exchange?: number;            // Tipo de cambio (si no es MXN)
    amount: number;               // Total pagado
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
    };
    items: { quantity: number; product: { description: string; price: number } }[];
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
        throw new Error(`Error al timbrar factura con Facturapi: ${msg}`);
    }

    return res.json() as Promise<FacturapiInvoiceResult>;
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
 */
export async function facturapiCreatePaymentComplement(
    payload: FacturapiPaymentComplementPayload
): Promise<FacturapiInvoiceResult> {
    const finalPayload = { ...payload, type: 'P' };
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
