/**
 * El reporte de ventas en PDF, sin navegador.
 *
 * Sigue el diseño de la pantalla de Financials —A4 horizontal, el verde de la
 * marca, encabezado, tres tarjetas y tabla— para que un reporte pedido por
 * chat y uno exportado desde la plataforma se vean como el mismo documento.
 *
 * Dos cosas que la exportación de Financials hace y aquí NO se repiten:
 *
 *   1. Ahí las filas que no caben en la página simplemente no se dibujan
 *      (`if (rowY < 40) return;`). Un reporte al que le faltan meses sin
 *      avisar es peor que uno de dos páginas: aquí se pagina.
 *   2. Las cifras se alinean a la derecha midiéndolas con la fuente real. Es
 *      la misma lección que dejó el PDF de la cotización: un total de siete
 *      dígitos colocado por x fija termina encima del rótulo de al lado.
 *
 * Y una regla que este documento sí tiene que llevar impresa: trae márgenes y
 * costos, así que va marcado de USO INTERNO en cada página. El margen nunca
 * viaja a un cliente.
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

// ── Paleta y medidas, tomadas de pages/Financials.tsx ───────────────────

const VERDE = rgb(0.26, 0.48, 0.43);      // #427a6e, el primary de la marca
const TINTA = rgb(0.2, 0.2, 0.2);
const GRIS = rgb(0.5, 0.5, 0.5);
const LINEA = rgb(0.9, 0.9, 0.9);
const BUENO = rgb(0.2, 0.6, 0.4);
const ALERTA = rgb(0.9, 0.4, 0.1);
const ACENTO = rgb(0.77, 0.31, 0.75);

const HOJA: [number, number] = [842, 595];   // A4 horizontal
const MARGEN = 40;
const DERECHA = HOJA[0] - MARGEN;            // 802
/** Piso del contenido: debajo va el pie de página, en y=24. */
const PIE = 44;

/** Umbral de margen sano, el mismo que usa Financials para el semáforo. */
const MARGEN_SANO = 0.30;

/**
 * Bordes DERECHOS de cada columna numérica, y la izquierda del concepto.
 *
 * Están puestos de modo que la columna más ancha posible —una cifra de siete
 * dígitos a 10pt, ~77pt— quepa entre un borde y el anterior.
 */
const COL = {
    concepto: MARGEN,
    cotizado: 300,
    vendido: 420,
    proyectos: 470,
    facturado: 590,
    margen: 670,
    conversion: DERECHA,
};

// ── Datos que recibe ────────────────────────────────────────────────────

export interface MesDeVentas {
    /** AAAA-MM */
    mes: string;
    cotizado: number;
    vendido: number;
    costo: number;
    facturado: number;
    /** cuántos proyectos se cerraron ese mes */
    n: number;
    /**
     * De lo cotizado ESE mes, cuánto acabó cerrándose — aunque se cerrara
     * meses después. La conversión se mide así y no como vendido/cotizado del
     * mismo mes: la venta de noviembre puede venir de la oferta de septiembre,
     * y dividir una entre otra da porcentajes de más de 100%.
     */
    convertido: number;
}

export interface ClienteDeVentas {
    nombre: string;
    vendido: number;
    costo: number;
    facturado: number;
    n: number;
}

export interface DatosReporte {
    desde: string;
    hasta: string;
    meses: MesDeVentas[];
    clientes?: ClienteDeVentas[];
    /** Proyectos sin fecha de venta: no entran en ningún mes y hay que decirlo. */
    sinFechaDeVenta?: { nombre: string; monto: number }[];
    /**
     * Si ninguna cotización del periodo trae proyecto ligado, la conversión no
     * es 0%: es que no se puede saber. La columna sale vacía y se explica al
     * pie, en vez de imprimir un cero que se lee como "no cerramos nada".
     */
    conversionMedible?: boolean;
}

// ── Formato ─────────────────────────────────────────────────────────────

const pesos = (n: number) =>
    `$${(Math.round(n * 100) / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    })}`;

/** Cifras grandes en las tarjetas: los centavos ahí no dicen nada. */
const pesosCorto = (n: number) =>
    `$${Math.round(n).toLocaleString('en-US')}`;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * "2026-11" → "noviembre 2026".
 *
 * A mano y no con `toLocaleDateString('es-MX')`: Node sin ICU completo
 * devuelve el mes en inglés, y el reporte saldría mitad y mitad.
 */
export function nombreDeMes(m: string): string {
    const [a, n] = m.split('-');
    const i = Number(n) - 1;
    return MESES[i] ? `${MESES[i]} ${a}` : m;
}

