/**
 * CFDI 4.0 — lectura del XML timbrado y aritmética fiscal del REP.
 *
 * Sin dependencias y sin red: son funciones puras sobre el XML que ya timbró
 * un PAC. Se usan para dos cosas:
 *
 *   1. Registrar una factura emitida en OTRA plataforma para poder timbrar
 *      aquí su Complemento de Pago (el REP se liga por UUID, no por PAC).
 *   2. Repartir los impuestos del pago A PRORRATA de la estructura real de la
 *      factura, en lugar de suponer que el monto pagado es base × 1.08.
 */

// ---------------------------------------------------------------------------
// Catálogo c_Impuesto del SAT
// ---------------------------------------------------------------------------
const IMPUESTOS: { [clave: string]: 'ISR' | 'IVA' | 'IEPS' } = {
    '001': 'ISR',
    '002': 'IVA',
    '003': 'IEPS',
};

const NS_CFDI = 'http://www.sat.gob.mx/cfd/4';
const NS_TFD = 'http://www.sat.gob.mx/TimbreFiscalDigital';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Un impuesto de la factura, agregado por (tipo, tasa, retención). */
export interface CfdiImpuesto {
    tipo: 'ISR' | 'IVA' | 'IEPS';
    tasa: number;        // 0.08, 0.0125…
    base: number;        // suma de las bases de los conceptos
    importe: number;     // suma de los importes
    retencion: boolean;  // true = se resta del total
}

/** Una factura CFDI 4.0 ya timbrada, leída de su XML. */
export interface CfdiExterno {
    uuid: string;
    serie: string;
    folio: string;
    fecha: string;              // ISO 8601
    emisorRfc: string;
    emisorNombre: string;
    receptorRfc: string;
    receptorNombre: string;
    receptorRegimen: string;
    receptorCp: string;
    usoCfdi: string;
    moneda: string;
    tipoCambio: number;
    metodoPago: string;         // PUE | PPD
    formaPago: string;
    tipoComprobante: string;    // I | E | T | N | P
    subtotal: number;
    total: number;
    impuestos: CfdiImpuesto[];
}

/** Impuesto ya prorrateado, en el formato que espera Facturapi. */
export interface ImpuestoPagado {
    base: number;
    type: 'IVA' | 'ISR' | 'IEPS';
    rate: number;
    withholding?: boolean;
}

export class CfdiInvalido extends Error {}

// ---------------------------------------------------------------------------
// Lectura del XML
// ---------------------------------------------------------------------------

function hijos(nodo: Element | Document, ns: string, nombre: string): Element[] {
    return Array.from(nodo.getElementsByTagNameNS(ns, nombre));
}

function primero(nodo: Element | Document, ns: string, nombre: string): Element | null {
    return hijos(nodo, ns, nombre)[0] ?? null;
}

function num(valor: string | null | undefined): number {
    const n = parseFloat(valor ?? '');
    return Number.isFinite(n) ? n : 0;
}

/**
 * Lee un CFDI 4.0 timbrado.
 *
 * Los impuestos se agregan desde los CONCEPTOS, no desde el nodo Impuestos de
 * arriba: ahí las retenciones vienen sin Base ni TasaOCuota (el SAT no las
 * exige en ese nivel), y sin base no se puede prorratear el pago.
 */
