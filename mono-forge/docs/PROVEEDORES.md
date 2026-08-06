# Cambiar el proveedor del modelo (NVIDIA en lugar de Anthropic)

El motor no depende del proveedor. `mono-forge` deriva **todas** las medidas a
partir de las reglas del taller; el modelo sólo decide **qué** módulos poner y
con qué anchos. Esa separación es la que hace que el proveedor sea
intercambiable — y es la razón de fondo por la que aquí sí conviene evaluar un
modelo más barato.

## Qué cambia y qué no

| | Cambia con el proveedor |
|---|---|
| Las 13 herramientas de `forge_agent/herramientas.py` | **No.** Se declaran una vez con `@beta_tool` y de ahí salen los dos formatos de esquema |
| Los generadores, las reglas y el cutlist | **No.** Nunca ven al modelo |
| El bucle de herramientas | **Sí.** Anthropic lo corre el SDK (`tool_runner`); en OpenAI-compatible es un bucle manual en `proveedores.py` |
| `thinking` adaptativo y `effort` | **Sí.** Son de Anthropic; en el otro backend no existen |

## Configuración

Todo por variables de entorno. **Ninguna llave se escribe en el código.**

```powershell
# NVIDIA (build.nvidia.com)
$env:FORGE_PROVEEDOR = "nvidia"
$env:NVIDIA_API_KEY  = "nvapi-..."
$env:FORGE_MODEL     = "<id completo del modelo>"

# Un NIM tuyo, vLLM u Ollama corriendo en tu red
$env:FORGE_PROVEEDOR = "openai_compat"
$env:FORGE_BASE_URL  = "http://localhost:8000/v1"
$env:FORGE_MODEL     = "<id local>"

# Anthropic (default si no defines nada)
$env:FORGE_PROVEEDOR = "anthropic"
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

Instala el cliente una vez: `pip install openai` (sólo lo necesitan los
backends OpenAI-compatibles; el de Anthropic no lo usa).

Después, todo igual que siempre:

```powershell
python -m forge_agent.worker --prompt "cocina en L rosa pastel con torre y tarja"
python -m forge_agent.worker            # modo escucha, para la plataforma
```

El worker imprime el modelo activo al arrancar y falla de inmediato si falta
una variable — no a media hora de trabajo.

## El requisito que decide si funciona: function calling

Este agente no escribe prosa: encadena 13 herramientas con parámetros
estrictos, lee los `ERROR: ...` que devuelve el motor y corrige. Eso exige
**function calling multi-turno**, no sólo "soporta tools".

En la ficha del modelo en build.nvidia.com verifica que declare *function
calling* / *tool use*. Un modelo sin eso no falla elegante: no llama a ninguna
herramienta y el agente termina con "no construyó ningún módulo".

Cómo probarlo, en orden:

1. **Un mueble** — *"un gabinete inferior de 600 con puerta"*. Si no llama
   `definir_proyecto` y `agregar_gabinete_base`, el modelo no sirve para esto.
2. **Aritmética** — *"una cajonera de 450 con 3 cajones"*. Los frentes deben
   sumar exactamente 800mm. El motor rechaza lo que no cuadre; lo que se está
   midiendo es si el modelo **lee el error y corrige**.
3. **Una L** — dos muros con `retorno_de`. Es el caso más difícil: exige
   sostener el plan a lo largo de ~20 llamadas.

Si falla en el 2 o el 3, el problema es el modelo, no el motor.

## La red de seguridad

Aunque el modelo se equivoque, hay cosas que **no** puede romper:

- **Las medidas de corte.** Las deriva `mono-forge`. Un lateral de mueble
  inferior mide 785mm porque `900 − 100 − 15 = 785`, no porque el modelo lo
  diga.
- **La aritmética vertical.** Una cajonera cuyos frentes no sumen 800 no se
  crea: la herramienta devuelve ERROR.
- **Los SKUs.** `ver_catalogo` es la única fuente; un SKU inventado no tiene
  precio y sale marcado en el costeo.
- **El cierre del pipeline.** `docs.verificar()` compara el área del cutlist
  contra el área del JSON y cuenta bisagras contra puertas.

Lo que un modelo débil **sí** puede arruinar: la distribución (anchos feos,
la tarja en mal lugar, olvidar un tramo). Eso se ve en el visor 3D antes de
cortar nada — que es exactamente para lo que sirve el visor.

## Qué se pierde saliendo de Anthropic

Honestamente:

- **`thinking` adaptativo y `effort`.** El bucle manual no los tiene. En una
  cocina en L, ese razonamiento es justo lo que sostiene el plan.
- **El `tool_runner` del SDK**, con sus reintentos. El bucle manual de
  `proveedores.py` es más simple: tope de 60 vueltas y corta.
- **Llamadas en paralelo bien manejadas.** Se soportan, pero los modelos
  abiertos las emiten con menos consistencia.

## Una configuración mixta que tiene sentido

No es todo o nada. El proveedor se resuelve por llamada:

```python
from forge_agent.agente import disenar

disenar(prompt, proveedor="nvidia")      # iteración rápida y barata
disenar(prompt, proveedor="anthropic")   # el diseño que sí se va a fabricar
```

Barato mientras el cliente juega con distribuciones; el bueno para el diseño
que se manda al taller. El `project.json` tiene el mismo formato en los dos
casos, así que los entregables no cambian.
