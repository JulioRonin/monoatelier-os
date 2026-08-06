"""Cámaras, luces, escenas y materiales de render. Los renders SIEMPRE pasan por aquí.

El lenguaje visual sale de style/mono_atelier_style.md: luz cálida INDIRECTA
(cove lineal, nunca spots puntuales), muros de estuco crudo, madera con veta
vertical, piedra con vetas marcadas como único elemento "ruidoso".

La geometría del encuadre se DERIVA del bounding box del proyecto, no se
hardcodea: un mueble de 600mm y una cocina de 4m se encuadran igual de bien.
Ese bounding box sale del JSON (campo colocacion), nunca de medir mallas.

Las funciones de matemática pura (bbox_de, camara_para, kelvin_a_rgb) se pueden
importar y probar sin Blender.
"""

from __future__ import annotations

import math

try:
    import bpy
except ImportError:  # importable fuera de Blender para poder testear la matemática
    bpy = None

MM = 0.001

# ── Escenas ──────────────────────────────────────────────────────────────
# temp_k: temperatura de la luz principal. cove_k: la indirecta del plafón.
ESCENAS = {
    "cocina": dict(
        temp_k=4200, potencia=180.0,      # ventana lateral grande
        cove_k=2900, cove_potencia=14.0,  # luz indirecta cálida en el plafón
        relleno=0.22,
        muro=(0.86, 0.83, 0.78, 1.0),     # estuco crudo, crema cálido
        piso=(0.84, 0.82, 0.78, 1.0),     # microcemento claro
        mundo=(0.55, 0.54, 0.52, 1.0),
        exposicion=0.15,
        con_muros=True,
    ),
    "estudio": dict(
        temp_k=5000, potencia=140.0,
        cove_k=3200, cove_potencia=8.0,
        relleno=0.45,
        muro=(0.90, 0.88, 0.85, 1.0),     # ciclorama neutro
        piso=(0.90, 0.88, 0.85, 1.0),
        mundo=(0.72, 0.71, 0.70, 1.0),
        exposicion=0.0,
        con_muros=False,                  # fondo infinito, sin esquinas
    ),
    "noche": dict(
        temp_k=2700, potencia=25.0,
        cove_k=2500, cove_potencia=26.0,  # protagonismo del LED y la indirecta
        relleno=0.06,
        muro=(0.30, 0.28, 0.26, 1.0),
        piso=(0.26, 0.25, 0.24, 1.0),
        mundo=(0.06, 0.06, 0.07, 1.0),
        exposicion=0.5,
        con_muros=True,
    ),
}

# ── Vistas ───────────────────────────────────────────────────────────────
# Encuadres RELATIVOS: azimut 0 = de frente; elevación en grados sobre el
# objetivo; margen = cuánto aire dejar alrededor; altura_objetivo = a qué
# fracción del alto del mueble se apunta.
VISTAS = {
    "frontal":    dict(azimut=0,  elevacion=4,  margen=1.15, altura_objetivo=0.50, lente=50),
    "frontal_34": dict(azimut=38, elevacion=9,  margen=1.30, altura_objetivo=0.46, lente=35),
    "lateral":    dict(azimut=68, elevacion=6,  margen=1.35, altura_objetivo=0.50, lente=35),
    "detalle":    dict(azimut=28, elevacion=-1, margen=0.42, altura_objetivo=0.34, lente=85),
    "cenital":    dict(azimut=18, elevacion=52, margen=1.45, altura_objetivo=0.55, lente=35),
}

#: el set que se entrega por defecto (CLAUDE.md pide mínimo 3 vistas)
VISTAS_ENTREGA = ("frontal_34", "frontal", "detalle")


# ── Matemática pura (testeable sin Blender) ──────────────────────────────

