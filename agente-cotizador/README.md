# Agente cotizador — servidor MCP para Hermes

Hermes ya resuelve el chat: Discord, WhatsApp, Telegram, la sesión y el modelo.
Lo que no sabe es cuánto cuesta una cocina. Eso vive aquí.

Este servidor MCP expone las herramientas de cotización de Mono Atelier. Hermes
se conecta, las descubre solas y las usa durante la conversación.

```
Discord  ─┐
WhatsApp ─┼──→  HERMES  ──(MCP, stdio)──→  mono-cotizador
Telegram ─┘     transporte · sesión · modelo      │
                                                  ├── lib/cotizador.ts      ← MISMO precio que la plataforma
                                                  ├── lib/cotizacionPdf.ts  ← MISMO PDF que la plataforma
                                                  └── Supabase
```

No hay bot de Discord que mantener, ni bucle de herramientas, ni capa de
proveedor de modelo. Hermes pone todo eso.

## La regla

El modelo decide **qué** preguntar y cómo interpretar la respuesta. El sistema
decide **cuánto cuesta**. Ninguna herramienta acepta un precio inventado por el
modelo; la única forma de poner un precio a mano es `precio_directo`, que es
Julio dictándolo a propósito.

Los precios salen de `lib/cotizador.ts`, **el mismo módulo que usa la
plataforma**. Si este servidor recalculara por su cuenta, el chat y la pantalla
darían números distintos para la misma cocina.

## Las herramientas

| Herramienta | Qué hace |
|---|---|
| `ver_catalogo` | Servicios, precios, unidades y variantes, diciendo cuáles **sustituyen** el precio base y cuáles **se suman** |
| `iniciar_cotizacion` | Abre el borrador (cliente, proyecto, fecha de entrega) |
| `agregar_partida` | Agrega un servicio **del catálogo**. Tres rutas de precio: de lista, desde costo con margen, o dictado |
| `agregar_concepto` | Agrega una partida **fuera de catálogo**: descripción, medidas o cantidad, precio o costo, y notas |
| `guardar_en_catalogo` | Da de alta un concepto en la lista maestra para poder cotizarlo después |
| `ver_borrador` | Partidas y totales, **para pedir aprobación** |
| `quitar_partida` | Corregir sin empezar de cero |
| `cerrar_cotizacion` | Guarda en la plataforma y genera el PDF |

Y para consultar lo ya cotizado:

| Herramienta | Qué hace |
|---|---|
| `listar_cotizaciones` | Las guardadas, de la más reciente a la más vieja. Filtra por cliente o estado |
| `ver_cotizacion` | El detalle de una: partidas y totales |
| `pdf_de_cotizacion` | Vuelve a generar su PDF para reenviarlo, sin modificarla |

Y para la cobranza:

| Herramienta | Qué hace |
|---|---|
| `proyectos_activos` | Qué traes en marcha, cuánto te han pagado y cuánto falta |
| `estado_de_cuenta` | La relación de un cliente: proyectos, abonos, saldo y lo facturado |
| `registrar_pago` | Guarda un nuevo abono recibido: actualiza automáticamente el saldo |

Estas tres **no llevan costo ni margen**, a propósito: un estado de cuenta es
justo lo que uno acaba leyendo con el cliente enfrente. Lo que se cobra y lo
que se debe el cliente ya lo sabe; lo que costó hacerlo, no. Y registrar un
pago es simplemente anotar que el dinero llegó.

Un proyecto **ya entregado que todavía debe sigue apareciendo**: el saldo no se
cierra al entregar la cocina. El saldo sale de la tabla `payments`, sumando
abonos — no de `downpayment`, que es el anticipo pactado y no lo que entró.

Y para pedir diseños a **Forge** (el módulo de diseño de la plataforma, no Autodesk):

| Herramienta | Qué hace |
|---|---|
| `disenar_mueble` | Pone el pedido en la cola de Forge. Con fotos las sube y encola una **lectura**; sin fotos, un diseño directo |
| `estado_diseno` | Cómo va: en cola, trabajando, la **ficha** de una lectura lista, o los documentos y el enlace AR de un diseño terminado |
| `construir_diseno` | Con las medidas que el usuario **confirmó**, manda a construir lo que leyó la foto |

