/**
 * Prueba de la cotización en curso y de la entrega del PDF.
 *
 * Reproduce lo que pasó en Discord: el usuario aprobó ("sí, genérala") y
 * cerrar_cotizacion contestó "La sesión se perdió"; el modelo reabrió la
 * cotización de cero. Lo que se verifica:
 *
 *   1. El borrador SOBREVIVE a que el servidor se reinicie entre pasos.
 *   2. Un `sesion` inventado por el modelo ya no importa (se ignora).
 *   3. Volver a llamar iniciar_cotizacion con el MISMO cliente y proyecto no
 *      borra las partidas; con otro distinto sí, y lo dice.
 *   4. Un borrador de hace más de 12 horas no resucita, y uno ilegible no
 *      tumba nada.
 *   5. El PDF se entrega con una línea MEDIA:<ruta> que la expresión regular
 *      de Hermes reconoce completa, con barras "/" y con espacios en la ruta.
 *   6. Al cerrar no queda nada abierto.
 *
 *     npm run build:agente && node prueba-borrador.mjs
 */

import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Borradores, VIGENCIA_MS } from './agente-cotizador/dist/agente-cotizador/borradores.js';
import { comoEntregar, etiquetaMedia, rutaParaChat } from './agente-cotizador/dist/agente-cotizador/entrega.js';

const fallas = [];
const ok = (c, m) => { if (!c) fallas.push(m); };
const salida = mkdtempSync(join(tmpdir(), 'cotizador-prueba-'));
const archivo = join(salida, '.borrador-abierto.json');

// ── 1. el módulo, sin servidor ───────────────────────────────────────────
try {
  let reloj = 1_000_000;
  const abre = () => new Borradores(() => archivo, () => reloj);
  const a = abre();
  a.abrir({ cliente: 'EMDICO', proyecto: 'Escritorio', entrega: '2026-10-22', fecha: '2026-09-30' });
  a.tomar().items.push({ description: 'Escritorio', quantity: 1, unitPrice: 9000 });
  a.guardar();

  const b = abre();                                   // "el proceso se reinició"
  ok(b.tomar().items.length === 1 && b.tomar().cliente === 'EMDICO',
     'un borrador nuevo debe leer del disco lo que dejó el proceso anterior');

  const mismo = b.abrir({ cliente: ' emdico ', proyecto: 'ESCRITORIO', entrega: '2026-11-01', fecha: '2026-09-30' });
  ok(mismo.borrador.items.length === 1 && /ya estaba abierta/.test(mismo.aviso ?? ''),
     'reabrir el mismo cliente y proyecto (aunque cambien mayúsculas y espacios) no debe borrar las partidas');
  ok(mismo.borrador.entrega === '2026-11-01', 'al reabrir se actualiza la fecha de entrega');

  const otro = b.abrir({ cliente: 'Casa Ríos', proyecto: 'Closet', entrega: '2026-11-15', fecha: '2026-09-30' });
  ok(otro.borrador.items.length === 0 && /Se descartó.*EMDICO/.test(otro.aviso ?? ''),
     'abrir OTRA cotización debe reemplazar y decir qué se descartó');

  reloj += VIGENCIA_MS + 1;
  let msg = '';
  try { abre().tomar(); } catch (e) { msg = e.message; }
  ok(/más de 12 horas/.test(msg), `un borrador de hace 13 horas no debe resucitar. Dio: "${msg}"`);

  writeFileSync(archivo, '{"actualizado": 1, "borrador": {"cliente": "x"');   // cortado a la mitad
  msg = '';
  try { abre().tomar(); } catch (e) { msg = e.message; }
  ok(/No hay una cotización abierta/.test(msg), 'un archivo ilegible debe tratarse como "no hay borrador", sin tronar');

  const c = abre();
  c.abrir({ cliente: 'A', proyecto: 'B', entrega: '2026-10-01', fecha: '2026-09-30' });
  c.cerrar();
  ok(!existsSync(archivo), 'cerrar debe borrar el archivo para que no resucite');
} catch (e) {
  fallas.push(`el módulo de borradores tronó en lugar de comportarse: ${e.message}`);
}

