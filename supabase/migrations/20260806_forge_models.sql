-- FORGE: diseños paramétricos (mono-forge) + visor 3D/AR
-- Tabla de modelos + bucket público de storage para GLB/USDZ/project.json

create table if not exists forge_models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  project_id uuid,                 -- opcional: vínculo a projects.id
  project_json jsonb not null,     -- la FUENTE DE VERDAD (mono-forge)
  glb_url text,                    -- visor web + AR Android (Scene Viewer)
  usdz_url text,                   -- AR iOS (Quick Look)
  status text default 'draft',     -- draft | published
  created_at timestamptz default now()
);

alter table forge_models enable row level security;

-- Lectura pública: el visor AR del teléfono entra sin sesión (link por QR).
-- Escritura abierta al anon key: mismo modelo de acceso del resto del prototipo.
drop policy if exists "forge_models_select" on forge_models;
create policy "forge_models_select" on forge_models for select using (true);
drop policy if exists "forge_models_insert" on forge_models;
create policy "forge_models_insert" on forge_models for insert with check (true);
drop policy if exists "forge_models_update" on forge_models;
create policy "forge_models_update" on forge_models for update using (true);
drop policy if exists "forge_models_delete" on forge_models;
create policy "forge_models_delete" on forge_models for delete using (true);

-- Bucket público 'forge' para los assets 3D
insert into storage.buckets (id, name, public)
values ('forge', 'forge', true)
on conflict (id) do nothing;

drop policy if exists "forge_storage_select" on storage.objects;
create policy "forge_storage_select" on storage.objects
  for select using (bucket_id = 'forge');
drop policy if exists "forge_storage_insert" on storage.objects;
create policy "forge_storage_insert" on storage.objects
  for insert with check (bucket_id = 'forge');
drop policy if exists "forge_storage_update" on storage.objects;
create policy "forge_storage_update" on storage.objects
  for update using (bucket_id = 'forge');
drop policy if exists "forge_storage_delete" on storage.objects;
create policy "forge_storage_delete" on storage.objects
  for delete using (bucket_id = 'forge');
