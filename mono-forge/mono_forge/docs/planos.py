"""Planos vectoriales derivados de la colocación 3D del project.json.

No se dibuja nada "a ojo": cada rectángulo sale de panel.colocacion, que a su
vez deriva de rules/posicion.py. Si el plano se ve mal, la regla está mal.
"""

from __future__ import annotations

import math

from reportlab.lib.units import mm
from reportlab.platypus import Flowable

from .estilo import GRIS, GRIS_CLARO, MONO, PRIMARY, SANS, TINTA

# vistas: (eje horizontal, eje vertical, tamaño horizontal, tamaño vertical)
VISTAS = {
    "frontal": ("x", "z", "sx", "sz"),
    "planta": ("x", "y", "sx", "sy"),
    "lateral": ("y", "z", "sy", "sz"),
}


def _extension(c: dict, eje: str) -> float:
    """Extensión de la caja sobre un eje del proyecto.

    sx/sy son las medidas LOCALES del muro. Cuando el tramo va girado ("rz",
    cocinas en L / U) la huella en planta es la de la caja girada: sin esto,
    un mueble sobre el muro girado se dibujaría acostado.
    """
    rz = float(c.get("rz", 0.0))
    if not rz or eje == "sz":
        return c[eje]
    co, si = abs(math.cos(math.radians(rz))), abs(math.sin(math.radians(rz)))
    return (c["sx"] * co + c["sy"] * si if eje == "sx"
            else c["sx"] * si + c["sy"] * co)


def _local(c: dict, marco) -> dict:
    """Regresa la colocación al marco del muro (para el alzado de un tramo girado).

    Un alzado frontal de una cocina en L es ilegible: el muro girado se ve de
    canto. Deshaciendo el giro, cada tramo se dibuja de frente como si fuera
    una cocina de un muro — que es como el carpintero la va a montar.
    """
    rot, ox, oy = marco
    r = math.radians(rot)
    co, si = math.cos(r), math.sin(r)
    dx, dy = c["x"] - ox, c["y"] - oy
    return {**c, "x": dx * co + dy * si, "y": -dx * si + dy * co, "rz": 0.0}


def _rects(paneles, vista: str, marco=None) -> list[tuple[float, float, float, float, str]]:
    """(x0, y0, ancho, alto, nombre) en mm del proyecto."""
    eh, ev, sh, sv = VISTAS[vista]
    out = []
    for p in paneles:
        for i, c in enumerate(p.colocacion or []):
            nombre = p.name if len(p.colocacion) == 1 else f"{p.name}_{i+1}"
            if marco is not None:
                c = _local(c, marco)
            th, tv = _extension(c, sh), _extension(c, sv)
            out.append((c[eh] - th / 2, c[ev] - tv / 2, th, tv, nombre))
    return out


def _marco_de(t) -> tuple[float, float, float]:
    rot = float(getattr(t, "rotacion", 0.0) or 0.0)
    ox, oy = (list(getattr(t, "origen", None) or [0.0, 0.0]) + [0.0, 0.0])[:2]
    return rot, float(ox), float(oy)


def marcos_por_modulo(project) -> dict[str, tuple[float, float, float]]:
    """id de módulo → marco de su muro. Espeja el agrupamiento de posicion.py:
    los módulos sueltos viven en el marco del primer tramo."""
    if not project.tramos:
        return {}
    principal = _marco_de(project.tramos[0])
    fuera = {m.id for m in project.modules}
    salida: dict[str, tuple[float, float, float]] = {}
    for t in project.tramos:
        for mid in t.modulos:
            salida.setdefault(mid, _marco_de(t))
            fuera.discard(mid)
    for mid in fuera:
        salida[mid] = principal
    return salida


