"""Posicionamiento 3D por rol_estructural — deriva, nunca mide.

La colocación se DERIVA de los parámetros y las reglas estructurales, y se
escribe en el project.json (la fuente de verdad). Blender y el visor web/AR
sólo leen y construyen: nunca calculan medidas por su cuenta.

Sistema de coordenadas (mm, igual que el taller):
    X → a lo largo del muro (izquierda → derecha)
    Y → profundidad (0 = cara frontal del casco, +Y hacia el muro)
    Z → altura (0 = piso)

Todos los paneles de un mueble Mono Atelier son cajas alineadas a ejes, así
que cada colocación es simplemente centro + extensión por eje:
    {"x","y","z","sx","sy","sz"}   (centro y tamaños en mm)

Un Panel con cantidad N recibe N colocaciones (una por copia), en el mismo
orden con el que cutlist._expandir numera las copias (_1, _2, ...).
"""

from __future__ import annotations

from ..constants import (
    T, ALTO_ZOCLO, ZOCLO_RETRANQUEO, RETRANQUEO_ENTREPANO,
    ALTO_TOTAL_BASE, CUBIERTA_VUELO, GAP_FRENTES,
    alto_lateral, alto_cuerpo,
)
from ..models import Module, Panel, Project

#: altura del piso al canto INFERIOR de los muebles colgados (900 de base +
#: 600 de salpicadero). Ajustable por proyecto vía colocar(alto_colgado=...).
ALTO_COLGADO_DEFAULT = 1500

#: separación visual entre módulos sueltos (los de un tramo van a hueso)
GAP_MODULOS = 0


def _c(x: float, y: float, z: float, sx: float, sy: float, sz: float) -> dict:
    return {"x": round(x, 2), "y": round(y, 2), "z": round(z, 2),
            "sx": round(sx, 2), "sy": round(sy, 2), "sz": round(sz, 2)}


# ─────────────────────────────────────────────────────────────────────────
# Colocación módulo-local (origen: esquina frontal izquierda al piso del
# propio módulo). Devuelve True si supo colocar el panel.
# ─────────────────────────────────────────────────────────────────────────

def _colocar_panel_apoyado(m: Module, p: Panel) -> bool:
    """base | base_tarja | torre — el lateral DESCANSA sobre la base."""
    a, prof = m.ancho, m.prof
    h_lat = alto_lateral(m.tipo, m.alto)
    h_cuerpo = alto_cuerpo(m.tipo, m.alto)
    z_base = ALTO_ZOCLO          # cara inferior de la base portante
    z_top = z_base + T + h_lat   # canto superior de los laterales
    rol = p.rol_estructural

    if rol == "base_portante":
        p.colocacion = [_c(a / 2, prof / 2, z_base + T / 2, a, prof, T)]
    elif rol == "lateral_apoyado":
        zc = z_base + T + h_lat / 2
        p.colocacion = [_c(T / 2, prof / 2, zc, T, prof, h_lat),
                        _c(a - T / 2, prof / 2, zc, T, prof, h_lat)][:p.cantidad]
    elif rol == "divisor":
        p.colocacion = [_c(a / 2, prof / 2, z_base + T + h_lat / 2, T, prof, h_lat)]
    elif rol == "refuerzo":
        tira = p.ancho
        if p.name.endswith("_ref_sup_frente"):
            p.colocacion = [_c(a / 2, tira / 2, z_top - T / 2, p.largo, tira, T)]
        elif p.name.endswith("_ref_sup_trasero"):
            p.colocacion = [_c(a / 2, prof - tira / 2, z_top - T / 2, p.largo, tira, T)]
        else:  # _ref_post_inferior — vertical, pegado al fondo sobre la base
            p.colocacion = [_c(a / 2, prof - T / 2, z_base + T + tira / 2,
                               p.largo, T, tira)]
    elif rol == "zoclo":
        p.colocacion = [_c(a / 2, ZOCLO_RETRANQUEO + T / 2, p.ancho / 2,
                           p.largo, T, p.ancho)]
    elif rol == "fondo":
        # aplicado SOBRE el canto trasero: sobresale detrás del casco
        p.colocacion = [_c(a / 2, prof + p.espesor / 2, z_base + h_cuerpo / 2,
                           p.largo, p.espesor, p.ancho)]
    elif rol in ("entrepano_movil", "entrepano_fijo"):
        _colocar_entrepanos(m, p, z0=z_base + T, z1=z_top - T)
    elif rol == "frente":
        _colocar_frentes(m, p, z_top=z_top,
                         apilar=(m.tipo == "torre"), z_piso=z_base + T)
    else:
        return False
    return True


