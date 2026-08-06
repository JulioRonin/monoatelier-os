"""CLI:  python -m mono_forge.cli BASE-600 [SUP-750 ...] [--out projects/x] [--cliente N]

Sin --out imprime el cutlist en consola. Con --out crea el directorio del
proyecto y escribe project.json CON colocación 3D — listo para Blender
(blender/build_from_json.py) y para el visor web/AR de la plataforma.
"""

from __future__ import annotations

import os
import sys

from .cutlist import imprimir
from .models import Project
from .presets import PRESETS, desde_preset
from .rules.posicion import colocar


def main(argv: list[str]) -> int:
    args = argv[1:]
    out = None
    cliente = "DEMO"
    presets: list[str] = []
    i = 0
    while i < len(args):
        if args[i] == "--out" and i + 1 < len(args):
            out = args[i + 1]
            i += 2
        elif args[i] == "--cliente" and i + 1 < len(args):
            cliente = args[i + 1]
            i += 2
        else:
            presets.append(args[i])
            i += 1

    if not presets:
        print("uso: python -m mono_forge.cli <PRESET> [PRESET...] "
              "[--out projects/x] [--cliente NOMBRE]")
        print("presets:", ", ".join(PRESETS))
        return 1

    p = Project(cliente=cliente, nombre=" + ".join(presets))
    for i, nombre in enumerate(presets, start=1):
        p.modules.append(desde_preset(nombre, id=f"M{i:02d}"))

    resumen = colocar(p)
    if resumen["sin_regla"]:
        print("AVISO — paneles sin regla de colocación:",
              ", ".join(resumen["sin_regla"]))

    imprimir(p)

    if out:
        os.makedirs(out, exist_ok=True)
        ruta = os.path.join(out, "project.json")
        p.to_json(ruta)
        print(f"\nproject.json escrito en {ruta} "
              f"({resumen['colocados']} colocaciones 3D).")
        print("Siguiente paso (Blender headless):")
        print(f"  blender --background --python blender/build_from_json.py -- {ruta}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
