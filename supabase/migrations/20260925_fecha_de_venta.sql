-- La fecha en que una cotización se convierte en VENTA
--
-- Hoy no existe. Cuando una cotización se asigna a un proyecto, la plataforma
-- copia nombre, cliente y monto a un formulario nuevo y ahí se pierde el hilo:
-- no queda registro de qué cotización originó qué proyecto, ni de cuándo se
-- cerró el trato.
--
-- Por eso cada pantalla mide con una fecha distinta y ninguna responde
-- "¿en qué mes entró esa venta?":
--
--   Financials  agrupa por projects.start_date  (cuándo ARRANCA la obra)
--   Dashboard   agrupa por projects.due_date    (cuándo se ENTREGA)
--   Quotes      tiene quotes.date               (cuándo se OFERTÓ)
--
-- Ninguna de las tres es la fecha de la venta. Una cotización de septiembre
-- que se aprueba en noviembre y arranca en enero aparece en tres meses
-- distintos según a quién se le pregunte.

alter table projects
  add column if not exists quote_id uuid references quotes(id) on delete set null,
  add column if not exists sold_at date;

comment on column projects.quote_id is
  'Cotización que originó este proyecto. Permite rastrear qué se ofertó contra qué se vendió.';
comment on column projects.sold_at is
  'Fecha en que la cotización se convirtió en venta. NO es la fecha de la cotización (eso es ofertar) ni la de inicio de obra (eso es producir). Es la que responde "¿en qué mes entró esta venta?".';

create index if not exists projects_sold_at_idx on projects (sold_at);
create index if not exists projects_quote_idx on projects (quote_id);

-- Relleno para lo que ya existe.
--
-- No se puede saber la fecha real de cierre de los proyectos viejos, así que
-- se usa created_at como aproximación: es cuándo se dio de alta el proyecto,
-- que suele ser el mismo día o muy cerca. Queda anotado en las notas de la
-- migración y no se inventa nada más: los proyectos nuevos sí llevarán la
-- fecha exacta.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'projects' and column_name = 'created_at') then
    update projects
       set sold_at = created_at::date
     where sold_at is null and created_at is not null;
  end if;
end $$;