Sin estas tres, el agente no sabe que Forge existe y lo confunde con el de
Autodesk (te pregunta por `.rvt` e `.ifc`). Sus descripciones lo dicen de frente.

Es el mismo camino que la pantalla de Forge:

```
foto en Discord ─ disenar_mueble ─→ cola (forge_jobs) ─→ Forge Agent lee la foto
                                                              │
   el usuario confirma medidas ←─ estado_diseno ←─────── ficha
                │
   construir_diseno ─→ cola ─→ Forge Agent: cutlist, planos, cotización, 3D
                                                              │
                              estado_diseno ←──────── documentos + enlace AR
```

- **La foto la toma de la ruta que Hermes deja en disco.** Cuando el modelo de
  Hermes no ve imágenes, Hermes guarda la foto en su caché y pone su ruta en el
  mensaje; el modelo se la pasa a `disenar_mueble`, que la lee, comprueba que de
  verdad sea una imagen (JPG, PNG, WEBP o GIF, no HEIC) y la sube al bucket
  `forge`. También acepta una URL. Un archivo que no sea imagen no se sube nunca.
- **No se construye con medidas sin confirmar.** Una foto no trae escala y las
  hechas con IA mienten. `construir_diseno` exige TODAS las medidas de la ficha,
  en **milímetros**, y rechaza las que parecen centímetros (`220` → "¿2200?").
  Sólo con `usar_estimadas` (que el usuario pida a propósito) acepta las estimadas.
- **El diseño lo hace el Forge Agent en tu PC**, no el chat. Si un trabajo lleva
  más de 2 minutos en cola, el agente avisa que el worker no está corriendo.
- Un pedido idéntico que ya está en curso no se vuelve a encolar (los modelos
  chicos reintentan las herramientas).
- Para el enlace de 3D/AR de un diseño terminado define en el `.env.local`
  `PLATAFORMA_URL=https://…` (la dirección de la plataforma en Vercel). Los
  costos internos nunca se comparten por aquí.

Y para preguntar por las ventas:

| Herramienta | Qué hace |
|---|---|
| `resumen_ventas` | Cotizado, vendido y facturado mes por mes, con margen y conversión |
| `ventas_por_cliente` | Quién compra más y cuál deja más margen |
| `reporte_ventas` | Lo mismo en PDF, con el formato de la plataforma, para guardar o imprimir |

Estas tres llevan **costos y márgenes**, y las respuestas vienen marcadas como
información interna. El PDF sale sellado `USO INTERNO — NO ENVIAR AL CLIENTE`
en cada página: no impide reenviarlo, pero sí reenviarlo sin darse cuenta.

Cada cotización se identifica con una **referencia corta** (los primeros ocho
caracteres del id) para poder decir "mándame el PDF de la 7c8d4400". Si la
referencia coincide con más de una, el agente pregunta en vez de adivinar:
mandarle al cliente el PDF equivocado es peor que pedir que lo aclare.

El PDF **sólo se genera al cerrar**, después de que apruebes los totales.

### La cotización en curso no se pierde

Hay **un borrador abierto a la vez**, y se guarda en disco
(`cotizaciones/.borrador-abierto.json`) con cada cambio. Antes vivía sólo en la
memoria y cada herramienta lo buscaba por un `sesion` que llenaba el modelo; si
Hermes reconectaba el servidor, o el modelo mandaba otro `sesion` al cerrar,
salía "la sesión se perdió" y el modelo reabría la cotización de cero.

- Sobrevive a que se reinicie el servidor o Hermes.
- Si el modelo vuelve a llamar `iniciar_cotizacion` con el **mismo** cliente y
  proyecto, conserva las partidas; con otros distintos, reemplaza y lo dice.
- Uno de más de 12 horas se descarta: no resucita mañana.
- Consecuencia: si dos personas cotizan a la vez con el mismo bot, se pisarían.

### Por qué las respuestas vienen en bloque de código