def bbox_de(data: dict) -> dict:
    """Bounding box del proyecto EN METROS, derivado del JSON.

    Lee panel.colocacion — la misma fuente que usa build_from_json. Nunca mide
    mallas: si el encuadre sale mal, la regla de posición es la que está mal.
    """
    xs: list[float] = []
    ys: list[float] = []
    zs: list[float] = []
    for cont in list(data.get("modules", [])) + list(data.get("tramos", [])):
        for p in cont.get("panels", []):
            for c in p.get("colocacion") or []:
                xs += [c["x"] - c["sx"] / 2, c["x"] + c["sx"] / 2]
                ys += [c["y"] - c["sy"] / 2, c["y"] + c["sy"] / 2]
                zs += [c["z"] - c["sz"] / 2, c["z"] + c["sz"] / 2]
    if not xs:
        raise ValueError(
            "El project.json no trae colocación 3D: no hay nada que encuadrar. "
            "Regeneralo con mono_forge.rules.posicion.colocar().")
    return {
        "min_x": min(xs) * MM, "max_x": max(xs) * MM,
        "min_y": min(ys) * MM, "max_y": max(ys) * MM,
        "min_z": min(zs) * MM, "max_z": max(zs) * MM,
        "ancho": (max(xs) - min(xs)) * MM,
        "fondo": (max(ys) - min(ys)) * MM,
        "alto":  (max(zs) - min(zs)) * MM,
    }


def kelvin_a_rgb(kelvin: float) -> tuple[float, float, float]:
    """Temperatura de color → RGB lineal aproximado (Tanner Helland)."""
    t = max(1000.0, min(12000.0, kelvin)) / 100.0
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * ((t - 60) ** -0.1332047592)
        g = 288.1221695283 * ((t - 60) ** -0.0755148492)
        b = 255.0
    return tuple(max(0.0, min(1.0, v / 255.0)) for v in (r, g, b))


def camara_para(vista: str, bbox: dict) -> dict:
    """Posición y objetivo de cámara que encuadran el proyecto completo.

    El frente del mueble mira a −Y (convención de rules/posicion.py), así que
    la cámara se coloca del lado negativo de Y.
    """
    cfg = VISTAS[vista]
    lente = float(cfg["lente"])
    sensor = 36.0

    cx = (bbox["min_x"] + bbox["max_x"]) / 2
    cy = (bbox["min_y"] + bbox["max_y"]) / 2
    cz = bbox["min_z"] + bbox["alto"] * cfg["altura_objetivo"]

    fov = 2 * math.atan(sensor / (2 * lente))
    lado = max(bbox["ancho"], bbox["alto"], 0.4)
    dist = (lado / 2) / math.tan(fov / 2) * cfg["margen"]

    az = math.radians(cfg["azimut"])
    el = math.radians(cfg["elevacion"])
    horiz = dist * math.cos(el)
    return {
        "loc": (cx + horiz * math.sin(az),
                cy - horiz * math.cos(az),
                cz + dist * math.sin(el)),
        "objetivo": (cx, cy, cz),
        "lente": lente,
    }


def zonas_led(data: dict) -> list[dict]:
    """Dónde va la luz indirecta de mueble, leída de los módulos con led=True.

    La iluminación del render se deriva del MISMO dato que la lista de herrajes:
    si un módulo lleva LED en el presupuesto, se ve encendido en el render.
    """
    zonas = []
    for m in data.get("modules", []):
        if not m.get("led"):
            continue
        cs = [c for p in m.get("panels", []) for c in (p.get("colocacion") or [])]
        if not cs:
            continue
        x0 = min(c["x"] - c["sx"] / 2 for c in cs) * MM
        x1 = max(c["x"] + c["sx"] / 2 for c in cs) * MM
        y0 = min(c["y"] - c["sy"] / 2 for c in cs) * MM
        y1 = max(c["y"] + c["sy"] / 2 for c in cs) * MM
        z0 = min(c["z"] - c["sz"] / 2 for c in cs) * MM
        zonas.append({
            "id": m.get("id", "?"),
            "centro": ((x0 + x1) / 2, (y0 + y1) / 2, z0 - 0.01),
            "ancho": max(0.05, (x1 - x0) - 0.04),   # retranqueo de 40mm, como el cálculo
            "fondo": max(0.03, (y1 - y0) * 0.5),
        })
    return zonas


# ── Blender ──────────────────────────────────────────────────────────────

