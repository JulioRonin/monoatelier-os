"""Posicionamiento 3D por rol_estructural — deriva, nunca mide.

La colocación se DERIVA de los parámetros y las reglas estructurales, y se
escribe en el project.json (la fuente de verdad). Blender y el visor web/AR
sólo leen y construyen: nunca calculan medidas por su cuenta.

Sistema de coordenadas LOCAL de cada muro (mm, igual que el taller):
    X → a lo largo del muro (izquierda → derecha)
    Y → profundidad (0 = cara frontal del casco, +Y hacia el muro)
    Z → altura (0 = piso)

Cada Tramo es un muro y lleva su propia `rotacion` (grados, antihorario en
planta) y su `origen` [X, Y]: la aritmética del mueble se resuelve siempre en
el marco local del muro y sólo al final se transforma al marco del proyecto.
Así una cocina en L o en U no necesita reglas nuevas — necesita dos tramos.
Cuando un tramo va girado, cada colocación lleva además "rz" (grados): la
extensión sx/sy sigue siendo LOCAL y el visor gira la caja sobre su centro.

Todos los paneles de un mueble Mono Atelier son cajas alineadas a ejes, así
que cada colocación es simplemente centro + extensión por eje:
    {"x","y","z","sx","sy","sz"}   (centro y tamaños en mm)

Un Panel con cantidad N recibe N colocaciones (una por copia), en el mismo
orden con el que cutlist._expandir numera las copias (_1, _2, ...).
"""

from __future__ import annotations

import math