def _colocar_panel_colgado(m: Module, p: Panel) -> bool:
    """superior — techo y piso CAPTURADOS entre laterales completos."""
    a, alto, prof = m.ancho, m.alto, m.prof
    rol = p.rol_estructural

    if rol == "lateral_portante":
        zc = alto / 2
        p.colocacion = [_c(T / 2, prof / 2, zc, T, prof, alto),
                        _c(a - T / 2, prof / 2, zc, T, prof, alto)][:p.cantidad]
    elif rol == "capturado":
        if p.name.endswith("_techo"):
            p.colocacion = [_c(a / 2, prof / 2, alto - T / 2, p.largo, prof, T)]
        else:  # _piso
            p.colocacion = [_c(a / 2, prof / 2, T / 2, p.largo, prof, T)]
    elif rol == "riel_colgador":
        p.colocacion = [_c(a / 2, prof - T / 2, alto - T - p.ancho / 2,
                           p.largo, T, p.ancho)]
    elif rol == "divisor":
        p.colocacion = [_c(a / 2, prof / 2, alto / 2, T, prof, p.largo)]
    elif rol == "fondo":
        p.colocacion = [_c(a / 2, prof + p.espesor / 2, alto / 2,
                           p.largo, p.espesor, p.ancho)]
    elif rol in ("entrepano_movil", "entrepano_fijo"):
        _colocar_entrepanos(m, p, z0=T, z1=alto - T)
    elif rol == "frente":
        _colocar_frentes(m, p, z_top=alto)
    else:
        return False
    return True


def _colocar_panel_cajonera(m: Module, p: Panel) -> bool:
    """cajonera suelta — los laterales corren el largo de la corredera."""
    a, alto = m.ancho, m.alto
    rol = p.rol_estructural

    # dimensiones de la caja, derivadas de los propios paneles
    lat = next((q for q in m.panels if q.rol_estructural == "lateral_caja"), None)
    if lat is None:
        return False
    corredera, alto_caja = lat.largo, lat.ancho
    fondo_caja = next((q for q in m.panels if q.name.endswith("_fondo_caja")), None)
    ancho_caja = fondo_caja.largo if fondo_caja else a - 2 * T
    x0 = (a - ancho_caja) / 2            # caja centrada en el módulo
    z0 = (alto - alto_caja) / 2          # caja centrada en el alto del frente

    if rol == "lateral_caja":
        zc = z0 + alto_caja / 2
        p.colocacion = [_c(x0 + T / 2, corredera / 2, zc, T, corredera, alto_caja),
                        _c(x0 + ancho_caja - T / 2, corredera / 2, zc,
                           T, corredera, alto_caja)][:p.cantidad]
    elif rol == "capturado":
        zc = z0 + alto_caja / 2
        y = T / 2 if p.name.endswith("_frente_caja") else corredera - T / 2
        p.colocacion = [_c(a / 2, y, zc, p.largo, T, p.ancho)]
    elif rol == "fondo":
        p.colocacion = [_c(a / 2, corredera / 2, z0 + p.espesor / 2,
                           p.largo, p.ancho, p.espesor)]
    elif rol == "frente":
        p.colocacion = [_c(a / 2, -p.espesor / 2, alto / 2,
                           p.ancho, p.espesor, p.largo)]
    else:
        return False
    return True