export function leerCfdi(xml: string): CfdiExterno {
    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(xml, 'application/xml');
    } catch {
        throw new CfdiInvalido('El archivo no es XML.');
    }
    if (doc.getElementsByTagName('parsererror').length > 0) {
        throw new CfdiInvalido('El XML está mal formado o incompleto.');
    }

    const comp = primero(doc, NS_CFDI, 'Comprobante');
    if (!comp) {
        throw new CfdiInvalido(
            'No es un CFDI 4.0. ¿Subiste el PDF o el "acuse" en lugar del XML timbrado?');
    }
    const version = comp.getAttribute('Version') ?? '';
    if (!version.startsWith('4.')) {
        throw new CfdiInvalido(
            `El CFDI es versión ${version || 'desconocida'}. Sólo se puede relacionar la 4.0.`);
    }

    const timbre = primero(doc, NS_TFD, 'TimbreFiscalDigital');
    const uuid = timbre?.getAttribute('UUID');
    if (!uuid) {
        throw new CfdiInvalido(
            'El XML no tiene Timbre Fiscal Digital: no está timbrado y no tiene UUID. ' +
            'Sin UUID el REP no se puede relacionar con nada.');
    }

    const emisor = primero(doc, NS_CFDI, 'Emisor');
    const receptor = primero(doc, NS_CFDI, 'Receptor');
    if (!emisor || !receptor) {
        throw new CfdiInvalido('Al XML le falta el nodo Emisor o Receptor.');
    }

    // ── impuestos, agregados por (tipo, tasa, retención) ────────────────
    const acumulado = new Map<string, CfdiImpuesto>();
    const acumular = (nodo: Element, retencion: boolean) => {
        const clave = nodo.getAttribute('Impuesto') ?? '';
        const tipo = IMPUESTOS[clave];
        if (!tipo) return;                       // impuesto local o desconocido
        if ((nodo.getAttribute('TipoFactor') ?? 'Tasa') === 'Exento') return;

        const tasa = num(nodo.getAttribute('TasaOCuota'));
        const llave = `${tipo}|${tasa}|${retencion}`;
        const previo = acumulado.get(llave);
        const base = num(nodo.getAttribute('Base'));
        const importe = num(nodo.getAttribute('Importe'));
        if (previo) {
            previo.base = redondear(previo.base + base);
            previo.importe = redondear(previo.importe + importe);
        } else {
            acumulado.set(llave, { tipo, tasa, base, importe, retencion });
        }
    };

    for (const concepto of hijos(doc, NS_CFDI, 'Concepto')) {
        const impuestos = primero(concepto, NS_CFDI, 'Impuestos');
        if (!impuestos) continue;
        const traslados = primero(impuestos, NS_CFDI, 'Traslados');
        const retenciones = primero(impuestos, NS_CFDI, 'Retenciones');
        if (traslados) for (const t of hijos(traslados, NS_CFDI, 'Traslado')) acumular(t, false);
        if (retenciones) for (const r of hijos(retenciones, NS_CFDI, 'Retencion')) acumular(r, true);
    }

    return {
        uuid: uuid.toLowerCase(),
        // Serie es OPCIONAL en el CFDI. La factura 46 de Mono Atelier no la trae:
        // no la inventes, un folio fiscal con serie que no existe no cuadra.
        serie: comp.getAttribute('Serie') ?? '',
        folio: comp.getAttribute('Folio') ?? '',
        fecha: comp.getAttribute('Fecha') ?? '',
        emisorRfc: (emisor.getAttribute('Rfc') ?? '').toUpperCase(),
        emisorNombre: emisor.getAttribute('Nombre') ?? '',
        receptorRfc: (receptor.getAttribute('Rfc') ?? '').toUpperCase(),
        receptorNombre: receptor.getAttribute('Nombre') ?? '',
        receptorRegimen: receptor.getAttribute('RegimenFiscalReceptor') ?? '',
        receptorCp: receptor.getAttribute('DomicilioFiscalReceptor') ?? '',
        usoCfdi: receptor.getAttribute('UsoCFDI') ?? '',
        moneda: comp.getAttribute('Moneda') ?? 'MXN',
        tipoCambio: num(comp.getAttribute('TipoCambio')) || 1,
        metodoPago: comp.getAttribute('MetodoPago') ?? '',
        formaPago: comp.getAttribute('FormaPago') ?? '',
        tipoComprobante: comp.getAttribute('TipoDeComprobante') ?? '',
        subtotal: num(comp.getAttribute('SubTotal')),
        total: num(comp.getAttribute('Total')),
        impuestos: Array.from(acumulado.values()),
    };
}

/**
 * ¿Esta factura admite un REP? Devuelve el motivo si NO.
 *
 * El SAT no acepta un Complemento de Pago sobre una factura PUE: esa ya se
 * declaró pagada al emitirse. Timbrarlo de todos modos deja dos comprobantes
 * que no cuadran entre sí.
 */
