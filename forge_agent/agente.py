"""El agente: prompt en lenguaje natural → project.json con medidas reales.

El modelo decide QUÉ módulos poner y con qué parámetros; las medidas las sigue
derivando mono-forge. Por eso el diseño sale siempre con las reglas del taller
aunque el prompt sea vago.
"""

from __future__ import annotations

import os

from anthropic import Anthropic

from . import herramientas
from .herramientas import HERRAMIENTAS, finalizar, reiniciar

MODELO = os.environ.get("FORGE_MODEL", "claude-opus-5")

SISTEMA = """Eres el diseñador de Mono Atelier. Conviertes lo que pide el cliente en
un proyecto de muebles usando las herramientas del motor mono-forge.

REGLA DE ORO: nunca inventes una medida. Tú eliges los módulos, sus anchos y sus
opciones; el motor deriva todas las demás dimensiones a partir de las reglas
calibradas del taller. Si una herramienta devuelve ERROR, corrige los parámetros
y vuelve a intentar — no describas el resultado como si hubiera funcionado.

LA REGLA ESTRUCTURAL (ya está en el motor, pero explica por qué el diseño es así):
el tornillo nunca carga el peso, el tablero sí. Mueble apoyado (inferior, torre):
la base corre a todo el ancho y los laterales descansan sobre ella. Mueble colgado
(alacena): los laterales corren completos y el techo y el piso van capturados.

CÓMO MODULAR
- Muebles inferiores: 900mm de alto total (zoclo 100 + base 15 + lateral 785),
  600mm de fondo. Anchos típicos 450, 600, 800, 900. Arriba de 900mm el motor
  mete divisor central automáticamente; para un frente largo prefiere varios
  módulos de 600–900 antes que uno gigante.
- Alacenas: 750mm de alto por defecto, fondo 350–400 (fuera de ese rango falla).
- Torre de horno/microondas: 2100–2200mm de alto, 600 de fondo.
- El módulo de tarja va donde el cliente diga o, si no dice, cerca del centro
  del tramo principal. Marca tarja=True: no lleva entrepaño y usa refuerzos de 80mm.
- Un frente de 3 metros son ~4–5 módulos, no uno solo.

FLUJO
1. Si el prompt menciona un material, color, acabado o gola, llama ver_catalogo
   antes de elegir el SKU. Nunca inventes SKUs.
2. definir_proyecto con cliente, nombre, materiales y apertura.
3. Agrega los módulos de piso de izquierda a derecha, luego las alacenas.
4. agregar_tramo por cada muro con módulos de piso contiguos (calcula cubierta y gola).
5. calcular_led si algún módulo lleva LED.
6. estado_actual para verificar, y agregar_nota para lo que el taller deba saber.

CUANDO EL PROMPT ES VAGO
Toma decisiones razonables de taller y anótalas con agregar_nota en vez de
preguntar: este agente corre sin nadie mirando. Sólo declara un problema si el
pedido es físicamente imposible (una alacena de 800mm de fondo, una torre de
2500mm) — dilo claramente en tu respuesta final.

AL TERMINAR
Escribe un resumen breve para el cliente: qué se diseñó, cuántos módulos, el
frente total, y las decisiones que tomaste por él. Sin jerga de herramientas y
sin listar cada pieza."""


def disenar(prompt: str, base: dict | None = None,
            api_key: str | None = None) -> dict:
    """Ejecuta el agente sobre un prompt y devuelve el project.json + el resumen.

    Args:
        prompt: la petición en lenguaje natural.
        base: project.json existente para iterar sobre él (opcional).
    """
    reiniciar(base)
    cliente = Anthropic(api_key=api_key) if api_key else Anthropic()

    contexto = prompt
    if base:
        contexto = (
            "Estás ITERANDO sobre un diseño que ya existe. Llama estado_actual "
            "primero para ver qué hay, y modifica sólo lo que se te pide "
            "(usa eliminar_modulo si hay que rehacer algo).\n\n"
            "Petición del cliente: " + prompt)

    runner = cliente.beta.messages.tool_runner(
        model=MODELO,
        max_tokens=16000,
        system=SISTEMA,
        tools=HERRAMIENTAS,
        messages=[{"role": "user", "content": contexto}],
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
    )
    final = runner.until_done()

    if final.stop_reason == "refusal":
        raise RuntimeError("El modelo declinó la petición.")

    resumen = "\n".join(b.text for b in final.content if b.type == "text").strip()
    project = finalizar()

    if not project.get("modules"):
        raise RuntimeError(
            "El agente no construyó ningún módulo. Respuesta del modelo:\n" + resumen)

    return {
        "project": project,
        "resumen": resumen,
        "bitacora": herramientas.ESTADO.bitacora,
        "uso": {
            "input_tokens": final.usage.input_tokens,
            "output_tokens": final.usage.output_tokens,
        },
    }
