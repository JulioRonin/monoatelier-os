"""Generador de CUBIERTA — la fabrica Mono Atelier, entra al cutlist.

Se calcula POR TRAMO (suma de anchos de módulos contiguos), no por módulo.
"""

from __future__ import annotations

import math

from ..constants import (
    CUBIERTA_ESPESOR, CUBIERTA_VUELO, PROF_BASE, HOJA_LARGO, HOJA_ANCHO, KERF,
)
from ..models import Panel, cantos


def cubierta(tramo_id: str, largo_tramo: float,
             prof_modulo: float = PROF_BASE,
             vuelo: float = CUBIERTA_VUELO,
             espesor: float = CUBIERTA_ESPESOR,
             recortes: list[str] | None = None,
             material: str = "MEL-BLA-19-CUB") -> tuple[list[Panel], list[str]]:
    prof = prof_modulo + vuelo
    recortes = recortes or []
    notas: list[str] = []

    uniones = max(0, math.ceil(largo_tramo / HOJA_LARGO) - 1)
    if uniones:
        notas.append(
            f"Tramo de {largo_tramo:.0f}mm > {HOJA_LARGO}mm: {uniones} unión(es). "
            "Ubicarlas NUNCA sobre el hueco de la tarja.")

    # aviso de aprovechamiento: ¿cabe algo más a lo ancho de la hoja?
    sobrante = HOJA_ANCHO - prof - KERF
    notas.append(
        f"Cubierta de {prof:.0f}mm de fondo: sobran {sobrante:.0f}mm de hoja "
        f"(considerando kerf de {KERF}mm).")
    if 0 < prof_modulo - sobrante <= 10:
        ajuste = prof_modulo - sobrante
        notas.append(
            f"AVISO DE AHORRO: reduciendo el vuelo {ajuste:.0f}mm "
            f"(a {vuelo - ajuste:.0f}mm) el sobrante alcanza para un lateral de "
            f"{prof_modulo:.0f}mm en la misma hoja.")

    piezas = math.ceil(largo_tramo / HOJA_LARGO)
    largo_pieza = largo_tramo / piezas

    panels = [Panel(
        name=f"{tramo_id}_cubierta", largo=largo_pieza, ancho=prof, espesor=espesor,
        cantidad=piezas, material=material, rol_estructural="cubierta",
        justificacion=f"Cubierta de fabricación propia. Vuelo frontal {vuelo}mm.",
        cantos=cantos(frontal=True), veta="horizontal")]

    for r in recortes:
        notas.append(f"Recorte de {r} en cubierta: cotas en el plano de cubierta.")
    return panels, notas
