# Agente cotizador con Hermes — análisis y plan

Objetivo: cotizar por chat. Le paso los datos por Discord (o WhatsApp), el
agente me hace las preguntas que hoy lleno a mano en el formulario, me
devuelve el PDF de la cotización, y con un comando la manda por correo.

Este documento es el análisis previo a construirlo: qué se reusa, qué hay que
extraer, qué decisiones faltan y qué hace falta de parte de Julio.

## Lo único que estaba en duda, y ya se probó

Hoy el PDF de cotización **se genera dentro del navegador**:
`pages/Quotes.tsx` → `createPdfBlob()` hace `fetch('/TEMPLATE Mono Atelier (1).pdf')`
y dibuja con pdf-lib en coordenadas fijas. Un agente que contesta por Discord o
WhatsApp no tiene navegador, así que todo el proyecto dependía de si ese mismo
PDF se puede producir sin uno.

**Sí se puede.** Probado en este repo con la plantilla real (3 páginas, carta
612×792): pdf-lib carga la plantilla desde el disco, dibuja y guarda un PDF
válido. Verificado además con `pdftotext` (herramienta independiente) y
renderizando la página: el texto queda dibujado sobre la plantilla, no es un
PDF vacío.

La única diferencia entre navegador y servidor es **cómo se lee la plantilla**:
`fetch()` allá, `readFileSync()` acá. Nada más.

## El riesgo real del proyecto: dos implementaciones que se separan

No es el modelo ni el chat. Es que hoy **dos cosas críticas viven dentro del
componente de React**, mezcladas con el estado de la UI:

1. **El cálculo del precio** (`pages/Quotes.tsx`, ~líneas 312–360): la
   separación `sustitucion` / `adicional` / `opcion`, el `cantidadDe()` que
   decide si un adicional va por la misma cantidad que el servicio, y que cada
   adicional sea su propia partida.
2. **El dibujo del PDF** (`createPdfBlob`): coordenadas, paginación a los 7
   renglones, IVA leído de `ajustes`.

Si el agente reimplementa cualquiera de las dos, se separan con el tiempo. Y
concretamente: el agente reintroduciría el defecto que ya costó dinero —tratar
un adicional como sustitución hacía que elegir "Cascada $2,000" en una cocina
de $2,850/ml **bajara** el precio a $2,000/ml.

Por eso el primer trabajo no es el agente, es **extraer esas dos piezas a
módulos compartidos sin dependencias del DOM**:

```
lib/cotizador.ts       precio desde la master list (services/service_variables)
lib/cotizacionPdf.ts   el PDF, recibiendo los bytes de la plantilla como parámetro
```

La plataforma sigue usándolas igual que hoy; el agente usa **las mismas**. Una
implementación, dos puertas de entrada. Sin esto, el agente es una copia que
diverge.

## Arquitectura

```
Discord  ──┐
           ├─→  adaptador de transporte  ─→  agente (Hermes)
WhatsApp ──┘                                     │
                                                 │ las herramientas NO calculan precios
                                                 ▼
                                    lib/cotizador.ts  ←─ master list
                                    lib/cotizacionPdf.ts
                                                 │
                                    Supabase (quotes)  +  Resend
```

**La regla, igual que en mono-forge:** el modelo decide *qué* preguntar y cómo
interpretar lo que contesto. El sistema decide *cuánto cuesta*. El modelo nunca
escribe un precio; llama a una herramienta que lo saca de la master list. Un
modelo más débil puede entender mal una frase — nunca puede inventar un precio.

### Herramientas del agente

| Herramienta | Qué hace |
|---|---|
| `ver_catalogo(busqueda)` | Servicios y variantes de la master list, con su `kind` |
| `iniciar_cotizacion(cliente, proyecto)` | Abre el borrador; busca el cliente en `clients` |
| `agregar_partida(servicio, cantidad, variante, adicionales[])` | Precio calculado por `lib/cotizador.ts` |
| `quitar_partida(n)` / `ver_borrador()` | Corregir sin empezar de cero |
| `cerrar_cotizacion(tiempo_entrega, notas)` | Guarda en `quotes` (`api.createQuote`) y genera el PDF |
| `enviar_por_correo(destinatario)` | Resend, con el PDF adjunto |

El formulario que hay que llenar es corto y acotado —`projectName`,
`clientName`, `deliveryTime`, `date`, `items[]`, `notes`— así que la entrevista
tiene fin. Eso juega a favor: no hace falta un modelo enorme.

## Sobre Hermes

Hermes 4 (Nous Research) es open-weights y se sirve por endpoints
**OpenAI-compatible**, que es exactamente lo que `forge_agent/proveedores.py`
ya habla. Tres caminos:

