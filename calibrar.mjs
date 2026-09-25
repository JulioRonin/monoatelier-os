/**
 * Calibra el PDF de cotización contra la plantilla.
 *
 *     npm run calibrar:pdf
 *
 * Genera una cotización de prueba, extrae con `pdftotext -bbox` la posición
 * real de cada texto —tanto el que trae impreso la plantilla como el que
 * dibujamos nosotros— y reporta el desfase de cada campo.
 *
 * Existe porque las coordenadas de lib/cotizacionPdf.ts se ajustaron a ojo y
 * varias estaban mal sin que se notara: la cantidad caía 10pt a la derecha de
 * su columna, el costo 29pt, y las notas largas se escribían encima del
 * subtotal. "Se ve bien" no es una medición.
 *
 * Si algún día se cambia la plantilla, esto dice qué se rompió y cuánto.
 * Requiere poppler-utils (pdftotext).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { generarCotizacionPdf } from './agente-cotizador/dist/lib/cotizacionPdf.js';

const PLANTILLA = 'public/TEMPLATE Mono Atelier  (1).pdf';
const TMP = process.env.TMPDIR || '.';

/** Tolerancia: por debajo de esto el desfase no se ve impreso. */
const TOLERANCIA = 1.5;

function cajas(pdf) {
    execSync(`pdftotext -bbox -f 2 -l 2 "${pdf}" "${TMP}/_bbox.html"`);
    const html = readFileSync(`${TMP}/_bbox.html`, 'utf8');
    return [...html.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/g)]
        .map(m => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5] }));
}

const quote = {
    id: '', projectName: 'PROYECTOPRUEBA', clientName: 'CLIENTEPRUEBA',
    date: '2026-09-25', deliveryTime: '2026-11-10',
    items: [{ description: 'CONCEPTOPRUEBA', quantity: 44, unitPrice: 1111 }],
    notes: 'NOTAPRUEBA', status: 'Draft', totalAmount: 48884,
};

writeFileSync(`${TMP}/_cal.pdf`, await generarCotizacionPdf(quote, {
    plantilla: readFileSync(PLANTILLA), iva: 0.08,
}));

const w = cajas(`${TMP}/_cal.pdf`);
const dame = t => w.find(v => v.t === t);
let fallas = 0;

// ── alineación vertical: cada valor con su rótulo ────────────────────────
console.log('\nALINEACIÓN VERTICAL (valor contra su rótulo)\n' + '─'.repeat(58));
for (const [mio, rotulo] of [
    ['PROYECTOPRUEBA', 'PROYECTO'], ['CLIENTEPRUEBA', 'CLIENTE'], ['2026-09-25', 'Fecha:'],
]) {
    const a = dame(mio), b = dame(rotulo);
    if (!a || !b) { console.log(`  ? no encontré ${!a ? mio : rotulo}`); fallas++; continue; }
    const d = b.y1 - a.y1;
    const ok = Math.abs(d) < TOLERANCIA;
    if (!ok) fallas++;
    console.log(`  ${ok ? '✓' : '✗'} ${rotulo.padEnd(12)} desfase ${d.toFixed(1).padStart(6)}pt`);
}

// ── columnas de la tabla ─────────────────────────────────────────────────
console.log('\nCOLUMNAS (cifra bajo su encabezado)\n' + '─'.repeat(58));
for (const [mio, enc, modo] of [
    ['44', '#', 'centro'], ['$1,111', 'Costo', 'derecha'], ['$48,884', 'Total', 'derecha'],
]) {
    const a = dame(mio), b = dame(enc);
    if (!a || !b) { console.log(`  ? no encontré ${!a ? mio : enc}`); fallas++; continue; }
    const d = modo === 'centro'
        ? (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2
        : a.x1 - b.x1;
    const ok = Math.abs(d) <= 5;
    if (!ok) fallas++;
    console.log(`  ${ok ? '✓' : '✗'} ${enc.padEnd(12)} ${modo.padEnd(8)} desfase ${d.toFixed(1).padStart(6)}pt`);
}

// ── invasiones: texto que se mete donde no debe ──────────────────────────
console.log('\nINVASIONES\n' + '─'.repeat(58));
const chequeo = (nombre, cond, detalle) => {
    if (!cond) fallas++;
    console.log(`  ${cond ? '✓' : '✗'} ${nombre}${cond ? '' : ` — ${detalle}`}`);
};

const desc = dame('CONCEPTOPRUEBA'), cant = dame('44');
chequeo('la descripción no invade la columna de cantidad',
    !desc || !cant || desc.x1 < cant.x0, `descripción llega a ${desc?.x1.toFixed(1)}, cantidad empieza en ${cant?.x0.toFixed(1)}`);

const nota = dame('NOTAPRUEBA'), sub = dame('Sub');
chequeo('las notas no invaden los totales',
    !nota || !sub || nota.x1 < sub.x0, `notas llegan a ${nota?.x1.toFixed(1)}, "Sub Total" empieza en ${sub?.x0.toFixed(1)}`);

// ── días de entrega: cabe en el hueco de la plantilla ────────────────────
// El hueco que dejó la plantilla entre "ENTREGA" y "DÍAS". Se compara contra
// estos números y no contra las palabras vecinas porque, al quedar pegadas,
// pdftotext las fusiona en un solo token ("ENTREGA33DÍAS") y no hay qué medir.
const HUECO = [207.7, 219.5];
const linea = w.filter(v => v.y0 > 535 && v.y0 < 560);
const dias = linea.find(v => /^\d+$/.test(v.t));
if (dias) {
    const izq = dias.x0 - HUECO[0], der = HUECO[1] - dias.x1;
    const ok = izq > 0.5 && der > 0.5;
    if (!ok) fallas++;
    console.log(`  ${ok ? '✓' : '✗'} los días (${dias.t}) caben en el hueco de la plantilla ` +
                `(aire ${izq.toFixed(1)}pt / ${der.toFixed(1)}pt)`);
} else {
    console.log('  ? no encontré el número de días en la línea de entrega');
    fallas++;
}

console.log('\n' + '─'.repeat(58));
console.log(fallas ? `${fallas} desalineación(es). Ajusta las constantes de lib/cotizacionPdf.ts.\n`
                   : 'Todo alineado con la plantilla.\n');
process.exit(fallas ? 1 : 0);