Las tablas salen dentro de ``` y con una nota que le pide al agente copiarlas
tal cual. Por dos razones:

- Fuera de un bloque, Discord dibuja el texto con tipografía proporcional y
  las columnas alineadas con espacios quedan chuecas.
- Pedirle al modelo que **redacte** una tabla de cifras es pedirle que la
  reescriba, y un modelo chico la reescribe mal: cambia un número, se salta un
  renglón, o se le va la respuesta entera. Copiar un bloque es la operación
  más simple que se le puede pedir.

Ningún renglón pasa de 76 caracteres, que es lo que entra sin tener que
arrastrar la tabla de lado en el teléfono. Las pruebas lo verifican.

### Cómo llega el PDF al chat

El servidor termina su respuesta con una línea así:

```
MEDIA:C:/Users/ORKA/monoatelier-os/cotizaciones/Cotizacion_EMDICO_Escritorio_1790000000000.pdf
```

y le pide al modelo que la copie **al final de su mensaje**. Hermes reconoce la
etiqueta `MEDIA:` y sube el archivo como adjunto (los PDF son "documentos": botón
de descarga en Discord). Tres detalles que importan:

- **Hace falta la etiqueta.** Antes se pedía la ruta suelta, y esa detección
  está pensada para rutas de Linux: con `C:\Users\…` llegaba el texto de la
  ruta y no el archivo. La etiqueta sí reconoce letras de unidad.
- **Con `/` y no con `\`.** Discord toma la barra invertida como escape y los
  modelos la duplican o se la comen al copiar. Windows abre las dos.
- **Nunca en código.** Si el modelo la pone entre `comillas invertidas` o en un
  bloque de código, Hermes la ignora a propósito y se ve la ruta. Por eso la
  instrucción lo prohíbe.

Si aun así llega la ruta y no el archivo: en Discord el bot necesita el permiso
**Adjuntar archivos** en ese canal (en un mensaje directo no hace falta), y el
archivo tiene que existir en la PC donde corre Hermes.

### Con qué fecha se mide cada cifra

Un proyecto tiene tres fechas distintas y dan tres meses distintos:

| Cifra | Fecha que usa | Qué contesta |
|---|---|---|
| Cotizado | `quotes.date` | cuándo se **ofertó** |
| Vendido | `projects.sold_at` | cuándo **entró la venta** |
| Facturado | `invoices.date` | cuándo se **timbró** |

Una cocina ofertada en septiembre, cerrada en noviembre y que arranca obra en
enero aparecía en septiembre, en noviembre o en enero según la pantalla:
Financials agrupaba por `start_date` y el Dashboard por `due_date`. La venta
entró en noviembre. Por eso la migración `20260925_fecha_de_venta.sql` agrega
`projects.sold_at` —que se llena sola al convertir una cotización en
proyecto— y `projects.quote_id`, que dice de qué cotización salió.

La **conversión** se mide por cohorte: de lo cotizado en un mes, cuánto acabó
cerrándose, aunque se cerrara meses después. Dividir lo vendido entre lo
cotizado del mismo mes compara dos grupos distintos y llega a dar más de 100%.
Necesita `quote_id`, que sólo tienen las cotizaciones convertidas después de
esa migración; antes de eso la columna sale en blanco en vez de en cero.

Lo facturado cuenta **sólo lo timbrado de verdad**: las facturas de sandbox
(`modo = 'test'`) y las canceladas quedan fuera.

Los proyectos **sin fecha de venta** no caen en ningún mes, así que el resumen
los lista aparte en vez de dejarlos desaparecer sin ruido.

### Conceptos fuera de catálogo

Para proyectos específicos que no están en la lista de servicios:

```
agregar_concepto(descripcion="Lambrín de madera en muros de gerencia",
                 cantidad=18, unidad="m²", precio_unitario=1250,
                 notas="Incluye preparación de muro. No incluye instalación eléctrica.")
