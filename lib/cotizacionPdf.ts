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
// Con extensión .js a propósito: Vite la resuelve al .ts igual, pero Node en
// modo ESM la exige. Sin ella este módulo funciona en la web y truena en el
// worker del agente, que es justo el escenario que se quería evitar.
import { totalesDe } from './cotizador.js';

// ── Coordenadas de la plantilla ─────────────────────────────────────────
//
// Medidas con `pdftotext -bbox` sobre la plantilla real, no a ojo: ahí están
// las posiciones exactas de cada rótulo impreso, y los valores se alinean
// contra ellas. Si algún día se cambia la plantilla, hay que volver a medir
// (ver calibrar.mjs), no mover números hasta que "se vea bien".
//
// Rótulos de referencia (x0–x1, y0–y1 desde arriba):
//   PROYECTO  83.9–160.1  197.7–212.7      Descripción 114.0–184.0  257.6–271.2
//   CLIENTE   83.1–136.0  216.6–230.1      #           266.1–272.9
//   Fecha:   393.9–439.9  213.2–227.3      Costo       352.2–386.2
//   NOTAS:    82.0–131.4  447.2–460.8      Total       460.4–490.3
//   Sub Total 370.4–426.0 445.4–459.0
// anchoNombre: los nombres arrancan en 220 y "Fecha:" empieza en 393.9. Un
// nombre fiscal largo ("…SERVICIOS INDUSTRIALES SA DE CV") lo atravesaba
// entero, escribiendo encima del rótulo y de la fecha.
const ENCABEZADO = { proyecto: [220, 203], cliente: [220, 220], fecha: [450, 217],
                     anchoNombre: 168 };
// anchoDescripcion: hasta dónde puede llegar el texto antes de invadir la
// columna de cantidad, que va centrada en 280.
// cantidadCentro va al centro del rótulo "#" (266.1–272.9), y las cifras
// terminan 4pt después del borde derecho de su encabezado. Antes la cantidad
// caía 10pt a la derecha de su columna y el costo 29pt: las cifras no
// colgaban de su título.
const TABLA = { inicioY: 300, paso: 20, descripcionX: 65, anchoDescripcion: 190,
                cantidadCentro: 269.5, precioDer: 390, totalDer: 494 };

/**
 * La tabla arranca en 300 y los totales viven en 450: caben 7 partidas.
 * Antes no había tope y a partir de la octava el texto se dibujaba ENCIMA de
 * los totales, en silencio.
 */
const Y_TOPE = 435;

// anchoCifra: los rótulos impresos "Sub Total", "IVA (8%)" y "Total" terminan
// cerca de x=430. Una cifra de siete dígitos a 10pt mide ~77pt y desde 495
// hacia la izquierda llegaba hasta 418, encima del rótulo. Se encoge para
// caber en lugar de montarse.
const FINANZAS = { derecha: 495, inicioY: 450, anchoCifra: 62 };

/**
 * Las notas van en la columna de la izquierda, bajo "NOTAS:".
 *
 * `ancho` está calculado para no invadir la columna de totales, que arranca
 * cerca de x=375: antes se dibujaba una sola línea de 80 caracteres desde
 * x=140 y a 8pt eso mide ~350pt, así que una nota larga terminaba escrita
 * ENCIMA del subtotal. Ahora se parte en renglones y se corta al llegar al
 * tope, en vez de pisar cifras.
 */
const NOTAS = { x: 140, y: 450, ancho: 225, alto: 10, maxLineas: 4 };

/**
 * Los días de entrega van en el hueco que la plantilla dejó entre "ENTREGA"
 * (termina en 207.7) y "DÍAS" (empieza en 219.5): once puntos y ocho décimas.
 *
 * Un número de dos cifras a 9pt mide ~10pt y quedaba pegado a "DÍAS". Se
 * centra en el hueco y se encoge la fuente hasta que quepa con aire a los
 * lados — un "120" no cabría a 9pt y saldría montado sobre el rótulo.
 *
 * Queda más pequeño que el texto de la plantilla y no se puede evitar desde
 * aquí: para igualar su altura (10pt de caja) harían falta ~12pt de fuente,
 * que miden 13.6pt de ancho y no entran en un hueco de 11.8. Eso se arregla
 * ensanchando el hueco en el archivo de diseño de la plantilla, no en código.
 */
// La línea "TIEMPO DE ENTREGA ... DÍAS" de la plantilla ocupa 540.6–550.6.
// Se ancla por el BORDE INFERIOR (yMaxObjetivo) y no por una coordenada fija,
// porque al encoger la fuente el texto se movería de renglón: a 548 el número
// se caía al renglón siguiente y quedaba encima de "DE ORDEN DE COMPRA".
const ENTREGA = { hueco: [207.7, 219.5], yLinea: 540.0,
                  sizeMax: 9, sizeMin: 6, margen: 1.2 };

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

/**
 * Parte un texto en renglones que quepan en `ancho`.
 *
 * Mide con la fuente real (`widthOfTextAtSize`) en vez de contar caracteres:
 * "IIII" y "MMMM" tienen el mismo número de letras y muy distinto ancho, y es
 * justo esa diferencia la que hace que una nota se salga del área.
 */
