-- El libro de pagos debe distinguir sandbox de producción
--
-- El REP de PRUEBA (llave sk_test) quedó asentado en rep_pagos igual que uno
-- real, así que la factura 46 aparecía "liquidada" con saldo $0.00 y no se
-- podía timbrar el REP de verdad. Un timbrado de sandbox no llega al SAT:
-- no puede descontar saldo del mundo real.
--
-- A partir de aquí cada renglón lleva el modo en que se timbró, y la pantalla
-- sólo suma los pagos del modo activo (lo dice el prefijo de la llave:
-- sk_test_… o sk_live_…).

alter table rep_pagos
  add column if not exists modo text not null default 'live';

do $$ begin
  alter table rep_pagos
    add constraint rep_pagos_modo_chk check (modo in ('live', 'test'));
exception when duplicate_object then null; end $$;

comment on column rep_pagos.modo is
  'live = timbrado real ante el SAT | test = sandbox de Facturapi. Sólo los live descuentan saldo real.';

-- Todo lo asentado ANTES de esta migración salió del sandbox: la llave de
-- producción no existía todavía. Se marca como test para liberar los saldos.
update rep_pagos set modo = 'test';

-- La misma parcialidad puede existir una vez en test y una vez en live
-- (probar primero es exactamente el flujo esperado). Lo que sigue prohibido
-- es repetirla DENTRO del mismo modo.
drop index if exists rep_pagos_parcialidad_idx;
create unique index if not exists rep_pagos_parcialidad_modo_idx
  on rep_pagos (factura_uuid, modo, parcialidad);