// ── 2. la etiqueta que Hermes reconoce ───────────────────────────────────
// Copia de MEDIA_TAG_CLEANUP_RE de gateway/platforms/base.py de Hermes (leída
// en su repositorio el 2026-09-30). Si Hermes la cambia esta prueba no se
// entera: sirve para que NUESTRO formato no se rompa sin querer.
const EXT = 'pdf|docx?|xlsx?|pptx?|csv|txt|md|zip|png|jpe?g|webp|gif|mp4|mp3|wav|ogg';
const HERMES = new RegExp(
  '[`"\'*_]{0,3}MEDIA:\\s*' +
  '(?<path>`[^`\\n]+?`|"[^"\\n]+?"|\'[^\'\\n]+?\'|' +
  '(?:~/|/|[A-Za-z]:[/\\\\])\\S+?(?:[^\\S\\n]+\\S+?)*?\\.(?:' + EXT + '))');

for (const ruta of [
  'C:\\Users\\ORKA\\monoatelier-os\\cotizaciones\\Cotizacion_EMDICO_Escritorio_1790000000000.pdf',
  'C:\\Users\\Julio Ronin\\monoatelier-os\\cotizaciones\\Cotizacion_EMDICO_1790000000000.pdf',
  '/home/julio/monoatelier-os/cotizaciones/Cotizacion_X_1.pdf',
]) {
  const texto = `Listo, aquí está la cotización de $9,720.\n\n${etiquetaMedia(ruta)}`;
  const m = HERMES.exec(texto);
  ok(m?.groups.path === rutaParaChat(ruta),
     `Hermes debe reconocer la ruta completa de "${ruta}". Reconoció: "${m?.groups.path}"`);
  ok(!/\\/.test(etiquetaMedia(ruta)), 'la etiqueta debe ir con "/", no con "\\" que Discord y los modelos maltratan');
}
ok(/sin comillas invertidas/.test(comoEntregar('C:/x/y.pdf')) && /MEDIA:C:\/x\/y\.pdf$/.test(comoEntregar('C:/x/y.pdf')),
   'la instrucción debe prohibir el formato de código y terminar con la etiqueta');

// ── 3. el servidor, matándolo entre pasos ────────────────────────────────
const srv = createServer((req, res) => {
  const ruta = req.url.split('?')[0];
  const enviar = d => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
  if (req.method === 'POST' && ruta === '/rest/v1/quotes') {
    let body = ''; req.on('data', c => body += c);
    return req.on('end', () => enviar([{ ...JSON.parse(body)[0], id: 77 }]));
  }
  if (ruta === '/rest/v1/services') return enviar([{ id: 's1', name: 'Cocina', category: 'Carpintería',
    description: '', base_price: 4500, cost: null, units: 'Mt Lineal', active: true, sku: null, price_updated_at: null }]);
  if (ruta === '/rest/v1/ajustes') return enviar([{ clave: 'iva', valor: 0.08 }, { clave: 'margen_objetivo', valor: 0.35 }]);
  enviar([]);
});
await new Promise(r => srv.listen(54325, '127.0.0.1', r));

async function levantar() {
  const t = new StdioClientTransport({
    command: 'node', args: ['agente-cotizador/dist/agente-cotizador/servidor.js'],
    env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:54325', SUPABASE_KEY: 'falsa', COTIZADOR_SALIDA: salida },
  });
  const cli = new Client({ name: 'prueba-borrador', version: '1.0.0' });
  await cli.connect(t);
  const call = async (n, a = {}) => {
    const r = await cli.callTool({ name: n, arguments: a });
    return (r.content?.[0]?.text ?? '') + (r.isError ? '  [isError]' : '');
  };
  return { cli, call };
}

