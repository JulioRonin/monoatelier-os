"""JSON → geometría Blender.

    blender --background --python blender/build_from_json.py -- projects/x/project.json

Cada panel es un objeto mesh independiente con el mismo nombre que en el JSON
(crítico para vistas explotadas y anotaciones). Las medidas vienen del JSON:
NUNCA se modela a ojo ni se miden mallas para obtener cotas.
"""

import json
import os
import sys

try:
    import bpy
except ImportError:  # permite importar el módulo fuera de Blender
    bpy = None

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
    s.unit_settings.scale_length = MM
    s.unit_settings.length_unit = "MILLIMETERS"


def crear_panel(nombre, largo, ancho, espesor, x=0.0, y=0.0, z=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x * MM, y * MM, z * MM))
    ob = bpy.context.active_object
    ob.name = nombre
    ob.scale = (largo * MM, espesor * MM, ancho * MM)
    ob.rotation_euler = rot
    return ob


def construir(data):
    preparar_escena()
    for m in data.get("modules", []):
        col = bpy.data.collections.new(m["id"])
        bpy.context.scene.collection.children.link(col)
        z = 0.0
        for p in m["panels"]:
            for i in range(int(p.get("cantidad", 1))):
                nombre = p["name"] if p.get("cantidad", 1) == 1 else f"{p['name']}_{i+1}"
                ob = crear_panel(nombre, p["largo"], p["ancho"], p["espesor"], z=z)
                z += p["espesor"] + 5     # apilado provisional: ver TODO
                for c in list(ob.users_collection):
                    c.objects.unlink(ob)
                col.objects.link(ob)
    # TODO: posicionamiento real por rol_estructural (base abajo, laterales a los
    # extremos, refuerzos arriba/atrás). Implementar en rules/posicion.py y leerlo aquí.


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
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "modelo.blend"))
    print(f"OK → {out}/modelo.blend")


if bpy and __name__ == "__main__":
    main()
