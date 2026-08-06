-- FORGE: los entregables viven en la plataforma, no sólo en la PC del taller
--
-- El worker ya subía cutlist.xlsx, herrajes.xlsx y los PDF al bucket 'forge',
-- pero sólo guardaba glb_url y usdz_url en la tabla: las demás URLs se perdían
-- y la plataforma no tenía cómo encontrarlas. Aquí se guardan.
--
-- costos_internos.pdf NO va con los demás: lleva el margen y el costo directo.
-- Va a un bucket PRIVADO aparte, y la plataforma pide una URL firmada cuando
-- alguien lo abre. Ver la nota de seguridad al final.

alter table forge_models
  add column if not exists documentos jsonb default '{}'::jsonb,
  add column if not exists costos_path text;

comment on column forge_models.documentos is
  'nombre de archivo → URL pública. Sólo documentos de cliente; el margen nunca entra aquí.';
comment on column forge_models.costos_path is
  'ruta dentro del bucket privado forge-interno. NO es una URL: se firma al abrir.';

-- Bucket PRIVADO para el reporte interno de costos
insert into storage.buckets (id, name, public)
values ('forge-interno', 'forge-interno', false)
on conflict (id) do nothing;

-- Sin política de lectura anónima: un objeto de este bucket sólo se sirve con
-- una URL firmada (createSignedUrl) o con la service_role key del worker.
drop policy if exists "forge_interno_insert" on storage.objects;
create policy "forge_interno_insert" on storage.objects
  for insert with check (bucket_id = 'forge-interno');
drop policy if exists "forge_interno_update" on storage.objects;
create policy "forge_interno_update" on storage.objects
  for update using (bucket_id = 'forge-interno');
drop policy if exists "forge_interno_select" on storage.objects;
create policy "forge_interno_select" on storage.objects
  for select using (bucket_id = 'forge-interno');
drop policy if exists "forge_interno_delete" on storage.objects;
create policy "forge_interno_delete" on storage.objects
  for delete using (bucket_id = 'forge-interno');

-- ─────────────────────────────────────────────────────────────────────────
-- NOTA DE SEGURIDAD — léela antes de activar FORGE_SUBIR_COSTOS=1
--
-- El bucket es privado: la diferencia real con 'forge' es que sus objetos NO
-- tienen URL pública adivinable y hay que firmarlas para leerlas.
--
-- PERO mientras la plataforma no tenga login, la política de arriba deja que
-- cualquiera que llegue a tu app con el anon key pida esa firma. Es decir: la
-- puerta hoy es el acceso a tu plataforma, no el bucket.
--
-- Por eso subir el reporte de costos es OPT-IN (FORGE_SUBIR_COSTOS=1) y viene
-- apagado. Cuando pongas autenticación, endurece la política de select a:
--     using (bucket_id = 'forge-interno' and auth.role() = 'authenticated')
-- ─────────────────────────────────────────────────────────────────────────
