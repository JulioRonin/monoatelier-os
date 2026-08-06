"""Planos vectoriales derivados de la colocación 3D del project.json.

No se dibuja nada "a ojo": cada rectángulo sale de panel.colocacion, que a su
vez deriva de rules/posicion.py. Si el plano se ve mal, la regla está mal.
"""

from __future__ import annotations

from reportlab.lib.units import mm
from reportlab.platypus import Flowable

from .estilo import GRIS, GRIS_CLARO, MONO, PRIMARY, SANS, TINTA

# vistas: (eje horizontal, eje vertical, tamaño horizontal, tamaño vertical)
VISTAS = {
    "frontal": ("x", "z", "sx", "sz"),
    "planta": ("x", "y", "sx", "sy"),
    "lateral": ("y", "z", "sy", "sz"),
}


def _rects(paneles, vista: str) -> list[tuple[float, float, float, float, str]]:
    """(x0, y0, ancho, alto, nombre) en mm del proyecto."""
    eh, ev, sh, sv = VISTAS[vista]
    out = []
    for p in paneles:
        for i, c in enumerate(p.colocacion or []):
            nombre = p.name if len(p.colocacion) == 1 else f"{p.name}_{i+1}"
            out.append((c[eh] - c[sh] / 2, c[ev] - c[sv] / 2, c[sh], c[sv], nombre))
    return out


class Plano(Flowable):
    """Dibuja una vista ortogonal a escala, con cotas generales."""

    def __init__(self, paneles, vista: str = "frontal", ancho_disp: float = 170 * mm,
                 alto_max: float = 95 * mm, titulo: str = "", cotas: bool = True):
        super().__init__()
        self.rects = _rects(paneles, vista)
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
