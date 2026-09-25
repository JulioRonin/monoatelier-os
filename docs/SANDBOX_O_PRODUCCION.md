# Cómo saber que estás facturando de verdad

## El problema, con nombre y apellido

La factura **A7**, de $116,272.80 a EMDICO, se timbró en el **sandbox** de
Facturapi. El PDF salió con logo, folio fiscal, sello digital, cadena original
y código QR. **Se ve exactamente igual que una real.** No llegó al SAT, EMDICO
no la puede deducir, y no hubo nada en pantalla que lo dijera.

La causa: la llave de producción se puso en el `.env.local` de la máquina, pero
el despliegue de Vercel seguía sirviendo con la de pruebas.

Un CFDI de sandbox no se distingue mirándolo. La única defensa es que el
sistema lo diga **antes**, y por eso la app ya no depende de que te acuerdes de
revisarlo.

## Las tres señales que ahora tienes

**1. Banner global, en todas las páginas, que no se puede cerrar.**
Si la llave no es de producción, hay una franja ámbar arriba de todo —no sólo
en Facturación— diciendo que lo que timbres no llega al SAT. Incluye el
prefijo de la llave activa (`sk_test_…` / `sk_live_…`) para compararlo de un
vistazo con lo que está puesto en Vercel. Sólo el prefijo: el resto es un
secreto y no tiene por qué salir en una captura de pantalla.

En producción el banner no existe: no estorba cuando todo está bien.

**2. Distintivo en Facturación y en REP/Pagos.**
Verde *Producción — timbra ante el SAT*, ámbar *Sandbox*, rojo *Sin llave*.

**3. Confirmación antes de cada timbrado.**
- En **sandbox**: un aviso que dice de frente que la factura no tiene validez
  fiscal y que el cliente no la puede deducir. Hay que aceptarlo a propósito.
- En **producción**: te muestra cliente, total, número de conceptos y **las
  claves del SAT** que vas a usar, antes de timbrar. Ahí es donde se atrapa una
  ClaveProdServ equivocada, que es lo que costó la A7.

## La trampa de Vercel

Vite **hornea** las variables `VITE_*` en el momento del build; no se leen al
abrir la página. De ahí salen los dos errores más comunes:

- **Cambiaste la llave y no redesplegaste.** El sitio sigue sirviendo el build
  anterior, con la llave anterior. Cambiar la variable no basta: hay que
  volver a construir.
- **La pusiste sólo en `.env.local`.** Ese archivo es de tu máquina y no viaja
  al repositorio ni a Vercel. La llave de producción tiene que estar en
  **Settings → Environment Variables** del proyecto en Vercel.

Y una más, que muerde en silencio: Vercel tiene entornos **separados** —
Production, Preview y Development. Si pones la llave sólo en *Production* y
abres una URL de *Preview* (las que genera cada rama o cada commit), esa
variable no existe ahí. El banner te lo va a decir, pero conviene saberlo:
**revisa en qué entornos está marcada la variable.**

## Verificar en 10 segundos

1. Abre la app y mira arriba: ¿hay franja ámbar? Estás en pruebas.
2. Entra a **Facturación 4.0** y mira el distintivo junto al título.
3. Contrasta con el panel de Facturapi: el switch **TEST / LIVE** de la barra
   lateral. Las facturas de un ambiente **no aparecen** en el otro — por eso la
   A7 no salía en la lista cuando la llave ya era la de producción.

## Verificar una factura ya emitida

La autoridad es el SAT, no la app ni Facturapi:

[verificacfdi.facturaelectronica.sat.gob.mx](https://verificacfdi.facturaelectronica.sat.gob.mx)
— con el folio fiscal, el RFC emisor y el RFC receptor.

Si el SAT no la encuentra, es de sandbox: **no hay que cancelarla**, porque
para el SAT nunca existió. Basta con volver a emitirla en producción. Pedirle
al cliente que "acepte la cancelación" de una factura de pruebas sólo lo manda
a buscar en su buzón algo que no está.

## En tus propios registros

La tabla `invoices` guarda ahora una columna `modo` (`live` / `test`), igual
que `rep_pagos`. Migración: `supabase/migrations/20260902_invoices_modo.sql`.

No se marcó lo ya guardado: sin saber con qué llave salió cada factura vieja,
ponerles una etiqueta en bloque sería inventar. Las de prueba se reconocen en
el panel de Facturapi con el switch TEST/LIVE.
