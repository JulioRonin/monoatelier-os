# Diseñar por prompts — el Forge Agent

Escribes en la plataforma *"cocina en L de 3.2m, frentes alto brillo blanco,
gola de aluminio, tarja al centro y torre de horno a la derecha"* y sale el
diseño completo: modelo 3D, AR, cutlist, manual de ensamble, cotización y costos.

## Por qué hay un agente local

Blender corre en **tu PC**; la plataforma corre en **la nube**. Una web no puede
hablarle a `localhost`. El Forge Agent es el puente:

```
[Plataforma Forge] ──prompt──► [tabla forge_jobs en Supabase]
       ▲                                    │
       │                                    ▼
 ves el resultado          [Forge Agent — corre en tu PC]
 (3D, AR, documentos)       · Claude traduce el prompt a parámetros del motor
       │                    · mono-forge deriva TODAS las medidas
       └───sube GLB/docs────· Blender construye y exporta
```

**El modelo nunca inventa una medida.** Elige qué módulos poner y con qué
anchos; el motor deriva el resto con las reglas del taller. Por eso un prompt
vago sigue produciendo un diseño ejecutable.

## Instalación (una vez)

1. **API key de Anthropic** — crea una en <https://console.anthropic.com>.

2. **Migraciones** en tu proyecto Supabase (SQL Editor):
   - `supabase/migrations/20260806_forge_models.sql` (tabla + bucket)
   - `supabase/migrations/20260806_forge_jobs.sql` (la cola)

3. **Dependencias**, desde la raíz del repo:

```powershell
cd mono-forge
.venv\Scripts\activate
pip install -e ".[dev]"
pip install anthropic
```

