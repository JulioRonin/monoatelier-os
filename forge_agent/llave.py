"""Guardar la llave de Anthropic en el .env.local del repo, verificada.

    python -m forge_agent.llave

Pides la llave, la pegas, y queda escrita en el archivo correcto con su propio
renglón, después de confirmar con Anthropic que la acepta. Editar el archivo a
mano falló de varias formas: la pestaña del Bloc de notas sin guardar, el
archivo guardado en otra carpeta, la línea pegada al renglón anterior.
"""

from __future__ import annotations

import getpass
import os
import sys

from . import RAIZ, _limpio, leer_texto

CLAVE = "ANTHROPIC_API_KEY"


def guardar_llave(llave: str, ruta: str | None = None) -> str:
    """Escribe CLAVE=llave en su propio renglón y conserva todo lo demás.

    Se reescribe en UTF-8, que es lo que espera Vite al leer el mismo archivo.
    """
    ruta = ruta or os.path.join(RAIZ, ".env.local")
    lineas = [l for l in (leer_texto(ruta) or "").splitlines()
              if l.split("=", 1)[0].strip() != CLAVE]
    while lineas and not lineas[-1].strip():
        lineas.pop()
    lineas.append(f"{CLAVE}={llave}")
    with open(ruta, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lineas) + "\n")
    return ruta


def _verificar(llave: str) -> str | None:
    """None si Anthropic la acepta; si no, el motivo. No gasta tokens."""
    import anthropic
    modelo = os.environ.get("FORGE_MODELO_LECTURA") or "claude-opus-5-5"
    try:
        anthropic.Anthropic(api_key=llave).models.retrieve(modelo)
    except anthropic.AuthenticationError:
        return "Anthropic la rechazó: no es una llave válida (¿revocada o incompleta?)."
    except anthropic.NotFoundError:
        return None                     # la llave sirve; el modelo es otro tema
    except anthropic.APIConnectionError:
        return "sin conexión"
    return None


def main(argv: list[str]) -> int:
    print(f"\nSe guardará en {os.path.join(RAIZ, '.env.local')}")
    if len(argv) > 1:
        crudo = argv[1]
    else:
        print("Copia tu llave en console.anthropic.com → API keys (empieza con")
        print("sk-ant-api03-). Pégala aquí y da Enter. Por seguridad NO se ve")
        print("mientras la pegas: es normal que parezca que no pasó nada.")
        crudo = getpass.getpass("Llave: ")
    llave = _limpio(crudo)

    if not llave:
        print("No pegaste nada. Vuelve a correr el comando.")
        return 1
    if "..." in llave or not llave.startswith("sk-ant-"):
        print(f"Eso no parece una llave de Anthropic (empieza con «{llave[:7]}»). "
              "Debe empezar con sk-ant-api03-.")
        return 1
    if len(llave) < 90:
        print(f"La llave mide {len(llave)} caracteres; una completa mide ~108. "
              "Parece que se cortó al copiarla.")
        return 1

    motivo = _verificar(llave)
    if motivo and motivo != "sin conexión":
        print(motivo)
        print("No la guardé. Crea una nueva en console.anthropic.com y vuelve a intentar.")
        return 1

    ruta = guardar_llave(llave)
    print(f"✓ Guardada: {llave[:12]}…{llave[-4:]} ({len(llave)} caracteres)")
    if motivo == "sin conexión":
        print("  (no pude verificarla con Anthropic por falta de conexión)")
    else:
        print("  Anthropic la aceptó.")
    print(f"  en {ruta}")
    print("\nSiguiente:  python -m forge_agent.doctor")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
