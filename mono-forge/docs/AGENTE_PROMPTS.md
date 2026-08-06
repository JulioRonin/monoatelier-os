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

## Qué hace cada pieza

| Archivo | Qué es |
|---|---|
| `forge_agent/herramientas.py` | Las herramientas que Claude puede llamar: agregar módulos, tramos, LED, consultar el catálogo. Cada una invoca un generador del motor. |
| `forge_agent/agente.py` | El prompt de sistema con las reglas del taller y el ciclo de tool use (modelo `claude-opus-5`). |
| `forge_agent/worker.py` | La cola: toma trabajos, corre el agente, llama a Blender, genera entregables, sube todo. |
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
- **`ANTHROPIC_API_KEY` no definida** → el worker lo dice y sale antes de tomar trabajos.
- **El agente diseñó algo raro** → sé más específico en el prompt (medidas del
  muro, dónde va la tarja, cuántas puertas). Todo lo que no especifiques lo
  decide él y lo anota en las notas del proyecto.