def _entrada(nodo, nombre, valor) -> None:
    """Asigna una entrada sólo si existe: los nombres del Principled cambian
    entre versiones de Blender y no vale la pena reventar por un 'Coat'."""
    if nombre in nodo.inputs:
        nodo.inputs[nombre].default_value = valor


def configurar(escena="cocina", motor="CYCLES", res=(1920, 1080), muestras=128,
               gpu=True):
    """Motor, resolución, gestión de color y ambiente del mundo."""
    if bpy is None:
        return
    cfg = ESCENAS[escena]
    s = bpy.context.scene
    s.render.engine = motor
    s.render.resolution_x, s.render.resolution_y = res
    s.render.resolution_percentage = 100
    s.render.film_transparent = False

    if motor == "CYCLES":
        s.cycles.samples = muestras
        s.cycles.use_denoising = True
        if gpu:
            _activar_gpu(s)

    # AgX da el rolloff suave y cálido de la referencia; Filmic es el respaldo
    for transform in ("AgX", "Filmic", "Standard"):
        try:
            s.view_settings.view_transform = transform
            break
        except TypeError:
            continue
    try:
        s.view_settings.look = "AgX - Medium Contrast"
    except TypeError:
        pass
    s.view_settings.exposure = cfg["exposicion"]

    mundo = bpy.data.worlds.get("MonoAtelier") or bpy.data.worlds.new("MonoAtelier")
    s.world = mundo
    mundo.use_nodes = True
    fondo = mundo.node_tree.nodes["Background"]
    fondo.inputs[0].default_value = cfg["mundo"]
    fondo.inputs[1].default_value = cfg["relleno"]


def _activar_gpu(scene) -> None:
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for tipo in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
            try:
                prefs.compute_device_type = tipo
            except TypeError:
                continue
            prefs.get_devices()
            if any(d.type != "CPU" for d in prefs.devices):
                for d in prefs.devices:
                    d.use = True
                scene.cycles.device = "GPU"
                print(f"  · Cycles en GPU ({tipo})")
                return
    except Exception as e:
        print(f"  · GPU no disponible ({e}); render en CPU.")


def _material_plano(nombre, color, rough, metallic=0.0):
    mat = bpy.data.materials.get(nombre) or bpy.data.materials.new(nombre)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    _entrada(bsdf, "Base Color", color)
    _entrada(bsdf, "Roughness", rough)
    _entrada(bsdf, "Metallic", metallic)
    return mat


def _coords(nt, escala):
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = escala
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    return mapping


