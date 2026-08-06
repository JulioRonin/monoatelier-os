"""cotizacion.pdf — documento de CLIENTE.

El margen NUNCA aparece aquí: sólo el precio final. El desglose interno vive
en costos_internos.pdf, que no se entrega.
"""

from __future__ import annotations

import os
from datetime import date

from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer

from ..costing import Tarifas, costear
from ..models import Project
from .estilo import A4, MARGEN, dinero, encabezado, estilos, marca, tabla
from .planos import Plano, alzados

ANCHO_UTIL = A4[0] - 2 * MARGEN


def _nombre_bonito(m) -> str:
    etiquetas = {
        "base": "Mueble inferior", "base_tarja": "Mueble inferior de tarja",
        "superior": "Alacena", "torre": "Torre", "cajonera": "Cajonera",
    }
    return f"{etiquetas.get(m.tipo, m.tipo.title())} {m.id}"


def cotizacion_pdf(project: Project, destino: str, tarifas: Tarifas | None = None,
                   vigencia_dias: int = 15, tiempo_entrega: str = "") -> str:
    st = estilos()
    costos = costear(project, tarifas)
    moneda = costos["moneda"]
    ruta = os.path.join(destino, "cotizacion.pdf")

    doc = SimpleDocTemplate(ruta, pagesize=A4, leftMargin=MARGEN, rightMargin=MARGEN,
                            topMargin=MARGEN + 10 * mm, bottomMargin=MARGEN + 6 * mm,
                            title=f"Cotización — {project.nombre}",
                            author="Mono Atelier")
    doc._mono_subtitulo = "COTIZACIÓN"

    fl = encabezado("Cotización", f"MONO ATELIER · {date.today():%d.%m.%Y}", st)
    fl.append(tabla([
        ["Cliente", "Proyecto", "Vigencia"],
        [project.cliente, project.nombre, f"{vigencia_dias} días naturales"],
    ], [ANCHO_UTIL * 0.34, ANCHO_UTIL * 0.44, ANCHO_UTIL * 0.22],
        alineacion_num=False, tam=8.5))
    fl.append(Spacer(1, 14))

    # ── Vista del conjunto ──────────────────────────────────────────
    paneles_con_pos = [p for p in project.all_panels() if p.colocacion]
    if paneles_con_pos:
        fl.append(Paragraph("El conjunto", st["h2"]))
        for titulo, paneles, marco in alzados(project):
            fl.append(Plano(paneles, "frontal", ANCHO_UTIL, 80 * mm,
                            titulo=titulo, marco=marco))
            fl.append(Spacer(1, 10))

    # ── Partidas ────────────────────────────────────────────────────
    # El precio se prorratea por área de tablero de cada módulo: es la métrica
    # que realmente mueve material, corte, canto y mano de obra.
    area_total = sum(m.area_m2 for m in project.modules) + \
        sum(sum(p.area_m2 for p in t.panels) for t in project.tramos)
    precio_total = costos["precio_cliente"]

    filas = [["Concepto", "Medidas (mm)", "Importe"]]
    acumulado = 0.0
    for m in project.modules:
        parte = (m.area_m2 / area_total * precio_total) if area_total else 0.0
        acumulado += parte
        filas.append([
            _nombre_bonito(m),
            f"{m.ancho:.0f} ancho × {m.alto:.0f} alto × {m.prof:.0f} fondo",
            dinero(parte, moneda) if precio_total else "—",
        ])
    for t in project.tramos:
        area_t = sum(p.area_m2 for p in t.panels)
        if not area_t:
            continue
        parte = (area_t / area_total * precio_total) if area_total else 0.0
        acumulado += parte
        filas.append([f"Cubierta — tramo {t.id}", "fabricación propia, canto frontal",
                      dinero(parte, moneda) if precio_total else "—"])

    # el redondeo de prorrateo nunca debe alterar el total
    if precio_total and filas[1:]:
        ajuste = precio_total - acumulado
        if abs(ajuste) > 0.005:
            ultimo = filas[-1]
            valor = float(ultimo[2].replace("$", "").replace(",", "").split()[0])
            ultimo[2] = dinero(valor + ajuste, moneda)

    fl.append(Paragraph("Partidas", st["h2"]))
    fl.append(tabla(filas, [ANCHO_UTIL * 0.36, ANCHO_UTIL * 0.42, ANCHO_UTIL * 0.22],
                    tam=8))
    fl.append(Spacer(1, 8))

    if precio_total:
        fl.append(Paragraph(f"Total {dinero(precio_total, moneda)}", st["total"]))
        fl.append(Paragraph("Precio final. No incluye IVA salvo indicación expresa.",
                            st["nota"]))
    else:
        fl.append(Paragraph(
            "COTIZACIÓN PRELIMINAR — sin importe: faltan precios en el catálogo.",
            st["alerta"]))

    if costos["skus_sin_precio"]:
        fl.append(Paragraph(
            f"Nota interna (no entregar): {len(costos['skus_sin_precio'])} SKU(s) sin "
            f"precio en catálogo — {', '.join(costos['skus_sin_precio'])}.", st["alerta"]))

    # ── Lo que incluye ──────────────────────────────────────────────
    fl.append(Spacer(1, 12))
    incluye = [
        "Fabricación con tablero de 15mm y cubrecanto aplicado lado por lado según pieza.",
        "Estructura Mono Atelier: el tablero carga el peso, el tornillo sólo alinea.",
        "Fondo de 3mm aplicado que escuadra el mueble.",
        "Herrajes de cazoleta 35mm y correderas de 500mm, patas niveladoras.",
        "Modelo 3D del proyecto y visualización en realidad aumentada.",
        "Manual de ensamble y documento de entrega.",
    ]
    if any(m.led for m in project.modules):
        incluye.append("Iluminación LED con fuente dimensionada y ruteo previsto.")
    if project.tramos:
        incluye.append("Cubierta de fabricación propia con vuelo frontal.")

    fl.append(Paragraph("Incluye", st["h2"]))
    for i in incluye:
        fl.append(Paragraph(f"— {i}", st["cuerpo"]))

    fl.append(Paragraph("No incluye", st["h2"]))
    for i in ["Instalaciones hidráulicas, eléctricas y de gas.",
              "Electrodomésticos, tarja y grifería.",
              "Albañilería, plomería o resanes del muro.",
              "Cubierta de piedra natural o cuarzo (se cotiza aparte)."]:
        fl.append(Paragraph(f"— {i}", st["cuerpo"]))

    if tiempo_entrega:
        fl.append(Paragraph("Tiempo de entrega", st["h2"]))
        fl.append(Paragraph(tiempo_entrega, st["cuerpo"]))

    # ── Condiciones y firma ─────────────────────────────────────────
    fl.append(PageBreak())
    fl.append(Paragraph("Condiciones", st["h2"]))
    for c in [
        "Anticipo del 60% para programar fabricación; 40% contra entrega.",
        "Las medidas se confirman en sitio antes de cortar. Cualquier cambio "
        "posterior al corte se cotiza por separado.",
        f"Precios vigentes {vigencia_dias} días naturales a partir de la fecha "
        "de esta cotización.",
        "Los tonos de tablero pueden variar ligeramente entre lotes del proveedor.",
    ]:
        fl.append(Paragraph(f"— {c}", st["cuerpo"]))

    fl.append(Spacer(1, 26))
    fl.append(KeepTogether(tabla([
        ["", ""],
        ["Mono Atelier", project.cliente],
    ], [ANCHO_UTIL / 2, ANCHO_UTIL / 2], encabezado_fila=False, alineacion_num=False,
        tam=8)))
    fl.append(Paragraph("Firmas de conformidad", st["nota"]))

    doc.build(fl, onFirstPage=marca, onLaterPages=marca)
    return ruta
