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

Cada cotización se identifica con una **referencia corta** (los primeros ocho
caracteres del id) para poder decir "mándame el PDF de la 7c8d4400". Si la
referencia coincide con más de una, el agente pregunta en vez de adivinar:
mandarle al cliente el PDF equivocado es peor que pedir que lo aclare.

El PDF **sólo se genera al cerrar**, después de que apruebes los totales.

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

1. Que Hermes liste las seis herramientas.
2. Que `ver_catalogo` traiga tus servicios reales (si no, es `SUPABASE_KEY`).
3. Que al cerrar, el PDF quede en `COTIZADOR_SALIDA` y Hermes lo adjunte en el
   chat. El servidor devuelve la ruta; **queda por confirmar si Hermes la
   adjunta solo** o si hay que pedírselo con su propia herramienta de mensajería.

## Probarlo sin Hermes

```bash
node prueba-flujo.mjs     # levanta un Supabase falso con los CSV y cotiza
```

Recorre el flujo completo —catálogo, borrador, las tres rutas de precio, PDF—
sin tocar la base real. Útil para ver si un cambio rompió algo.

## Lo que este servidor NO hace, a propósito

- **No manda correos.** Resend va aparte, cuando haya dominio verificado.
- **No crea clientes.** Cotiza a nombre de quien le digas; dar de alta un
  cliente es un movimiento de la plataforma, no del chat.
- **No corrige precios mal clasificados.** Si una variante marcada como
  sustitución abarata el servicio, lo **avisa** en el catálogo y en el borrador
  (`⚠`), pero no la cambia: eso se decide en la pantalla de Precios.