from ..constants import (
    T, ALTO_ZOCLO, ZOCLO_RETRANQUEO, RETRANQUEO_ENTREPANO,
    ALTO_TOTAL_BASE, CUBIERTA_VUELO, GAP_FRENTES,
    HOLGURA_ESQUINA, PROF_BASE,
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
    elif rol == "accesorio_tarja":
        # el tazón cuelga del nivel de cubierta hacia abajo
        p.colocacion = [_c(a / 2, T + p.ancho / 2,
                           ALTO_TOTAL_BASE - p.espesor / 2,
                           p.largo, p.ancho, p.espesor)]
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
    """Mueble de cajones (casco + N cajones) o, si es viejo, un cajón suelto."""
    cajones = m.flags.get("cajones")
    if not cajones:
        return _colocar_cajon_suelto(m, p)

    for cj in cajones:
        if p.name.startswith(f"{m.id}_c{cj['i']}_"):
            return _colocar_pieza_de_cajon(m, p, cj)
    # cualquier otra pieza es del casco: mismas reglas que un mueble inferior
    return _colocar_panel_apoyado(m, p)


def _colocar_pieza_de_cajon(m: Module, p: Panel, cj: dict) -> bool:
    """Una pieza de la caja o el frente de un cajón dentro del mueble."""
    a = m.ancho
    ancho_caja, corredera = cj["ancho_caja"], cj["corredera"]
    x0 = (a - ancho_caja) / 2          # caja centrada en el hueco
    z0 = cj["z_caja"]
    rol = p.rol_estructural

    if rol == "lateral_caja":
        zc = z0 + cj["alto_caja"] / 2
        p.colocacion = [
            _c(x0 + T / 2, corredera / 2, zc, T, corredera, cj["alto_caja"]),
            _c(x0 + ancho_caja - T / 2, corredera / 2, zc,
               T, corredera, cj["alto_caja"]),
        ][:p.cantidad]
    elif rol == "capturado":
        y = T / 2 if p.name.endswith("_frente_caja") else corredera - T / 2
        p.colocacion = [_c(a / 2, y, z0 + cj["alto_caja"] / 2, p.largo, T, p.ancho)]
    elif rol == "fondo_caja":
        # atrapado entre los cuatro lados: inset en X y en Y
        p.colocacion = [_c(a / 2, corredera / 2, z0 + p.espesor / 2,
                           p.largo, p.ancho, p.espesor)]
    elif rol == "frente":
        p.colocacion = [_c(a / 2, -p.espesor / 2,
                           cj["z_frente"] + p.largo / 2, p.ancho, p.espesor, p.largo)]
    else:
        return False
    return True


def _colocar_cajon_suelto(m: Module, p: Panel) -> bool:
    """Cajón sin casco — los laterales corren el largo de la corredera."""
    a, alto = m.ancho, m.alto
    rol = p.rol_estructural

    # Medidas declaradas por el generador. El fallback mide el lateral sólo
    # para JSON viejos: deducir el ancho de la caja midiendo el fondo hacía que
    # cambiar el fondo desplazara los laterales y las piezas se atravesaran.
    lat = next((q for q in m.panels if q.rol_estructural == "lateral_caja"), None)
    if lat is None:
        return False
    corredera = m.flags.get("corredera", lat.largo)
    alto_caja = m.flags.get("alto_caja", lat.ancho)
    ancho_caja = m.flags.get("ancho_caja")
    if ancho_caja is None:
        capturado = next((q for q in m.panels
                          if q.name.endswith("_frente_caja")), None)
        ancho_caja = capturado.largo + 2 * T if capturado else a - 2 * T
    x0 = (a - ancho_caja) / 2            # caja centrada en el módulo
    z0 = (alto - alto_caja) / 2          # caja centrada en el alto del frente
    if rol == "lateral_caja":
        zc = z0 + alto_caja / 2
        p.colocacion = [_c(x0 + T / 2, corredera / 2, zc, T, corredera, p.ancho),
                        _c(x0 + ancho_caja - T / 2, corredera / 2, zc,
                           T, corredera, p.ancho)][:p.cantidad]
    elif rol == "capturado":
        y = T / 2 if p.name.endswith("_frente_caja") else corredera - T / 2
        p.colocacion = [_c(a / 2, y, z0 + alto_caja / 2, p.largo, T, p.ancho)]
    elif rol in ("fondo_caja", "fondo"):   # "fondo" = JSON viejo de 3mm
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


def _colocar_jaladeras(m: Module) -> list[str]:
    """Segunda pasada: las jaladeras se cuelgan de los frentes YA colocados.

    No tienen regla propia porque su posición no es un dato del mueble sino una
    consecuencia del frente: una jaladera mal puesta es un frente mal puesto.
    """
    cfg = m.flags.get("jaladeras")
    piezas = [p for p in m.panels if p.rol_estructural == "accesorio_jaladera"]
    if not piezas:
        return []
    if not cfg:
        return [p.name for p in piezas]

    offsets = cfg.get("offsets", {})
    retranqueo = float(cfg.get("retranqueo_superior", 80.0))
    frentes = [c for p in m.panels if p.rol_estructural == "frente"
               for c in p.colocacion]
    if not frentes:
        return [p.name for p in piezas]

    sin_regla: list[str] = []
    for p in piezas:
        dx = offsets.get(p.name.rsplit("_jal_", 1)[-1])
        if dx is None:
            sin_regla.append(p.name)
            continue
        p.colocacion = []
        for cf in frentes[:int(p.cantidad)]:
            # cara exterior del frente (el frente vive en y negativa)
            y_cara = cf["y"] - cf["sy"] / 2
            centrada = cf["sz"] <= 400.0            # frente de cajón
            z = cf["z"] if centrada else cf["z"] + cf["sz"] / 2 - retranqueo
            p.colocacion.append(_c(cf["x"] + dx, y_cara - p.espesor / 2, z,
                                   p.largo, p.espesor, p.ancho))
    return sin_regla


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

def esquina_en_l(largo_muro_previo: float, prof: float = PROF_BASE,
                 holgura: float = HOLGURA_ESQUINA, sentido: str = "derecha",
                 largo_retorno: float = 0.0) -> dict:
    """rotacion y origen del muro de RETORNO de una cocina en L o en U.

    El muro previo corre sobre X desde 0 hasta `largo_muro_previo`; el retorno
    apoya su respaldo contra ese extremo y sale hacia el frente (−Y), que es
    donde está el cuarto. `holgura` es el filler de esquina: sin él, la última
    puerta del muro previo choca con la primera del retorno.

        t.rotacion, t.origen = esquina_en_l(3000).values()

    En el retorno IZQUIERDO el cursor de módulos corre del fondo del cuarto
    hacia la esquina (el giro es +90° y no un espejo), así que hay que decirle
    cuánto mide el retorno: `largo_retorno`.
    """
    if sentido == "derecha":
        return {"rotacion": -90.0,
                "origen": [largo_muro_previo - prof, -holgura]}
    if sentido == "izquierda":
        if largo_retorno <= 0:
            raise ValueError(
                "El retorno izquierdo necesita largo_retorno: sus módulos se "
                "numeran desde el fondo del cuarto hacia la esquina.")
        return {"rotacion": 90.0, "origen": [prof, -holgura - largo_retorno]}
    raise ValueError("sentido debe ser 'derecha' o 'izquierda'.")


def _marco(rotacion: float, ox: float, oy: float) -> tuple[float, float, float, float]:
    r = math.radians(rotacion)
    return math.cos(r), math.sin(r), ox, oy


def _al_proyecto(c: dict, marco, x0: float, y0: float, z0: float,
                 rotacion: float) -> None:
    """Lleva una colocación del marco local del muro al marco del proyecto."""
    cos_t, sin_t, ox, oy = marco
    lx, ly = c["x"] + x0, c["y"] + y0
    c["x"] = round(ox + lx * cos_t - ly * sin_t, 2)
    c["y"] = round(oy + lx * sin_t + ly * cos_t, 2)
    c["z"] = round(c["z"] + z0, 2)
    if rotacion:
        # sx/sy siguen siendo las extensiones LOCALES de la pieza; el visor
        # gira la caja sobre su centro. Sin rotación no se escribe la clave,
        # para no ensuciar los project.json de un solo muro.
        c["rz"] = round(rotacion, 4)


def _agrupar_por_tramo(project: Project) -> list[tuple[object, list[Module]]]:
    """Cada módulo a su muro. Los que no están en ningún tramo se anexan al
    primero (una cocina de un solo muro se comporta igual que antes)."""
    tramo_de: dict[str, str] = {}
    for t in project.tramos:
        for mid in t.modulos:
            tramo_de.setdefault(mid, t.id)

    principal = project.tramos[0].id if project.tramos else None
    grupos: dict[object, list[Module]] = {t.id: [] for t in project.tramos}
    grupos.setdefault(principal, [])
    for m in project.modules:
        grupos.setdefault(tramo_de.get(m.id, principal), []).append(m)
    return list(grupos.items())


def colocar(project: Project, alto_colgado: float = ALTO_COLGADO_DEFAULT) -> dict:
    """Calcula y escribe la colocación de TODOS los paneles del proyecto.

    Dentro de cada tramo (muro) los módulos de piso avanzan sobre un cursor X y
    los colgados sobre otro, elevados a `alto_colgado`; la cubierta se tiende
    sobre ese mismo cursor. Al final, todo el tramo se gira y se traslada a su
    posición en el proyecto — de ahí salen la L y la U.
    Devuelve un resumen con los paneles sin regla.
    """
    sin_regla: list[str] = []

    # Profundidad del muro: la alacena es MENOS profunda que el mueble de piso
    # y va colgada del muro, no alineada al frente. Sin esta referencia las
    # alacenas flotan 250mm adentro del cuarto.
    prof_muro = max([m.prof for m in project.modules if m.tipo != "superior"]
                    or [PROF_BASE])

    for gid, mods in _agrupar_por_tramo(project):
        t = next((x for x in project.tramos if x.id == gid), None)
        rotacion = float(t.rotacion) if t is not None else 0.0
        ox, oy = ((list(t.origen) + [0.0, 0.0])[:2] if t is not None else (0.0, 0.0))
        marco = _marco(rotacion, float(ox), float(oy))
        arranque = float(getattr(t, "desplazamiento", 0.0) or 0.0) if t else 0.0

        x_piso = arranque
        x_aire = arranque
        for m in mods:
            if m.tipo == "superior":
                x0, y0, z0 = x_aire, max(prof_muro - m.prof, 0.0), alto_colgado
                x_aire += m.ancho + GAP_MODULOS
            else:
                x0, y0, z0 = x_piso, 0.0, 0.0
                x_piso += m.ancho + GAP_MODULOS

            fn = _DISPATCH.get(m.tipo)
            for p in m.panels:
                p.colocacion = []
                if p.rol_estructural == "accesorio_jaladera":
                    continue            # se cuelgan de los frentes, más abajo
                if fn is None or not fn(m, p):
                    sin_regla.append(p.name)
            sin_regla += _colocar_jaladeras(m)

            # con el módulo entero resuelto en local, se lleva a su muro
            for p in m.panels:
                for c in p.colocacion:
                    _al_proyecto(c, marco, x0, y0, z0, rotacion)

        # cubiertas y demás paneles del propio tramo, en el mismo marco
        if t is None:
            continue
        cursor = arranque
        for p in t.panels:
            p.colocacion = []
            if p.rol_estructural == "cubierta":
                prof_cub = p.ancho
                for _ in range(int(p.cantidad)):
                    c = _c(cursor + p.largo / 2, prof_cub / 2 - CUBIERTA_VUELO,
                           ALTO_TOTAL_BASE + p.espesor / 2,
                           p.largo, prof_cub, p.espesor)
                    _al_proyecto(c, marco, 0.0, 0.0, 0.0, rotacion)
                    p.colocacion.append(c)
                    cursor += p.largo
            else:
                sin_regla.append(p.name)

    total = sum(len(p.colocacion) for p in project.all_panels())
    if sin_regla:
        project.notas.append(
            "posicion: sin regla de colocación para: " + ", ".join(sin_regla))
    return {"colocados": total, "sin_regla": sin_regla}
