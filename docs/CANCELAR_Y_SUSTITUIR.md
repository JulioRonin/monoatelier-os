# Cancelar una factura y emitir la corregida

## Por qué se emitió la A7 con la clave equivocada

El campo de **ClaveProdServ** era una cajita de 20 píxeles, sin etiqueta, con la
descripción escondida en un `title=` — y venía **precargada con `84111506`**,
que es una clave de servicios de facturación. Al agregar un concepto, esa clave
ya estaba puesta; si nadie la tocaba, se timbraba así. Y si el campo se borraba,
el código volvía a ponerla:

```js
product_key: item.productCode || '84111506',   // ← el default silencioso
```

Tres conceptos de mobiliario salieron facturados bajo servicios contables sin
que la pantalla dijera nada. Eso ya no puede pasar:

- La clave **ya no se precarga** y es **obligatoria** (8 dígitos, validados
  antes de timbrar).
- El campo es visible, etiquetado y marcado con asterisco.
- Se sugieren las claves **que tú ya has usado** en tus propias facturas —
  salen de tu historial de Facturapi, no de un catálogo inventado — como
  botones de un clic y como autocompletado.
- Si alguien escribe `84111506`, aparece un aviso de que es la clave de
  servicios de facturación.

## El orden correcto: primero la nueva, después cancelar

Esto importa y es lo que más se hace al revés. Para cancelar con **motivo 01**
(“emitido con errores **con** relación”) el SAT pide el folio fiscal de la
factura que la sustituye — **y esa factura ya tiene que existir**. Si cancelas
primero, te quedas sin poder usar el motivo 01.

El flujo de la pantalla lo impone:

1. En **Mis Facturas**, botón **Sustituir** en la factura mala. Se copian
   cliente y conceptos al formulario; la ClaveProdServ se deja **vacía a
   propósito**, porque es justo lo que hay que corregir.
2. Corriges las claves y timbras. La nueva sale con `relation: '04'`
   (sustitución de los CFDI previos) apuntando al UUID de la vieja.
3. En la pantalla de éxito aparece el segundo paso: **Cancelar A7 (motivo 01)**,
   ya ligada a la nueva. Un clic.

También hay un botón **Cancelar** suelto, con los cuatro motivos del SAT
explicados, para los casos que no son sustitución:

| Motivo | Cuándo |
|---|---|
| **01** | Estaba mal y hay una factura nueva que la sustituye. Pide el UUID de esa nueva. |
| **02** | Estaba mal y **no** se va a volver a facturar. |
| **03** | La operación nunca se llevó a cabo. |
| **04** | Ya quedó incluida en una factura global. |

## Cancelar no es inmediato arriba de $1,000

Este es el punto que más confunde. Cuando la factura pasa de $1,000, el SAT le
pide autorización al receptor: le llega a su **buzón tributario** y tiene
**3 días hábiles** para responder. Si no contesta, se cancela sola (afirmativa
ficta).

Por eso la pantalla dice **“Cancelación en proceso”** y no “Cancelada” mientras
`cancellation_status` sea `pending`. Decir lo contrario sería mentir sobre algo
que el contador va a revisar. Lo práctico: avísale al cliente para que la
acepte y no esperar los tres días.

## Sobre el CFDI relacionado (tipo 04)

Al timbrar la sustituta se manda `relation: '04'` con el UUID de la anterior.
No pude verificar ese nombre de campo contra la documentación de Facturapi
—el proxy de red bloquea su sitio desde el entorno donde se programó esto—, así
que hay una red de seguridad: si el API rechaza la petición **por ese campo**,
se reintenta sin él y la pantalla avisa que la factura se timbró **sin** el
relacionado.

No te quedas sin factura por un campo accesorio, y no se te oculta que faltó.
La liga de sustitución existe de todos modos en la cancelación: el motivo 01
lleva el UUID de la que sustituye, y eso es lo que el SAT registra.

## Qué NO se puede cancelar así

- **Una factura PPD que ya tiene REP.** Primero se cancela el complemento de
  pago, después la factura. La pantalla no lo impide todavía; tenlo presente.
- **Sustituir un REP.** Un complemento de pago no se “vuelve a emitir
  corregido”: se cancela y se timbra el pago otra vez. Por eso los REP tienen
  botón de Cancelar pero no de Sustituir.
