/**
 * Prueba de las migraciones de Auth y RLS contra un Postgres real (PGlite).
 *
 * Se arma una base como la de hoy —contraseñas en texto plano en `users`,
 * tablas abiertas a la llave pública, una política "using (true)" como las
 * de forge_jobs— y se le corren las dos migraciones TAL CUAL están en
 * supabase/migrations. Se simula lo mínimo de Supabase: los roles anon,
 * authenticated y service_role, y auth.uid() / auth.email() a partir del
 * JWT de la sesión.
 *
 * Lo que se verifica:
 *   1. Nadie sin sesión lee perfiles ni contraseñas; la columna desaparece.
 *   2. La cuenta se liga a su perfil por correo, SÓLO si está confirmado.
 *   3. Una cuenta sin perfil (un registro cualquiera) no ve nada.
 *   4. Sólo un Super User da de alta o cambia perfiles.
 *   5. Con RLS, sin sesión no se ve ni se escribe nada; con perfil, todo.
 *   6. La llave de servicio (los agentes de la PC) sigue viendo todo.
 *   7. El visor AR del QR ve un diseño por id y nada más.
 *   8. Correr las migraciones dos veces no truena.
 *
 *     node prueba-auth.mjs
 */

import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const fallas = [];
const ok = (c, m) => { if (!c) fallas.push(m); };

// ── lo que Supabase ya trae ─────────────────────────────────────────────
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.email() returns text language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.email', true), '') $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);

// ── la base como está hoy ───────────────────────────────────────────────
await db.exec(`
  create table public.users (
    id uuid primary key default gen_random_uuid(), email text, password text,
    full_name text, role text, avatar_url text, created_at timestamptz default now());
  insert into public.users (id, email, password, full_name, role, created_at) values
    ('00000000-0000-0000-0000-000000000001', 'Julio@Mono.mx', 'secreto123', 'Julio', 'Super User', now() - interval '2 days'),
    ('00000000-0000-0000-0000-000000000002', 'ana@mono.mx', 'ana456', 'Ana', 'Level 2', now() - interval '1 day'),
    ('00000000-0000-0000-0000-000000000003', 'pepe@mono.mx', 'pepe789', 'Pepe', 'Level 2', now()),
    ('00000000-0000-0000-0000-000000000004', 'ana@mono.mx', 'dup', 'Ana (duplicado)', 'Level 2', now());
  create table public.projects (id bigint generated always as identity primary key, name text);
  insert into public.projects (name) values ('Cocina Anáhuac'), ('Vestidor Díaz');
  create table public.forge_models (id uuid primary key, name text, glb_url text,
    usdz_url text, project_json jsonb, documentos jsonb);
  insert into public.forge_models values ('11111111-1111-1111-1111-111111111111', 'Vestidor',
    'https://x/v.glb', null, '{"cliente":"Díaz"}', '{"cotizacion.pdf":"https://x/c.pdf"}');
  create table public.forge_jobs (id int primary key, prompt text);
  alter table public.forge_jobs enable row level security;
  create policy forge_jobs_select on public.forge_jobs for select using (true);
  insert into public.forge_jobs values (1, 'cocina');
  create view public.proyectos_vista as select id, name from public.projects;
  insert into auth.users values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'julio@mono.mx', now()),   -- confirmado
    ('aaaaaaaa-0000-0000-0000-000000000002', 'ana@mono.mx', now()),
    ('aaaaaaaa-0000-0000-0000-000000000003', 'pepe@mono.mx', null),     -- SIN confirmar
    ('aaaaaaaa-0000-0000-0000-000000000009', 'extrano@x.com', now());   -- sin perfil
`);

