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

insert into ajustes (clave, valor, descripcion) values
  ('mano_obra_hora', '0'::jsonb,
   'Costo de una hora de taller, en pesos. Incluye lo que te cuesta la hora, NO lo que la cobras.'),

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