export function motivoParaNoTimbrarRep(f: CfdiExterno): string | null {
    if (f.tipoComprobante === 'P') {
        return 'Ese XML ya ES un Complemento de Pago (tipo P), no una factura.';
    }
    if (f.tipoComprobante !== 'I') {
        return `El comprobante es tipo "${f.tipoComprobante}". El REP sólo aplica a facturas de Ingreso (I).`;
    }
    if (f.metodoPago !== 'PPD') {
        return `La factura es ${f.metodoPago || 'sin método de pago'}, no PPD. ` +
               'Sólo las PPD llevan Complemento de Pago; una PUE ya se declaró pagada al emitirse.';
    }
    if (f.total <= 0) {
        return 'El total de la factura es cero.';
    }
    return null;
}

// ---------------------------------------------------------------------------
// Aritmética del pago
// ---------------------------------------------------------------------------

/** Redondeo a 2 decimales, que es lo que el SAT acepta en pesos. */
export function redondear(n: number, decimales = 2): number {
    const f = 10 ** decimales;
    // el +Number.EPSILON evita que 1.005 caiga a 1.00 por el binario del float
    return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Reparte los impuestos de la factura a prorrata del monto pagado.
 *
 * Esto es lo que arregla el error de fondo del módulo: `base = monto / 1.08`
 * SÓLO es cierto si el único impuesto es IVA 8% trasladado. La factura 46
 * tiene además 1.25% de ISR retenido:
 *
 *     30,000 + 2,400 (IVA) − 375 (ISR) = 32,025
 *     32,025 / 1.08 = 29,652.78   ← base falsa, el REP sale mal
 *     base real = 30,000
 *
 * Se manda sólo la base y la tasa: Facturapi deriva el importe, así no hay dos
 * redondeos distintos que puedan discrepar en un centavo.
 */
export function repartirImpuestos(
    impuestos: CfdiImpuesto[],
    montoPagado: number,
    totalFactura: number,
): ImpuestoPagado[] {
    if (totalFactura <= 0 || impuestos.length === 0) return [];
    const factor = montoPagado / totalFactura;

    return impuestos
        .map(i => ({
            base: redondear(i.base * factor),
            type: i.tipo,
            rate: i.tasa,
            ...(i.retencion ? { withholding: true } : {}),
        }))
        .filter(i => i.base > 0);
}

/**
 * Estructura fiscal supuesta cuando NO se conoce la de la factura original
 * (facturas viejas de Facturapi sin desglose accesible).
 *
 * Es una suposición, no un dato: quien la use debe decirlo en pantalla.
 */
export function estructuraSupuesta(total: number, tasaIva: number): CfdiImpuesto[] {
    const base = redondear(total / (1 + tasaIva));
    return [{
        tipo: 'IVA',
        tasa: tasaIva,
        base,
        importe: redondear(total - base),
        retencion: false,
    }];
}

/** Cómo se compone el monto pagado. Lo que se enseña en pantalla. */
export interface DesglosePago {
    base: number;
    trasladado: number;
    retenido: number;
    /** base + trasladado − retenido. Debe cuadrar con el monto pagado. */
    total: number;
    /** Diferencia contra el monto pagado. Más de un centavo = algo no cuadra. */
    diferencia: number;
}

/**
 * Desglosa un pago con la estructura fiscal de la factura.
 *
 * La base sale del SUBTOTAL de la factura, no de sumar las bases de los
 * impuestos: dos traslados sobre el mismo concepto (IVA + IEPS) comparten base
 * y sumarlas la contaría dos veces.
 */
export function desglosarPago(
    impuestos: CfdiImpuesto[],
    subtotal: number,
    montoPagado: number,
    totalFactura: number,
): DesglosePago {
    if (totalFactura <= 0) {
        return { base: 0, trasladado: 0, retenido: 0, total: 0, diferencia: -montoPagado };
    }
    const factor = montoPagado / totalFactura;
    const base = redondear(subtotal * factor);

    let trasladado = 0;
    let retenido = 0;
    for (const i of impuestos) {
        const importe = redondear(redondear(i.base * factor) * i.tasa);
        if (i.retencion) retenido += importe;
        else trasladado += importe;
    }
    trasladado = redondear(trasladado);
    retenido = redondear(retenido);

    const total = redondear(base + trasladado - retenido);
    return { base, trasladado, retenido, total, diferencia: redondear(total - montoPagado) };
}