/** null cuando no hay costo capturado: un margen inventado se lee como real. */
export const margenDe = (v: { vendido: number; costo: number }): number | null =>
    v.vendido > 0 && v.costo > 0 ? (v.vendido - v.costo) / v.vendido : null;

// ── Dibujo ──────────────────────────────────────────────────────────────

interface Lienzo {
    pagina: PDFPage;
    /** y del siguiente renglón */
    y: number;
}

export async function generarReporteVentasPdf(d: DatosReporte): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const normal = await pdf.embedFont(StandardFonts.Helvetica);
    const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);

    const total = d.meses.reduce((a, v) => ({
        cotizado: a.cotizado + v.cotizado, vendido: a.vendido + v.vendido,
        costo: a.costo + v.costo, facturado: a.facturado + v.facturado, n: a.n + v.n,
        convertido: a.convertido + v.convertido,
    }), { cotizado: 0, vendido: 0, costo: 0, facturado: 0, n: 0, convertido: 0 });

    const medible = d.conversionMedible !== false;
    /** De lo cotizado en el mes, qué parte acabó cerrándose. */
    const conversion = (v: { cotizado: number; convertido: number }) =>
        medible && v.cotizado > 0 ? `${((v.convertido / v.cotizado) * 100).toFixed(0)}%` : '—';

    let hojas = 0;
    const nuevaHoja = (): Lienzo => {
        const pagina = pdf.addPage(HOJA);
        hojas++;
        sello(pagina, normal, negrita);
        return { pagina, y: HOJA[1] - MARGEN - 10 };
    };

    const txt = (l: Lienzo, t: string, x: number, y: number,
                 size = 10, bold = false, color = TINTA) =>
        l.pagina.drawText(t, { x, y, size, font: bold ? negrita : normal, color });

    /** Alineado a la derecha con la fuente real, para que nada se monte. */
    const txtDer = (l: Lienzo, t: string, xDer: number, y: number,
                    size = 10, bold = false, color = TINTA) => {
        const f = bold ? negrita : normal;
        txt(l, t, xDer - f.widthOfTextAtSize(t, size), y, size, bold, color);
    };

    let l = nuevaHoja();

    // 1. Encabezado — mismo texto y jerarquía que la pantalla
    txt(l, 'Reporte de Ventas', MARGEN, l.y - 20, 24, true, VERDE);
    txt(l, `Cotizado, vendido y facturado  •  ${d.desde} a ${d.hasta}`,
        MARGEN, l.y - 40, 10, false, GRIS);

    // 2. Tres tarjetas, como en Financials
    // 20pt entre el subtítulo y el rótulo de la tarjeta, los mismos que deja
    // Financials (subtítulo en height-70, rótulo en height-90).
    const tarjetaY = l.y - 110;
    const anchoTarjeta = 240, hueco = 20;
    const mgTotal = margenDe(total);

    const tarjeta = (x: number, rotulo: string, cifra: string,
                     pie: string, colorPie = VERDE) => {
        txt(l, rotulo, x, tarjetaY + 50, 8, true, GRIS);
        txt(l, cifra, x, tarjetaY + 25, 20, true, TINTA);
        txt(l, pie, x, tarjetaY + 5, 10, false, colorPie);
    };
    tarjeta(MARGEN, 'VENDIDO EN EL PERIODO', pesosCorto(total.vendido),
        `${total.n} proyecto${total.n === 1 ? '' : 's'} cerrado${total.n === 1 ? '' : 's'}`);
    tarjeta(MARGEN + anchoTarjeta + hueco, 'FACTURADO', pesosCorto(total.facturado),
        'Sólo timbrado real, sin sandbox', ACENTO);
    tarjeta(MARGEN + 2 * (anchoTarjeta + hueco), 'MARGEN PROMEDIO',
        mgTotal == null ? '—' : `${(mgTotal * 100).toFixed(1)}%`,
        mgTotal == null ? 'Falta capturar costo real'
            : mgTotal > MARGEN_SANO ? 'Margen sano' : 'Requiere atención',
        mgTotal == null ? GRIS : mgTotal > MARGEN_SANO ? BUENO : ALERTA);

    // 3. Tabla por mes
    //
    // 42 y no los 65 que deja Financials entre las tarjetas y la tabla: ese
    // hueco se ve bien en una pantalla con scroll, pero en una hoja se come el
    // espacio que necesita la nota del pie y manda un reporte de tres meses a
    // una segunda página casi vacía.
    l.y = tarjetaY - 42;
    l.y = encabezadoTabla(l, txt, txtDer, 'MES');

    for (const m of d.meses) {
        if (l.y < 70) { l = nuevaHoja(); l.y = encabezadoTabla(l, txt, txtDer, 'MES (cont.)'); }
        const mg = margenDe(m);
        txt(l, nombreDeMes(m.mes), COL.concepto, l.y, 11, true, TINTA);
        txtDer(l, pesos(m.cotizado), COL.cotizado, l.y, 10, false, GRIS);
        txtDer(l, pesos(m.vendido), COL.vendido, l.y, 10, true, TINTA);
        txtDer(l, String(m.n), COL.proyectos, l.y, 10, false, GRIS);
        txtDer(l, pesos(m.facturado), COL.facturado, l.y, 10, false, TINTA);
        txtDer(l, mg == null ? '—' : `${(mg * 100).toFixed(0)}%`, COL.margen, l.y, 11, true,
            mg == null ? GRIS : mg > MARGEN_SANO ? BUENO : ALERTA);
        txtDer(l, conversion(m), COL.conversion, l.y, 10, false, GRIS);
        raya(l.pagina, l.y - 8, LINEA);
        l.y -= 26;
    }

    // Totales, con su propia raya más marcada
    if (l.y < 80) { l = nuevaHoja(); l.y -= 20; }
    raya(l.pagina, l.y + 12, GRIS, 1);
    txt(l, 'TOTAL', COL.concepto, l.y, 11, true, VERDE);
    txtDer(l, pesos(total.cotizado), COL.cotizado, l.y, 10, true, TINTA);
    txtDer(l, pesos(total.vendido), COL.vendido, l.y, 10, true, TINTA);
    txtDer(l, String(total.n), COL.proyectos, l.y, 10, true, TINTA);
    txtDer(l, pesos(total.facturado), COL.facturado, l.y, 10, true, TINTA);
    txtDer(l, mgTotal == null ? '—' : `${(mgTotal * 100).toFixed(1)}%`, COL.margen, l.y, 11, true,
        mgTotal == null ? GRIS : mgTotal > MARGEN_SANO ? BUENO : ALERTA);
    txtDer(l, conversion(total), COL.conversion, l.y, 10, true, TINTA);
    l.y -= 34;

    // 4. Clientes, si se pidieron
    if (d.clientes?.length) {
        if (l.y < 150) l = nuevaHoja();
        txt(l, 'Por cliente', MARGEN, l.y, 14, true, VERDE);
        l.y -= 24;
        l.y = encabezadoTabla(l, txt, txtDer, 'CLIENTE', true);
        for (const c of d.clientes) {
            if (l.y < 70) { l = nuevaHoja(); l.y = encabezadoTabla(l, txt, txtDer, 'CLIENTE (cont.)', true); }
            const mg = margenDe(c);
            txt(l, recortar(c.nombre, normal, 11, COL.cotizado - COL.concepto - 20),
                COL.concepto, l.y, 11, true, TINTA);
            txtDer(l, pesos(c.vendido), COL.vendido, l.y, 10, true, TINTA);
            txtDer(l, String(c.n), COL.proyectos, l.y, 10, false, GRIS);
            txtDer(l, pesos(c.facturado), COL.facturado, l.y, 10, false, TINTA);
            txtDer(l, mg == null ? '—' : `${(mg * 100).toFixed(0)}%`, COL.margen, l.y, 11, true,
                mg == null ? GRIS : mg > MARGEN_SANO ? BUENO : ALERTA);
            raya(l.pagina, l.y - 8, LINEA);
            l.y -= 26;
        }
        l.y -= 10;
    }

    // 5. Qué fecha usa cada cifra. Sin esta nota, dos reportes del mismo mes
    //    con criterios distintos parecen contradecirse.
    //
    // Se mide el bloque COMPLETO antes de empezarlo, contando los proyectos
    // que va a listar. Si sólo se comprobara el hueco del primer renglón, el
    // aviso podría quedar escrito —"1 proyecto(s) sin fecha de venta:"— y la
    // lista caerse por el borde: un encabezado anunciando una lista vacía.
    const huerfanosAListar = (d.sinFechaDeVenta ?? []).slice(0, 6);
    const altoNotas = 14 + 4 * 12
        + (huerfanosAListar.length ? 6 + 12 + huerfanosAListar.length * 11 : 0)
        + ((d.sinFechaDeVenta?.length ?? 0) > huerfanosAListar.length ? 11 : 0);
    if (l.y - altoNotas < PIE) l = nuevaHoja();
    txt(l, 'Cómo se midió', MARGEN, l.y, 9, true, GRIS);
    l.y -= 14;
    for (const nota of [
        'Cotizado: por la fecha de la cotización — cuándo se ofertó.',
        'Vendido: por la fecha en que la cotización se volvió proyecto — cuándo entró la venta.',
        'Facturado: por la fecha de la factura, contando sólo las timbradas de verdad (sin sandbox ni canceladas).',
        medible
            ? 'Conversión: de lo cotizado en ese mes, cuánto acabó cerrándose — aunque se cerrara meses después.'
            : 'Conversión: sin dato. Se mide ligando cada cotización con el proyecto en que se convirtió, '
              + 'y ese enlace se guarda desde ahora; las cotizaciones anteriores no lo traen.',
    ]) {
        txt(l, nota, MARGEN, l.y, 8, false, GRIS);
        l.y -= 12;
    }

    if (huerfanosAListar.length) {
        const n = d.sinFechaDeVenta!.length;
        l.y -= 6;
        txt(l, `${n} proyecto${n === 1 ? '' : 's'} sin fecha de venta — no entra${n === 1 ? '' : 'n'} en ningún mes:`,
            MARGEN, l.y, 8, true, ALERTA);
        l.y -= 12;
        for (const p of huerfanosAListar) {
            txt(l, `${p.nombre} — ${pesos(p.monto)}`, MARGEN + 10, l.y, 8, false, GRIS);
            l.y -= 11;
        }
        if (n > huerfanosAListar.length) {
            txt(l, `y ${n - huerfanosAListar.length} más.`, MARGEN + 10, l.y, 8, false, GRIS);
        }
    }

    return pdf.save();
}

