/**
 * Prueba de cobranza: proyectos activos y estado de cuenta por cliente.
 *
 * Arma el caso que describió Julio: con un mismo cliente hay proyectos en
 * marcha que no le han pagado, otros en marcha ya liquidados, y uno ya
 * entregado que sigue debiendo. Lo que se verifica:
 *
 *   1. Un proyecto ENTREGADO que todavía debe NO desaparece de la lista. El
 *      saldo no se cierra al entregar la cocina, y esconderlo es perder la
 *      cobranza.
 *   2. El saldo sale de la tabla `payments`, sumando abonos — no de
 *      `downpayment`, que es el anticipo pactado y no lo que entró.
 *   3. "Ivan Diaz" sin acentos encuentra a "Iván Díaz".
 *   4. Ni el costo ni el margen aparecen: un estado de cuenta se acaba
 *      leyendo con el cliente enfrente.
 *   5. Un proyecto cancelado no suma a lo contratado.
 *
 *     node prueba-cobranza.mjs
 */

import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Ids numéricos: es lo que devuelve PostgREST con columnas bigint.
const clients = [
  { id: 1, full_name: 'Iván Díaz', fiscal_name: null },
  { id: 2, full_name: 'EMDICO', fiscal_name: 'EMDICO SA DE CV' },
];

const projects = [
  // En marcha, le debe casi todo.
  { id: 201, name: 'Cocina Anáhuac', client_id: 1, status: 'In Progress',
    budget: 180000, live_cost: 117000, start_date: '2026-08-10', due_date: '2026-11-30',
    sold_at: '2026-08-01', downpayment: 90000, created_at: '2026-08-01T10:00:00Z' },
  // En marcha y YA PAGADO completo.
  { id: 202, name: 'Closets recámara', client_id: 1, status: 'In Progress',
    budget: 80000, live_cost: 50000, start_date: '2026-09-01', due_date: '2026-10-15',
    sold_at: '2026-08-20', downpayment: 40000, created_at: '2026-08-20T10:00:00Z' },
  // ENTREGADO pero con saldo, y la fecha de entrega ya pasó: es cobranza vencida.
  { id: 203, name: 'Vestidor principal', client_id: 1, status: 'Completed',
    budget: 60000, live_cost: 38000, start_date: '2026-05-02', due_date: '2026-06-20',
    sold_at: '2026-04-28', downpayment: 30000, created_at: '2026-04-28T10:00:00Z' },
  // Cancelado: no debe sumar a lo contratado.
  { id: 204, name: 'Barra bar', client_id: 1, status: 'Cancelled',
    budget: 30000, live_cost: 0, start_date: '2026-07-01', due_date: '2026-08-01',
    sold_at: '2026-06-25', downpayment: 0, created_at: '2026-06-25T10:00:00Z' },
  // De otro cliente: no debe colarse en la cuenta de Iván.
  { id: 205, name: 'Cocina Planta 2', client_id: 2, status: 'In Progress',
    budget: 200000, live_cost: 130000, start_date: '2026-09-05', due_date: '2026-12-20',
    sold_at: '2026-09-01', downpayment: 100000, created_at: '2026-09-01T10:00:00Z' },
];

const payments = [
  { id: 1, project_id: 201, amount: 45000, date: '2026-08-12', method: 'Transferencia', notes: null },
  { id: 2, project_id: 202, amount: 40000, date: '2026-08-22', method: 'Transferencia', notes: null },
  { id: 3, project_id: 202, amount: 40000, date: '2026-09-18', method: 'Efectivo', notes: null },
  { id: 4, project_id: 203, amount: 30000, date: '2026-05-05', method: 'Transferencia', notes: null },
  { id: 5, project_id: 205, amount: 100000, date: '2026-09-08', method: 'Transferencia', notes: null },
];

const invoices = [
  { id: 301, series: 'A', folio: 10, date: '2026-08-13', client_name: 'Iván Díaz',
    client_rfc: 'DIAI800101AAA', subtotal: 45000, total: 48600, status: 'valid',
    uuid: 'u-1', modo: 'live', created_at: '2026-08-13T10:00:00Z' },
  // Sandbox: no cuenta como facturado.
  { id: 302, series: 'A', folio: 11, date: '2026-09-01', client_name: 'Iván Díaz',
    client_rfc: 'DIAI800101AAA', subtotal: 999999, total: 1079998, status: 'valid',
    uuid: 'u-2', modo: 'test', created_at: '2026-09-01T10:00:00Z' },
];