```

La **unidad se pega a la descripción** (`Lambrín … (m²)`) porque la plantilla
sólo tiene columnas de Descripción, Cantidad, Costo e Importe: no hay dónde
imprimirla aparte, y perderla dejaría "18 ×" sin decir 18 de qué.

Las **notas se acumulan** entre conceptos y se imprimen juntas al pie.

### Medidas en lugar de cantidad

No hay que calcular el área a mano. Se dan las medidas **en metros** y el
servidor saca la cantidad y devuelve la operación:

```
medidas: { largo: 6, alto: 3 }               → 6 × 3 = 18 m²
medidas: { largo: 0.9, alto: 2.1, piezas: 7 } → 0.9 × 2.1 = 1.89 m² × 7 = 13.23 m²
medidas: { largo: 4.5 }                       → 4.5 ml
```

`ancho` y `alto` son la misma dimensión —la segunda— con dos nombres porque un
piso se describe "largo por ancho" y un muro "largo por alto". Mandar los dos
se rechaza en vez de adivinar cuál se quiso decir.

Esta cuenta la hace el sistema y no el modelo **a propósito**: 6 × 3 es trivial
hasta que son 3.4 × 2.85 × 7 piezas, y ese resultado se vuelve dinero.

### Precio: cuatro formas

```
precio_unitario: 1900                              ← lo dictas
costo_directo: 600                                 ← costo, y se aplica el margen
costo_materiales: 420, costo_mano_obra: 180        ← desglosado; se suman
(nada de lo anterior)                              ← te lo pregunta
```

Exige una sola forma y rechaza las combinaciones: elegir precio por alguien más
es justo lo que este servidor no hace.

### Dar de alta lo que se repite

Cuando un concepto libre resulta ser recurrente:

```
guardar_en_catalogo(desde_partida=1, categoria="Carpintería", costo=600)
```

Toma nombre, precio y unidad de esa partida del borrador —separando la unidad
del nombre— y lo registra en `services` con la fecha de revisión sellada. Si ya
hay algo con nombre parecido **avisa en vez de duplicar**: un catálogo con
"Cocina", "Cocinas" y "Cocina minimalista" es el desorden que costó trabajo
limpiar.

### Las tres rutas de precio

```
agregar_partida(servicio="Cocina", cantidad=4,
                adicionales=["Cubierta Cuarzo"])     ← de lista
agregar_partida(servicio="Mueble de madera", cantidad=1,
                costo_directo=6500)                   ← 6500/(1−0.35) = $10,000
agregar_partida(servicio="Closet", cantidad=3,
                precio_directo=2400)                  ← dictado por ti
```

El margen sale de `ajustes.margen_objetivo` y es **sobre precio**:
`precio = costo / (1 − margen)`. Nunca aparece en el PDF del cliente.

## Instalación (Windows, paso a paso)

Todo se corre **dentro de la carpeta del repo**. El error más común es correr
`npm install` en `C:\Users\TuUsuario`, donde no hay `package.json`.

**1. Traer el código.** Si tienes Git:

```cmd
cd C:\Users\ORKA
git clone https://github.com/JulioRonin/monoatelier-os.git
cd monoatelier-os
```

Sin Git: descarga el ZIP desde GitHub (botón verde **Code → Download ZIP**),
descomprímelo y entra a la carpeta con `cd`.

**2. Las llaves, una sola vez.** Crea el archivo `.env.local` en la raíz del
repo con las dos que ya usa la plataforma:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...
```

Están en Supabase → **Project Settings → API**. El agente las lee de ahí, así
no hay que copiarlas al config de Hermes y arriesgarse a que un día queden
distintas en cada lado. Ese archivo **no se sube al repositorio**.

**La llave de servicio.** Con las tablas protegidas (migración
`20260929_rls_miembros.sql`) la llave pública ya no ve nada, y el agente no
falla: contesta que no hay datos. Agrega también, **sin** el prefijo `VITE_`:

```
SUPABASE_KEY=<service_role de Project Settings → API Keys>
```

Sin `VITE_` la plataforma nunca la publica; con `VITE_` quedaría dentro del
sitio, a la vista de cualquiera. El Forge Agent lee la misma línea.
`npm run doctor:agente` te dice cuál estás usando.

**3. Instalar y revisar:**

```cmd
npm install
npm run doctor:agente
```

El doctor compila y revisa la cadena completa: llaves → Supabase → tablas →
catálogo → plantilla → genera un PDF de prueba. Cada línea con ✗ dice qué
hacer. **Termina imprimiendo la ruta exacta** que va en el config de Hermes.

## Configuración en Hermes

En Windows el archivo es `C:\Users\TuUsuario\.hermes\config.yaml`.

