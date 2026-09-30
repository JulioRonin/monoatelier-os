/**
 * Prueba de Forge desde el chat: disenar_mueble → estado_diseno → construir_diseno.
 *
 * Reproduce lo que pasó en Discord: Julio mandó la foto de un armario y dijo
 * "necesito diseñar este mueble" y el agente contestó preguntando si Forge era
 * el de Autodesk, porque no tenía ninguna herramienta que lo conectara con el
 * Forge de la plataforma.
 *
 * El Supabase es de mentiras (REST y Storage); el Forge Agent se simula
 * escribiendo en la cola lo que escribiría el worker. Lo que se verifica:
 *
 *   1. Las herramientas dicen que Forge es el módulo del taller y NO Autodesk.
 *   2. Una foto que Hermes dejó en disco sube al bucket y se encola como
 *      lectura; una ruta inventada, un archivo que no es imagen o una HEIC no
 *      encolan nada (y nunca se sube un archivo que no sea imagen).
 *   3. Repetir el mismo pedido no lo encola dos veces.
 *   4. La ficha se ve en el chat y NO se construye con medidas sin confirmar,
 *      ni con centímetros donde van milímetros.
 *   5. Lo que se encola para construir lleva las medidas confirmadas y las
 *      indicaciones, en el formato que lee el worker.
 *   6. Un diseño terminado da los enlaces de sus documentos y de AR, nunca los
 *      costos internos.
 *
 *     npm run build:agente && node prueba-forge.mjs
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const fallas = [];
const ok = (c, m) => { if (!c) fallas.push(m); };

// ── la ficha que dejaría el worker ───────────────────────────────────────
const elemento = (tipo, ancho, extra = {}) => ({
  tipo, fraccion_ancho: 1, ancho_estimado_mm: ancho, alto_estimado_mm: 2200,
  puertas: 0, cajones: 0, entrepanos: 0, led: false, detalle: '', ...extra });
const FICHA = {
  nombre_proyecto: 'Armario para pizarrón', cliente: '', tipo: 'closet',
  resumen: 'Armario alto de entrepaños para guardar pizarrón y rotafolios, pegado a la pared.',
  distribucion: 'lineal',
  muros: [{ id: 'A', descripcion: 'pared de la sala de juntas', elementos: [
    elemento('closet_entrepanos', 1000, { entrepanos: 4, led: true,
      detalle: 'Entrepaños fijos con LED; guarda pizarrón y rotafolios de pie.' })] }],
  acabados: [{ zona: 'estructura', descripcion: 'melamina blanca', sku_sugerido: 'MEL-BLA-15-IMP' }],
  apertura: 'jaladera', led: { lleva: true, zonas: ['entrepaños'] },
  no_fabricable: [{ elemento: 'Puertas corredizas de cristal', por_que: 'el taller no fabrica vidrio.',
                    propuesta: 'Se subcontrata el cristal y el riel.' }],
  medidas: [
    { clave: 'largo_muro_A', pregunta: '¿Cuánto mide de ancho el armario?', estimado_mm: 1000, base: 'foto' },
    { clave: 'alto_total', pregunta: '¿Altura del piso al plafón?', estimado_mm: 2200, base: 'puerta de 2100' },
    { clave: 'fondo', pregunta: '¿Qué fondo lleva, pegado a la pared?', estimado_mm: 500, base: 'proporción' },
  ],
  supuestos: [], construible: true, omitidos: [],
};

// ── Supabase de mentiras: REST + Storage ─────────────────────────────────
const jobs = [];
const modelos = new Map();
const subidas = [];
let fallaColumnas = false;
const enviar = (res, d, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };

const srv = createServer((req, res) => {
  const [ruta, qs] = req.url.split('?');
  const p = new URLSearchParams(qs ?? '');
  const trozos = [];
  req.on('data', c => trozos.push(c));
  req.on('end', () => {
    const cuerpo = Buffer.concat(trozos);
    if (ruta.startsWith('/storage/v1/object/forge/')) {
      subidas.push({ ruta: ruta.replace('/storage/v1/object/forge/', ''),
                     tipo: req.headers['content-type'], bytes: cuerpo });
      return enviar(res, { Key: ruta });
    }
    if (ruta === '/rest/v1/forge_jobs' && req.method === 'POST') {
      if (fallaColumnas) return enviar(res, { code: '42703', message: 'column forge_jobs.tipo does not exist' }, 400);
      const f = JSON.parse(cuerpo.toString())[0];
      const fila = { id: randomUUID(), result_model_id: null, log: null, error: null,
                     created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...f };
      jobs.unshift(fila);
      return enviar(res, [fila], 201);
    }
    if (ruta === '/rest/v1/forge_jobs') return enviar(res, [...jobs]);
    if (ruta === '/rest/v1/forge_models') {
      const id = (p.get('id') ?? '').replace('eq.', '');
      return enviar(res, modelos.has(id) ? [modelos.get(id)] : []);
    }
    enviar(res, []);
  });
});
await new Promise(r => srv.listen(54326, '127.0.0.1', r));

const transporte = new StdioClientTransport({
  command: 'node', args: ['agente-cotizador/dist/agente-cotizador/servidor.js'],
  env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:54326', SUPABASE_KEY: 'falsa',
         PLATAFORMA_URL: 'https://plataforma.test/', COTIZADOR_SALIDA: mkdtempSync(join(tmpdir(), 'forge-prueba-')) },
});
const cli = new Client({ name: 'prueba-forge', version: '1.0.0' });
await cli.connect(transporte);
const call = async (n, a = {}) => (await cli.callTool({ name: n, arguments: a })).content?.[0]?.text ?? '';

// ── 1. quién es Forge ────────────────────────────────────────────────────
const herramientas = (await cli.listTools()).tools;
const de = n => herramientas.find(t => t.name === n);
for (const n of ['disenar_mueble', 'estado_diseno', 'construir_diseno']) {
  ok(de(n), `falta la herramienta ${n}`);
  ok(/NO es Autodesk/.test(de(n)?.description ?? ''), `${n} debe decir que Forge NO es Autodesk`);
}
ok(/no preguntes por plataformas/i.test(cli.getInstructions() ?? ''),
   'las instrucciones del servidor deben pedir que no pregunte por plataformas ni formatos');
ok(/NO le preguntes por plataformas/.test(de('disenar_mueble')?.description ?? ''),
   'disenar_mueble debe prohibir preguntar por .rvt / .ifc: es lo que hizo el agente en Discord');

// ── 2. sin fotos: diseño directo, y no se encola dos veces ───────────────
const pedido = 'Mueble para guardar pizarrón y rotafolios, 100 cm de ancho, 220 de alto y 50 de fondo';
let r = await call('disenar_mueble', { descripcion: pedido });
ok(/ref [0-9a-f]{8}/.test(r), `debe dar la ref. Dio: ${r.slice(0, 120)}`);
ok(jobs.length === 1 && jobs[0].tipo === 'diseno' && jobs[0].prompt === pedido && jobs[0].status === 'pending',
   `sin fotos debe encolar un diseño directo con las palabras del usuario: ${JSON.stringify(jobs[0])}`);
r = await call('disenar_mueble', { descripcion: pedido });
ok(jobs.length === 1 && /ya está en curso/.test(r), 'el mismo pedido no debe encolarse dos veces');

// ── 3. con foto: la ruta que Hermes deja en disco ────────────────────────
const carpeta = mkdtempSync(join(tmpdir(), 'hermes-cache-'));
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('datos de la foto')]);
const rutaFoto = join(carpeta, 'img_a1b2c3 (armario).png');   // con espacio, como en Windows
writeFileSync(rutaFoto, png);

const conFoto = 'Necesito diseñar este mueble para una sala de juntas';
r = await call('disenar_mueble', { descripcion: conFoto, imagenes: ['`' + rutaFoto + '`'] });   // el modelo la pone entre comillas
const lectura = jobs[0];
ok(lectura.tipo === 'lectura' && lectura.prompt === conFoto, `con fotos debe encolar una LECTURA: ${JSON.stringify({ ...lectura, ficha: 0 })}`);
ok(subidas.length === 1 && /^refs\/[0-9a-f-]{36}\.png$/.test(subidas[0].ruta) && subidas[0].tipo === 'image/png'
   && subidas[0].bytes.equals(png), `la foto debe subir a refs/ como PNG con sus bytes intactos: ${JSON.stringify(subidas[0]?.ruta)}`);
ok(lectura.imagenes.length === 1 && lectura.imagenes[0].includes('/storage/v1/object/public/forge/refs/'),
   `la lectura debe llevar la URL pública de la foto: ${JSON.stringify(lectura.imagenes)}`);

// rutas que NO deben encolar nada
const antes = { jobs: jobs.length, subidas: subidas.length };
const texto = join(carpeta, 'secretos.jpg');
writeFileSync(texto, 'ANTHROPIC_API_KEY=sk-ant-esto-no-debe-subirse');   // se llama .jpg pero no lo es
const heic = join(carpeta, 'iphone.jpg');
writeFileSync(heic, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(20)]));
for (const [nombre, ruta, esperado] of [
  ['ruta inventada', join(carpeta, 'no-existe.png'), /no encuentro el archivo/],
  ['un archivo que no es imagen', texto, /no es una imagen/],
  ['una foto HEIC', heic, /HEIC/],
  ['una carpeta', carpeta, /carpeta/],
]) {
  r = await call('disenar_mueble', { descripcion: `${conFoto} (${nombre})`, imagenes: [ruta] });
  ok(/No encolé nada/.test(r) && esperado.test(r), `${nombre}: debe explicar el problema. Dio: ${r.slice(0, 160)}`);
}
ok(jobs.length === antes.jobs, 'una foto que falla no debe dejar nada en la cola');
ok(subidas.length === antes.subidas, 'un archivo que no es imagen NUNCA debe subirse al bucket público');

// ── 4. cómo va ───────────────────────────────────────────────────────────
r = await call('estado_diseno', { referencia: lectura.id.slice(0, 8) });
ok(/en cola/.test(r) && !/no parece estar corriendo/.test(r), 'un trabajo recién encolado no debe alarmar');
lectura.created_at = new Date(Date.now() - 5 * 60_000).toISOString();
r = await call('estado_diseno', { referencia: lectura.id.slice(0, 8) });
ok(/Forge Agent no parece estar corriendo/.test(r) && /python -m forge_agent\.worker/.test(r),
   'a los 5 minutos en cola debe decir que el Forge Agent no está corriendo y cómo abrirlo');

// el worker termina la lectura
Object.assign(lectura, { status: 'done', ficha: FICHA, log: 'Armario · 1 muro(s)' });
r = await call('estado_diseno');
ok(/Lectura lista — Armario para pizarrón/.test(r) && /Muro A/.test(r) && /Entrepaños · ~1000 mm/.test(r),
   `la ficha debe verse en el chat. Dio: ${r.slice(0, 200)}`);
ok(/NO SE FABRICA COMO EN LA FOTO/.test(r) && /Puertas corredizas de cristal/.test(r),
   'debe decir lo que no se fabrica como en la foto');
ok(/MEDIDAS POR CONFIRMAR/.test(r) && /largo_muro_A/.test(r) && /alto_total/.test(r) && /fondo — estimado 500/.test(r),
   'debe listar las medidas por confirmar con su clave');
ok(/SIGUIENTE/.test(r) && /No construyas con medidas que no dijo él/.test(r), 'debe indicar el siguiente paso y prohibir adivinar medidas');
let dentro = false, largas = 0;
for (const l of r.split('\n')) { if (l.trim() === '```') { dentro = !dentro; continue; } if (dentro && l.length > 76) largas++; }
ok(!largas, `el bloque de medidas se sale del chat en ${largas} renglón(es)`);

// ── 5. construir: sólo con medidas confirmadas ───────────────────────────
const n = jobs.length;
r = await call('construir_diseno', {});
ok(jobs.length === n && /Faltan por confirmar 3/.test(r) && /NO las adivines/.test(r) && /fondo — /.test(r),
   `sin medidas no debe construir y debe listar lo que falta. Dio: ${r.slice(0, 200)}`);
r = await call('construir_diseno', { medidas: { largo_muro_A: 100, alto_total: 220, fondo: 50 } });
ok(jobs.length === n && /centímetros o metros/.test(r) && /100 cm = 1000/.test(r),
   'las medidas en cm (100, 220, 50) deben rechazarse: es el error más fácil de cometer');
r = await call('construir_diseno', { medidas: { largo_muro_B: 1000 } });
ok(jobs.length === n && /No existe la medida «largo_muro_B»/.test(r) && /largo_muro_A, alto_total, fondo/.test(r),
   'una clave inventada debe rechazarse y decir cuáles son las válidas');
r = await call('construir_diseno', { medidas: { largo_muro_A: 1000, alto_total: 2200 } });
ok(jobs.length === n && /Faltan por confirmar 1/.test(r), 'con una medida sin confirmar tampoco debe construir');

r = await call('construir_diseno', {
  medidas: { largo_muro_A: 1000, alto_total: 2200, fondo: 500 }, indicaciones: 'Frentes en blanco mate' });
const obra = jobs[0];
ok(jobs.length === n + 1 && obra.tipo === 'diseno' && obra.prompt === 'Construir: Armario para pizarrón' && obra.status === 'pending',
   `debe encolar la construcción. Dio: ${r.slice(0, 200)}`);
const med = Object.fromEntries(obra.ficha.medidas.map(m => [m.clave, m.valor_mm]));
ok(med.largo_muro_A === 1000 && med.alto_total === 2200 && med.fondo === 500,
   `la ficha encolada debe llevar las medidas CONFIRMADAS en valor_mm (formato que lee el worker): ${JSON.stringify(med)}`);
ok(obra.ficha.indicaciones === 'Frentes en blanco mate', 'la ficha debe llevar las indicaciones del usuario');
ok(obra.ficha.construible === true && obra.ficha.muros?.length === 1, 'la ficha debe llegar completa al worker');
ok(obra.imagenes.join() === lectura.imagenes.join(), 'la construcción debe conservar las fotos de referencia');
ok(FICHA.medidas.every(m => m.valor_mm === undefined), 'construir no debe modificar la ficha de la lectura');

r = await call('construir_diseno', { medidas: { largo_muro_A: 1000, alto_total: 2200, fondo: 500 } });
ok(jobs.length === n + 1 && /ya hay una construcción/i.test(r), 'no debe encolar la misma construcción dos veces');

// con "usar las estimadas", sólo si el usuario lo pidió: y se avisa
const otra = { ...structuredClone(lectura), id: randomUUID(), status: 'done',
               created_at: new Date().toISOString(), ficha: { ...structuredClone(FICHA), nombre_proyecto: 'Vitrina' } };
jobs.unshift(otra);
r = await call('construir_diseno', { referencia: otra.id.slice(0, 8), usar_estimadas: true });
ok(jobs[0].prompt === 'Construir: Vitrina' && /ESTIMADAS de: largo_muro_A, alto_total, fondo/.test(r),
   `con usar_estimadas debe construir y avisar cuáles usó. Dio: ${r.slice(0, 200)}`);

// una ficha que Forge no puede construir
const noSe = { ...structuredClone(otra), id: randomUUID(), created_at: new Date().toISOString(),
               ficha: { ...structuredClone(FICHA), nombre_proyecto: 'Isla', construible: false, omitidos: ['isla'] } };
jobs.unshift(noSe);
const m2 = jobs.length;
r = await call('construir_diseno', { referencia: noSe.id.slice(0, 8), usar_estimadas: true });
ok(jobs.length === m2 && /no tiene generador/.test(r), 'sin generador no debe encolar');
r = await call('estado_diseno', { referencia: noSe.id.slice(0, 8) });
ok(/⚠ Forge todavía no tiene generador/.test(r) && /NO se puede construir/.test(r) && /Forge no puede construir esto todavía/.test(r),
   `una ficha no construible debe decirlo en la ficha y en el siguiente paso. Dio: ${r.slice(-260)}`);

// ── 6. el diseño terminado ───────────────────────────────────────────────
const modeloId = randomUUID();
modelos.set(modeloId, { id: modeloId, name: 'Armario para pizarrón', status: 'published', glb_url: 'https://x/preview.glb',
  documentos: { 'cotizacion.pdf': 'https://x/cot.pdf', 'entrega.pdf': 'https://x/ent.pdf',
                'manual_ensamble.pdf': 'https://x/man.pdf', 'cutlist.xlsx': 'https://x/cut.xlsx',
                'herrajes.xlsx': 'https://x/her.xlsx', 'preview.glb': 'https://x/preview.glb',
                'costos_internos.pdf': 'https://x/COSTOS-INTERNOS.pdf', 'project.json': 'https://x/p.json' } });
Object.assign(obra, { status: 'done', result_model_id: modeloId, log: 'Armario de entrepaños de 1000 × 2360 mm, 1 módulo.' });
r = await call('estado_diseno', { referencia: obra.id.slice(0, 8) });
ok(/listo — Armario para pizarrón/.test(r) && /Cotización \(cliente\): https:\/\/x\/cot\.pdf/.test(r)
   && /Cutlist \(taller\): https:\/\/x\/cut\.xlsx/.test(r), `debe dar los enlaces de los documentos. Dio: ${r.slice(0, 300)}`);
ok(r.includes(`Verlo en 3D / AR: https://plataforma.test/?ar=${modeloId}`), 'debe dar el enlace de AR (sin doble diagonal)');
ok(!/COSTOS-INTERNOS|costos_internos/.test(r.replace(/NO se comparte/, '')), 'los costos internos NUNCA deben salir por el chat');
ok(!/`https?:/.test(r), 'los enlaces no deben ir entre comillas invertidas');

// un trabajo que falló
Object.assign(jobs[jobs.length - 1], { status: 'error', error: 'No hay ANTHROPIC_API_KEY' });
r = await call('estado_diseno', { referencia: jobs[jobs.length - 1].id.slice(0, 8) });
ok(/falló/.test(r) && /ANTHROPIC_API_KEY/.test(r), 'un trabajo con error debe mostrar el error');
r = await call('estado_diseno', { referencia: 'zzzz' });
ok(/No encuentro el trabajo/.test(r), 'una ref que no existe debe decirlo');

// falta una migración: se dice cuál
fallaColumnas = true;
r = await call('disenar_mueble', { descripcion: 'Otro mueble distinto para una recámara, 2 metros' });
ok(/20260928_forge_lectura\.sql/.test(r), `la migración que falta debe nombrarse. Dio: ${r.slice(0, 160)}`);

await cli.close(); srv.close();

if (fallas.length) {
  console.log('FALLAS:'); fallas.forEach(f => console.log(' ✗ ' + f));
  process.exit(1);
}
console.log('✓ Forge ya se pide desde el chat: la foto sube y se lee, la ficha se ve, nada se');
console.log('  construye sin medidas confirmadas en milímetros, y los costos no salen.');
process.exit(0);
