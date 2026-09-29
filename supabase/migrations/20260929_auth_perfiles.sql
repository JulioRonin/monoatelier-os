-- AUTH: el login pasa a Supabase Auth y las contraseñas salen de `users`.
--
-- Antes el login leía `users` con la llave PÚBLICA del sitio y comparaba la
-- contraseña en el navegador: cualquiera con la URL podía leer las
-- contraseñas de todos, en texto plano. Ahora:
--
--   · Las contraseñas viven sólo en Supabase Auth (cifradas).
--   · `users` queda como PERFIL (nombre, rol) y se liga a la cuenta de Auth
--     por `auth_id`. Se conserva la tabla porque `projects` la referencia.
--   · La liga se hace sola la primera vez que la persona entra, por correo,
--     y SÓLO si su correo está confirmado.
--   · Nadie sin perfil ve nada, aunque tenga cuenta de Auth.
--
-- ANTES DE CORRER ESTO (si no, te quedas fuera):
--   1. Supabase → Authentication → Users → Add user → Create new user, con el
--      MISMO correo que tienes en la tabla users y "Auto Confirm User"
--      marcado. Haz lo mismo con cada persona del equipo.
--   2. Authentication → Sign In / Providers → Email: deja "Confirm email"
--      ACTIVADO. Sin eso, alguien podría registrarse con el correo de un
--      perfil que aún no entra y quedarse con él.
--   3. Authentication → URL Configuration → Site URL: la dirección de la
--      plataforma en Vercel (para los enlaces de restablecer contraseña).
-- Luego corre este archivo y publica la versión nueva de la plataforma.

-- ── la liga perfil ↔ cuenta ──────────────────────────────────────────────
alter table public.users
  add column if not exists auth_id uuid unique references auth.users (id) on delete set null;

-- ¿la sesión actual es de alguien del equipo? Las usa cada política de RLS.
-- SECURITY DEFINER para leer `users` sin toparse con su propia RLS.
create or replace function public.es_miembro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where auth_id = auth.uid());
$$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users
                 where auth_id = auth.uid() and role = 'Super User');
$$;

-- El perfil de la sesión. La primera vez lo liga por correo, si el correo
-- está confirmado y el perfil no tiene ya otra cuenta. Si hay dos perfiles
-- con el mismo correo, liga sólo el más antiguo.
create or replace function public.vincular_perfil() returns public.users
language plpgsql security definer set search_path = public as $$
declare
  perfil public.users;
  confirmado boolean;
begin
  if auth.uid() is null then
    return null;
  end if;

  select * into perfil from public.users where auth_id = auth.uid();
  if found then
    return perfil;
  end if;

  select email_confirmed_at is not null into confirmado
    from auth.users where id = auth.uid();
  if not coalesce(confirmado, false) then
    return null;
  end if;

  update public.users set auth_id = auth.uid()
   where id = (select u.id from public.users u
                where lower(u.email) = lower(auth.email()) and u.auth_id is null
                order by u.created_at nulls last
                limit 1)
  returning * into perfil;
  return perfil;
end;
$$;

revoke all on function public.es_miembro() from public;
revoke all on function public.es_admin() from public;
revoke all on function public.vincular_perfil() from public;
grant execute on function public.es_miembro() to anon, authenticated;
grant execute on function public.es_admin() to anon, authenticated;
grant execute on function public.vincular_perfil() to authenticated;

-- ── RLS de users: el equipo lee, sólo un Super User da de alta o cambia ──
alter table public.users enable row level security;

do $$
declare p record;
begin
  -- cualquier política vieja (p. ej. "todos pueden leer") dejaría la puerta abierta
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'users' loop
    execute format('drop policy %I on public.users', p.policyname);
  end loop;
end $$;

create policy perfiles_leer on public.users
  for select to authenticated using (public.es_miembro());
create policy perfiles_alta on public.users
  for insert to authenticated with check (public.es_admin());
create policy perfiles_editar on public.users
  for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy perfiles_baja on public.users
  for delete to authenticated using (public.es_admin());

-- ── adiós a las contraseñas en texto plano ───────────────────────────────
alter table public.users drop column if exists password;

-- ── visor AR público (el QR): un diseño a la vez, sólo lo del modelo 3D ──
-- La página del QR se abre sin sesión. En vez de dejar la tabla abierta
-- (que expondría las cotizaciones de todos los diseños), esta función
-- entrega nombre y modelos de UN diseño cuyo id ya conoces.
create or replace function public.modelo_ar(p_id uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', name, 'glb_url', glb_url, 'usdz_url', usdz_url)
    from public.forge_models where id = p_id;
$$;
revoke all on function public.modelo_ar(uuid) from public;
grant execute on function public.modelo_ar(uuid) to anon, authenticated;
