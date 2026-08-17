# Complemento de Pago (REP) — cómo funciona y qué se arregló

El REP es un CFDI **tipo "P"**. No lleva conceptos ni precios: sólo dice
*"de la factura tal, el día tal, se pagó tanto"*. Se relaciona con la factura
original **únicamente por UUID**.

De ahí salen dos cosas que valen la pena tener claras:

- **No importa quién timbró la factura.** Una factura PPD emitida en Fenix Web
  / Mas Facturas puede recibir su REP aquí, porque el complemento sólo carga el
  UUID. No hace falta migrar nada ni retimbrar la factura.
- **Tiene fecha límite.** El REP se presenta a más tardar el **día 5 del mes
  siguiente** al mes en que se recibió el pago.

## Antes de usarlo: correr la migración

```
supabase/migrations/20260817_rep_facturas_externas.sql
```

Crea `facturas_externas` (facturas de otro PAC) y `rep_pagos` (el libro de
pagos). Sin ella, la pestaña de importar y el cálculo del saldo fallan.

## Los tres defectos que se corrigieron

### 1. El error que salía en pantalla

> `Error al timbrar Complemento de Pago: El campo "complements" es requerido.`

El módulo mandaba los pagos en la raíz del cuerpo:

```json
{ "type": "P", "customer": "...", "payments": [ ... ] }
```

Facturapi no los lee ahí. Un CFDI tipo "P" los lleva dentro de `complements`:

```json
{ "type": "P", "customer": "...",
  "complements": [ { "type": "pago",
                     "data": { "payment_form": "03", "date": "...",
                               "currency": "MXN",
                               "related_documents": [ ... ] } } ] }
```

La firma de `facturapiCreatePaymentComplement()` sigue recibiendo `payments`
porque así se lee mejor desde la pantalla; la traducción al formato de la API
pasa dentro de esa función.

### 2. La base gravable estaba mal cuando hay retención

Se calculaba así:

```js
const baseGravable = amountPaid / 1.08;
```

Eso sólo es cierto si el único impuesto es IVA 8% trasladado. La factura 46
tiene además 1.25% de ISR retenido:

```
30,000  base
+ 2,400  IVA 8%
−   375  ISR retenido 1.25%
─────────
 32,025  total

32,025 / 1.08 = 29,652.78   ← base falsa
base real     = 30,000.00
```

Un REP con base 29,652.78 no cuadra contra la factura que dice 30,000.

Ahora los impuestos del pago se **reparten a prorrata de la estructura real de
la factura** (`lib/cfdi.ts` → `repartirImpuestos`). Al REP se le manda la
**base y la tasa**, y Facturapi deriva el importe: así hay un solo redondeo y
no dos que puedan discrepar por un centavo.

Verificado contra la factura 46 real:

| Pago | Base | IVA 8% | ISR ret. 1.25% | Suma |
|---|---|---|---|---|
| 32,025.00 (total) | 30,000.00 | +2,400.00 | −375.00 | 32,025.00 |
| 16,012.50 (mitad) | 15,000.00 | +1,200.00 | −187.50 | 16,012.50 |
| 10,000.00 | 9,367.68 | +749.41 | −117.10 | 9,999.99 |

El último centavo es redondeo inevitable de un monto arbitrario y cae dentro de
la tolerancia. La pantalla sólo marca en rojo un descuadre **mayor a un peso**,
que ya no es redondeo sino un desglose que no corresponde a esa factura.

### 3. El receptor del REP se inventaba

El paso "sincronizar cliente" creaba un cliente nuevo con datos de relleno:

```js
tax_system: '616',        // "Sin obligaciones fiscales"
address: { zip: '06600' } // un CP de la CDMX
```

El receptor del REP debe ser **idéntico** al de la factura original: mismo RFC,
mismo régimen y mismo código postal. Además `POST /customers` siempre crea un
registro nuevo, así que cada timbrado dejaba un cliente duplicado.

Ahora:

- Si la factura salió de Facturapi, se reutiliza **su** cliente. No se adivina
  nada.
- Si es una factura importada, el régimen y el CP salen del XML
  (`RegimenFiscalReceptor` y `DomicilioFiscalReceptor`), y se busca al cliente
  por RFC antes de crearlo.

## Facturas emitidas en otra plataforma

Pestaña **Importar factura externa** → se arrastra el **XML timbrado** (el PDF
no sirve: el UUID hay que leerlo, no transcribirlo).

Del XML se leen UUID, serie, folio, fecha, receptor completo, moneda, subtotal,
total y la estructura de impuestos. Los impuestos se agregan **desde los
conceptos**, no del nodo `Impuestos` de arriba: ahí las retenciones vienen sin
`Base` ni `TasaOCuota`, y sin base no se puede prorratear el pago.

Se rechaza el archivo, con el motivo, cuando:

- no es CFDI 4.0, o no está timbrado (sin UUID no hay nada que relacionar);
- el comprobante no es de Ingreso (un tipo "P" ya *es* un REP);
- la factura es **PUE**: el SAT no acepta complemento sobre una factura que ya
  se declaró pagada al emitirse.

Si `VITE_RFC_EMISOR` está configurada, también avisa cuando el emisor del XML
no eres tú — de una factura que te emitieron el REP lo timbra quien la emitió.

Serie: **el CFDI la trae como opcional y hay facturas que no la tienen** (la 46
es una de ellas). Se registra sin serie, tal cual; no se inventa.

## Parcialidad y saldo anterior ya no se escriben a mano

`rep_pagos` guarda un renglón por REP timbrado. De ahí salen:

```
parcialidad   = parcialidades ya reportadas + 1
saldo anterior = total de la factura − Σ pagos ya reportados
```

Un índice único sobre `(factura_uuid, parcialidad)` impide timbrar dos veces la
misma parcialidad, que es un error fiscal y no una preferencia.

El asiento se hace **antes** de descargar el PDF y el XML: si la descarga
falla, el REP ya está timbrado y el saldo tiene que reflejarlo de todos modos.

## Lo que queda pendiente de confirmar con el contador

La factura 46 lleva **ISR retenido sin IVA retenido**. Para servicios
profesionales prestados por persona física a persona moral, el SAT normalmente
espera las dos retenciones (ISR 10% y 2/3 de IVA), mientras que en RESICO
(régimen 626) aplica la retención de 1.25% de ISR y ninguna de IVA — que es
justo lo que trae la factura. Como el concepto es *"Servicio de diseño y
fabricación de mobiliario"*, cae en la frontera entre servicio y enajenación de
bienes, y de qué lado caiga cambia qué retenciones proceden.

Esto no afecta al REP —el complemento reproduce lo que ya trae la factura— pero
conviene resolverlo antes de emitir más facturas con esa misma estructura.
