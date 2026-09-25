/**
 * Prueba de las herramientas de datos de venta del agente.
 *
 * Lo que se verifica, y por qué cada cosa:
 *
 *   1. Una cotización de SEPTIEMBRE que se cerró en NOVIEMBRE y que arranca
 *      obra en ENERO debe aparecer como venta de NOVIEMBRE. Es el error que
 *      tenía la plataforma: Financials agrupaba por start_date y el Dashboard
 *      por due_date, así que la misma venta caía en tres meses distintos según
 *      la pantalla.
 *   2. Las facturas de sandbox (modo 'test') y las canceladas NO son ingresos.
 *   3. Un proyecto sin sold_at se avisa en vez de desaparecer sin ruido.
 *   4. Los rangos se piden al servidor: aquí se honran los filtros gte/lte
 *      para que si el servidor dejara de mandarlos, la prueba lo note.
 *
 *     node prueba-ventas.mjs
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ── Datos de mentiras, con las fechas peleadas a propósito ───────────────

const clients = [
  { id: 'c1', full_name: 'EMDICO', fiscal_name: 'EMDICO SA DE CV' },
  { id: 'c2', full_name: 'Casa Ríos', fiscal_name: null },
];

const quotes = [
  // Se ofertó en septiembre. Se cerró en noviembre (ver projects).
  { id: 'q1', project_name: 'Cocina Planta 2', client_name: 'EMDICO SA DE CV',
    date: '2026-09-03', total_amount: 180000, status: 'Approved',
    items: [], notes: null, delivery_time: '30', created_at: '2026-09-03T10:00:00Z' },
  // Ofertada en noviembre y nunca cerrada: sube lo cotizado, no lo vendido.
  { id: 'q2', project_name: 'Closets recámara', client_name: 'Casa Ríos',
    date: '2026-11-11', total_amount: 60000, status: 'Sent',
    items: [], notes: null, delivery_time: '20', created_at: '2026-11-11T10:00:00Z' },
];

const projects = [
  // El caso del pleito: cotizada en sept, VENDIDA en nov, arranca en enero.
  { id: 'p1', name: 'Cocina Planta 2', client_id: 'c1', status: 'In Progress',
    budget: 180000, live_cost: 117000, start_date: '2027-01-08', due_date: '2027-03-01',
    sold_at: '2026-11-19', quote_id: 'q1', created_at: '2026-11-19T18:00:00Z' },
  { id: 'p2', name: 'Lambrín oficina', client_id: 'c2', status: 'Completed',
    budget: 42000, live_cost: 25000, start_date: '2026-11-02', due_date: '2026-11-28',
    sold_at: '2026-10-30', quote_id: null, created_at: '2026-10-30T12:00:00Z' },
  // Sin fecha de venta: no debe caer en ningún mes, pero sí avisarse.
  { id: 'p3', name: 'Barra bar', client_id: 'c1', status: 'In Progress',
    budget: 30000, live_cost: 0, start_date: '2026-11-15', due_date: '2026-12-20',
    sold_at: null, quote_id: null, created_at: '2026-11-15T09:00:00Z' },
];

const invoices = [
  { id: 'f1', series: 'A', folio: 8, date: '2026-11-20', client_name: 'EMDICO SA DE CV',
    client_rfc: 'EMD000101AAA', subtotal: 90000, total: 97200, status: 'valid',
    uuid: 'u-1', modo: 'live', created_at: '2026-11-20T10:00:00Z' },
  // Sandbox: NO es ingreso, nunca llegó al SAT.
  { id: 'f2', series: 'A', folio: 9, date: '2026-11-21', client_name: 'EMDICO SA DE CV',
    client_rfc: 'EMD000101AAA', subtotal: 500000, total: 540000, status: 'valid',
    uuid: 'u-2', modo: 'test', created_at: '2026-11-21T10:00:00Z' },
  // Cancelada: tampoco.
  { id: 'f3', series: 'A', folio: 7, date: '2026-10-31', client_name: 'Casa Ríos',
    client_rfc: 'RIOS800101AAA', subtotal: 100000, total: 108000, status: 'canceled',
    uuid: 'u-3', modo: 'live', created_at: '2026-10-31T10:00:00Z' },
  { id: 'f4', series: 'A', folio: 6, date: '2026-10-15', client_name: 'Casa Ríos',
    client_rfc: 'RIOS800101AAA', subtotal: 40000, total: 43200, status: 'valid',
    uuid: 'u-4', modo: 'live', created_at: '2026-10-15T10:00:00Z' },
];

/**
 * Aplica los filtros de PostgREST que usa el servidor: gte, lte e is.null.
 *
 * `is.null` importa: un proyecto sin fecha de venta no vuelve en ningún rango,
 * y si esta imitación lo devolviera de todos modos, la prueba daría por bueno
 * un servidor que en la base real no encuentra nada.
 */
