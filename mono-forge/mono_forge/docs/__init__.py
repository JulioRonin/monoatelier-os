"""Generación de entregables desde el project.json.

Todo sale del modelo de datos: ningún documento mide mallas ni reescribe
medidas. Si un número no cuadra, el error está en los parámetros o en una
regla, nunca en el documento.
"""

from __future__ import annotations

import os

from ..costing import Tarifas
from ..cutlist import resumen
from ..models import Project
from .costos import costos_pdf
from .cotizacion import cotizacion_pdf
from .entrega import entrega_pdf
from .manual import manual_pdf
from .xlsx import cutlist_xlsx, herrajes_xlsx

__all__ = ["generar_todo", "verificar", "cutlist_xlsx", "herrajes_xlsx",
           "cotizacion_pdf", "manual_pdf", "entrega_pdf", "costos_pdf"]

#: los 7 entregables del sistema + el reporte interno de costos
ESPERADOS = ("modelo.blend", "preview.glb", "cutlist.xlsx", "herrajes.xlsx",
             "cotizacion.pdf", "manual_ensamble.pdf", "entrega.pdf",
             "costos_internos.pdf")


def generar_todo(project: Project, destino: str, tarifas: Tarifas | None = None,
                 ar_url: str = "") -> dict[str, str]:
    """Construye cutlist, herrajes, cotización, manual, entrega y costos."""
    os.makedirs(destino, exist_ok=True)
    return {
        "cutlist.xlsx": cutlist_xlsx(project, destino),
        "herrajes.xlsx": herrajes_xlsx(project, destino),
        "cotizacion.pdf": cotizacion_pdf(project, destino, tarifas),
        "manual_ensamble.pdf": manual_pdf(project, destino),
        "entrega.pdf": entrega_pdf(project, destino, ar_url=ar_url),
        "costos_internos.pdf": costos_pdf(project, destino, tarifas),
    }


def verificar(project: Project, destino: str) -> dict:
    """La verificación que exige CLAUDE.md al terminar cualquier pipeline.

    · área de cutlist ≈ área de paneles del JSON (±1%)
    · bisagras == puertas × regla de altura
    · suma vertical de las torres cuadrada
    · existencia de los entregables
    """
    from ..constants import T, alto_lateral, num_bisagras

    problemas: list[str] = []
    r = resumen(project)

    # 1. área
    area_json = sum(p.area_m2 for p in project.all_panels())
    area_cut = sum(h.area_usada for hs in r["detalle"].values() for h in hs)
    if area_json > 0 and abs(area_cut - area_json) / area_json > 0.01:
        problemas.append(
            f"Área de cutlist ({area_cut:.3f} m²) difiere más de 1% del área de "
            f"paneles del JSON ({area_json:.3f} m²).")

    # 2. bisagras vs puertas
    for m in project.modules:
        puertas = [p for p in m.panels if p.rol_estructural == "frente"
                   and m.tipo != "cajonera"]
        esperadas = sum(num_bisagras(p.largo) * int(p.cantidad) for p in puertas)
        declaradas = sum(h.cantidad for h in m.hardware if h.sku.startswith("BIS-"))
        if esperadas != declaradas:
            problemas.append(
                f"{m.id}: {declaradas:g} bisagras declaradas, {esperadas} esperadas "
                f"por la regla de altura.")

    # 3. suma vertical de torres
    for m in project.modules:
        if m.tipo != "torre":
            continue
        lat = next((p for p in m.panels if p.rol_estructural == "lateral_apoyado"), None)
        if lat is None:
            problemas.append(f"{m.id}: torre sin lateral apoyado.")
            continue
        esperado = alto_lateral("torre", m.alto)
        if abs(lat.largo - esperado) > 0.01:
            problemas.append(
                f"{m.id}: lateral de {lat.largo}mm; la suma vertical exige {esperado}mm.")
        zoclo = next((p for p in m.panels if p.rol_estructural == "zoclo"), None)
        if zoclo and abs((zoclo.ancho + T + lat.largo) - m.alto) > 0.01:
            problemas.append(
                f"{m.id}: zoclo {zoclo.ancho} + base {T} + lateral {lat.largo} "
                f"≠ alto total {m.alto}.")

    # 4. archivos
    faltantes = [f for f in ESPERADOS
                 if not os.path.exists(os.path.join(destino, f))]

    return {
        "ok": not problemas and not faltantes,
        "problemas": problemas,
        "faltantes": faltantes,
        "area_json_m2": round(area_json, 3),
        "area_cutlist_m2": round(area_cut, 3),
    }
