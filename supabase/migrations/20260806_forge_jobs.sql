-- FORGE JOBS: la cola entre la plataforma y el Forge Agent que corre en tu PC.
-- Escribes un prompt en Forge → se encola aquí → el agente local lo toma,
-- diseña con el motor, construye en Blender y publica el resultado.

create table if not exists forge_jobs (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  base_project_json jsonb,          -- diseño previo cuando se está iterando
  base_model_id uuid,               -- forge_models.id del que se parte
  status text not null default 'pending',   -- pending | running | done | error
  result_model_id uuid,             -- forge_models.id generado
  log text,                         -- resumen del agente para el usuario
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists forge_jobs_status_idx on forge_jobs (status, created_at);

create or replace function forge_jobs_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists forge_jobs_touch on forge_jobs;
create trigger forge_jobs_touch before update on forge_jobs
  for each row execute function forge_jobs_touch();

alter table forge_jobs enable row level security;

drop policy if exists "forge_jobs_select" on forge_jobs;
create policy "forge_jobs_select" on forge_jobs for select using (true);
drop policy if exists "forge_jobs_insert" on forge_jobs;
create policy "forge_jobs_insert" on forge_jobs for insert with check (true);
drop policy if exists "forge_jobs_update" on forge_jobs;
create policy "forge_jobs_update" on forge_jobs for update using (true);
drop policy if exists "forge_jobs_delete" on forge_jobs;
create policy "forge_jobs_delete" on forge_jobs for delete using (true);
