/**
 * Busca textos empalmados en el PDF generado.
 *
 * Extrae la caja de CADA palabra (las de la plantilla y las nuestras) y
 * reporta los pares que se solapan. Es la única forma de encontrarlos todos:
 * revisar a ojo sólo encuentra los que uno ya sospecha.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { generarCotizacionPdf } from './agente-cotizador/dist/lib/cotizacionPdf.js';

const TMP = process.env.TMPDIR || '.';
const PLANTILLA = 'public/TEMPLATE Mono Atelier  (1).pdf';

const casos = {
  'normal': {
    projectName:'Cocina Planta 2', clientName:'EMDICO', date:'2026-09-25', deliveryTime:'2026-11-10',
    items:[{description:'Cocina',quantity:4,unitPrice:2850}], notes:'Incluye instalación.',
  },
  'todo largo y grande': {
    projectName:'Remodelación integral de oficinas corporativas planta 2 y 3',
    clientName:'EMDICO CONSTRUCCIONES Y SERVICIOS INDUSTRIALES SA DE CV',
    date:'2026-09-25', deliveryTime:'2027-06-30',
    items:[
      {description:'Lambrín de madera en muros de gerencia con acabado poliuretano',quantity:1234.56,unitPrice:1250.75},
      {description:'Cocina integral',quantity:4,unitPrice:2850},
    ],
    notes:'Nota muy larga que debe envolverse en varios renglones sin invadir la columna de totales bajo ninguna circunstancia, ni siquiera cuando el texto se extiende bastante.',
  },
};

let fallas = 0;
for (const [nombre, q] of Object.entries(casos)) {
  const quote = { id:'', status:'Draft', totalAmount:0, ...q };
  writeFileSync(`${TMP}/_e.pdf`, await generarCotizacionPdf(quote, {
    plantilla: readFileSync(PLANTILLA), iva: 0.08 }));
  execSync(`pdftotext -bbox -f 2 -l 2 "${TMP}/_e.pdf" "${TMP}/_e.html"`);
  const w = [...readFileSync(`${TMP}/_e.html`,'utf8').matchAll(
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/g)]
    .map(m=>({x0:+m[1],y0:+m[2],x1:+m[3],y1:+m[4],t:m[5]}));

  console.log(`\n── ${nombre} ${'─'.repeat(50-nombre.length)}`);
  // El logotipo "MONO ATELIER" se superpone a propósito: es un diseño, no un
  // error de composición. Se excluye para no ahogar los hallazgos reales.
  const LOGO = new Set(['M','O','N','ATELIER']);
  const esLogo = v => LOGO.has(v.t) && v.y0 < 215;
  const choques = [];
  for (let i=0;i<w.length;i++) for (let j=i+1;j<w.length;j++) {
    const a=w[i], b=w[j];
    if (esLogo(a) || esLogo(b)) continue;
    const solX = Math.min(a.x1,b.x1) - Math.max(a.x0,b.x0);
    const solY = Math.min(a.y1,b.y1) - Math.max(a.y0,b.y0);
    if (solX > 0.5 && solY > 2) choques.push({a,b,solX:solX.toFixed(1)});
  }
  if (!choques.length) { console.log('  ✓ sin empalmes'); continue; }
  fallas += choques.length;
  for (const c of choques) {
    console.log(`  ✗ "${c.a.t}" (${c.a.x0.toFixed(0)}-${c.a.x1.toFixed(0)}) ` +
                `se empalma ${c.solX}pt con "${c.b.t}" (${c.b.x0.toFixed(0)}-${c.b.x1.toFixed(0)}) ` +
                `en y≈${c.a.y0.toFixed(0)}`);
  }
  // además: separación mínima entre palabras vecinas en la misma línea
  const lineas = {};
  for (const v of w) { const k = Math.round(v.y0); (lineas[k] ??= []).push(v); }
  for (const [y, vs] of Object.entries(lineas)) {
    vs.sort((a,b)=>a.x0-b.x0);
    for (let i=1;i<vs.length;i++) {
      const sep = vs[i].x0 - vs[i-1].x1;
      if (sep >= 0 && sep < 1.5) {
        console.log(`  ! "${vs[i-1].t}" y "${vs[i].t}" a ${sep.toFixed(1)}pt de separación (y≈${y})`);
        fallas++;
      }
    }
  }
}
console.log('\n' + '─'.repeat(60));
console.log(fallas ? `${fallas} problema(s) de espaciado.` : 'Sin empalmes ni textos pegados.');