async function como(rol, sesion, sql, params) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false),
                         set_config('request.jwt.claim.email', $2, false)`,
                 [sesion?.id ?? '', sesion?.email ?? '']);
  await db.exec(`set role ${rol}`);
  try { return { filas: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec('reset role'); }
}
const JULIO = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'julio@mono.mx' };
const ANA = { id: 'aaaaaaaa-0000-0000-0000-000000000002', email: 'ana@mono.mx' };
const PEPE = { id: 'aaaaaaaa-0000-0000-0000-000000000003', email: 'pepe@mono.mx' };
const EXTRANO = { id: 'aaaaaaaa-0000-0000-0000-000000000009', email: 'extrano@x.com' };

// el problema, antes de migrar
const antes = await como('anon', null, 'select email, password from public.users');
ok(antes.filas?.length === 4 && antes.filas[0].password,
   'la prueba debería reproducir el problema: hoy la llave pública lee las contraseñas');

const m1 = readFileSync('supabase/migrations/20260929_auth_perfiles.sql', 'utf8');
const m2 = readFileSync('supabase/migrations/20260929_rls_miembros.sql', 'utf8');
await db.exec(m1);

// 1. sin sesión no se lee nada, y la columna ya no existe
let r = await como('anon', null, 'select * from public.users');
ok(r.filas?.length === 0, `sin sesión se leen ${r.filas?.length} perfiles`);
r = await como('service_role', null,
  `select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'password'`);
ok(r.filas?.length === 0, 'la columna password sigue existiendo');

// 2. la liga por correo (sin importar mayúsculas), sólo si está confirmado
r = await como('authenticated', JULIO, 'select * from public.vincular_perfil()');
ok(r.filas?.[0]?.full_name === 'Julio', `Julio no quedó ligado: ${JSON.stringify(r)}`);
r = await como('authenticated', JULIO, 'select * from public.vincular_perfil()');
ok(r.filas?.[0]?.full_name === 'Julio', 'la segunda vez debe devolver el mismo perfil');
r = await como('authenticated', PEPE, 'select * from public.vincular_perfil()');
ok(!r.filas?.[0]?.id, 'un correo SIN confirmar no debe ligarse al perfil');
r = await como('authenticated', ANA, 'select * from public.vincular_perfil()');
ok(r.filas?.[0]?.full_name === 'Ana', 'con correo duplicado se liga el perfil más antiguo');
r = await como('service_role', null,
  `select count(*)::int n from public.users where lower(email) = 'ana@mono.mx' and auth_id is not null`);
ok(r.filas?.[0]?.n === 1, 'un correo duplicado no debe ligar dos perfiles a la misma cuenta');

// 3. una cuenta sin perfil no ve nada ni puede darse de alta
r = await como('authenticated', EXTRANO, 'select * from public.vincular_perfil()');
ok(!r.filas?.[0]?.id, 'una cuenta sin perfil no debe obtener uno');
r = await como('authenticated', EXTRANO, 'select * from public.users');
ok(r.filas?.length === 0, 'una cuenta sin perfil ve la lista de usuarios');
r = await como('authenticated', EXTRANO,
  `insert into public.users (email, full_name, role) values ('extrano@x.com', 'Yo', 'Super User')`);
ok(r.error, 'una cuenta sin perfil pudo darse de alta como Super User');

// 4. el equipo lee; sólo el Super User da de alta o cambia
r = await como('authenticated', ANA, 'select * from public.users');
ok(r.filas?.length === 4, `Ana (Level 2) debería ver a los 4: ve ${r.filas?.length}`);
r = await como('authenticated', ANA,
  `update public.users set role = 'Super User' where email = 'ana@mono.mx' returning id`);
ok(r.error || r.filas?.length === 0, 'un Level 2 no debe poder subirse a Super User');
r = await como('authenticated', JULIO,
  `insert into public.users (email, full_name, role) values ('nuevo@mono.mx', 'Nuevo', 'Level 2') returning id`);
ok(r.filas?.length === 1, `el Super User debe poder dar de alta: ${r.error}`);

// 7. el QR: un diseño por id, sólo lo del modelo
r = await como('anon', null, `select public.modelo_ar('11111111-1111-1111-1111-111111111111') as m`);
const m = r.filas?.[0]?.m;
ok(m?.glb_url === 'https://x/v.glb' && !('documentos' in (m || {})),
   `modelo_ar debe dar el GLB y nada más: ${JSON.stringify(r)}`);

// ── migración 2 ─────────────────────────────────────────────────────────
await db.exec(m2);

// 5. sin sesión, nada; sin perfil, nada; con perfil, todo
for (const tabla of ['projects', 'forge_jobs', 'forge_models', 'proyectos_vista']) {
  r = await como('anon', null, `select * from public.${tabla}`);
  ok(r.error || r.filas?.length === 0, `sin sesión se lee ${tabla}`);
  r = await como('authenticated', EXTRANO, `select * from public.${tabla}`);
  ok(r.error || r.filas?.length === 0, `una cuenta sin perfil lee ${tabla}`);
  r = await como('authenticated', ANA, `select * from public.${tabla}`);
  ok(r.filas?.length > 0, `alguien del equipo no puede leer ${tabla}: ${r.error}`);
}
r = await como('anon', null, `insert into public.projects (name) values ('spam') returning id`);
ok(r.error, 'sin sesión se pudo escribir en projects');
r = await como('authenticated', ANA, `insert into public.projects (name) values ('Closet Ruiz') returning id`);
ok(r.filas?.length === 1, `el equipo no puede escribir: ${r.error}`);

// 6. los agentes con la llave de servicio
r = await como('service_role', null, 'select * from public.projects');
ok(r.filas?.length === 3, 'la llave de servicio debe seguir viendo todo');

// el QR sigue funcionando con la tabla cerrada
r = await como('anon', null, `select public.modelo_ar('11111111-1111-1111-1111-111111111111') as m`);
ok(r.filas?.[0]?.m?.name === 'Vestidor', 'el visor AR del QR se rompió al cerrar las tablas');

// 8. idempotentes
try { await db.exec(m1); await db.exec(m2); }
catch (e) { fallas.push('correr las migraciones otra vez truena: ' + e.message); }
r = await como('authenticated', JULIO, 'select * from public.users');
ok(r.filas?.length === 5, 'después de re-correr, el equipo debe seguir viendo los perfiles');

if (fallas.length) {
  console.log('FALLAS:'); fallas.forEach(f => console.log(' ✗ ' + f));
  process.exit(1);
}
console.log('✓ las contraseñas ya no existen, nadie sin perfil ve nada, el equipo');
console.log('  trabaja igual, los agentes con la llave de servicio también, y el QR abre.');
