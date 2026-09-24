/**
 * El PDF de la cotización, sin navegador.
 *
 * Vivía dentro de `pages/Quotes.tsx` y hacía `fetch('/TEMPLATE …pdf')`. El
 * agente de chat tiene que devolver ESTE MISMO PDF por Discord o WhatsApp, y
 * ahí no hay `fetch` de rutas públicas ni `URL.createObjectURL`.
 *
 * La única diferencia entre los dos entornos es cómo se consiguen los bytes de
 * la plantilla —`fetch()` en el navegador, `readFileSync()` en el worker— así
 * que se reciben como parámetro y todo lo demás es idéntico. Las coordenadas
 * están calibradas contra la plantilla real: no se tocan sin verla impresa.
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Quote } from '../types';
import { totalesDe } from './cotizador';

// ── Coordenadas de la plantilla (calibradas, no adivinadas) ──────────────
const ENCABEZADO = { proyecto: [220, 195], cliente: [220, 220], fecha: [450, 220] };
const TABLA = { inicioY: 300, paso: 20, descripcionX: 65, cantidadCentro: 280, precioDer: 415, totalDer: 495 };

/**
 * La tabla arranca en 300 y los totales viven en 450: caben 7 partidas.
 * Antes no había tope y a partir de la octava el texto se dibujaba ENCIMA de
 * los totales, en silencio.
 */
const Y_TOPE = 435;

const FINANZAS = { derecha: 495, inicioY: 450 };
const NOTAS = { x: 140, y: 450, limite: 80 };
const ENTREGA = { x: 210, y: 540 };

export interface OpcionesPdf {
    /** Bytes de la plantilla. El que llama decide de dónde salen. */
    plantilla: Uint8Array | ArrayBuffer;
    /** Tasa de IVA. Sale de `ajustes`, nunca del código. */
    iva: number;
}

/**
 * Días hábiles entre dos fechas, inclusivas. La plantilla dice
 * "TIEMPO DE ENTREGA __ DÍAS" y el taller cuenta días de trabajo, no naturales.
 */
export function diasHabiles(desde: string, hasta: string): number {
    const a = new Date(desde);
    const b = new Date(hasta);
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 0;
    let n = 0;
    const cur = new Date(a);
    while (cur <= b) {
        const d = cur.getDay();
        if (d !== 0 && d !== 6) n++;
        cur.setDate(cur.getDate() + 1);
    }
    return n;
}

const pesos = (n: number, dec = 2) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;

/**
 * Dibuja la cotización sobre la plantilla y devuelve los bytes del PDF.
 *
 * No devuelve un Blob ni una URL: eso es del navegador. Quien llama decide si
 * lo descarga, lo sube a Supabase o lo manda por Discord.
 */
export async function generarCotizacionPdf(
    quote: Quote,
    { plantilla, iva }: OpcionesPdf,
): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(plantilla);
    const normal = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const negrita = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const paginas = pdfDoc.getPages();
    // La plantilla trae la hoja de partidas en la página 2.
    const hojaPlantilla = paginas.length > 1 ? paginas[1] : paginas[0];
    let hoja: PDFPage = hojaPlantilla;
    const { height } = hojaPlantilla.getSize();

    // Las coordenadas del diseño se miden desde ARRIBA; pdf-lib desde abajo.
    const texto = (t: string, x: number, yDesdeArriba: number, font: PDFFont = normal, size = 10) => {
        hoja.drawText(t, { x, y: height - yDesdeArriba, size, font, color: rgb(0.1, 0.1, 0.1) });
    };
    const derecha = (t: string, xDer: number, y: number, font: PDFFont = normal, size = 10) => {
        texto(t, xDer - font.widthOfTextAtSize(t, size), y, font, size);
    };

    // ── Encabezado ───────────────────────────────────────────────────────
    texto(quote.projectName ?? '', ENCABEZADO.proyecto[0], ENCABEZADO.proyecto[1], negrita);
    texto(quote.clientName ?? '', ENCABEZADO.cliente[0], ENCABEZADO.cliente[1], negrita);
    texto(quote.date ?? '', ENCABEZADO.fecha[0], ENCABEZADO.fecha[1]);

    // ── Partidas ─────────────────────────────────────────────────────────
    let y = TABLA.inicioY;
    for (const item of quote.items ?? []) {
        if (y > Y_TOPE) {
            hoja = pdfDoc.addPage([hojaPlantilla.getWidth(), hojaPlantilla.getHeight()]);
            y = TABLA.inicioY;
            texto(`${quote.projectName} — continuación`, 65, 250, negrita);
            texto('CONCEPTO', 65, 280, negrita, 9);
            texto('CANT', 265, 280, negrita, 9);
            texto('P. UNIT', 380, 280, negrita, 9);
            texto('IMPORTE', 455, 280, negrita, 9);
        }

        const cant = Number(item.quantity) || 0;
        const unitario = Number(item.unitPrice) || 0;

        texto((item.description ?? '').substring(0, 60), TABLA.descripcionX, y);
        const tCant = String(cant);
        texto(tCant, TABLA.cantidadCentro - normal.widthOfTextAtSize(tCant, 10) / 2, y);
        derecha(pesos(unitario, 0), TABLA.precioDer, y);
        derecha(pesos(cant * unitario, 0), TABLA.totalDer, y);

        y += TABLA.paso;
    }

    // ── Totales ──────────────────────────────────────────────────────────
    // Siempre en la hoja de la plantilla, donde el diseño los espera, aunque
    // las partidas hayan seguido en hojas nuevas.
    hoja = hojaPlantilla;

    // El subtotal se SUMA de las partidas impresas, no se toma de
    // quote.totalAmount. En la app los dos coinciden (totalAmount se calcula de
    // las partidas al guardar), pero si algún día difieren, un documento cuyo
    // subtotal no cuadre con los renglones que tiene arriba es un documento que
    // el cliente va a objetar. Manda lo que está impreso.
    const t = totalesDe(quote.items ?? [], iva);
    derecha(pesos(t.subtotal), FINANZAS.derecha, FINANZAS.inicioY, negrita);
    derecha(pesos(t.iva), FINANZAS.derecha, FINANZAS.inicioY + 15, negrita);
    derecha(pesos(t.total), FINANZAS.derecha, FINANZAS.inicioY + 35, negrita, 12);

    if (quote.notes) {
        texto(quote.notes.substring(0, NOTAS.limite), NOTAS.x, NOTAS.y, normal, 8);
    }

    const habiles = diasHabiles(quote.date, quote.deliveryTime);
    if (habiles > 0) texto(String(habiles), ENTREGA.x, ENTREGA.y, negrita, 9);

    return pdfDoc.save();
}