def alzados(project) -> list[tuple[str, list, tuple | None]]:
    """(título, paneles, marco) — un alzado por muro.

    Con un solo muro se devuelve el conjunto completo, como siempre. En cuanto
    hay un tramo girado (L o U) se separa por muro: un alzado del conjunto con
    un muro de canto no le sirve a nadie.
    """
    todos = [p for p in project.all_panels() if p.colocacion]
    if not any(_marco_de(t)[0] for t in project.tramos):
        return [("alzado frontal", todos, None)]

    # varios tramos pueden compartir muro (torre + corrida de piso + alacenas):
    # es UN alzado, no tres. El marco es el del primer tramo de ese muro; una
    # diferencia de origen sólo desplaza el dibujo, que se reencuadra solo.
    orden: list[str] = []
    por_muro: dict[str, list] = {}
    for t in project.tramos:
        if t.muro not in por_muro:
            por_muro[t.muro] = []
            orden.append(t.muro)
        por_muro[t.muro].append(t)

    salida: list[tuple[str, list, tuple | None]] = []
    for muro in orden:
        tramos = por_muro[muro]
        marco = _marco_de(tramos[0])
        ids = {mid for t in tramos for mid in t.modulos}
        if muro == project.tramos[0].muro:      # los sueltos viven aquí
            ids |= {m.id for m in project.modules
                    if not any(m.id in t.modulos for t in project.tramos)}
        paneles = [p for m in project.modules if m.id in ids
                   for p in m.panels if p.colocacion]
        paneles += [p for t in tramos for p in t.panels if p.colocacion]
        if paneles:
            salida.append((f"alzado · muro {muro}", paneles, marco))
    return salida or [("alzado frontal", todos, None)]


class Plano(Flowable):
    """Dibuja una vista ortogonal a escala, con cotas generales."""

    def __init__(self, paneles, vista: str = "frontal", ancho_disp: float = 170 * mm,
                 alto_max: float = 95 * mm, titulo: str = "", cotas: bool = True,
                 marco=None):
        """`marco` = (rotacion, origen_x, origen_y) de un tramo girado: dibuja
        ese muro de frente en lugar de verlo de canto."""
        super().__init__()
        self.rects = _rects(paneles, vista, marco)
        self.titulo = titulo
        self.cotas = cotas
        self.ancho_disp = ancho_disp
        self.alto_max = alto_max

        if self.rects:
            self.mnx = min(r[0] for r in self.rects)
            self.mny = min(r[1] for r in self.rects)
            self.mxx = max(r[0] + r[2] for r in self.rects)
            self.mxy = max(r[1] + r[3] for r in self.rects)
        else:
            self.mnx = self.mny = 0.0
            self.mxx = self.mxy = 1.0

        ancho_mm = max(self.mxx - self.mnx, 1.0)
        alto_mm = max(self.mxy - self.mny, 1.0)
        margen_cotas = 14 * mm if cotas else 2 * mm
        self.escala = min((ancho_disp - margen_cotas) / (ancho_mm * mm),
                          (alto_max - margen_cotas) / (alto_mm * mm))
        self.width = ancho_disp
        self.height = alto_mm * mm * self.escala + margen_cotas

    def _px(self, x: float) -> float:
        return (x - self.mnx) * mm * self.escala

    def _py(self, y: float) -> float:
        return (y - self.mny) * mm * self.escala

    def draw(self):
        c = self.canv
        off_x = 10 * mm if self.cotas else 1 * mm
        off_y = 10 * mm if self.cotas else 1 * mm
        c.saveState()
        c.translate(off_x, off_y)

        for x0, y0, w, h, _n in self.rects:
            c.setStrokeColor(TINTA)
            c.setFillColor(GRIS_CLARO)
            c.setLineWidth(0.4)
            c.rect(self._px(x0), self._py(y0), w * mm * self.escala,
                   h * mm * self.escala, stroke=1, fill=1)

        if self.cotas:
            ancho_total = self.mxx - self.mnx
            alto_total = self.mxy - self.mny
            px_w = ancho_total * mm * self.escala
            px_h = alto_total * mm * self.escala
            c.setStrokeColor(PRIMARY)
            c.setFillColor(PRIMARY)
            c.setLineWidth(0.4)
            c.setFont(MONO, 6)
            # cota horizontal (abajo)
            c.line(0, -5 * mm, px_w, -5 * mm)
            c.line(0, -6.5 * mm, 0, -3.5 * mm)
            c.line(px_w, -6.5 * mm, px_w, -3.5 * mm)
            c.drawCentredString(px_w / 2, -4.2 * mm, f"{ancho_total:.0f} mm")
            # cota vertical (izquierda)
            c.line(-5 * mm, 0, -5 * mm, px_h)
            c.line(-6.5 * mm, 0, -3.5 * mm, 0)
            c.line(-6.5 * mm, px_h, -3.5 * mm, px_h)
            c.saveState()
            c.translate(-6.2 * mm, px_h / 2)
            c.rotate(90)
            c.drawCentredString(0, 1.2 * mm, f"{alto_total:.0f} mm")
            c.restoreState()

        if self.titulo:
            c.setFont(MONO, 6)
            c.setFillColor(GRIS)
            c.drawString(0, self.height - off_y - 3 * mm, self.titulo.upper())
        c.restoreState()