function filtrar(filas, params, campo) {
  let out = filas;
  for (const v of params.getAll(campo)) {
    const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
    if (op === 'gte') out = out.filter(f => (f[campo] ?? '') >= val);
    if (op === 'lte') out = out.filter(f => (f[campo] ?? '') <= val);
    if (op === 'is' && val === 'null') out = out.filter(f => f[campo] == null);
    if (op === 'not') out = out.filter(f => f[campo] != null);
  }
  return out;
}

const pedidos = [];
const srv = createServer((req, res) => {
  const [ruta, qs] = req.url.split('?');
  const p = new URLSearchParams(qs ?? '');
  pedidos.push(req.url);
  const enviar = d => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
  if (ruta === '/rest/v1/projects') return enviar(filtrar(projects, p, 'sold_at'));
  if (ruta === '/rest/v1/invoices') return enviar(filtrar(invoices, p, 'date'));
  if (ruta === '/rest/v1/quotes') return enviar(quotes);
  if (ruta === '/rest/v1/clients') return enviar(clients);
  if (ruta === '/rest/v1/ajustes') return enviar([{ clave: 'iva', valor: 0.08 }]);
  if (ruta === '/rest/v1/services') return enviar([]);
  if (ruta === '/rest/v1/service_variables') return enviar([]);
  res.writeHead(404); res.end('[]');
});
await new Promise(r => srv.listen(54322, '127.0.0.1', r));

const transporte = new StdioClientTransport({
  command: 'node', args: ['agente-cotizador/dist/agente-cotizador/servidor.js'],
  env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:54322', SUPABASE_KEY: 'falsa' },
});
const cli = new Client({ name: 'prueba-ventas', version: '1.0.0' });
await cli.connect(transporte);
const call = async (n, a = {}) => (await cli.callTool({ name: n, arguments: a })).content?.[0]?.text ?? '';

const paso = (t, s) => console.log(`\n${'─'.repeat(70)}\n▸ ${t}\n${s}`);

const resumen = await call('resumen_ventas', { desde: '2026-09-01', hasta: '2026-12-31' });
paso('resumen_ventas (sept–dic 2026)', resumen);

const clientes = await call('ventas_por_cliente', { desde: '2026-09-01', hasta: '2026-12-31' });
paso('ventas_por_cliente', clientes);

const reporte = await call('reporte_ventas', { desde: '2026-09-01', hasta: '2026-12-31' })
  .catch(e => 'reporte_ventas no disponible: ' + e.message);
paso('reporte_ventas', reporte);

// ── Verificaciones ──────────────────────────────────────────────────────

const fallas = [];
const ok = (cond, msg) => { if (!cond) fallas.push(msg); };

const linea = (m) => resumen.split('\n').find(l => l.toLowerCase().startsWith(m)) ?? '';
const noviembre = linea('noviembre');
const septiembre = linea('septiembre');

ok(/vendido\s+\$180,000/.test(noviembre) || /vendido\s+\$?180,?000/.test(noviembre),
   `la venta de la cotización de septiembre debe contarse en NOVIEMBRE. Línea: "${noviembre}"`);
