"""JSON → geometría Blender + entregables 3D (modelo.blend, preview.glb, preview.usdz).

    blender --background --python blender/build_from_json.py -- projects/x/project.json

Cada panel es un objeto mesh independiente con el mismo nombre que en el JSON
(crítico para vistas explotadas y anotaciones). Las medidas Y LAS POSICIONES
vienen del JSON: la colocación la deriva mono_forge/rules/posicion.py y este
script sólo la lee. NUNCA se modela a ojo ni se miden mallas para obtener cotas.

Salidas en projects/x/deliverables/:
    modelo.blend    → trabajo interno / renders
    preview.glb     → visor web y AR Android (Scene Viewer / WebXR)
    preview.usdz    → AR iOS (Quick Look)   [requiere Blender 4.x con USD]
"""

import json
import os
import sys

try:
    import bpy
except ImportError:  # permite importar el módulo fuera de Blender
    bpy = None

# materials.py vive junto a este script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import materials  # noqa: E402

MM = 0.001


def args():
    argv = sys.argv
    if "--" in argv:
        return argv[argv.index("--") + 1:]
    return []


def preparar_escena():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    # 1 unidad de Blender = 1 METRO. Las posiciones ya vienen convertidas
    # (x * MM), así que un panel de 600mm mide 0.6 unidades = 0.6 m.
    # Poner scale_length = 0.001 aquí haría que ese panel midiera 0.6 mm y el
    # GLB saldría 1000× pequeño en AR. length_unit sólo cambia cómo se MUESTRA.
    s.unit_settings.scale_length = 1.0
    s.unit_settings.length_unit = "MILLIMETERS"


def crear_caja(nombre, sx, sy, sz, x, y, z, material_sku):
    """Caja alineada a ejes: centro (x,y,z) y extensión (sx,sy,sz), en mm."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x * MM, y * MM, z * MM))
    ob = bpy.context.active_object
    ob.name = nombre
    ob.scale = (sx * MM, sy * MM, sz * MM)
    mat = materials.obtener(material_sku)
    if mat is not None:
        ob.data.materials.append(mat)
    return ob


def _panels_de(contenedor):
    for p in contenedor.get("panels", []):
        yield p


def construir(data):
    preparar_escena()
    sin_colocacion = []

    contenedores = ([(m["id"], m) for m in data.get("modules", [])] +
                    [(t["id"], t) for t in data.get("tramos", [])])

    for cid, cont in contenedores:
        col = bpy.data.collections.new(cid)
        bpy.context.scene.collection.children.link(col)
        z_fallback = 0.0
        for p in _panels_de(cont):
            cantidad = int(p.get("cantidad", 1))
            colocacion = p.get("colocacion") or []
            for i in range(cantidad):
                nombre = p["name"] if cantidad == 1 else f"{p['name']}_{i+1}"
                if i < len(colocacion):
                    c = colocacion[i]
                    ob = crear_caja(nombre, c["sx"], c["sy"], c["sz"],
                                    c["x"], c["y"], c["z"], p.get("material", ""))
                else:
                    # fallback: apilado provisional para JSON sin colocación
                    ob = crear_caja(nombre, p["largo"], p["espesor"], p["ancho"],
                                    0.0, 0.0, z_fallback, p.get("material", ""))
                    z_fallback += p["espesor"] + 5
                    sin_colocacion.append(nombre)
                for uc in list(ob.users_collection):
                    uc.objects.unlink(ob)
                col.objects.link(ob)

    if sin_colocacion:
        print(f"AVISO: {len(sin_colocacion)} paneles sin colocación en el JSON "
              "(apilados provisionalmente). Regenera el project.json con "
              "mono_forge.rules.posicion.colocar().")


def exportar(out):
    """modelo.blend + preview.glb (+ preview.usdz si el build de Blender trae USD)."""
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "modelo.blend"))

    glb = os.path.join(out, "preview.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_yup=True)
    print(f"OK → {glb}")

    usdz = os.path.join(out, "preview.usdz")
    try:
        bpy.ops.wm.usd_export(filepath=usdz)
        print(f"OK → {usdz}")
    except Exception as e:  # USD no disponible en este build
        print(f"AVISO: no se pudo exportar USDZ ({e}). "
              "AR en iOS: la plataforma lo genera en el navegador.")


def main():
    a = args()
    if not a:
        print("uso: blender --background --python build_from_json.py -- <project.json>")
        return
    ruta = a[0]
    with open(ruta, encoding="utf-8") as f:
        data = json.load(f)
    construir(data)
    out = os.path.join(os.path.dirname(ruta), "deliverables")
    os.makedirs(out, exist_ok=True)
    exportar(out)
    print(f"OK → {out}/modelo.blend")


if bpy and __name__ == "__main__":
    main()
