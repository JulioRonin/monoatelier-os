"""Cámaras, luces y escenas. Los renders SIEMPRE pasan por aquí."""

try:
    import bpy
except ImportError:
    bpy = None

MM = 0.001
ESCENAS = {
    "estudio": dict(temp_k=3500, fondo=(0.88, 0.86, 0.83, 1)),
    "cocina":  dict(temp_k=3500, fondo=(0.90, 0.89, 0.87, 1)),
}
VISTAS = {
    "frontal_34": dict(loc=(1800, -2200, 1400), rot=(1.30, 0, 0.68)),
    "lateral":    dict(loc=(2600, -600, 1400),  rot=(1.40, 0, 1.30)),
    "detalle":    dict(loc=(700, -900, 900),    rot=(1.45, 0, 0.62)),
}


def configurar(escena="estudio", motor="CYCLES", res=(1920, 1080), muestras=128):
    if bpy is None:
        return
    s = bpy.context.scene
    s.render.engine = motor
    s.render.resolution_x, s.render.resolution_y = res
    if motor == "CYCLES":
        s.cycles.samples = muestras
    world = bpy.data.worlds.new("MonoAtelier") if not bpy.data.worlds else bpy.data.worlds[0]
    s.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = ESCENAS[escena]["fondo"]


def renderizar(vista, salida):
    if bpy is None:
        return
    cfg = VISTAS[vista]
    cam_data = bpy.data.cameras.new(f"cam_{vista}")
    cam_data.lens = 35
    cam = bpy.data.objects.new(f"cam_{vista}", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = tuple(v * MM for v in cfg["loc"])
    cam.rotation_euler = cfg["rot"]
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = salida
    bpy.ops.render.render(write_still=True)
