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
| `agregar_partida` | Agrega un servicio. Tres rutas de precio: de lista, desde costo con margen, o dictado |
| `ver_borrador` | Partidas y totales, **para pedir aprobación** |
| `quitar_partida` | Corregir sin empezar de cero |
| `cerrar_cotizacion` | Guarda en la plataforma y genera el PDF |

El PDF **sólo se genera al cerrar**, después de que apruebes los totales.

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
