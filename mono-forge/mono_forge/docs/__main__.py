"""Genera el paquete de entregables de un proyecto.

    python -m mono_forge.docs projects/cocina-perez
    python -m mono_forge.docs projects/x --margen 0.35 --canto-maquina 12 \
                                          --canto-manual 45 --mano-obra 850

Los documentos se escriben en <proyecto>/deliverables/, junto al modelo.blend
y el preview.glb que produce Blender.
"""

from __future__ import annotations

import os
import sys

from ..costing import Tarifas
from ..models import Project
from . import ESPERADOS, generar_todo, verificar


def _num(argv: list[str], flag: str, default: float) -> float:
    if flag in argv:
        try:
            return float(argv[argv.index(flag) + 1])
        except (IndexError, ValueError):
            print(f"AVISO: {flag} sin valor numérico; uso {default}.")
    return default


def main(argv: list[str]) -> int:
    posicionales = []
    i = 1
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            i += 2 if i + 1 < len(argv) and not argv[i + 1].startswith("--") else 1
        else:
            posicionales.append(a)
            i += 1

    if not posicionales:
        print(__doc__)
        return 1

    proyecto_dir = posicionales[0]
    ruta_json = os.path.join(proyecto_dir, "project.json")
    if not os.path.exists(ruta_json):
        ruta_json = proyecto_dir if proyecto_dir.endswith(".json") else ruta_json
    if not os.path.exists(ruta_json):
        print(f"ERROR: no existe {ruta_json}. Genera primero el proyecto:")
        print("  python -m mono_forge.cli BASE-600 --out projects/x")
        return 1

    project = Project.from_json(ruta_json)
    destino = os.path.join(os.path.dirname(os.path.abspath(ruta_json)), "deliverables")

    tarifas = Tarifas(
        canto_maquina_ml=_num(argv, "--canto-maquina", 0.0),
        canto_manual_ml=_num(argv, "--canto-manual", 0.0),
        mano_obra_modulo=_num(argv, "--mano-obra", 0.0),
        margen=_num(argv, "--margen", 0.35),
    )
    ar_url = ""
    if "--ar-url" in argv:
        ar_url = argv[argv.index("--ar-url") + 1]

    print(f"Generando entregables de «{project.nombre}» ({project.cliente})…")
    generados = generar_todo(project, destino, tarifas, ar_url=ar_url)
    for nombre, ruta in generados.items():
        print(f"  ✓ {nombre:<22} {ruta}")

    v = verificar(project, destino)
    print(f"\nVERIFICACIÓN — área JSON {v['area_json_m2']} m² vs cutlist "
          f"{v['area_cutlist_m2']} m²")
    for p in v["problemas"]:
        print(f"  ! {p}")
    if v["faltantes"]:
        print(f"  · faltan del paquete de {len(ESPERADOS)}: "
              f"{', '.join(v['faltantes'])}")
        print("    (modelo.blend y preview.glb los produce Blender:")
        print("     blender --background --python blender/build_from_json.py -- "
              f"{ruta_json})")
    if v["ok"]:
        print("  ✓ paquete completo y consistente.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
