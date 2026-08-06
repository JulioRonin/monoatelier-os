"""Reglas de herraje Mono Atelier.

Bisagras de cazoleta 35mm: recta / semicurva / curva.
El TIPO no es intercambiable al comprar y además DETERMINA el ancho de la puerta.
"""

from __future__ import annotations

from ..constants import (
    T, GAP_FRENTES, GAP_INSET, CAZOLETA_D, CAZOLETA_CENTRO, CAZOLETA_EXTREMOS,
    HOLGURA_LATERAL, HOLGURA_BAJOCAJON, num_bisagras, num_patas,
)
from ..models import HardwareItem, DrillOp

BISAGRA_SKU = {
    "recta": ("BIS-35-REC", "Bisagra cazoleta 35mm recta (sobreposición total)"),
    "semicurva": ("BIS-35-SEM", "Bisagra cazoleta 35mm semicurva (media sobreposición)"),
    "curva": ("BIS-35-CUR", "Bisagra cazoleta 35mm curva (puerta interior)"),
}


def tipo_bisagra(num_puertas: int, hay_divisor: bool, interior: bool = False) -> str:
    """recta   → una puerta por lateral, cubre el lateral completo
    semicurva  → dos puertas comparten un divisor
    curva      → puerta interior, va dentro del vano"""
    if interior:
        return "curva"
    if hay_divisor and num_puertas >= 2:
        return "semicurva"
    return "recta"


def ancho_puerta(ancho_modulo: float, num_puertas: int, tipo: str,
                 vano_interior: float | None = None) -> float:
    """Ancho de CADA puerta según el tipo de bisagra."""
    if tipo == "curva":
        if vano_interior is None:
            raise ValueError("bisagra curva requiere vano_interior")
        return vano_interior - 2 * GAP_INSET
    if num_puertas == 1:
        return ancho_modulo - GAP_FRENTES
    return (ancho_modulo - GAP_FRENTES) / num_puertas


def perforaciones_cazoleta(alto_puerta: float) -> list[DrillOp]:
    """Cazoletas Ø35: extremas a 100mm, resto repartidas."""
    n = num_bisagras(alto_puerta)
    if n < 2:
        n = 2
    y0, y1 = CAZOLETA_EXTREMOS, alto_puerta - CAZOLETA_EXTREMOS
    paso = (y1 - y0) / (n - 1)
    return [
        DrillOp(tipo="cazoleta", diametro=CAZOLETA_D, x=CAZOLETA_CENTRO,
                y=round(y0 + i * paso, 1), profundidad=12.5, cara="interior",
                nota="centro de cazoleta a 21.5mm del canto")
        for i in range(n)
    ]


def bisagras_para(alto_puerta: float, tipo: str, num_puertas: int = 1) -> HardwareItem:
    sku, desc = BISAGRA_SKU[tipo]
    return HardwareItem(sku, desc, num_bisagras(alto_puerta) * num_puertas, "pza")


def patas_para(ancho: float) -> HardwareItem:
    return HardwareItem("PAT-NIV-100", "Pata niveladora 100mm", num_patas(ancho), "pza")


def holgura_corredera(tipo: str) -> int:
    """Holgura POR LADO entre el lateral del mueble y el lateral de la caja."""
    if tipo == "lateral":
        return HOLGURA_LATERAL      # 13 (rango real 13–15)
    if tipo == "bajo_cajon":
        return HOLGURA_BAJOCAJON    # 7  (rango real 6–8)
    raise ValueError(f"tipo de corredera desconocido: {tipo}")


def corredera_para(longitud: int, tipo: str = "lateral") -> HardwareItem:
    if tipo == "lateral":
        return HardwareItem(f"COR-LAT-{longitud}",
                            f"Corredera lateral extensión {longitud}mm", 1, "par")
    return HardwareItem(f"COR-BAJ-{longitud}",
                        f"Corredera bajo cajón {longitud}mm", 1, "par")


def union_estructura(num_uniones: int) -> list[HardwareItem]:
    return [
        HardwareItem("UNI-MIN-15", "Minifix + tarugo", num_uniones, "jgo"),
        HardwareItem("TOR-35X45", "Tornillo 3.5x45", max(8, num_uniones), "pza"),
    ]
