"""costos_internos.pdf — DOCUMENTO INTERNO. No se entrega al cliente.

Aquí sí se imprime el margen, el costo directo y la comparación de proveedores.
Es la única pieza del paquete que lleva esa información.
"""

from __future__ import annotations

import os
from datetime import date

from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from ..constants import FACTOR_DESPERDICIO
from ..costing import Tarifas, comparar_proveedores, costear
from ..cutlist import resumen
from ..models import Project
from .estilo import A4, MARGEN, dinero, encabezado, estilos, marca, tabla

ANCHO_UTIL = A4[0] - 2 * MARGEN


def costos_pdf(project: Project, destino: str, tarifas: Tarifas | None = None) -> str:
    st = estilos()
    tarifas = tarifas or Tarifas()
    c = costear(project, tarifas)
    r = resumen(project)
    moneda = c["moneda"]

    ruta = os.path.join(destino, "costos_internos.pdf")
    doc = SimpleDocTemplate(ruta, pagesize=A4, leftMargin=MARGEN, rightMargin=MARGEN,
                            topMargin=MARGEN + 10 * mm, bottomMargin=MARGEN + 6 * mm,
                            title=f"Costos internos — {project.nombre}",
                            author="Mono Atelier")
    doc._mono_subtitulo = "INTERNO — NO ENTREGAR"

    fl = encabezado("Costos del proyecto",
                    f"USO INTERNO · {date.today():%d.%m.%Y}", st)
    fl.append(Paragraph(
        "DOCUMENTO INTERNO. Contiene margen y costo directo: no forma parte del "
        "paquete que se entrega al cliente.", st["alerta"]))
    fl.append(Spacer(1, 8))

    fl.append(tabla([
        ["Proyecto", "Cliente", "Proveedor"],
        [project.nombre, project.cliente, c["proveedor"]],
    ], [ANCHO_UTIL * 0.4, ANCHO_UTIL * 0.35, ANCHO_UTIL * 0.25],
        alineacion_num=False, tam=8.5))
    fl.append(Spacer(1, 14))

    # ── Desglose ────────────────────────────────────────────────────
    fl.append(Paragraph("Desglose de costo directo", st["h2"]))
    ml = c["cubrecanto_ml"]
    fl.append(tabla([
        ["Concepto", "Base de cálculo", "Costo"],
        ["Material", f"{r['area_paneles_m2']} m² + {FACTOR_DESPERDICIO*100:.0f}% desperdicio",
         dinero(c["material"], moneda)],
        ["Cubrecanto máquina", f"{ml['maquina']} ml × {dinero(tarifas.canto_maquina_ml, '')}",
         dinero(c["cubrecanto"], moneda)],
        ["Cubrecanto manual", f"{ml['manual']} ml (alto brillo)", "incluido arriba"],
        ["Herraje", "consolidado por SKU", dinero(c["herraje"], moneda)],
        ["Mano de obra", f"{len(project.modules)} módulos × "
         f"{dinero(tarifas.mano_obra_modulo, '')}", dinero(c["mano_obra"], moneda)],
        ["COSTO DIRECTO", "", dinero(c["costo_directo"], moneda)],
    ], [ANCHO_UTIL * 0.28, ANCHO_UTIL * 0.44, ANCHO_UTIL * 0.28], tam=8))
    fl.append(Spacer(1, 10))

    utilidad = c["precio_cliente"] - c["costo_directo"]
    fl.append(Paragraph("Margen y precio", st["h2"]))
    fl.append(tabla([
        ["Concepto", "Valor"],
        ["Margen configurado", f"{tarifas.margen*100:.1f}%"],
        ["Costo directo", dinero(c["costo_directo"], moneda)],
        ["Utilidad bruta", dinero(utilidad, moneda)],
        ["PRECIO AL CLIENTE", dinero(c["precio_cliente"], moneda)],
    ], [ANCHO_UTIL * 0.55, ANCHO_UTIL * 0.45], tam=8.5))

    # ── Consumo de material ─────────────────────────────────────────
    fl.append(Paragraph("Consumo de material", st["h2"]))
    filas = [["Material", "Hojas", "Aprovechamiento"]]
    for material, n in r["hojas_por_material"].items():
        filas.append([material, str(n), f"{r['aprovechamiento'][material]*100:.1f}%"])
    fl.append(tabla(filas, [ANCHO_UTIL * 0.5, ANCHO_UTIL * 0.2, ANCHO_UTIL * 0.3],
                    tam=8))
    for a in r["alertas"]:
        fl.append(Paragraph(f"— {a}", st["nota"]))

    # ── Proveedores ─────────────────────────────────────────────────
    comparacion = comparar_proveedores(project, tarifas)
    if comparacion:
        fl.append(Paragraph("Simulación por proveedor", st["h2"]))
        fl.append(Paragraph(
            "El delta entre importación y marca es una palanca de margen real.",
            st["nota"]))
        base = min((v for v in comparacion.values() if v), default=0)
        filas = [["Proveedor", "Precio resultante", "Δ vs. más bajo"]]
        for prov, precio in sorted(comparacion.items(), key=lambda kv: kv[1]):
            delta = precio - base
            filas.append([prov, dinero(precio, moneda),
                          "—" if delta == 0 else f"+{dinero(delta, moneda)}"])
        fl.append(tabla(filas, [ANCHO_UTIL * 0.34, ANCHO_UTIL * 0.33,
                                ANCHO_UTIL * 0.33], tam=8))
        if c["sustituciones"]:
            fl.append(Paragraph(
                "Sustituciones aplicadas en el proveedor actual: " +
                ", ".join(f"{a} → {b}" for a, b in c["sustituciones"].items()),
                st["nota"]))

    # ── Huecos de catálogo ──────────────────────────────────────────
    if c["skus_sin_precio"]:
        fl.append(Paragraph("Huecos de catálogo", st["h2"]))
        fl.append(Paragraph(
            f"{len(c['skus_sin_precio'])} SKU(s) sin precio — el costo real es MAYOR "
            f"que el mostrado arriba. Completa catalog/materiales.csv y "
            f"catalog/herrajes.csv antes de comprometer un precio.", st["alerta"]))
        for sku in c["skus_sin_precio"]:
            fl.append(Paragraph(f"— {sku}", st["cuerpo"]))

    if not (tarifas.canto_maquina_ml or tarifas.mano_obra_modulo):
        fl.append(Paragraph(
            "AVISO: tarifas de cubrecanto y mano de obra en cero. Pásalas con "
            "--canto-maquina, --canto-manual y --mano-obra para que el costo cierre.",
            st["alerta"]))

    doc.build(fl, onFirstPage=marca, onLaterPages=marca)
    return ruta