/** Rótulos de columna. Devuelve la y del primer renglón de datos. */
function encabezadoTabla(
    l: Lienzo,
    txt: (l: Lienzo, t: string, x: number, y: number, s?: number, b?: boolean, c?: any) => void,
    txtDer: (l: Lienzo, t: string, x: number, y: number, s?: number, b?: boolean, c?: any) => void,
    primera: string,
    sinCotizado = false,
): number {
    txt(l, primera, COL.concepto, l.y, 9, true, GRIS);
    if (!sinCotizado) txtDer(l, 'COTIZADO', COL.cotizado, l.y, 9, true, GRIS);
    txtDer(l, 'VENDIDO', COL.vendido, l.y, 9, true, GRIS);
    txtDer(l, '#', COL.proyectos, l.y, 9, true, GRIS);
    txtDer(l, 'FACTURADO', COL.facturado, l.y, 9, true, GRIS);
    txtDer(l, 'MARGEN', COL.margen, l.y, 9, true, GRIS);
    if (!sinCotizado) txtDer(l, 'CONVERSIÓN', COL.conversion, l.y, 9, true, GRIS);
    raya(l.pagina, l.y - 8, GRIS, 0.7);
    return l.y - 28;
}

const raya = (p: PDFPage, y: number, color: any, grosor = 0.5) =>
    p.drawLine({ start: { x: MARGEN, y }, end: { x: DERECHA, y }, thickness: grosor, color });