```yaml
mcp_servers:
  mono_cotizador:
    command: "node"
    args: ["C:/Users/ORKA/monoatelier-os/agente-cotizador/dist/agente-cotizador/servidor.js"]
```

Usa **diagonales normales** (`/`) aunque sea Windows: en YAML la barra
invertida escapa el siguiente carácter y la ruta queda rota sin avisar.

No hace falta la sección `env` si pusiste el `.env.local` del paso 2. Si
prefieres las llaves aquí:

```yaml
    env:
      SUPABASE_URL: "https://xxxxx.supabase.co"
      SUPABASE_KEY: "***"
```

Hermes registra las herramientas como `mcp_mono_cotizador_ver_catalogo`, etc.

La plantilla del PDF **no se configura**: el servidor la busca solo en
`public/`. Sólo define `COTIZADOR_PLANTILLA` si la mueves de ahí.

## Probarlo en Discord

En el canal donde esté el bot:

1. *"muéstrame el catálogo de cocinas"* → debe listar tus servicios reales
2. *"cotiza 4 metros de cocina con cubierta de cuarzo para EMDICO, entrega el 22 de octubre"*
3. *"enséñame el total"* → revisa los números
4. *"genérala"* → PDF

Si el paso 1 no trae nada, el problema es la llave o la tabla: corre
`npm run doctor:agente`.

## Cada vez que cambie el código

```cmd
git pull
npm run build:agente
```

Hermes lanza el servidor compilado; sin reconstruir sigue usando el anterior.

## Qué verificar la primera vez

1. Que Hermes liste las veinte herramientas.
2. Que `ver_catalogo` traiga tus servicios reales (si no, es `SUPABASE_KEY`).
3. Que al cerrar, el PDF quede en `COTIZADOR_SALIDA` y llegue como adjunto al
   chat. Pídele *"mándame el PDF de la última cotización"* (`pdf_de_cotizacion`)
   y confirma que aparece el archivo y no una ruta. Esa comprobación se hace
   con Hermes de verdad: las pruebas del repo verifican la etiqueta contra su
   expresión regular, no el envío a Discord.

## Probarlo sin Hermes

```bash
node prueba-flujo.mjs     # levanta un Supabase falso con los CSV y cotiza
node prueba-ventas.mjs    # comprueba que cada cifra use su fecha, y el PDF
node prueba-cobranza.mjs  # saldos por proyecto y estado de cuenta por cliente
node prueba-borrador.mjs  # el borrador sobrevive a un reinicio; la línea MEDIA:
node prueba-forge.mjs     # foto → lectura → medidas confirmadas → construcción
```

`prueba-cobranza.mjs` arma el caso que describió Julio: un cliente con
proyectos en marcha sin pagar, otros en marcha ya liquidados y uno entregado
que sigue debiendo. Falla si el entregado desaparece, si el saldo sale de
`downpayment` en vez de los abonos, o si se filtra un costo.

`prueba-ventas.mjs` arma a propósito el caso que se rompía: una cotización de
septiembre, cerrada en noviembre, con arranque de obra en enero. Falla si la
venta cae en un mes que no es noviembre, si una factura de sandbox o cancelada
se cuenta como ingreso, si un proyecto sin fecha de venta desaparece sin aviso,
o si la conversión pasa del 100% por cruzar cohortes.

Recorre el flujo completo —catálogo, borrador, las tres rutas de precio, PDF—
sin tocar la base real. Útil para ver si un cambio rompió algo.

## Lo que este servidor NO hace, a propósito

- **No manda correos.** Resend va aparte, cuando haya dominio verificado.
- **No diseña él mismo.** Forge lo hace en tu PC; el agente sólo pone el pedido
  en la cola y lee cómo va. Hoy Forge construye cocinas y closets abiertos; lo
  demás (puertas de un armario, una isla) lo dice en la ficha como "sin
  generador" o "no se fabrica como en la foto".
- **No crea clientes.** Cotiza a nombre de quien le digas; dar de alta un
  cliente es un movimiento de la plataforma, no del chat.
- **No corrige precios mal clasificados.** Si una variante marcada como
  sustitución abarata el servicio, lo **avisa** en el catálogo y en el borrador
  (`⚠`), pero no la cambia: eso se decide en la pantalla de Precios.
