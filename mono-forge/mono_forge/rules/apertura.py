"""Sistema de apertura: jaladera | gola_aluminio | gola_tablero | push.

La gola NO es un accesorio: es geometría. Reduce el alto de los frentes y se
retranquea. Y se calcula POR TRAMO (suma de módulos contiguos), nunca por módulo:
cotizarla por módulo da mal el número y deja uniones a la vista.

Como el hueco de la gola varía mucho según el perfil, sus medidas viven en
catalog/golas.csv y NO en el código.
"""

from __future__ import annotations

import csv
import math
import os

from ..models import HardwareItem, Panel, cantos

APERTURAS = ("jaladera", "gola_aluminio", "gola_tablero", "push")
_CATALOGO = os.path.join(os.path.dirname(__file__), "..", "..", "catalog", "golas.csv")


def cargar_golas(path: str | None = None) -> dict[str, dict]:
    path = path or _CATALOGO
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return {r["sku"]: r for r in csv.DictReader(f)}


def gola_por_sku(sku: str, path: str | None = None) -> dict:
    golas = cargar_golas(path)
    if sku not in golas:
        raise KeyError(f"gola '{sku}' no está en catalog/golas.csv")
    return golas[sku]


def ajustar_frentes(alto_frente: float, apertura: str, gola_hueco: float = 0.0) -> float:
    """Con gola, el frente pierde el alto del hueco."""
    if apertura not in APERTURAS:
        raise ValueError(f"apertura desconocida: {apertura}")
    if apertura in ("gola_aluminio", "gola_tablero"):
        if gola_hueco <= 0:
            raise ValueError("gola requiere gola_hueco (leerlo de catalog/golas.csv)")
        return alto_frente - gola_hueco
    return alto_frente


def gola_de_tramo(tramo_id: str, largo_tramo: float, sku: str,
                  path: str | None = None) -> tuple[list[Panel], list[HardwareItem], list[str]]:
    """Devuelve (paneles, herraje, notas) de la gola de un TRAMO completo."""
    g = gola_por_sku(sku, path)
    notas: list[str] = []

    if g["tipo"] == "aluminio":
        largo_com = float(g["largo_comercial_mm"])
        tramos = math.ceil(largo_tramo / largo_com)
        uniones = max(0, tramos - 1)
        desperdicio = tramos * largo_com - largo_tramo
        notas.append(
            f"Gola {sku}: {largo_tramo:.0f}mm de tramo → {tramos} perfil(es) de "
            f"{largo_com:.0f}mm, {uniones} unión(es), desperdicio {desperdicio:.0f}mm.")
        return [], [HardwareItem(sku, g["descripcion"], round(largo_tramo / 1000, 2), "ml"),
                    HardwareItem(f"{sku}-TAP", "Tapas y uniones de gola", 2 + uniones, "pza")], notas

    # gola fabricada con el mismo tablero
    alto = float(g["alto_hueco_mm"])
    notas.append(f"Gola de tablero {sku}: fabricada en obra, hueco {alto:.0f}mm.")
    p = Panel(name=f"{tramo_id}_gola_tablero", largo=largo_tramo, ancho=alto + 30,
              rol_estructural="gola",
              justificacion="Gola fabricada con el mismo tablero (sin perfil de aluminio).",
              cantos=cantos(frontal=True, superior=True))
    return [p], [], notas