function filtrar(filas, params, campo) {
  let out = filas;
  for (const v of params.getAll(campo)) {
    const i = v.indexOf('.');
    const [op, val] = [v.slice(0, i), v.slice(i + 1)];
    if (op === 'gte') out = out.filter(f => (f[campo] ?? '') >= val);
    if (op === 'lte') out = out.filter(f => (f[campo] ?? '') <= val);
    if (op === 'is' && val === 'null') out = out.filter(f => f[campo] == null);
    if (op === 'in') {
      const ids = val.replace(/^\(|\)$/g, '').split(',').map(x => x.trim());
      out = out.filter(f => ids.includes(String(f[campo])));
    }
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
  if (ruta === '/rest/v1/payments') return enviar(filtrar(payments, p, 'project_id'));
  if (ruta === '/rest/v1/invoices') return enviar(filtrar(invoices, p, 'date'));
  if (ruta === '/rest/v1/clients') return enviar(clients);
  if (ruta === '/rest/v1/quotes') return enviar([]);
  if (ruta === '/rest/v1/ajustes') return enviar([{ clave: 'iva', valor: 0.08 }]);
  if (ruta === '/rest/v1/services') return enviar([]);
  if (ruta === '/rest/v1/service_variables') return enviar([]);
  res.writeHead(404); res.end('[]');
});
await new Promise(r => srv.listen(54323, '127.0.0.1', r));

const transporte = new StdioClientTransport({
  command: 'node', args: ['agente-cotizador/dist/agente-cotizador/servidor.js'],
  env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:54323', SUPABASE_KEY: 'falsa' },
});
const cli = new Client({ name: 'prueba-cobranza', version: '1.0.0' });
await cli.connect(transporte);
const call = async (n, a = {}) => (await cli.callTool({ name: n, arguments: a })).content?.[0]?.text ?? '';
const paso = (t, s) => console.log(`\n${'─'.repeat(74)}\n▸ ${t}\n${s}`);

const activos = await call('proyectos_activos');
paso('proyectos_activos', activos);

const pendientes = await call('proyectos_activos', { pago: 'pendiente' });
paso('proyectos_activos (sólo los que deben)', pendientes);

const mes = await call('proyectos_activos', { mes: '2026-09' });
paso('proyectos_activos mes=2026-09', mes);

// Sin acentos, como lo escribiría en el chat.
const cuenta = await call('estado_de_cuenta', { cliente: 'Ivan Diaz' });
paso('estado_de_cuenta "Ivan Diaz"', cuenta);

// ── Verificaciones ──────────────────────────────────────────────────────

const fallas = [];
const ok = (c, m) => { if (!c) fallas.push(m); };

ok(/Iván Díaz/.test(cuenta), '"Ivan Diaz" sin acentos debe encontrar a "Iván Díaz"');
ok(/Vestidor principal/.test(cuenta),
   'un proyecto ENTREGADO que todavía debe tiene que salir: el saldo no se cierra al entregar');
ok(!/Barra bar/.test(cuenta), 'un proyecto cancelado no debe entrar en la cuenta');
ok(!/Cocina Planta 2/.test(cuenta), 'se coló un proyecto de otro cliente');
// Contratado = 180k + 80k + 60k = 320k. Pagado = 45k + 80k + 30k = 155k.
ok(/Contratado \$320,000\.00/.test(cuenta),
   `lo contratado debe ser $320,000 (sin el cancelado). Salió: "${
     cuenta.split('\n').find(l => l.startsWith('Contratado')) ?? '(nada)'}"`);
ok(/pagado \$155,000\.00/.test(cuenta),
   'lo pagado debe salir de la suma de abonos en payments, no de downpayment');
ok(/SALDO \$165,000\.00/.test(cuenta), 'el saldo debe ser $165,000');
ok(/48,600/.test(cuenta) && !/1,079,998/.test(cuenta),
   'lo facturado debe contar sólo el CFDI real, no el de sandbox');
ok(!/margen/i.test(cuenta) && !/costo/i.test(cuenta.replace(/sin costo/gi, '')),
   'un estado de cuenta NO debe llevar costo ni margen: se lee con el cliente enfrente');
ok(!/117,000|50,000\.00 ·|38,000/.test(cuenta), 'se filtró un costo directo al estado de cuenta');

ok(/Closets recámara/.test(activos) && /PAGADO/.test(activos),
   'los proyectos en marcha ya liquidados deben verse marcados como pagados');
ok(!/PAGADO/.test(pendientes), 'con pago=pendiente no deben salir los liquidados');
ok(/Vestidor principal/.test(pendientes) && /VENCIDO/.test(pendientes),
   'un entregado con saldo y fecha pasada debe marcarse como vencido');
ok(!/Vestidor principal/.test(mes),
   'con mes=2026-09 no debe salir un proyecto cuya entrega fue en junio');
ok(/Closets recámara/.test(mes) && /Cocina Anáhuac/.test(mes),
   'con mes=2026-09 deben salir los que estaban vivos ese mes');
ok(!/margen/i.test(activos), 'proyectos_activos no debe llevar margen');

console.log(`\n${'─'.repeat(74)}`);
if (fallas.length) { console.log('FALLAS:'); fallas.forEach(f => console.log(' ✗ ' + f)); }
else console.log('✓ la cobranza cuadra: nadie desaparece por estar entregado, el saldo\n  sale de los abonos, y no se filtra ni un costo.');

await cli.close(); srv.close();
process.exit(fallas.length ? 1 : 0);
