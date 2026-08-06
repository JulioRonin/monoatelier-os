"""project.json → renders del estilo Mono Atelier.

    blender --background --python blender/render.py -- projects/x/project.json
    blender --background --python blender/render.py -- projects/x/project.json \
            --escena noche --vistas frontal_34,detalle --muestras 256

Construye la geometría desde el JSON (mismo camino que build_from_json: las
medidas y posiciones nunca se tocan aquí), monta la escena y las luces del
manifiesto de estilo, sustituye los materiales planos por los procedurales y
renderiza a projects/x/deliverables/renders/.

Esos PNG los recoge automáticamente entrega.pdf al regenerar los documentos.
"""

import os
import sys

try:
    import bpy
except ImportError:
    bpy = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_from_json as constructor   # noqa: E402
import render_presets as presets        # noqa: E402


def _args():
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def _opt(a: list[str], flag: str, default: str) -> str:
    return a[a.index(flag) + 1] if flag in a and a.index(flag) + 1 < len(a) else default


def main() -> None:
    a = _args()
    if not a:
        print(__doc__)
        return
    ruta = a[0]
    escena = _opt(a, "--escena", "cocina")
    vistas = [v.strip() for v in
              _opt(a, "--vistas", ",".join(presets.VISTAS_ENTREGA)).split(",") if v.strip()]
    muestras = int(_opt(a, "--muestras", "128"))
    ancho, _, alto = _opt(a, "--res", "1920x1080").partition("x")
    salida_dir = _opt(a, "--salida", "")

    if escena not in presets.ESCENAS:
        print(f"ERROR: escena '{escena}'. Disponibles: {', '.join(presets.ESCENAS)}")
        return
    malas = [v for v in vistas if v not in presets.VISTAS]
    if malas:
        print(f"ERROR: vistas desconocidas {malas}. "
              f"Disponibles: {', '.join(presets.VISTAS)}")
        return

    import json
    with open(ruta, encoding="utf-8") as f:
        data = json.load(f)

    try:
        bbox = presets.bbox_de(data)
    except ValueError as e:
        print(f"ERROR: {e}")
        return
    print(f"Proyecto «{data.get('nombre','?')}» — "
          f"{bbox['ancho']*1000:.0f}×{bbox['alto']*1000:.0f}×{bbox['fondo']*1000:.0f}mm")

    constructor.construir(data)
    presets.configurar(escena=escena, muestras=muestras,
                       res=(int(ancho), int(alto or 1080)))
    presets.montar_escena(escena, bbox, data)
    n = presets.materiales_render()
    print(f"  · escena «{escena}», {n} material(es) de render, {muestras} muestras")

    destino = salida_dir or os.path.join(os.path.dirname(os.path.abspath(ruta)),
                                         "deliverables", "renders")
    os.makedirs(destino, exist_ok=True)
    for vista in vistas:
        ruta_png = os.path.join(destino, f"{vista}.png")
        print(f"  · renderizando {vista}…")
        presets.renderizar(vista, ruta_png, bbox)
        print(f"    ✓ {ruta_png}")

    print(f"\nOK → {destino}")
    print("Regenera los documentos para que entrega.pdf incluya los renders:")
    print(f"  python -m mono_forge.docs {os.path.dirname(os.path.abspath(ruta))}")


if bpy and __name__ == "__main__":
    main()
