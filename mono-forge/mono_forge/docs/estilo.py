"""Identidad visual Mono Atelier para los documentos.

Una sola fuente de verdad tipográfica y cromática: si mañana cambia la marca,
cambia aquí y TODOS los entregables la siguen.
"""

from __future__ import annotations

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape  # noqa: F401  (lo usan los módulos)
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

# ── Paleta (espejo del tailwind.config de la plataforma) ─────────────────
PRIMARY = colors.HexColor("#427a6e")
TINTA = colors.HexColor("#1a1a1a")
GRIS = colors.HexColor("#6b7280")
GRIS_CLARO = colors.HexColor("#e5e7eb")
FONDO = colors.HexColor("#f5f2ec")
ALERTA = colors.HexColor("#991b1b")

# Fuentes base de reportlab: sin archivos externos, funcionan en cualquier equipo.
SERIF = "Times-Italic"        # titulares (el gesto Cormorant del sistema)
SANS = "Helvetica"
SANS_BOLD = "Helvetica-Bold"
MONO = "Courier"              # etiquetas técnicas

MARGEN = 18 * mm


def estilos() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    s = {
        "titulo": ParagraphStyle("titulo", parent=base["Title"], fontName=SERIF,
                                 fontSize=26, leading=30, textColor=TINTA,
                                 alignment=0, spaceAfter=2),
        "kicker": ParagraphStyle("kicker", fontName=MONO, fontSize=7.5, leading=11,
                                 textColor=GRIS, spaceAfter=8),
        "h2": ParagraphStyle("h2", fontName=SANS_BOLD, fontSize=11, leading=15,
                             textColor=PRIMARY, spaceBefore=12, spaceAfter=6),
        "h3": ParagraphStyle("h3", fontName=SANS_BOLD, fontSize=9, leading=13,
                             textColor=TINTA, spaceBefore=8, spaceAfter=3),
        "cuerpo": ParagraphStyle("cuerpo", fontName=SANS, fontSize=9, leading=13,
                                 textColor=TINTA, spaceAfter=5),
        "nota": ParagraphStyle("nota", fontName=SANS, fontSize=8, leading=12,
                               textColor=GRIS, spaceAfter=4),
        "porque": ParagraphStyle("porque", fontName="Helvetica-Oblique", fontSize=8,
                                 leading=11.5, textColor=PRIMARY, leftIndent=8,
                                 spaceAfter=6),
        "alerta": ParagraphStyle("alerta", fontName=SANS_BOLD, fontSize=8.5,
                                 leading=12, textColor=ALERTA, spaceAfter=5),
        "total": ParagraphStyle("total", fontName=SERIF, fontSize=18, leading=22,
                                textColor=PRIMARY, alignment=TA_RIGHT),
        "pie": ParagraphStyle("pie", fontName=MONO, fontSize=6.5, leading=9,
                              textColor=GRIS, alignment=TA_CENTER),
    }
    return s


def marca(canvas, doc):
    """Membrete y pie en cada página: MONO / Atelier + numeración."""
    canvas.saveState()
    w, h = doc.pagesize

    canvas.setFont(SERIF, 15)
    canvas.setFillColor(PRIMARY)
    canvas.drawString(MARGEN, h - MARGEN + 4, "MONO")
    ancho_logo = canvas.stringWidth("MONO", SERIF, 15)
    canvas.setFont(MONO, 6)
    canvas.setFillColor(GRIS)
    canvas.drawString(MARGEN + ancho_logo + 5, h - MARGEN + 5, "A T E L I E R")

    canvas.setStrokeColor(GRIS_CLARO)
    canvas.setLineWidth(0.5)
    canvas.line(MARGEN, h - MARGEN - 4, w - MARGEN, h - MARGEN - 4)
    canvas.line(MARGEN, MARGEN, w - MARGEN, MARGEN)

    canvas.setFont(MONO, 6.5)
    canvas.setFillColor(GRIS)
    canvas.drawRightString(w - MARGEN, h - MARGEN + 5,
                           getattr(doc, "_mono_subtitulo", ""))
    canvas.drawCentredString(w / 2, MARGEN - 9, f"{doc.page}")
    canvas.restoreState()


def encabezado(titulo: str, kicker: str, st: dict) -> list:
    return [Paragraph(kicker, st["kicker"]), Paragraph(titulo, st["titulo"]),
            Spacer(1, 10)]


def tabla(datos: list[list], anchos: list[float], *, encabezado_fila: bool = True,
          alineacion_num: bool = True, tam: float = 7.5) -> Table:
    """Tabla del sistema: encabezado en primary, cebra suave, sin bordes gruesos."""
    t = Table(datos, colWidths=anchos, repeatRows=1 if encabezado_fila else 0)
    cmds = [
        ("FONTNAME", (0, 0), (-1, -1), SANS),
        ("FONTSIZE", (0, 0), (-1, -1), tam),
        ("TEXTCOLOR", (0, 0), (-1, -1), TINTA),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, GRIS_CLARO),
    ]
    if encabezado_fila:
        cmds += [
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), SANS_BOLD),
            ("FONTSIZE", (0, 0), (-1, 0), tam - 0.5),
        ]
    if alineacion_num and len(datos) > 1:
        cmds.append(("ALIGN", (1, 0), (-1, -1), "RIGHT"))
    t.setStyle(TableStyle(cmds))
    return t


def dinero(v: float, moneda: str = "MXN") -> str:
    return f"${v:,.2f} {moneda}"