4. **Variables de entorno** (PowerShell, una por línea):

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:SUPABASE_URL      = "https://<tu-proyecto>.supabase.co"
$env:SUPABASE_KEY      = "<service_role key>"
$env:BLENDER_PATH      = "C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"
```

Opcionales — tus tarifas, para que el costeo cierre:

```powershell
$env:FORGE_CANTO_MAQUINA = "12"    # costo por ml de cubrecanto a máquina
$env:FORGE_CANTO_MANUAL  = "45"    # por ml a mano (alto brillo)
$env:FORGE_MANO_OBRA     = "850"   # por módulo
$env:FORGE_MARGEN        = "0.35"  # fracción, no porcentaje
```

Para no re-escribirlas cada vez, guárdalas con `setx` o ponlas en un `.bat`.

## Uso

**Modo escucha** (el normal): déjalo corriendo mientras diseñas.

```powershell
cd C:\Users\ORKA\Documents\monoatelier-os
python -m forge_agent.worker
```

Ahora entra a **Forge** en la plataforma, escribe tu prompt y pulsa *Diseñar*.
Verás el trabajo pasar de *en cola* → *diseñando* → resultado, con el resumen
del agente. El diseño aparece en el listado, listo para ver en 3D y publicar en AR.

**Iterar**: selecciona un diseño existente y escribe el cambio —
*"súbeme la alacena 10cm"*, *"quita la cajonera y pon un mueble de 600"*. El
agente parte del diseño seleccionado en vez de empezar de cero.

**Sin plataforma** (prueba rápida desde la terminal):

```powershell
python -m forge_agent.worker --prompt "cocina de 3m con tarja y torre de horno"
```

Escribe todo en `projects/<id>/` y, si hay Supabase configurado, lo publica.

## Diseñar desde una foto

Muchas referencias de clientes están hechas con IA: se ven bien y mienten
(repisas que flotan, proporciones imposibles, sin escala). Por eso la foto no
va directo a construir: pasa por una **ficha** que tú revisas.

1. En Forge sube la foto con **Referencias** y pulsa **Leer foto**. Puedes
   escribir indicaciones en el cuadro (cliente, altura del plafón, lo que ya
   sepas).
2. Claude lee la foto y deja la ficha: elementos de izquierda a derecha por
   muro, acabados, lo que **no se fabrica** como se ve (con su propuesta) y las
   **medidas estimadas**, cada una con el ancla que usó.
3. Pulsa **Revisar**, corrige las medidas con la cinta en la mano, agrega
   indicaciones y pulsa **Construir diseño**. Lo que apruebas es lo que se
   construye: el constructor recibe la ficha, no la foto.

Qué se puede construir lo decide el código, no el modelo: hoy el motor tiene
generadores de **cocina** y de **closet** (colgado doble, colgado sencillo con
zapatera, entrepaños, cajonera con vitrina y zapatera). Lo que no tenga
generador (una isla, un mueble de TV) se omite y se dice; si nada de la ficha
tiene generador, el botón de construir aparece deshabilitado con el motivo.

Requiere la migración `supabase/migrations/20260928_forge_lectura.sql`.

### Pedirlo desde Discord

El agente del chat (Hermes) tiene tres herramientas que hablan con la misma cola
que la pantalla de Forge: `disenar_mueble`, `estado_diseno` y `construir_diseno`.
Mándale la foto y di *"necesito diseñar este mueble, mide 100 de ancho por 220 de
alto y 50 de fondo"*. Él pone el pedido en la cola; **el Forge Agent tiene que
estar corriendo en tu PC** (`python -m forge_agent.worker`) para que lo tome.

1. Pídelo. Con foto, Forge la **lee** (unos minutos).
2. Pregúntale *"¿ya está?"*: te enseña la ficha y las medidas por confirmar.
3. Contéstale las medidas (él las convierte a milímetros) y dile que lo construya.
4. Pregunta otra vez: te da los enlaces de cotización, manual, cutlist, herrajes
   y el 3D/AR. Los costos internos nunca salen por el chat.

Definición completa en `agente-cotizador/README.md`.

### Claude lee, Nemotron construye

La lectura necesita un modelo que vea imágenes. Nemotron 3 Super sólo recibe
texto, pero construir desde la ficha sólo necesita texto — y ahí están las
15–25 llamadas de herramientas, que es lo caro. La combinación, en el `.env.local` de la raíz del repo (no se sube a git;
ábrelo con `notepad .env.local`; cada valor va completo, sin comillas —
`...` aquí sólo marca dónde va tu llave):

```
ANTHROPIC_API_KEY=sk-ant-api03-...        # lee la foto
FORGE_PROVEEDOR=nvidia                    # construye
NVIDIA_API_KEY=nvapi-...
FORGE_MODEL=nvidia/nemotron-3-super-120b-a12b
```

El worker lee ese archivo solo, y de ahí mismo toma `VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY` que ya usa la plataforma. **El archivo manda**: si
la terminal trae otro valor (un `setx` viejo, un `set` con comillas), se usa
el del archivo y el doctor lo avisa.

Confirma el id exacto con `python -m forge_agent.probar_modelo --listar` y
pásalo por las tres pruebas antes de confiarle una cocina en L:
`python -m forge_agent.probar_modelo nvidia/nemotron-3-super-120b-a12b`.

La lectura usa `claude-opus-5-5`; se cambia con `FORGE_MODELO_LECTURA`. Si
Claude declina una imagen, la API reintenta sola con otro modelo
(`fallbacks: "default"`).

**Probar la lectura desde la terminal**, con la foto tal como te llegó (no
sube ni construye nada; imprime la ficha y lo que recibiría el constructor):

```powershell
python -m forge_agent.worker --leer C:\Users\ORKA\Downloads\vestidor.webp --indicaciones "plafón a 2.45"
```

Formatos: JPG, PNG, WEBP y GIF. Las fotos HEIC del iPhone no se pueden leer;
la plataforma las rechaza al subirlas y dice cómo exportarlas.

## Qué hace cada pieza

| Archivo | Qué es |
|---|---|
| `forge_agent/herramientas.py` | Las herramientas que Claude puede llamar: agregar módulos, tramos, LED, consultar el catálogo. Cada una invoca un generador del motor. |
| `forge_agent/agente.py` | El prompt de sistema con las reglas del taller y el ciclo de tool use (modelo `claude-opus-5-5`). |
| `forge_agent/lectura.py` | Foto → ficha: el esquema, el prompt de lectura, qué se puede construir y las instrucciones para el constructor. |
| `forge_agent/worker.py` | La cola: toma trabajos (lectura o diseño), corre el agente, llama a Blender, genera entregables, sube todo. |
| `forge_agent/test_herramientas.py` | 9 tests que ejercitan la secuencia completa sin llamar a la API. |

## Lo que decide el modelo vs. lo que decide el motor

| Decide el modelo | Deriva el motor |
|---|---|
| Cuántos módulos y de qué ancho | Alto de laterales (785), largo de refuerzos, capturados |
| Dónde va la tarja y la torre | Tipo y cantidad de bisagras, correderas, patas |
| Material y perfil de gola (del catálogo) | Alto de frente según el hueco de la gola |
| Qué módulos llevan LED | Metros de tira, watts, fuente comercial, notas de ruteo |
| Cómo se agrupan los tramos | Cubierta, uniones, desperdicio, nesting con kerf |

## Costos de API

Cada diseño son unas cuantas llamadas al modelo. Un proyecto de cocina típico
ronda los 15–40 mil tokens de entrada y 3–8 mil de salida. Consulta las tarifas
vigentes en <https://platform.claude.com/docs/en/pricing>.

## Problemas frecuentes

- **El trabajo se queda "en cola"** → el Forge Agent no está corriendo, o no ve
  la misma base de datos. Revisa `SUPABASE_URL`/`SUPABASE_KEY` en la terminal del agente.
- **"No se pudo encolar el diseño"** → falta la migración `20260806_forge_jobs.sql`.
- **El diseño sale sin modelo 3D** → `BLENDER_PATH` sin definir. No es grave:
  publica en AR desde la plataforma y el navegador genera el GLB.
- **`ANTHROPIC_API_KEY` no definida** → el worker lo dice al arrancar. Con
  constructor NVIDIA sigue trabajando, pero las lecturas de foto fallan.
- **`No module named 'mono_forge'`** → versiones anteriores lo pedían instalado;
  ahora basta correr desde la raíz del repo.
- **`No module named 'reportlab'` (u otro) aunque pip dice "already
  satisfied"** → tienes dos Python: `pip` instaló en uno y `python` abre el
  otro. Instala con el Python que de verdad usas:
  `python -m pip install -r forge_agent/requirements.txt`. El worker y el
  doctor imprimen la ruta del Python en uso y el comando exacto.
- **"Anthropic rechazó la llave" o "sin ANTHROPIC_API_KEY"** → la llave vive en
  tu PC, no en Vercel (sus variables son para la página web). Guárdala con
  `python -m forge_agent.llave`: la pegas, la verifica con Anthropic y la
  escribe en su propio renglón del `.env.local` (no se ve mientras la pegas). El doctor
  muestra la huella de la llave que ve (`sk-ant-api03…WXYZ`), de dónde la
  tomó, y la verifica sin gastar tokens. La plataforma web no usa ninguna
  llave de Anthropic: no la subas a Vercel.
- **La cola se ve vacía pero en la plataforma hay trabajos** → con las tablas
  protegidas (`20260929_rls_miembros.sql`) el worker necesita la llave de
  servicio: `SUPABASE_KEY=<service_role>` en el `.env.local`, sin `VITE_`.
  El doctor avisa si estás usando la pública.
- **"No se pudo encolar la lectura"** → falta `20260928_forge_lectura.sql`.
- **El agente diseñó algo raro** → sé más específico en el prompt (medidas del
  muro, dónde va la tarja, cuántas puertas). Todo lo que no especifiques lo
  decide él y lo anota en las notas del proyecto.