ok(!/vendido\s+\$1?80,000/.test(septiembre.replace('cotizado $180,000.00', '')),
   `septiembre no debe registrar venta, sólo lo cotizado. Línea: "${septiembre}"`);
ok(/cotizado\s+\$180,000/.test(septiembre),
   `septiembre debe registrar los $180,000 COTIZADOS. Línea: "${septiembre}"`);
ok(!/2027/.test(resumen), 'el mes de arranque de obra (enero 2027) no debe aparecer como venta');
ok(/facturado\s+\$97,200/.test(noviembre),
   `noviembre debe facturar sólo los $97,200 reales, no los $540,000 de sandbox. Línea: "${noviembre}"`);
ok(!/540,000/.test(resumen), 'una factura de sandbox se colό como ingreso');
ok(!/108,000/.test(resumen), 'una factura cancelada se colό como ingreso');
ok(/1 proyecto\(s\) sin fecha de venta/.test(resumen), 'no se avisó del proyecto sin sold_at');
// La conversión se mide por cohorte. De lo cotizado en el periodo ($240,000)
// sólo q1 ($180,000) se cerró → 75%. Dividir lo vendido entre lo cotizado del
// mismo mes daba 300% en noviembre, que es la clase de cifra que se cree.
ok(/Conversión: 75%/.test(resumen),
   `la conversión debe ser por cohorte: 75% ($180k cerrados de $240k ofertados). Salió: "${
     resumen.split('\n').find(l => l.startsWith('Conversión')) ?? '(nada)'}"`);
ok(!/300%/.test(resumen) && !/300%/.test(reporte),
   'una conversión de más de 100% significa que se cruzaron cohortes');
ok(/INTERNO/.test(resumen) && /INTERNO/.test(clientes),
   'falta el aviso de que costos y márgenes son internos');
ok(/EMDICO SA DE CV/.test(clientes), 'el cliente debe salir por su razón social');
ok(pedidos.some(u => u.includes('sold_at=gte')),
   'el servidor debe filtrar proyectos por sold_at, no traerlos todos');

// El PDF se revisa por su TEXTO, no por que el archivo exista y pese algo.
// Así se detectó que el aviso de proyectos sin fecha quedaba escrito con la
// lista cortada por el borde de la hoja: encabezado sin nada debajo.
const rutaPdf = reporte.split('\n').find(l => l.trim().endsWith('.pdf'))?.trim();
if (rutaPdf && existsSync(rutaPdf)) {
  let texto = null;
  try {
    texto = execFileSync('pdftotext', ['-layout', rutaPdf, '-'], { encoding: 'utf8' });
  } catch { console.log('\n(sin pdftotext: no se pudo revisar el contenido del PDF)'); }
  if (texto) {
    ok(/USO INTERNO/.test(texto), 'el PDF debe ir sellado de uso interno en la página');
    ok(/noviembre 2026/.test(texto), 'el PDF debe traer el mes de la venta');
    ok(!/540,000/.test(texto) && !/108,000/.test(texto),
       'el PDF cuenta como ingreso una factura de sandbox o cancelada');
    ok(/Barra bar/.test(texto),
       'el PDF anuncia proyectos sin fecha de venta pero no los lista: el bloque se cortó');
    ok(/TOTAL/.test(texto), 'el PDF debe cerrar con los totales');
  }
} else {
  fallas.push('reporte_ventas no devolvió una ruta de PDF que exista');
}

console.log(`\n${'─'.repeat(70)}`);
if (fallas.length) {
  console.log('FALLAS:'); fallas.forEach(f => console.log(' ✗ ' + f));
} else {
  console.log('✓ todo cuadra: la venta cae en el mes en que se cerró, sandbox y');
  console.log('  canceladas quedan fuera, y el aviso de información interna va puesto.');
}

await cli.close(); srv.close();
process.exit(fallas.length ? 1 : 0);
