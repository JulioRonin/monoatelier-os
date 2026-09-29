/**
 * Prueba del proxy de Facturapi (api/_facturapi.ts), sin red: Supabase y
 * Facturapi son falsos y se registra cada llamada que les llega.
 *
 *     node --experimental-strip-types prueba-facturapi.ts
 *
 * Lo que se verifica:
 *   1. Sin sesión, con sesión falsa o sin perfil: Facturapi NUNCA recibe nada.
 *   2. Sólo pasan las operaciones que usa la plataforma, con sus parámetros;
 *      un "../" o una operación fuera de la lista no llega a Facturapi.
 *   3. La llave viaja sólo hacia Facturapi: ninguna respuesta la contiene.
 *   4. Cada respuesta dice el modo (live/test) y los PDF pasan intactos.
 */
import { atender, entornoDe, type Entorno } from './api/_facturapi.ts';

const LLAVE = 'sk_test_ESTA-ES-LA-LLAVE-SECRETA';
const env: Entorno = { FACTURAPI_KEY: LLAVE, SUPABASE_URL: 'https://supa.test', SUPABASE_ANON_KEY: 'anon' };
const TOKEN_OK = 'token-de-julio';
const TOKEN_SIN_PERFIL = 'token-de-extrano';

let llamadas: { url: string; init: RequestInit }[] = [];
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x00, 0xff]);

async function falso(url: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const u = String(url);
    llamadas.push({ url: u, init });
    const auth = new Headers(init.headers).get('authorization') || '';
    if (u.endsWith('/auth/v1/user')) {
        return auth === `Bearer ${TOKEN_OK}` || auth === `Bearer ${TOKEN_SIN_PERFIL}`
            ? Response.json({ id: 'u1' }) : new Response('{}', { status: 401 });
    }
    if (u.endsWith('/rest/v1/rpc/es_miembro')) return Response.json(auth === `Bearer ${TOKEN_OK}`);
    if (u.startsWith('https://www.facturapi.io/v2/invoices/f1/pdf')) {
        return new Response(PDF, { headers: { 'content-type': 'application/pdf',
                                               'content-disposition': 'attachment; filename="f1.pdf"' } });
    }
    if (u.startsWith('https://www.facturapi.io/')) return Response.json({ id: 'f1', uuid: 'U-1' });
    return new Response('no', { status: 500 });
}

const fallas: string[] = [];
const ok = (c: unknown, m: string) => { if (!c) fallas.push(m); };
const aFacturapi = () => llamadas.filter(l => l.url.startsWith('https://www.facturapi.io'));
const texto = (b: string | Uint8Array) => typeof b === 'string' ? b : new TextDecoder().decode(b);

async function pedir(metodo: string, ruta: string, query: Record<string, string> = {},
                     token = TOKEN_OK, cuerpo?: unknown, e: Entorno = env) {
    llamadas = [];
    return atender({ metodo, ruta, query: { ruta, ...query }, cuerpo,
                     authorization: token ? `Bearer ${token}` : undefined }, e, falso as typeof fetch);
}

// 1. nadie sin sesión con perfil llega a Facturapi
let r = await pedir('GET', 'invoices', {}, '');
ok(r.status === 401 && aFacturapi().length === 0, 'sin sesión debe dar 401 sin tocar Facturapi');
r = await pedir('GET', 'invoices', {}, 'token-inventado');
ok(r.status === 401 && aFacturapi().length === 0, 'un token falso debe dar 401 sin tocar Facturapi');
r = await pedir('POST', 'invoices', {}, TOKEN_SIN_PERFIL, { customer: 'c' });
ok(r.status === 403 && aFacturapi().length === 0, 'una cuenta sin perfil no debe poder timbrar');

// 2. sólo lo que usa la plataforma
for (const [m, ruta] of [['GET', 'organizations'], ['DELETE', 'customers/c1'],
                         ['GET', 'invoices/../organizations'], ['POST', 'invoices/f1/email'],
                         ['GET', 'invoices/f1/pdf/../../x'], ['PUT', 'invoices/f1']]) {
    r = await pedir(m, ruta);
    ok(r.status === 404 && aFacturapi().length === 0, `${m} ${ruta} no debe llegar a Facturapi (dio ${r.status})`);
}
r = await pedir('GET', 'invoices', { limit: '20', q: 'EMDICO', 'date[gt]': '2026-09-01',
                                     api_key: 'x', ruta: 'otra' });
