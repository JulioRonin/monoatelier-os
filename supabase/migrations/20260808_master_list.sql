-- MASTER LIST de servicios, componentes y precios
--
-- Las tablas services y service_variables existían sin migración (se crearon
-- a mano al importar de Airtable). Esto las versiona y arregla el defecto que
-- costaba dinero: una variante NO es siempre una sustitución.
--
--   sustitucion  cambia el precio base       (cuarzo en lugar de granito)
--   adicional    SE SUMA al precio base      (cascada, LED, herrajes)
--   opcion       no mueve el precio          (4 / 6 / 8 personas)
--
-- Antes todo era "sustitución": elegir "Cascada 1 lado $2000" en una cocina de
-- $2850/ml bajaba el precio a $2000/ml. En 5 metros eso son $4,250 perdidos,
-- y encima con la cascada incluida.
--
-- Aditiva a propósito: no borra ni renombra nada, para que la app vieja siga
-- funcionando mientras se migra. Correr completa; es idempotente.

-- ── servicios ───────────────────────────────────────────────────────────

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  description text,
  base_price numeric,
  units text
);

alter table services
  add column if not exists sku text,
  add column if not exists cost numeric,                 -- lo que te cuesta
  add column if not exists active boolean default true,
  add column if not exists price_updated_at date,        -- vigencia del precio
  add column if not exists notes text;

comment on column services.cost is
  'Costo directo. Sin esto no hay margen: precio − costo es la única cifra que dice si ganas.';
comment on column services.price_updated_at is
  'Cuándo se revisó el precio por última vez. Un precio de hace dos años se ve igual que uno de ayer.';

create unique index if not exists services_sku_idx on services (sku) where sku is not null;

-- ── componentes / variantes ─────────────────────────────────────────────

create table if not exists service_variables (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references services(id) on delete cascade,
  name text not null,
  price numeric
);

alter table service_variables
  add column if not exists kind text not null default 'sustitucion',
  add column if not exists units text,
  add column if not exists cost numeric,
  add column if not exists active boolean default true,
  add column if not exists sort_order int default 0,
  add column if not exists notes text;

do $$ begin
  alter table service_variables
    add constraint service_variables_kind_chk
    check (kind in ('sustitucion', 'adicional', 'opcion'));
exception when duplicate_object then null; end $$;

comment on column service_variables.kind is
  'sustitucion = reemplaza el precio base | adicional = se suma | opcion = no mueve el precio';
comment on column service_variables.units is
  'Unidad del adicional cuando difiere del servicio (ej. LED por metro en una cocina por metro lineal).';

create index if not exists service_variables_service_idx
  on service_variables (service_id, sort_order);

-- ── reclasificación de lo que ya está cargado ───────────────────────────
-- Se reclasifica por nombre porque es el único dato que hay. Revísalo en
-- Materiales después de correr esto: lo que quede mal clasificado sigue
-- cotizando mal.

update service_variables set kind = 'adicional'
 where kind = 'sustitucion'
   and (name ilike '%cascada%'
     or name ilike '%luz%led%' or name ilike '%led%'
     or name ilike '%perfil%'
     or name ilike '%herraje%');

-- "4 Personas" / "6 Personas" / "8 Personas" venían sin precio: son opciones
update service_variables set kind = 'opcion'
 where (price is null or price = 0);

-- Los metros NO son variantes, son cantidad. "Default (4mts)", "5 Metros" …
-- "10 Metros" eran siete filas con el mismo precio; se desactivan para que no
-- inviten a cotizar dos veces el metraje.
update service_variables set active = false
 where name ~* '^\s*(default\s*\(?\s*)?[0-9]+\s*(mts?|metros?)\b';

-- ── RLS ─────────────────────────────────────────────────────────────────

alter table services enable row level security;
alter table service_variables enable row level security;

drop policy if exists "Public read access for services" on services;
create policy "Public read access for services" on services for select using (true);
drop policy if exists "services_write" on services;
create policy "services_write" on services for all using (true) with check (true);

drop policy if exists "Public read access for service_variables" on service_variables;
create policy "Public read access for service_variables" on service_variables for select using (true);
drop policy if exists "service_variables_write" on service_variables;
create policy "service_variables_write" on service_variables for all using (true) with check (true);

-- ── configuración del negocio ───────────────────────────────────────────
-- El IVA estaba escrito en el código como 0.08. Es correcto para la franja
-- fronteriza norte, pero un número fiscal no debe vivir escondido en un .tsx.

create table if not exists ajustes (
  clave text primary key,
  valor jsonb not null,
  descripcion text,
  updated_at timestamptz default now()
);

alter table ajustes enable row level security;
drop policy if exists "ajustes_select" on ajustes;
create policy "ajustes_select" on ajustes for select using (true);
drop policy if exists "ajustes_write" on ajustes;
create policy "ajustes_write" on ajustes for all using (true) with check (true);

insert into ajustes (clave, valor, descripcion) values
  ('iva', '0.08'::jsonb,
   'Tasa de IVA. 0.08 = franja fronteriza norte; 0.16 = resto del país.'),
  ('moneda', '"MXN"'::jsonb, 'Moneda de las cotizaciones.')
on conflict (clave) do nothing;
