-- Cada factura guardada dice en qué modo se timbró
--
-- La A7 ($116,272.80, EMDICO) se timbró en el sandbox de Facturapi porque la
-- llave del despliegue seguía siendo la de pruebas. El CFDI se ve idéntico a
-- uno real —PDF, folio fiscal, sello— y no hay nada en el registro guardado
-- que permita distinguirlos después.
--
-- Con esta columna, el historial propio nunca miente: una factura de prueba
-- queda marcada como tal desde que se guarda.

alter table invoices
  add column if not exists modo text not null default 'live';

do $$ begin
  alter table invoices
    add constraint invoices_modo_chk check (modo in ('live', 'test'));
exception when duplicate_object then null; end $$;

comment on column invoices.modo is
  'live = timbrada ante el SAT | test = sandbox de Facturapi, sin validez fiscal.';

-- No se toca lo ya guardado: sin saber con qué llave salió cada una, marcarlas
-- en bloque sería inventar. Las de prueba se reconocen en el panel de
-- Facturapi con el switch TEST/LIVE.