const url = new URL(aFacturapi()[0]?.url || 'http://x');
ok(url.pathname === '/v2/invoices', `lista de facturas: ${url.pathname}`);
ok(url.searchParams.get('q') === 'EMDICO' && url.searchParams.get('date[gt]') === '2026-09-01',
   'los filtros de la lista deben pasar');
ok(!url.searchParams.has('api_key') && !url.searchParams.has('ruta'), 'sólo deben pasar los parámetros conocidos');

r = await pedir('DELETE', 'invoices/f1', { motive: '01', substitution: 'U-2' });
const cancel = new URL(aFacturapi()[0]?.url || 'http://x');
ok(aFacturapi()[0]?.init.method === 'DELETE' && cancel.searchParams.get('motive') === '01'
   && cancel.searchParams.get('substitution') === 'U-2', 'la cancelación debe llevar motivo y sustitución');

r = await pedir('POST', 'invoices', {}, TOKEN_OK, { customer: 'c1', items: [] });
const post = aFacturapi()[0];
ok(post?.init.method === 'POST' && JSON.parse(String(post.init.body)).customer === 'c1', 'el timbre debe llevar el cuerpo');
ok(new Headers(post?.init.headers).get('authorization') ===
   `Basic ${Buffer.from(`${LLAVE}:`).toString('base64')}`, 'a Facturapi debe llegar la llave en Basic');
ok(r.headers['X-Facturapi-Modo'] === 'test', 'la respuesta del timbre debe decir el modo');

r = await pedir('POST', 'invoices', {}, TOKEN_OK, undefined);
ok(r.status === 400 && aFacturapi().length === 0, 'un POST sin cuerpo no debe llegar a Facturapi');

// 3. la llave nunca sale
r = await pedir('GET', 'modo');
const modo = JSON.parse(texto(r.body));
ok(modo.modo === 'test' && modo.prefijo === 'sk_test_…', `modo: ${texto(r.body)}`);
ok(aFacturapi().length === 0, 'preguntar el modo no debe llamar a Facturapi');
for (const [m, ruta] of [['GET', 'modo'], ['GET', 'invoices'], ['GET', 'organizations']]) {
    r = await pedir(m, ruta);
    ok(!texto(r.body).includes('ESTA-ES-LA-LLAVE') && !JSON.stringify(r.headers).includes('ESTA-ES-LA-LLAVE'),
       `la llave apareció en la respuesta de ${m} ${ruta}`);
}

// 4. los PDF pasan intactos
r = await pedir('GET', 'invoices/f1/pdf');
ok(r.headers['Content-Type'] === 'application/pdf', 'el PDF debe conservar su tipo');
ok(r.headers['Content-Disposition']?.includes('f1.pdf'), 'el PDF debe conservar su nombre');
ok(r.body instanceof Uint8Array && r.body.length === PDF.length && r.body.every((b, i) => b === PDF[i]),
   'los bytes del PDF deben llegar intactos');

// sin llave en el servidor: se dice, y el modo lo reporta
r = await pedir('GET', 'invoices', {}, TOKEN_OK, undefined, { ...env, FACTURAPI_KEY: undefined });
ok(r.status === 500 && /FACTURAPI_KEY/.test(texto(r.body)), 'sin llave debe decir que falta FACTURAPI_KEY');
r = await pedir('GET', 'modo', {}, TOKEN_OK, undefined, { ...env, FACTURAPI_KEY: undefined });
ok(JSON.parse(texto(r.body)).modo === 'sin-llave', 'sin llave el modo debe ser sin-llave');

// en Vercel las VITE_ de Supabase sirven de respaldo; la de Facturapi con VITE_ NO
const e = entornoDe({ VITE_SUPABASE_URL: 'https://s.co/', VITE_SUPABASE_ANON_KEY: 'a',
                      VITE_FACTURAPI_KEY: 'sk_live_vieja' });
ok(e.SUPABASE_URL === 'https://s.co' && e.SUPABASE_ANON_KEY === 'a', 'debe tomar la URL y la anon de las VITE_');
ok(e.FACTURAPI_KEY === undefined, 'no debe usar VITE_FACTURAPI_KEY: esa es la que quedó expuesta');

if (fallas.length) {
    console.log('FALLAS:'); fallas.forEach(f => console.log(' ✗ ' + f));
    process.exit(1);
}
console.log('✓ sin sesión con perfil no pasa nada, sólo pasan las operaciones de la');
console.log('  plataforma, la llave no sale nunca y los PDF llegan intactos.');