export function envolver(texto: string, font: PDFFont, size: number, ancho: number): string[] {
    const lineas: string[] = [];
    let actual = '';
    for (const palabra of texto.split(/\s+/).filter(Boolean)) {
        const tentativa = actual ? `${actual} ${palabra}` : palabra;
        if (font.widthOfTextAtSize(tentativa, size) <= ancho) {
            actual = tentativa;
            continue;
        }
        if (actual) lineas.push(actual);
        // Una palabra sola más ancha que la columna (una URL, un SKU largo)
        // se parte por letras: dejarla entera la sacaría del área igual.
        if (font.widthOfTextAtSize(palabra, size) > ancho) {
            let trozo = '';
            for (const letra of palabra) {
                if (font.widthOfTextAtSize(trozo + letra, size) > ancho) {
                    lineas.push(trozo);
                    trozo = letra;
                } else {
                    trozo += letra;
                }
            }
            actual = trozo;
        } else {
            actual = palabra;
        }
    }
    if (actual) lineas.push(actual);
    return lineas;
}

/**
 * Recorta a lo que quepa en `ancho`, con puntos suspensivos.
 *
 * Se medía con `substring(0, 60)`, que cuenta letras en vez de medirlas: una
 * descripción de 60 caracteres anchos se metía encima de la columna de
 * cantidad y dejaba "…gerencia (m²)18" pegado, sin poder leer ninguno de los
 * dos. Con conceptos libres, donde las descripciones las escribe el usuario,
 * pasa a cada rato.
 */
export function recortar(texto: string, font: PDFFont, size: number, ancho: number): string {
    if (font.widthOfTextAtSize(texto, size) <= ancho) return texto;
    let corto = texto;
    while (corto.length > 1 && font.widthOfTextAtSize(`${corto}…`, size) > ancho) {
        corto = corto.slice(0, -1);
    }
    return `${corto.trimEnd()}…`;
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
    /** Como `derecha`, pero encoge la fuente hasta que la cifra quepa en `ancho`. */
    const derechaAjustada = (t: string, xDer: number, y: number, ancho: number,
                             font: PDFFont = normal, size = 10) => {
        let s = size;
        while (s > 6 && font.widthOfTextAtSize(t, s) > ancho) s -= 0.25;
        texto(t, xDer - font.widthOfTextAtSize(t, s), y, font, s);
    };

    // ── Encabezado ───────────────────────────────────────────────────────
    texto(recortar(quote.projectName ?? '', negrita, 10, ENCABEZADO.anchoNombre),
          ENCABEZADO.proyecto[0], ENCABEZADO.proyecto[1], negrita);
    texto(recortar(quote.clientName ?? '', negrita, 10, ENCABEZADO.anchoNombre),
          ENCABEZADO.cliente[0], ENCABEZADO.cliente[1], negrita);
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

        // El ancho de la descripción se calcula contra la cantidad de ESTE
        // renglón: "1234.56" centrado ocupa más a la izquierda que "4", y con
        // un ancho fijo la descripción le caía encima.
        const tCant = String(cant);
        const xCant = TABLA.cantidadCentro - normal.widthOfTextAtSize(tCant, 10) / 2;
        const anchoDesc = Math.min(TABLA.anchoDescripcion, xCant - TABLA.descripcionX - 6);
        texto(recortar(item.description ?? '', normal, 10, anchoDesc), TABLA.descripcionX, y);
        texto(tCant, xCant, y);
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
    derechaAjustada(pesos(t.subtotal), FINANZAS.derecha, FINANZAS.inicioY, FINANZAS.anchoCifra, negrita);
    derechaAjustada(pesos(t.iva), FINANZAS.derecha, FINANZAS.inicioY + 15, FINANZAS.anchoCifra, negrita);
    derechaAjustada(pesos(t.total), FINANZAS.derecha, FINANZAS.inicioY + 35, FINANZAS.anchoCifra, negrita, 12);

    if (quote.notes) {
        const lineas = envolver(quote.notes, normal, 8, NOTAS.ancho);
        lineas.slice(0, NOTAS.maxLineas).forEach((l, n) => {
            texto(l, NOTAS.x, NOTAS.y + n * NOTAS.alto, normal, 8);
        });
        // Si no cupo todo, se marca. Una nota cortada en seco hace creer al
        // cliente que ahí termina la condición.
        if (lineas.length > NOTAS.maxLineas) {
            texto('(…)', NOTAS.x, NOTAS.y + NOTAS.maxLineas * NOTAS.alto, normal, 8);
        }
    }

    const habiles = diasHabiles(quote.date, quote.deliveryTime);
    if (habiles > 0) {
        const t = String(habiles);
        const disponible = ENTREGA.hueco[1] - ENTREGA.hueco[0] - ENTREGA.margen * 2;
        let size = ENTREGA.sizeMax;
        while (size > ENTREGA.sizeMin && negrita.widthOfTextAtSize(t, size) > disponible) size -= 0.5;
        const ancho = negrita.widthOfTextAtSize(t, size);
        const centro = (ENTREGA.hueco[0] + ENTREGA.hueco[1]) / 2;
        texto(t, centro - ancho / 2, ENTREGA.yLinea, negrita, size);
    }

    return pdfDoc.save();
}
