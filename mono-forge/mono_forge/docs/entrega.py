"""entrega.pdf — el documento que se firma con el cliente al entregar.

Renders (si existen), especificaciones, garantía, cuidados y firma.
"""

from __future__ import annotations

import os
from datetime import date

from reportlab.lib.units import mm
from reportlab.platypus import (
    Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
)

from ..models import Project
from .estilo import A4, MARGEN, encabezado, estilos, marca, tabla
from .planos import Plano

ANCHO_UTIL = A4[0] - 2 * MARGEN
_EXT_IMG = (".png", ".jpg", ".jpeg")


def _renders(destino: str) -> list[str]:
    carpeta = os.path.join(destino, "renders")
    if not os.path.isdir(carpeta):
        return []
    return [os.path.join(carpeta, f) for f in sorted(os.listdir(carpeta))
            if f.lower().endswith(_EXT_IMG)]


def entrega_pdf(project: Project, destino: str, ar_url: str = "",
                garantia_meses: int = 12) -> str:
    st = estilos()
    ruta = os.path.join(destino, "entrega.pdf")
    doc = SimpleDocTemplate(ruta, pagesize=A4, leftMargin=MARGEN, rightMargin=MARGEN,
                            topMargin=MARGEN + 10 * mm, bottomMargin=MARGEN + 6 * mm,
                            title=f"Entrega — {project.nombre}", author="Mono Atelier")
    doc._mono_subtitulo = "ENTREGA"

    fl = encabezado("Documento de entrega",
                    f"MONO ATELIER · {date.today():%d.%m.%Y}", st)
    fl.append(tabla([
        ["Cliente", "Proyecto", "Fecha de entrega"],
        [project.cliente, project.nombre, f"{date.today():%d.%m.%Y}"],
    ], [ANCHO_UTIL * 0.34, ANCHO_UTIL * 0.44, ANCHO_UTIL * 0.22],
        alineacion_num=False, tam=8.5))
    fl.append(Spacer(1, 14))

    # ── Renders o plano ─────────────────────────────────────────────
    renders = _renders(destino)
    if renders:
        fl.append(Paragraph("El proyecto", st["h2"]))
        for r in renders[:4]:
            try:
                img = Image(r)
                escala = ANCHO_UTIL / img.imageWidth
                img.drawWidth = ANCHO_UTIL
                img.drawHeight = img.imageHeight * escala
                fl.append(img)
                fl.append(Spacer(1, 8))
            except Exception:
                continue
    else:
        paneles_pos = [p for p in project.all_panels() if p.colocacion]
        if paneles_pos:
            fl.append(Paragraph("El proyecto", st["h2"]))
            fl.append(Plano(paneles_pos, "frontal", ANCHO_UTIL, 85 * mm,
                            titulo="alzado frontal"))
            fl.append(Paragraph(
                "Renders no incluidos en este paquete: genera la carpeta renders/ "
                "con blender/render_presets.py y vuelve a construir el documento.",
                st["nota"]))

    # ── Especificaciones ────────────────────────────────────────────
    fl.append(PageBreak())
    fl.append(Paragraph("Especificaciones", st["h2"]))
    filas = [["Módulo", "Tipo", "Ancho", "Alto", "Fondo", "Apertura"]]
    for m in project.modules:
        filas.append([m.id, m.tipo.replace("_", " "), f"{m.ancho:.0f} mm",
                      f"{m.alto:.0f} mm", f"{m.prof:.0f} mm", m.apertura])
    fl.append(tabla(filas, [ANCHO_UTIL * 0.14, ANCHO_UTIL * 0.22, ANCHO_UTIL * 0.16,
                            ANCHO_UTIL * 0.16, ANCHO_UTIL * 0.16, ANCHO_UTIL * 0.16],
                    tam=8))
    fl.append(Spacer(1, 6))

    materiales = sorted({p.material for p in project.all_panels()})
    fl.append(Paragraph("Materiales empleados", st["h3"]))
    fl.append(Paragraph(", ".join(materiales), st["cuerpo"]))

    if ar_url:
        fl.append(Paragraph("Tu proyecto en realidad aumentada", st["h2"]))
        fl.append(Paragraph(
            f"Abre este enlace desde tu teléfono para ver el mueble a escala real "
            f"en tu espacio: {ar_url}", st["cuerpo"]))

    # ── Garantía y cuidados ─────────────────────────────────────────
    fl.append(Paragraph("Garantía", st["h2"]))
    for g in [
        f"{garantia_meses} meses sobre defectos de fabricación y herrajes, a partir "
        f"de la fecha de esta entrega.",
        "Cubre: desalineación de frentes por ajuste, falla de bisagras o correderas, "
        "desprendimiento de cubrecanto no provocado.",
        "No cubre: humedad, golpes, sobrecarga de entrepaños, modificaciones hechas "
        "por terceros, ni variación natural de tono entre lotes de tablero.",
    ]:
        fl.append(Paragraph(f"— {g}", st["cuerpo"]))

    fl.append(Paragraph("Cuidados", st["h2"]))
    for c in [
        "Limpia con paño húmedo y jabón neutro. Nunca abrasivos, solventes ni cloro.",
        "Seca de inmediato cualquier escurrimiento en juntas y cantos: la humedad "
        "prolongada es lo único que realmente daña el tablero.",
        "Los entrepaños móviles soportan carga distribuida, no puntual.",
        "Si un frente se desalinea con el uso, se ajusta en los tres ejes de la "
        "bisagra: avísanos y lo hacemos.",
    ]:
        fl.append(Paragraph(f"— {c}", st["cuerpo"]))

    if project.notas:
        fl.append(Paragraph("Notas del proyecto", st["h2"]))
        for n in project.notas:
            fl.append(Paragraph(f"— {n}", st["nota"]))

    # ── Firma ───────────────────────────────────────────────────────
    fl.append(Spacer(1, 24))
    fl.append(Paragraph("Recepción de conformidad", st["h2"]))
    fl.append(Paragraph(
        "El cliente declara haber recibido el proyecto descrito, revisado su "
        "funcionamiento y aceptado su estado.", st["cuerpo"]))
    fl.append(Spacer(1, 26))
    fl.append(KeepTogether(tabla([
        ["", ""],
        ["Entrega — Mono Atelier", f"Recibe — {project.cliente}"],
    ], [ANCHO_UTIL / 2, ANCHO_UTIL / 2], encabezado_fila=False,
        alineacion_num=False, tam=8)))

    doc.build(fl, onFirstPage=marca, onLaterPages=marca)
    return ruta
