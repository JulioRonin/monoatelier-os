"""CLI mínima:  python -m mono_forge.cli BASE-600"""

from __future__ import annotations

import sys

from .cutlist import imprimir
from .models import Project
from .presets import PRESETS, desde_preset


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("uso: python -m mono_forge.cli <PRESET> [PRESET...]")
        print("presets:", ", ".join(PRESETS))
        return 1
    p = Project(cliente="DEMO", nombre=" + ".join(argv[1:]))
    for i, nombre in enumerate(argv[1:], start=1):
        p.modules.append(desde_preset(nombre, id=f"M{i:02d}"))
    imprimir(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
