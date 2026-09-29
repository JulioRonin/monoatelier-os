-- RLS: sólo el equipo ve y cambia los datos.
--
-- Hasta hoy todas las tablas se podían leer y escribir con la llave PÚBLICA
-- del sitio (la que viaja en el navegador): clientes, facturas, pagos,
-- cotizaciones, costos. Iniciar sesión no protegía nada porque la puerta de
-- atrás seguía abierta. Esta migración cierra TODAS las tablas de `public`:
-- sólo una sesión con perfil en `users` (public.es_miembro()) las usa.
--
-- CORRE PRIMERO 20260929_auth_perfiles.sql y confirma que puedes entrar a la
-- plataforma con tu cuenta nueva.
--
-- ANTES DE CORRER ESTO, los agentes de tu PC (cotizador de Discord y Forge
-- Agent) tienen que usar la llave de SERVICIO, o verán todo vacío sin dar
-- error: en el .env.local del repo agrega
--     SUPABASE_KEY=<service_role de Supabase → Project Settings → API Keys>
-- SIN el prefijo VITE_: con VITE_ la llave se publicaría dentro del sitio.
-- `npm run doctor:agente` y `python -m forge_agent.doctor` te dicen si ya.
--
-- Es idempotente: se puede correr más de una vez. Al final hay un bloque de
-- EMERGENCIA comentado para reabrir las tablas si algo sale mal.

do $$
declare
  t record;
  p record;
begin
  for t in select tablename from pg_tables
            where schemaname = 'public' and tablename <> 'users' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    -- las políticas viejas "using (true)" dejarían entrar a cualquiera: las
    -- políticas se SUMAN, basta una abierta para que todo quede abierto
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t.tablename loop
      execute format('drop policy %I on public.%I', p.policyname, t.tablename);
    end loop;
    execute format(
      'create policy miembros on public.%I for all to authenticated '
      'using (public.es_miembro()) with check (public.es_miembro())', t.tablename);
  end loop;

  -- una vista corre con los permisos de su dueño y se saltaría la RLS de
  -- sus tablas; con security_invoker respeta los de quien consulta
  for t in select viewname from pg_views where schemaname = 'public' loop
    execute format('alter view public.%I set (security_invoker = on)', t.viewname);
  end loop;
end $$;

-- Lo que sigue abierto a propósito, sin sesión:
--   · public.modelo_ar(id): nombre y modelo 3D de UN diseño, para el QR.
--   · El bucket de Storage 'forge' (GLB, USDZ y PDFs de cliente): público
--     por diseño, para mandar un link por WhatsApp. 'forge-interno' es privado.

-- ── EMERGENCIA: reabrir todo como estaba (quita la protección) ───────────
-- do $$ declare t record; begin
--   for t in select tablename from pg_tables where schemaname = 'public' loop
--     execute format('drop policy if exists miembros on public.%I', t.tablename);
--     execute format('create policy abierto on public.%I for all using (true) with check (true)', t.tablename);
--   end loop;
-- end $$;
