-- REP (Complemento de Pago) — facturas externas y libro de pagos
--
-- Dos problemas que resuelve:
--
-- 1. Una factura PPD timbrada en OTRA plataforma (Fenix Web / Mas Facturas)
--    también necesita su REP, y el REP se relaciona con ella SÓLO por UUID:
--    no requiere el mismo PAC. Pero el módulo de REP sólo veía las facturas
--    que están en Facturapi, así que esas facturas no se podían seleccionar.
--    facturas_externas las registra a partir de su XML.
--
-- 2. El saldo anterior se escribía a mano. En la parcialidad 2 nadie se acuerda
--    de cuánto se pagó en la 1, y un saldo mal puesto invalida el REP ante el
--    SAT. rep_pagos lleva el libro: saldo anterior = total − Σ pagos previos.

-- ── facturas timbradas fuera de esta plataforma ─────────────────────────

create table if not exists facturas_externas (
  id uuid primary key default gen_random_uuid(),

  -- El UUID es la ÚNICA liga con el REP. Único: importar dos veces la misma
  -- factura sería invitar a timbrar dos REP de la misma parcialidad.
  uuid text not null unique,
  serie text,                       -- puede no existir: el CFDI la trae opcional
  folio text,
  fecha timestamptz not null,

  emisor_rfc text not null,
  emisor_nombre text,

  -- El receptor del REP debe ser IDÉNTICO al de la factura original
  -- (RFC, régimen y código postal). Por eso se guardan los tres.
  receptor_rfc text not null,
  receptor_nombre text,
  receptor_regimen text not null,
  receptor_cp text not null,
  uso_cfdi text,

  moneda text not null default 'MXN',
  tipo_cambio numeric not null default 1,
  metodo_pago text not null,        -- PPD (las PUE no llevan REP)
  forma_pago text,

  subtotal numeric not null,
  total numeric not null,

  -- [{tipo, tasa, base, importe, retencion}] — agregado desde los conceptos,
  -- que es donde el CFDI sí trae Base y TasaOCuota. El nodo Impuestos de
  -- arriba omite la base en las retenciones.
  impuestos jsonb not null default '[]'::jsonb,

  xml text,                         -- el CFDI original tal cual se importó
  notas text,
  created_at timestamptz default now()
);

comment on table facturas_externas is
  'Facturas PPD timbradas con otro PAC que necesitan su REP aquí. El REP se liga por UUID.';
comment on column facturas_externas.impuestos is
  'Estructura fiscal de la factura. El REP reparte ESTA estructura a prorrata del monto pagado; nunca asume que el pago es base×1.08.';

create index if not exists facturas_externas_receptor_idx
  on facturas_externas (receptor_rfc);

-- ── libro de pagos: un renglón por REP timbrado ─────────────────────────

create table if not exists rep_pagos (
  id uuid primary key default gen_random_uuid(),

  factura_uuid text not null,       -- UUID de la factura PPD original
  factura_origen text not null default 'facturapi',   -- facturapi | externa
  factura_folio text,               -- para leerlo sin ir a buscar la factura

  rep_uuid text,                    -- UUID del REP ya timbrado
  rep_facturapi_id text,
  rep_serie text,
  rep_folio int,

  fecha_pago timestamptz not null,
  forma_pago text not null,
  moneda text not null default 'MXN',
  tipo_cambio numeric not null default 1,

  monto numeric not null,
  parcialidad int not null,
  saldo_anterior numeric not null,
  saldo_insoluto numeric not null,

  created_at timestamptz default now()
);

comment on table rep_pagos is
  'Un renglón por REP timbrado. De aquí sale la parcialidad y el saldo anterior del siguiente pago.';

-- Dos REP con la misma parcialidad sobre la misma factura es un error fiscal,
-- no una preferencia: el índice lo impide.
create unique index if not exists rep_pagos_parcialidad_idx
  on rep_pagos (factura_uuid, parcialidad);

create index if not exists rep_pagos_factura_idx
  on rep_pagos (factura_uuid);

-- ── RLS (mismo patrón que el resto del esquema) ─────────────────────────

alter table facturas_externas enable row level security;
alter table rep_pagos enable row level security;

drop policy if exists "facturas_externas_select" on facturas_externas;
create policy "facturas_externas_select" on facturas_externas for select using (true);
drop policy if exists "facturas_externas_write" on facturas_externas;
create policy "facturas_externas_write" on facturas_externas for all using (true) with check (true);

drop policy if exists "rep_pagos_select" on rep_pagos;
create policy "rep_pagos_select" on rep_pagos for select using (true);
drop policy if exists "rep_pagos_write" on rep_pagos;
create policy "rep_pagos_write" on rep_pagos for all using (true) with check (true);
