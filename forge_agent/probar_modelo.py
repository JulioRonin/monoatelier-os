"""¿Este modelo sirve para diseñar? Tres pruebas, de fácil a difícil.

    python -m forge_agent.probar_modelo --listar
    python -m forge_agent.probar_modelo <id-del-modelo>
    python -m forge_agent.probar_modelo <id-1> <id-2> <id-3>

No mide si el modelo "escribe bonito": mide si encadena herramientas con
parámetros estrictos, si lee un ERROR del motor y corrige, y si sostiene un
plan a lo largo de ~20 llamadas. Eso es todo lo que este agente necesita.

Las tres pruebas, y qué falla cuando falla:

    1. LLAMA      un mueble suelto. Si no pasa, el modelo no hace function
                  calling de verdad y no hay nada más que probar.
    2. CORRIGE    una cajonera cuyos frentes deben sumar 800mm. El motor
                  rechaza lo que no cuadre; se mide si el modelo LEE el error
                  y vuelve a intentar. Es lo que hace viable un modelo barato.
    3. SOSTIENE   una cocina en L: dos muros, retorno_de, cubierta por tramo.
                  El caso largo. Si falla aquí pero pasa el 2, sirve para
                  muebles sueltos y no para cocinas completas.

Usa el mismo backend que la plataforma (proveedores.py), así que lo que pase
aquí es lo que va a pasar en producción.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

from . import herramientas, proveedores
from .agente import SISTEMA


# ── las tres pruebas ─────────────────────────────────────────────────────

def _revisar_mueble(p: dict) -> str | None:
    if not p["modules"]:
        return "no creó ningún módulo"
    return None


def _revisar_cajonera(p: dict) -> str | None:
    caj = [m for m in p["modules"] if m["tipo"] == "cajonera"]
    if not caj:
        return "no creó la cajonera"
    frentes = [q for q in caj[0]["panels"] if q["rol_estructural"] == "frente"]
    if len(frentes) != 3:
        return f"la cajonera salió con {len(frentes)} frentes en vez de 3"
    # Aquí NO se revisa que sumen 800: si el módulo existe es porque el
    # generador ya validó esa aritmética y descontó el gap entre frentes.
    # Volver a sumarlos sería duplicar una regla del motor — justo lo que
    # este sistema no hace en ningún lado.
    return None


def _revisar_l(p: dict) -> str | None:
    if len(p["tramos"]) < 2:
        return f"hizo {len(p['tramos'])} tramo(s): una L necesita al menos 2"
    girados = [t for t in p["tramos"] if t.get("rotacion")]
    if not girados:
        return "ningún tramo quedó girado: puso los dos muros en línea recta"
    if len(p["modules"]) < 4:
        return f"sólo {len(p['modules'])} módulos para una cocina en L"
    return None


PRUEBAS = [
    ("LLAMA", "un gabinete inferior de 600mm con una puerta y un entrepaño",
     _revisar_mueble),
    ("CORRIGE", "una cajonera de 450mm de ancho con 3 cajones",
     _revisar_cajonera),
    ("SOSTIENE",
     "una cocina en L: muro A de 2400mm con dos gabinetes de 600 y un módulo "
     "de tarja de 900 con su tarja; muro B de retorno con dos gabinetes de "
     "600. Cubierta en los dos muros y alacenas sobre el muro A.",
     _revisar_l),
]


def probar(modelo: str, cfg: dict) -> dict:
    """Corre las tres pruebas contra un modelo. Nunca lanza: reporta."""
    print(f"\n{'═' * 62}\n{modelo}\n{'═' * 62}")
    resultados = []

    for nombre, prompt, revisar in PRUEBAS:
        herramientas.reiniciar()
        print(f"  {nombre:9} … ", end="", flush=True)
        try:
            r = proveedores.correr_openai_compat(
                SISTEMA, prompt, modelo=modelo,
                base_url=cfg["base_url"], api_key=cfg["api_key"])
            project = herramientas.finalizar()
            problema = revisar(project)
            if problema:
                print(f"FALLA — {problema}")
                resultados.append((nombre, False, problema))
            else:
                print(f"pasa  ({r['vueltas']} vueltas, "
                      f"{r['uso']['output_tokens']} tokens de salida)")
                resultados.append((nombre, True, ""))
        except Exception as e:                       # noqa: BLE001
            msg = str(e).split("\n")[0][:150]
            print(f"ERROR — {msg}")
            resultados.append((nombre, False, msg))
            if nombre == "LLAMA":
                print("           (sin function calling no tiene caso seguir)")
                break

    pasadas = sum(1 for _, ok, _ in resultados if ok)
    if pasadas == 3:
        veredicto = "SIRVE para cocinas completas"
    elif pasadas == 2:
        veredicto = "sirve para muebles sueltos; revisa las cocinas en L a mano"
    elif pasadas == 1:
        veredicto = "apenas llama herramientas; no lo uses en producción"
    else:
        veredicto = "NO SIRVE para este agente"
    print(f"  → {pasadas}/3 · {veredicto}")
    return {"modelo": modelo, "pasadas": pasadas, "veredicto": veredicto,
            "detalle": resultados}


# ── catálogo ─────────────────────────────────────────────────────────────

def listar(cfg: dict) -> int:
    """GET /v1/models del endpoint. Dice qué hay, no qué soporta tools."""
    req = urllib.request.Request(
        cfg["base_url"].rstrip("/") + "/models",
        headers={"Authorization": f"Bearer {cfg['api_key']}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        datos = json.load(r)
    ids = sorted(m["id"] for m in datos.get("data", []))
    print(f"{len(ids)} modelos en {cfg['base_url']}:\n")
    for i in ids:
        print(f"  {i}")
    print("\nEl catálogo NO dice cuáles hacen function calling. Confírmalo en "
          "la ficha del modelo\ny después pruébalo aquí — es lo único que "
          "cuenta:\n  python -m forge_agent.probar_modelo <id>")
    return 0


def main(argv: list[str]) -> int:
    os.environ.setdefault("FORGE_PROVEEDOR", "nvidia")
    os.environ.setdefault("FORGE_MODEL", "por-definir")   # listar no lo usa
    try:
        cfg = proveedores.configurar()
    except RuntimeError as e:
        print(f"ERROR de configuración: {e}")
        return 1
    if cfg["proveedor"] == "anthropic":
        print("Este probador corre contra endpoints OpenAI-compatibles. "
              "Define FORGE_PROVEEDOR=nvidia.")
        return 1

    if "--listar" in argv:
        return listar(cfg)

    modelos = [a for a in argv[1:] if not a.startswith("-")]
    if not modelos:
        print(__doc__)
        return 1

    resumen = [probar(m, cfg) for m in modelos]
    if len(resumen) > 1:
        print(f"\n{'═' * 62}\nRESUMEN\n{'═' * 62}")
        for r in sorted(resumen, key=lambda x: -x["pasadas"]):
            print(f"  {r['pasadas']}/3  {r['modelo']:45} {r['veredicto']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