/**
 * El sello de uso interno, en cada página.
 *
 * Este documento lleva costos y márgenes. En mono-forge hay un test que abre
 * los PDF en binario y falla si el margen se filtró a un entregable del
 * cliente; aquí no se puede impedir que alguien lo reenvíe, pero sí que lo
 * reenvíe sin darse cuenta de lo que trae.
 */
function sello(p: PDFPage, normal: PDFFont, negrita: PDFFont) {
    const t = 'USO INTERNO — NO ENVIAR AL CLIENTE';
    const size = 8;
    p.drawText(t, {
        x: DERECHA - negrita.widthOfTextAtSize(t, size),
        y: HOJA[1] - MARGEN - 4, size, font: negrita, color: ALERTA,
    });
    const pie = 'Mono Atelier — contiene costos y márgenes internos';
    p.drawText(pie, { x: MARGEN, y: 24, size: 7, font: normal, color: GRIS });
}

/** Corta midiendo con la fuente, no contando caracteres. */
function recortar(t: string, font: PDFFont, size: number, ancho: number): string {
    if (font.widthOfTextAtSize(t, size) <= ancho) return t;
    let c = t;
    while (c.length > 1 && font.widthOfTextAtSize(`${c}…`, size) > ancho) c = c.slice(0, -1);
    return `${c}…`;
}