def material_madera(nombre, claro, oscuro, rough=0.42):
    """Roble con VETA VERTICAL — bandas en X, que se leen como líneas de pie
    a cabeza en un frente. Es el gesto de la referencia."""
    mat = bpy.data.materials.get(nombre) or bpy.data.materials.new(nombre)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    mapping = _coords(nt, (1.0, 1.0, 1.0))

    onda = nt.nodes.new("ShaderNodeTexWave")
    onda.wave_type = "BANDS"
    onda.bands_direction = "X"
    onda.wave_profile = "SIN"
    onda.inputs["Scale"].default_value = 3.0
    onda.inputs["Distortion"].default_value = 12.0
    onda.inputs["Detail"].default_value = 3.0
    onda.inputs["Detail Scale"].default_value = 1.4
    nt.links.new(mapping.outputs["Vector"], onda.inputs["Vector"])

    rampa = nt.nodes.new("ShaderNodeValToRGB")
    rampa.color_ramp.elements[0].position = 0.30
    rampa.color_ramp.elements[0].color = oscuro
    rampa.color_ramp.elements[1].position = 0.72
    rampa.color_ramp.elements[1].color = claro
    nt.links.new(onda.outputs["Fac"], rampa.inputs["Fac"])
    nt.links.new(rampa.outputs["Color"], bsdf.inputs["Base Color"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06
    nt.links.new(onda.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    _entrada(bsdf, "Roughness", rough)
    return mat


def material_piedra(nombre, base, veta, rough=0.18):
    """Granito/mármol: vetas finas y contrastadas. La pieza que ancla la cocina."""
    mat = bpy.data.materials.get(nombre) or bpy.data.materials.new(nombre)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    mapping = _coords(nt, (1.0, 1.0, 1.0))

    ruido = nt.nodes.new("ShaderNodeTexNoise")
    ruido.inputs["Scale"].default_value = 4.0
    ruido.inputs["Detail"].default_value = 6.0
    nt.links.new(mapping.outputs["Vector"], ruido.inputs["Vector"])

    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = 5.5
    nt.links.new(ruido.outputs["Color"], vor.inputs["Vector"])

    rampa = nt.nodes.new("ShaderNodeValToRGB")
    rampa.color_ramp.elements[0].position = 0.0
    rampa.color_ramp.elements[0].color = veta       # la arista = la veta blanca
    rampa.color_ramp.elements[1].position = 0.10
    rampa.color_ramp.elements[1].color = base
    nt.links.new(vor.outputs["Distance"], rampa.inputs["Fac"])
    nt.links.new(rampa.outputs["Color"], bsdf.inputs["Base Color"])

    _entrada(bsdf, "Roughness", rough)
    _entrada(bsdf, "Coat Weight", 0.25)
    return mat


def material_estuco(nombre, color):
    """Microcement / estuco: casi liso, con una irregularidad mínima que evita
    el look de plástico en muros y piso."""
    mat = bpy.data.materials.get(nombre) or bpy.data.materials.new(nombre)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    ruido = nt.nodes.new("ShaderNodeTexNoise")
    ruido.inputs["Scale"].default_value = 90.0
    ruido.inputs["Detail"].default_value = 4.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.10
    nt.links.new(ruido.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    _entrada(bsdf, "Base Color", color)
    _entrada(bsdf, "Roughness", 0.88)
    return mat


#: SKU → cómo se construye su material de render.
#: Los SKU que no aparecen aquí conservan el material plano de materials.py.
RECETAS = {
    "MEL-ROBLE-NAT-15": ("madera", (0.80, 0.65, 0.46, 1), (0.62, 0.45, 0.28, 1), 0.40),
    "ROBLE-CLARO":      ("madera", (0.78, 0.63, 0.45, 1), (0.60, 0.44, 0.27, 1), 0.45),
    "LAC-VERDE-SAGE-15": ("plano", (0.42, 0.48, 0.38, 1), 0.32),
    "BRI-BLA-19-ARA":   ("plano", (0.93, 0.93, 0.92, 1), 0.06),
    "MEL-BLA-19-CUB":   ("piedra", (0.10, 0.10, 0.11, 1), (0.88, 0.87, 0.84, 1), 0.16),
    "GRANITO-OSCURO":   ("piedra", (0.08, 0.08, 0.09, 1), (0.92, 0.91, 0.88, 1), 0.14),
    "NEGRO-MATE":       ("plano", (0.04, 0.04, 0.04, 1), 0.62),
}


def materiales_render() -> int:
    """Sustituye los materiales planos por los procedurales del estilo.

    Se corre DESPUÉS de construir la geometría: build_from_json asigna
    materiales planos (que son los que viajan al GLB), y aquí se enriquecen
    sólo para el render.
    """
    if bpy is None:
        return 0
    n = 0
    for sku, receta in RECETAS.items():
        if sku not in bpy.data.materials:
            continue          # ese material no se usó en este proyecto
        viejo = bpy.data.materials[sku]
        nombre = f"{sku}__render"
        tipo = receta[0]
        if tipo == "madera":
            nuevo = material_madera(nombre, receta[1], receta[2], receta[3])
        elif tipo == "piedra":
            nuevo = material_piedra(nombre, receta[1], receta[2], receta[3])
        else:
            nuevo = _material_plano(nombre, receta[1], receta[2])
        for ob in bpy.data.objects:
            if ob.type != "MESH":
                continue
            for i, m in enumerate(ob.data.materials):
                if m is viejo:
                    ob.data.materials[i] = nuevo
        n += 1
    return n


def montar_escena(escena: str, bbox: dict, data: dict | None = None) -> None:
    """Piso, muros, ventana, cove indirecto y LED de mueble, a la medida del proyecto."""
    if bpy is None:
        return
    cfg = ESCENAS[escena]
    cx = (bbox["min_x"] + bbox["max_x"]) / 2
    cy = (bbox["min_y"] + bbox["max_y"]) / 2
    holgura = max(bbox["ancho"], 3.0) * 2.0
    techo = max(bbox["max_z"] + 0.6, 2.6)

    # piso
    bpy.ops.mesh.primitive_plane_add(size=holgura * 2, location=(cx, cy, 0.0))
    piso = bpy.context.active_object
    piso.name = "escena_piso"
    piso.data.materials.append(material_estuco("escena_piso_mat", cfg["piso"]))

    if cfg["con_muros"]:
        # muro de fondo, justo detrás del mueble
        bpy.ops.mesh.primitive_plane_add(size=holgura * 2,
                                         location=(cx, bbox["max_y"] + 0.02, techo / 2))
        muro = bpy.context.active_object
        muro.name = "escena_muro"
        muro.rotation_euler = (math.radians(90), 0, 0)
        mat_muro = material_estuco("escena_muro_mat", cfg["muro"])
        muro.data.materials.append(mat_muro)

        # plafón — recibe el rebote del cove
        bpy.ops.mesh.primitive_plane_add(size=holgura * 2, location=(cx, cy, techo))
        plafon = bpy.context.active_object
        plafon.name = "escena_plafon"
        plafon.data.materials.append(mat_muro)

    # ── luz principal: ventana lateral grande y suave ──
    luz = bpy.data.lights.new("luz_ventana", type="AREA")
    luz.shape = "RECTANGLE"
    luz.size = max(1.6, bbox["alto"] * 1.2)
    luz.size_y = max(1.2, bbox["alto"])
    luz.energy = cfg["potencia"] * max(1.0, bbox["ancho"] / 2.4)
    luz.color = kelvin_a_rgb(cfg["temp_k"])
    ob = bpy.data.objects.new("luz_ventana", luz)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (bbox["min_x"] - max(1.4, bbox["ancho"] * 0.5),
                   cy - 1.8, bbox["min_z"] + bbox["alto"] * 0.72)
    ob.rotation_euler = (math.radians(72), 0, math.radians(-52))

    # ── cove: tira indirecta contra el plafón, nunca spots ──
    cove = bpy.data.lights.new("luz_cove", type="AREA")
    cove.shape = "RECTANGLE"
    cove.size = max(1.0, bbox["ancho"])
    cove.size_y = 0.12
    cove.energy = cfg["cove_potencia"] * max(1.0, bbox["ancho"])
    cove.color = kelvin_a_rgb(cfg["cove_k"])
    ob = bpy.data.objects.new("luz_cove", cove)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (cx, bbox["max_y"] - 0.15, techo - 0.12)
    ob.rotation_euler = (math.radians(-14), 0, 0)   # apunta hacia arriba/atrás

    # ── LED de mueble, leído del propio proyecto ──
    for z in zonas_led(data or {}):
        led = bpy.data.lights.new(f"led_{z['id']}", type="AREA")
        led.shape = "RECTANGLE"
        led.size = z["ancho"]
        led.size_y = z["fondo"]
        led.energy = 9.0 * max(0.3, z["ancho"])
        led.color = kelvin_a_rgb(3000)
        ob = bpy.data.objects.new(f"led_{z['id']}", led)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = z["centro"]
        ob.rotation_euler = (math.radians(180), 0, 0)   # ilumina hacia abajo


def renderizar(vista: str, salida: str, bbox: dict) -> str:
    """Coloca la cámara encuadrando el proyecto y renderiza a `salida`."""
    if bpy is None:
        return salida
    cfg = camara_para(vista, bbox)

    objetivo = bpy.data.objects.new(f"objetivo_{vista}", None)
    bpy.context.scene.collection.objects.link(objetivo)
    objetivo.location = cfg["objetivo"]

    cam_data = bpy.data.cameras.new(f"cam_{vista}")
    cam_data.lens = cfg["lente"]
    cam = bpy.data.objects.new(f"cam_{vista}", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = cfg["loc"]

    # TRACK_TO en vez de calcular euler a mano: siempre apunta bien
    con = cam.constraints.new(type="TRACK_TO")
    con.target = objetivo
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"

    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = salida
    bpy.ops.render.render(write_still=True)
    return salida