let s = await levantar();
const esquema = (await s.cli.listTools()).tools;
ok(esquema.every(t => !('sesion' in (t.inputSchema.properties ?? {}))),
   'ninguna herramienta debe pedir `sesion`: es lo que el modelo llenaba mal');

await s.call('iniciar_cotizacion', { cliente: 'EMDICO', proyecto: 'Escritorio', entrega: '2026-10-22', sesion: 'abc' });
await s.call('agregar_concepto', { descripcion: 'Escritorio ejecutivo', cantidad: 1, precio_unitario: 9000,
                                    notas: 'Color similar a muestra', sesion: 'xyz' });
await s.call('agregar_concepto', { descripcion: 'Cajonera', cantidad: 2, precio_unitario: 1500, sesion: 'otra' });
const antes = await s.call('ver_borrador', { sesion: 'quien-sabe' });
ok(/Escritorio ejecutivo/.test(antes) && /Cajonera/.test(antes),
   `con `+'`sesion`'+` distinto en cada llamada debe ser la misma cotización. Dio: ${antes.slice(0, 120)}`);
await s.cli.close();                                    // ← se cae el servidor

s = await levantar();                                   // ← Hermes reconecta
const despues = await s.call('ver_borrador');
ok(despues === antes, 'después de reiniciar el servidor el borrador debe ser IDÉNTICO');

await s.call('quitar_partida', { numero: 2 });
await s.cli.close();
s = await levantar();
const trasQuitar = await s.call('ver_borrador');
ok(/Escritorio ejecutivo/.test(trasQuitar) && !/Cajonera/.test(trasQuitar),
   'quitar una partida también debe sobrevivir a un reinicio');

const reabre = await s.call('iniciar_cotizacion', { cliente: 'EMDICO', proyecto: 'Escritorio', entrega: '2026-10-22' });
ok(/ya estaba abierta/.test(reabre) && /Escritorio ejecutivo/.test(await s.call('ver_borrador')),
   'el modelo que "reabre para arreglar" no debe perder lo dictado');

const cierre = await s.call('cerrar_cotizacion', { sesion: 'una-que-jamas-existio' });
ok(!/isError|No hay una cotización abierta/.test(cierre), `cerrar debe funcionar aunque el modelo mande otro sesion. Dio: ${cierre.slice(0, 160)}`);
const linea = cierre.split('\n').find(l => l.startsWith('MEDIA:'));
ok(linea, 'el resultado debe terminar con una línea MEDIA:');
const ruta = (linea ?? '').replace(/^MEDIA:/, '');
ok(ruta && existsSync(ruta), `la ruta de la etiqueta debe existir en disco: ${ruta}`);
ok(ruta && existsSync(ruta) && readFileSync(ruta).subarray(0, 4).toString() === '%PDF', 'y debe ser un PDF de verdad');
ok(HERMES.exec(cierre)?.groups.path === ruta, 'Hermes debe reconocer la ruta completa que devolvió el servidor');
ok(/9,720\.00/.test(cierre), 'el total con IVA (9,000 × 1.08) debe salir en el resumen');
ok(!existsSync(archivo), 'al cerrar no debe quedar un borrador abierto en disco');

const trasCerrar = await s.call('ver_borrador');
ok(/No hay una cotización abierta/.test(trasCerrar), 'después de cerrar no debe haber borrador');

// pdf_de_cotizacion usa la misma entrega: ya no depende del borrador
ok(readdirSync(salida).some(f => f.endsWith('.pdf')), 'el PDF quedó en la carpeta de salida');
await s.cli.close(); srv.close();

if (fallas.length) {
  console.log('FALLAS:'); fallas.forEach(f => console.log(' ✗ ' + f));
  process.exit(1);
}
console.log('✓ el borrador sobrevive a un reinicio, el `sesion` del modelo ya no importa,');
console.log('  reabrir no borra lo dictado, y el PDF sale con una línea MEDIA: que Hermes reconoce.');
process.exit(0);
