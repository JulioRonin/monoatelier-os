"""Backends de modelo — el motor y las herramientas NO cambian.

Lo único específico de un proveedor es cómo se corre el bucle de herramientas:

    Anthropic          client.beta.messages.tool_runner  (el SDK corre el bucle)
    OpenAI-compatible  bucle manual sobre chat.completions (NVIDIA NIM, vLLM,
                       Ollama, o cualquier endpoint que hable ese formato)

Las herramientas de herramientas.py son las MISMAS en los dos casos: se
declaran una sola vez con @beta_tool y de ahí se derivan los dos formatos de
esquema. Si un día hay que agregar una herramienta, se agrega una vez.

Por qué esto importa más de lo que parece: el motor deriva TODAS las medidas.
El modelo sólo elige qué módulos poner y con qué anchos. Un modelo más débil
puede equivocarse de distribución — nunca de medida de corte. Por eso un
backend más barato es una decisión razonable aquí y no lo sería en un sistema
donde el modelo escribe las cotas.

Las llaves salen SIEMPRE del entorno. Nunca se escriben en el código.
"""

from __future__ import annotations

import json
import os

from .herramientas import HERRAMIENTAS

#: tope de seguridad del bucle manual. Un diseño normal usa 15–25 llamadas;
#: si se pasa de aquí, el modelo se está ciclando y es mejor cortar.
MAX_VUELTAS = 60

#: endpoint OpenAI-compatible de NVIDIA (build.nvidia.com / NIM alojado)
BASE_URL_NVIDIA = "https://integrate.api.nvidia.com/v1"

_POR_NOMBRE = {t.name: t for t in HERRAMIENTAS}


# ── esquema y ejecución, compartidos por todos los backends ──────────────

def esquema_openai() -> list[dict]:
    """Las mismas herramientas, en el formato de function calling de OpenAI.

    Se derivan del esquema que ya generó @beta_tool a partir de las firmas y
    los docstrings: no hay una segunda definición que se pueda desincronizar.
    """
    return [{"type": "function",
             "function": {"name": t.name,
                          "description": t.description,
                          "parameters": t.input_schema}}
            for t in HERRAMIENTAS]


def ejecutar(nombre: str, argumentos) -> str:
    """Corre una herramienta y devuelve SIEMPRE texto.

    Ningún error sale como excepción: se le devuelve al modelo como
    "ERROR: ..." para que corrija y vuelva a intentar. Una excepción mataría
    el trabajo entero por un parámetro mal escrito.
    """
    t = _POR_NOMBRE.get(nombre)
    if t is None:
        return (f"ERROR: no existe la herramienta '{nombre}'. "
                f"Disponibles: {', '.join(sorted(_POR_NOMBRE))}.")

    if isinstance(argumentos, str):
        try:
            argumentos = json.loads(argumentos or "{}")
        except json.JSONDecodeError as e:
            return (f"ERROR: los argumentos de {nombre} no son JSON válido "
                    f"({e}). Vuelve a llamarla con JSON bien formado.")
    if argumentos is None:
        argumentos = {}
    if not isinstance(argumentos, dict):
        return (f"ERROR: los argumentos de {nombre} deben ser un objeto JSON "
                f"con los nombres de los parámetros.")

    try:
        return str(t.func(**argumentos))
    except TypeError as e:
        return (f"ERROR: parámetros incorrectos para {nombre}: {e}. "
                f"Revisa la descripción de la herramienta.")
    except Exception as e:                      # noqa: BLE001 — al modelo, no al log
        return f"ERROR: {nombre} falló: {e}"


# ── backend OpenAI-compatible (NVIDIA NIM, vLLM, Ollama…) ────────────────

def _mensaje_asistente(msg) -> dict:
    """Serializa el turno del asistente para mandarlo de vuelta en el historial."""
    salida: dict = {"role": "assistant", "content": msg.content or ""}
    llamadas = getattr(msg, "tool_calls", None)
    if llamadas:
        salida["content"] = msg.content or None   # algunos servidores rechazan ""
        salida["tool_calls"] = [
            {"id": c.id, "type": "function",
             "function": {"name": c.function.name,
                          "arguments": c.function.arguments}}
            for c in llamadas]
    return salida


