import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ── Supabase de mentiras, con los datos reales de los CSV ────────────────
const parse = (t) => {
  const [h, ...ls] = t.replace(/^﻿/, '').trim().split(/\r?\n/);
  const cols = h.split(','); const out = []; let buf = '';
  for (const l of ls) {
    buf = buf ? buf + '\n' + l : l;
    if ((buf.match(/"/g) || []).length % 2) continue;
    const f = []; let cur = '', q = false;
    for (const ch of buf) {
      if (ch === '"') q = !q; else if (ch === ',' && !q) { f.push(cur); cur = ''; } else cur += ch;
    }
    f.push(cur);
    out.push(Object.fromEntries(cols.map((c, i) => [c.trim(), (f[i] ?? '').trim()])));
    buf = '';
  }
  return out;
};
const money = s => parseFloat(String(s).replace(/[$,]/g, '')) || 0;

const svcCsv = parse(readFileSync('public/Services-Grid view.csv', 'utf8'));
const varCsv = parse(readFileSync('public/Variables-Grid view.csv', 'utf8'));
const idDe = n => 'svc-' + n.trim().replace(/\W+/g, '-').toLowerCase();

const services = svcCsv.map(s => ({
  id: idDe(s['Service Name']), name: s['Service Name'].trim(), category: s['Category'],
  description: s['Description'], base_price: money(s['Base Price']), cost: null,
  units: s['Units'], active: true, sku: null, price_updated_at: null,
}));

// clasificación como quedará tras arreglar las 14 en la pantalla de Precios
const esAdicional = n => /cascada|led|perfil|herraje|cubierta|mdf|madera|tablero/i.test(n);
const esMetraje  = n => /^\s*(default\s*\(?\s*)?[0-9]+\s*(mts?|metros?)\b/i.test(n);
let vid = 0;
const service_variables = [];
for (const v of varCsv) {
  const nombre = v['Variable Name'].trim(); const precio = money(v['Variable Price']);
  for (const serv of v['Service'].split(',').map(x => x.trim())) {
    if (!services.find(s => s.name === serv)) continue;
    service_variables.push({
      id: 'var-' + (++vid), service_id: idDe(serv), name: nombre,
      kind: !precio ? 'opcion' : esAdicional(nombre) ? 'adicional' : 'sustitucion',
      price: precio || null, cost: null, units: /cubierta|mdf|madera|tablero/i.test(nombre) ? v['Service'].includes('Cocina') ? 'Mt Lineal' : null : null,
      active: !esMetraje(nombre), sort_order: vid,
    });
  }
}

const guardadas = [];
const srv = createServer((req, res) => {
  const ruta = req.url.split('?')[0];
  const enviar = d => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
  if (req.method === 'POST' && ruta === '/rest/v1/quotes') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => { const q = JSON.parse(body)[0]; guardadas.push(q); enviar([{ ...q, id: 'q-' + guardadas.length }]); });
    return;
  }
  if (ruta === '/rest/v1/services') return enviar(services);
  if (ruta === '/rest/v1/service_variables') return enviar(service_variables);
  if (ruta === '/rest/v1/ajustes') return enviar([
    { clave: 'iva', valor: 0.08 }, { clave: 'margen_objetivo', valor: 0.35 },
    { clave: 'mano_obra_modulo', valor: 850 },
  ]);
  if (ruta === '/rest/v1/clients') return enviar([]);
  res.writeHead(404); res.end('[]');
});
await new Promise(r => srv.listen(54321, '127.0.0.1', r));

// ── El agente ────────────────────────────────────────────────────────────
const transporte = new StdioClientTransport({
  command: 'node', args: ['agente-cotizador/dist/agente-cotizador/servidor.js'],
  env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_KEY: 'falsa',
         COTIZADOR_SALIDA: process.env.S + '/cotizaciones' },
});
const cli = new Client({ name: 'prueba', version: '1.0.0' });
await cli.connect(transporte);
const call = async (n, a = {}) => (await cli.callTool({ name: n, arguments: a })).content?.[0]?.text ?? '';

const paso = (t, s) => console.log(`\n${'─'.repeat(64)}\n▸ ${t}\n${s}`);

paso('ver_catalogo("cocina")', (await call('ver_catalogo', { busqueda: 'cocina' })).split('\n').slice(0, 14).join('\n'));
paso('iniciar_cotizacion', await call('iniciar_cotizacion', { cliente: 'EMDICO', proyecto: 'Cocina Planta 2', entrega: '2026-10-22' }));
paso('agregar_partida — ambigüedad', await call('agregar_partida', { servicio: 'cubierta', cantidad: 4 }));
paso('agregar_partida — de lista', await call('agregar_partida', { servicio: 'Cocina', cantidad: 4, adicionales: ['Cubierta Cuarzo', 'Herrajes Cierre lento'] }));
paso('agregar_partida — adicional pasado como sustitución', await call('agregar_partida', { servicio: 'Cocina', cantidad: 1, sustitucion: 'Cascada 1 lado' }));
paso('agregar_partida — por COSTO con margen 35%', await call('agregar_partida', { servicio: 'Mueble de madera', cantidad: 1, costo_directo: 6500 }));
paso('agregar_partida — precio DICTADO', await call('agregar_partida', { servicio: 'Closet', cantidad: 3, precio_directo: 2400 }));
paso('ver_borrador', await call('ver_borrador'));
paso('cerrar_cotizacion', await call('cerrar_cotizacion', { notas: 'Incluye instalación. No incluye electrodomésticos.' }));
console.log('\nguardadas en la plataforma:', guardadas.length, '| total:', guardadas[0]?.total_amount);

await cli.close(); srv.close();
