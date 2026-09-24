-- Tarifas del taller: lo que hace falta para cotizar por costo, no por lista
--
-- Hoy hay DOS mundos de precio que no se hablan:
--
--   1. services / service_variables — lista de precios plana ($/ml, $/pz),
--      importada de Airtable. Rápida de usar, imposible de auditar: no dice
--      cuánto cuesta producir, así que no dice si se está ganando.
--
--   2. mono-forge/costing.py — costeo real de abajo hacia arriba: m² de
--      tablero × costo_m2, cubrecanto por ml, herrajes por pieza, mano de obra,
--      y precio = costo_directo / (1 − margen). Ese motor ya existe y ya
--      reporta los SKU sin precio en vez de inventarlos.
--
-- Lo que le falta al segundo para servir desde la plataforma son las TARIFAS:
-- hoy se pasan por bandera de línea de comandos en cada corrida y no viven en
-- ningún lado. Un número que hay que recordar cada vez es un número que se
-- escribe distinto cada vez.
--
-- Aquí quedan guardadas, junto al IVA que ya estaba.

-- La tabla se crea aquí también. La creaba 20260808_master_list.sql, pero una
-- migración que da por hecho que otra ya corrió falla con "relation does not
-- exist" y no dice cuál falta. Es idempotente: si ya existe, no pasa nada.
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
  ('moneda', '"MXN"'::jsonb, 'Moneda de las cotizaciones.'),
  -- Por MÓDULO, no por hora. Es la unidad que ya usa mono-forge
  -- (Tarifas.mano_obra_modulo) y la que el taller sabe estimar: cambiar a
  -- horas obligaría a estimar horas por tipo de mueble, que es otro modelo.
  ('mano_obra_modulo', '0'::jsonb,
   'Costo de mano de obra por módulo (mueble), en pesos. Lo que te CUESTA producirlo, no lo que lo cobras.'),

  ('margen_objetivo', '0.35'::jsonb,
   'Margen sobre PRECIO (no sobre costo): precio = costo / (1 − margen). 0.35 = el costo es el 65% del precio. NUNCA se imprime en un documento del cliente.'),

  ('canto_maquina_ml', '0'::jsonb,
   'Costo por metro lineal de cubrecanto pegado a máquina.'),

  ('canto_manual_ml', '0'::jsonb,
   'Costo por metro lineal de cubrecanto pegado A MANO. El alto brillo 19mm siempre va manual: promediarlo deja cortas justo las cotizaciones con más mano de obra.'),

  ('desperdicio', '0.10'::jsonb,
   'Factor de desperdicio de tablero. 0.10 = 10% sobre el área neta de corte.')

on conflict (clave) do nothing;

-- Vigencia de la tarifa. Un costo de mano de obra de hace dos años se ve
-- idéntico a uno de ayer, y es la diferencia entre ganar y no.
alter table ajustes
  add column if not exists actualizado_por text;

comment on table ajustes is
  'Parámetros del negocio: IVA, moneda y tarifas de costeo. Se editan en la pantalla de Precios, no en el código.';