def correr_openai_compat(sistema: str, contexto: str, *, modelo: str,
                         base_url: str, api_key: str) -> dict:
    """Bucle de herramientas contra cualquier endpoint OpenAI-compatible.

    Devuelve {"resumen", "vueltas", "uso"}. El project.json lo cierra quien
    llama, con finalizar(), igual que en el backend de Anthropic.
    """
    try:
        from openai import OpenAI          # perezoso: no es dependencia del core
    except ImportError as e:                # pragma: no cover
        raise RuntimeError(
            "Falta el paquete 'openai' para hablar con un endpoint "
            "OpenAI-compatible. Instálalo con: pip install openai") from e

    cliente = OpenAI(base_url=base_url, api_key=api_key)
    herramientas = esquema_openai()
    mensajes: list[dict] = [{"role": "system", "content": sistema},
                            {"role": "user", "content": contexto}]

    entrada = salida_tok = 0
    textos: list[str] = []

    for vuelta in range(1, MAX_VUELTAS + 1):
        r = cliente.chat.completions.create(
            model=modelo, messages=mensajes,
            tools=herramientas, tool_choice="auto")

        uso = getattr(r, "usage", None)
        if uso:
            entrada += getattr(uso, "prompt_tokens", 0) or 0
            salida_tok += getattr(uso, "completion_tokens", 0) or 0

        msg = r.choices[0].message
        mensajes.append(_mensaje_asistente(msg))
        if msg.content:
            textos.append(msg.content)

        llamadas = getattr(msg, "tool_calls", None)
        if not llamadas:
            return {"resumen": (msg.content or "").strip(),
                    "vueltas": vuelta,
                    "uso": {"input_tokens": entrada, "output_tokens": salida_tok}}

        for c in llamadas:
            mensajes.append({
                "role": "tool", "tool_call_id": c.id,
                "content": ejecutar(c.function.name, c.function.arguments)})

    raise RuntimeError(
        f"El modelo no terminó en {MAX_VUELTAS} vueltas de herramientas: se "
        f"está ciclando. Revisa la bitácora y, si se repite, prueba un modelo "
        f"con mejor function calling.")


# ── resolución de configuración ──────────────────────────────────────────

def configurar(proveedor: str | None = None) -> dict:
    """Resuelve proveedor, modelo, endpoint y llave desde el entorno.

    Variables:
        FORGE_PROVEEDOR   anthropic (default) | nvidia | openai_compat
        FORGE_MODEL       id del modelo
        FORGE_BASE_URL    endpoint OpenAI-compatible (NIM local, vLLM, Ollama)
        ANTHROPIC_API_KEY / NVIDIA_API_KEY / FORGE_API_KEY
    """
    proveedor = (proveedor or os.environ.get("FORGE_PROVEEDOR")
                 or "anthropic").strip().lower()

    if proveedor == "anthropic":
        return {"proveedor": "anthropic",
                "modelo": os.environ.get("FORGE_MODEL", "claude-opus-5"),
                "base_url": None,
                "api_key": os.environ.get("ANTHROPIC_API_KEY")}

    if proveedor == "nvidia":
        llave = os.environ.get("NVIDIA_API_KEY") or os.environ.get("FORGE_API_KEY")
        if not llave:
            raise RuntimeError(
                "Falta NVIDIA_API_KEY en el entorno. Genérala en "
                "build.nvidia.com y expórtala; nunca la escribas en el código.")
        modelo = os.environ.get("FORGE_MODEL")
        if not modelo:
            raise RuntimeError(
                "Falta FORGE_MODEL. En NVIDIA el id va completo, con el "
                "publicador — por ejemplo 'nvidia/llama-3.3-nemotron-super-49b-v1'. "
                "Elige uno que declare function calling / tool use en su ficha de "
                "build.nvidia.com: sin eso este agente no puede funcionar.")
        return {"proveedor": "nvidia", "modelo": modelo,
                "base_url": os.environ.get("FORGE_BASE_URL", BASE_URL_NVIDIA),
                "api_key": llave}

    if proveedor == "openai_compat":
        base = os.environ.get("FORGE_BASE_URL")
        if not base:
            raise RuntimeError(
                "Falta FORGE_BASE_URL: el endpoint OpenAI-compatible "
                "(por ejemplo http://localhost:8000/v1 para un NIM local).")
        return {"proveedor": "openai_compat",
                "modelo": os.environ.get("FORGE_MODEL", "local"),
                "base_url": base,
                # un servidor local suele no pedir llave, pero el cliente la exige
                "api_key": os.environ.get("FORGE_API_KEY", "no-aplica")}

    raise RuntimeError(
        f"Proveedor '{proveedor}' desconocido. Usa: anthropic, nvidia u "
        f"openai_compat.")