def _colocar_entrepanos(m: Module, p: Panel, z0: float, z1: float) -> None:
    """Distribuye n entrepaños uniformes en el vano. Con divisor hay un panel
    de entrepaño POR VANO (se agregan en orden), centrado en su vano."""
    paneles_vano = [q for q in m.panels
                    if q.rol_estructural in ("entrepano_movil", "entrepano_fijo")]
    idx = paneles_vano.index(p)
    hay_divisor = any(q.rol_estructural == "divisor" for q in m.panels)
    if hay_divisor and len(paneles_vano) > 1:
        # dos vanos: centro del vano izquierdo y derecho
        xs = [(T + (m.ancho / 2 - T / 2)) / 2 + 0,  # centro vano izq
              (m.ancho / 2 + T / 2 + (m.ancho - T)) / 2]
        xc = xs[min(idx, 1)]
    else:
        xc = m.ancho / 2
    y = RETRANQUEO_ENTREPANO + p.ancho / 2
    h = z1 - z0
    p.colocacion = [
        _c(xc, y, z0 + h * (k + 1) / (p.cantidad + 1), p.largo, p.ancho, p.espesor)
        for k in range(p.cantidad)
    ]


def _colocar_frentes(m: Module, p: Panel, z_top: float,
                     apilar: bool = False, z_piso: float | None = None) -> None:
    """Frentes sobrepuestos al casco (y negativo). N puertas se reparten a lo
    ancho; en torre (apilar=True) van una abajo y otra arriba."""
    n = p.cantidad
    y = -p.espesor / 2
    if apilar and n == 2 and z_piso is not None:
        p.colocacion = [
            _c(m.ancho / 2, y, z_piso + GAP_FRENTES + p.largo / 2,
               p.ancho, p.espesor, p.largo),
            _c(m.ancho / 2, y, z_top - p.largo / 2, p.ancho, p.espesor, p.largo),
        ]
    else:
        paso = m.ancho / n
        p.colocacion = [
            _c(paso * (k + 0.5), y, z_top - p.largo / 2,
               p.ancho, p.espesor, p.largo)
            for k in range(n)
        ]


_DISPATCH = {
    "base": _colocar_panel_apoyado,
    "base_tarja": _colocar_panel_apoyado,
    "torre": _colocar_panel_apoyado,
    "superior": _colocar_panel_colgado,
    "cajonera": _colocar_panel_cajonera,
}


# ─────────────────────────────────────────────────────────────────────────
# Colocación a nivel proyecto
# ─────────────────────────────────────────────────────────────────────────

def colocar(project: Project, alto_colgado: float = ALTO_COLGADO_DEFAULT) -> dict:
    """Calcula y escribe la colocación de TODOS los paneles del proyecto.

    Los módulos de piso avanzan sobre un cursor X; los colgados sobre otro,
    elevados a `alto_colgado`. Las cubiertas de cada tramo se tienden sobre
    los módulos del tramo. Devuelve un resumen con paneles sin regla.
    """
    sin_regla: list[str] = []
    origen: dict[str, tuple[float, float]] = {}   # id módulo → (x0, z0)
    x_piso = 0.0
    x_aire = 0.0

    for m in project.modules:
        colgado = m.tipo == "superior"
        if colgado:
            x0, z0 = x_aire, alto_colgado
            x_aire += m.ancho + GAP_MODULOS
        else:
            x0, z0 = x_piso, 0.0
            x_piso += m.ancho + GAP_MODULOS
        origen[m.id] = (x0, z0)

        fn = _DISPATCH.get(m.tipo)
        for p in m.panels:
            p.colocacion = []
            if fn is None or not fn(m, p):
                sin_regla.append(p.name)
                continue
            for c in p.colocacion:
                c["x"] += x0
                c["z"] += z0

    # cubiertas y demás paneles de tramo
    for t in project.tramos:
        xs = [origen[mid][0] for mid in t.modulos if mid in origen]
        x0 = min(xs) if xs else 0.0
        cursor = x0
        for p in t.panels:
            p.colocacion = []
            if p.rol_estructural == "cubierta":
                prof_cub = p.ancho
                for _ in range(p.cantidad):
                    p.colocacion.append(_c(
                        cursor + p.largo / 2, prof_cub / 2 - CUBIERTA_VUELO,
                        ALTO_TOTAL_BASE + p.espesor / 2,
                        p.largo, prof_cub, p.espesor))
                    cursor += p.largo
            else:
                sin_regla.append(p.name)

    total = sum(len(p.colocacion) for p in project.all_panels())
    if sin_regla:
        project.notas.append(
            "posicion: sin regla de colocación para: " + ", ".join(sin_regla))
    return {"colocados": total, "sin_regla": sin_regla}
