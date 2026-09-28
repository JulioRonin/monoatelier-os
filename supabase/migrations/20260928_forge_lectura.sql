-- FORGE: diseñar desde una foto de referencia, en dos pasos
--
--   1. tipo = 'lectura': el worker manda la foto a un modelo con visión y
--      guarda aquí la FICHA (qué se ve, elementos, acabados, lo que no se
--      puede fabricar y las medidas estimadas). No construye nada.
--   2. Julio revisa la ficha en la plataforma, corrige medidas y encola
--      tipo = 'diseno' con la ficha ya confirmada. Ése sí se construye.
--
-- Los trabajos que ya existían son de diseño: el default los deja igual.

alter table forge_jobs
  add column if not exists tipo text not null default 'diseno',
  add column if not exists ficha jsonb;

comment on column forge_jobs.tipo is
  'lectura (foto → ficha para revisar) | diseno (prompt o ficha confirmada → proyecto)';
comment on column forge_jobs.ficha is
  'En lectura: la ficha que produjo el modelo. En diseno: la ficha confirmada por Julio, que manda sobre la foto.';