| Acceso | Endpoint | Nota |
|---|---|---|
| Nous Portal | `https://inference-api.nousresearch.com/v1` | directo del creador |
| OpenRouter | `https://openrouter.ai/api/v1` | ids tipo `nousresearch/hermes-4-70b` |
| Propio (vLLM) | `http://localhost:8000/v1` | requiere `--tool-call-parser hermes --enable-auto-tool-choice` |

**Lo que ya está hecho:** el trabajo de la capa de proveedores para NVIDIA sirve
tal cual. Hermes entra con `FORGE_PROVEEDOR=openai_compat` más `FORGE_BASE_URL`
y `FORGE_MODEL`. No hay que escribir un backend nuevo.

**Lo que no puedo darte por hecho:** que Hermes sostenga una entrevista de
~15 turnos encadenando herramientas sin perder el hilo. La ficha dice que
soporta function calling; sostenerlo multi-turno es otra cosa. Ya existe el
probador para eso, y aplica igual:

```powershell
$env:FORGE_PROVEEDOR = "openai_compat"
$env:FORGE_BASE_URL  = "https://inference-api.nousresearch.com/v1"
python -m forge_agent.probar_modelo <id-de-hermes>
```

Pruébalo antes de construir encima. Es la misma doctrina que ya está escrita en
`docs/PROVEEDORES.md`: pruébalo, no lo adivines.

## Discord o WhatsApp — no cuestan lo mismo

Esta es la decisión que más cambia el trabajo, y la diferencia no es de
programación:

**Discord** — el bot se conecta **hacia afuera** por WebSocket. Corre en la PC
del taller **sin necesidad de URL pública**, igual que el worker de Forge.
Token de bot, gratis, funciona hoy. Manda archivos (el PDF) sin ceremonia.

**WhatsApp** — API de Meta. Necesita cuenta de Meta Business, negocio
verificado, un número dedicado (no el personal), app aprobada y **plantillas de
mensaje aprobadas por Meta** para iniciar conversación. Además exige un
**webhook público por HTTPS**: la PC del taller no sirve sin un túnel
(cloudflared/ngrok) o sin poner una función en Vercel que reciba y encole en
Supabase. Y se cobra por conversación.

**Recomendación:** Discord primero, con el transporte detrás de una interfaz.
Toda la lógica —entrevista, precios, PDF, Resend— es independiente del
transporte, así que WhatsApp después es conectar un adaptador, no rehacer.

Si WhatsApp es obligatorio desde el día uno, la ruta limpia es: función en
Vercel recibe el webhook → encola en Supabase → el worker del taller procesa.
Es el mismo patrón que ya usa Forge (la plataforma encola, el worker trabaja) y
evita exponer la PC.

## Resend

Directo, pero depende de DNS: para enviar desde `cotizaciones@monoatelier.com`
hay que **verificar el dominio** agregando registros SPF y DKIM. Sin eso solo se
puede enviar a la dirección propia verificada. El envío lo hace el worker con el
PDF adjunto.

## Qué necesito de tu lado

1. **Hermes: cuál acceso.** ¿Nous Portal, OpenRouter, o servido por ti? Y el id
   exacto del modelo. La llave va por variable de entorno, nunca en el código.
2. **Discord o WhatsApp primero.** Si Discord: crear la app en
   `discord.com/developers`, invitar el bot a tu servidor y pasarme el token por
   variable de entorno. Si WhatsApp: en qué punto estás con Meta Business.
3. **Resend:** API key y si controlas el DNS del dominio desde el que quieres
   enviar.
4. **Dónde corre el agente.** ¿La PC del taller (como el worker de Forge) o algo
   siempre encendido? Con Discord la PC basta; con WhatsApp no.
5. **El precio del cuarzo, que sigue sin resolverse.** "Cubierta Cuarzo"
   (Cocina) = $1,450 contra "Cuarzo Estandar" (Cubierta de Cocina) = $3,500.
   Hoy lo resuelves tú al cotizar a mano. **Un agente no puede**: va a tomar el
   que encuentre y cotizar mal sin decir nada. Esto pasó de ser un pendiente a
   ser un bloqueante.
6. **¿La cotización por chat debe poder crear cliente nuevo**, o solo cotizar a
   clientes que ya están en la plataforma? Cambia cuántas preguntas hace.

## Orden propuesto

| Fase | Qué | Depende de |
|---|---|---|
| 1 | Extraer `lib/cotizador.ts` y `lib/cotizacionPdf.ts`; la plataforma sigue igual | nada — se puede empezar ya |
| 2 | Herramientas del agente sobre esos módulos, probadas sin chat | fase 1 |
| 3 | Bucle con Hermes + `probar_modelo` | llave y id del modelo |
| 4 | Adaptador de Discord | token del bot |
| 5 | Resend | API key + DNS |
| 6 | WhatsApp | cuenta de Meta Business |

La fase 1 es la que de verdad importa y no depende de ninguna respuesta tuya:
mientras el precio y el PDF vivan dentro de un componente de React, cualquier
agente que hagamos es una copia que se va a separar de la plataforma.