class Despiece(Flowable):
    """Cada pieza del módulo dibujada suelta y acotada — el plano del carpintero."""

    COLS = 5

    def __init__(self, panels, ancho_disp: float = 170 * mm):
        super().__init__()
        self.piezas = [p for p in panels if p.largo and p.ancho]
        self.width = ancho_disp
        self.celda = ancho_disp / self.COLS
        filas = (len(self.piezas) + self.COLS - 1) // self.COLS
        self.alto_celda = self.celda * 0.95
        self.height = filas * self.alto_celda + 2 * mm

    def draw(self):
        c = self.canv
        util = self.celda * 0.62      # espacio de dibujo dentro de la celda
        for i, p in enumerate(self.piezas):
            col, fila = i % self.COLS, i // self.COLS
            cx = col * self.celda + self.celda / 2
            cy = self.height - (fila + 1) * self.alto_celda + self.alto_celda / 2

            lado = max(p.largo, p.ancho, 1)
            k = util / lado
            w, h = p.largo * k, p.ancho * k

            c.setStrokeColor(TINTA)
            c.setFillColor(GRIS_CLARO)
            c.setLineWidth(0.4)
            c.rect(cx - w / 2, cy - h / 2 + 3 * mm, w, h, stroke=1, fill=1)

            # marca de cubrecanto: línea gruesa primary en los lados encintados
            c.setStrokeColor(PRIMARY)
            c.setLineWidth(1.6)
            x0, y0 = cx - w / 2, cy - h / 2 + 3 * mm
            if p.cantos.get("frontal"):
                c.line(x0, y0, x0, y0 + h)
            if p.cantos.get("trasero"):
                c.line(x0 + w, y0, x0 + w, y0 + h)
            if p.cantos.get("superior"):
                c.line(x0, y0 + h, x0 + w, y0 + h)
            if p.cantos.get("inferior"):
                c.line(x0, y0, x0 + w, y0)

            c.setFont(SANS, 5.2)
            c.setFillColor(TINTA)
            etiqueta = p.name.split("_", 1)[-1][:22]
            c.drawCentredString(cx, cy - h / 2 + 0.2 * mm,
                                f"{etiqueta} ×{int(p.cantidad)}")
            c.setFont(MONO, 5)
            c.setFillColor(GRIS)
            c.drawCentredString(cx, cy - h / 2 - 2.2 * mm,
                                f"{p.largo:.0f}×{p.ancho:.0f}×{p.espesor:.0f}")


class HojaNesting(Flowable):
    """Una hoja 2440×1220 con las piezas acomodadas (kerf ya considerado)."""

    def __init__(self, hoja, hoja_largo: float, hoja_ancho: float,
                 ancho_disp: float = 170 * mm):
        super().__init__()
        self.hoja = hoja
        self.hl, self.ha = hoja_largo, hoja_ancho
        self.width = ancho_disp
        self.k = ancho_disp / hoja_largo
        self.height = hoja_ancho * self.k + 4 * mm

    def draw(self):
        c = self.canv
        k = self.k
        c.setStrokeColor(GRIS)
        c.setLineWidth(0.6)
        c.rect(0, 2 * mm, self.hl * k, self.ha * k, stroke=1, fill=0)

        for p in self.hoja.piezas:
            c.setStrokeColor(TINTA)
            c.setFillColor(GRIS_CLARO)
            c.setLineWidth(0.3)
            c.rect(p.x * k, 2 * mm + p.y * k, p.largo * k, p.ancho * k,
                   stroke=1, fill=1)
            if p.largo * k > 16 and p.ancho * k > 7:
                c.setFont(MONO, 4.2)
                c.setFillColor(TINTA)
                c.drawCentredString(p.x * k + p.largo * k / 2,
                                    2 * mm + p.y * k + p.ancho * k / 2 - 1.4,
                                    p.panel.split("_", 1)[-1][:18])
