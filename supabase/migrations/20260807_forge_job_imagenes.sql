-- FORGE: imágenes de referencia en el prompt
--
-- Una foto de una barra, una cocina de Pinterest o el muro del cliente dice
-- en un segundo lo que un párrafo no logra. Se guardan en el bucket público
-- 'forge' bajo refs/ y aquí sólo viajan las URLs.

alter table forge_jobs
  add column if not exists imagenes jsonb default '[]'::jsonb;

comment on column forge_jobs.imagenes is
  'URLs de imágenes de referencia del prompt. El agente se las pasa al modelo si el modelo ve imágenes; si no, quedan como referencia del diseño.';
