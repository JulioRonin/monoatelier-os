"""Biblioteca de materiales estilo Mono Atelier. Nodos PBR simples y limpios."""

try:
    import bpy
except ImportError:
    bpy = None

PALETA = {
    "MEL-BLA-15-IMP": dict(base=(0.92, 0.92, 0.90, 1), rough=0.55),
    "MEL-BLA-15-DUR": dict(base=(0.92, 0.92, 0.90, 1), rough=0.55),
    "MEL-BLA-15-ARA": dict(base=(0.92, 0.92, 0.90, 1), rough=0.55),
    "BRI-BLA-19-ARA": dict(base=(0.95, 0.95, 0.95, 1), rough=0.08),  # alto brillo
    "MDF-003-FON":    dict(base=(0.75, 0.68, 0.55, 1), rough=0.80),
    "MEL-BLA-19-CUB": dict(base=(0.94, 0.94, 0.92, 1), rough=0.35),  # cubierta
    "NEGRO-MATE":     dict(base=(0.05, 0.05, 0.05, 1), rough=0.70),
    "ROBLE-CLARO":    dict(base=(0.72, 0.58, 0.40, 1), rough=0.45),
    "MEL-ROBLE-NAT-15": dict(base=(0.75, 0.60, 0.42, 1), rough=0.42),
    "LAC-VERDE-SAGE-15": dict(base=(0.65, 0.70, 0.58, 1), rough=0.30),
}


def obtener(sku):
    if bpy is None:
        return None
    if sku in bpy.data.materials:
        return bpy.data.materials[sku]
    cfg = PALETA.get(sku, PALETA["MEL-BLA-15-IMP"])
    mat = bpy.data.materials.new(sku)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = cfg["base"]
    bsdf.inputs["Roughness"].default_value = cfg["rough"]
    return mat
