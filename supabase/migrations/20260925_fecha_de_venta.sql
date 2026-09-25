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
  add column if not exists sold_at date;

-- quote_id tiene que ser DEL MISMO TIPO que quotes.id, y ese tipo no está en
-- ninguna migración de este repo: las tablas quotes y projects se crearon
-- fuera. Escribirlo a mano es adivinar —la primera versión puso uuid y la
-- columna real es bigint, así que la migración entera reventó— de modo que se
-- pregunta al catálogo. Así funciona tanto si es bigint como si es uuid, y
-- sigue funcionando si algún día se migra de uno a otro.
do $$
declare tipo text;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'projects'
                and column_name = 'quote_id') then
    return;   -- ya está puesta
  end if;

  -- to_regclass y no 'public.quotes'::regclass: el cast revienta con un error
  -- de Postgres si la tabla no existe, antes de poder explicar qué pasa.
  if to_regclass('public.quotes') is null then
    raise exception 'No existe public.quotes: esta migración va después de la tabla de cotizaciones.';
  end if;

  select format_type(a.atttypid, a.atttypmod) into tipo
    from pg_attribute a
   where a.attrelid = to_regclass('public.quotes')
     and a.attname = 'id' and a.attnum > 0 and not a.attisdropped;

  if tipo is null then
    raise exception 'public.quotes no tiene columna id.';
  end if;

  execute format('alter table public.projects add column quote_id %s', tipo);
  execute 'alter table public.projects
             add constraint projects_quote_id_fkey
             foreign key (quote_id) references public.quotes(id) on delete set null';
end $$;

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
