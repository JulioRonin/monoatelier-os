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

## Instalación

```bash
npm install
npm run build:agente
```

Deja compilado `agente-cotizador/dist/agente-cotizador/servidor.js`. Hay que
volver a correrlo cada vez que cambie el código.

## Configuración en Hermes

En `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  mono_cotizador:
    command: "node"
    args: ["/ruta/a/monoatelier-os/agente-cotizador/dist/agente-cotizador/servidor.js"]
    env:
      SUPABASE_URL: "https://xxxxx.supabase.co"
      SUPABASE_KEY: "***"
      COTIZADOR_PLANTILLA: "/ruta/a/monoatelier-os/public/TEMPLATE Mono Atelier  (1).pdf"
      COTIZADOR_SALIDA: "/ruta/donde/guardar/cotizaciones"
```

Hermes las registra como `mcp_mono_cotizador_ver_catalogo`, etc.

Las llaves van **sólo** en ese archivo, nunca en el código ni en el repositorio.

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
