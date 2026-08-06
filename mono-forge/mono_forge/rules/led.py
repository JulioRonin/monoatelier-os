"""Iluminación LED: cálculo de tira, fuente y NOTAS DE RUTEO.

La nota de ruteo es la salida que casi siempre se olvida: el carpintero necesita
saber por dónde pasa el cable ANTES de armar, no después.
"""

from __future__ import annotations

from ..constants import LED_W_POR_M, LED_RETRANQUEO, fuente_led
from ..models import HardwareItem, Project

ZONAS = ("bajo_alacena", "interior_nicho", "gola", "interior_closet")


def calcular(project: Project, temperatura_k: int = 3000,
             control: str = "switch") -> tuple[list[HardwareItem], list[str]]:
    modulos = [m for m in project.modules if m.led]
    if not modulos:
        return [], []

    ml = sum(max(0.0, m.ancho - LED_RETRANQUEO) / 1000 for m in modulos)
    watts = ml * LED_W_POR_M
    fuente = fuente_led(watts)

    items = [
        HardwareItem("LED-TIRA", f"Tira LED {LED_W_POR_M}W/m {temperatura_k}K",
                     round(ml, 2), "ml"),
        HardwareItem("LED-PERFIL", "Perfil de aluminio + difusor", round(ml, 2), "ml"),
        HardwareItem("LED-FUENTE", f"Fuente {fuente}W", 1, "pza"),
        HardwareItem("LED-CTRL", f"Control: {control}", 1, "pza"),
        HardwareItem("LED-CONECT", "Conectores y cable", len(modulos) + 1, "jgo"),
    ]
    notas = [
        f"LED: {ml:.2f} ml, {watts:.1f}W → fuente de {fuente}W.",
        "RUTEO: perforar paso de cable Ø10mm en los refuerzos posteriores de los "
        "módulos con LED ANTES de armar. Marcar en el plano del casco.",
    ]
    return items, notas
