"""Generador de mueble SUPERIOR (alacena)."""

from __future__ import annotations

from ..constants import (
    T, T_FRENTE_STD, PROF_SUPERIOR, PROF_SUPERIOR_RANGO, ALTO_SUPERIOR_DEFAULT,
    GAP_FRENTES, ANCHO_MAX_SIN_DIVISOR,
)
from ..models import Module, Panel, cantos
from ..rules import estructura as est
from ..rules import herrajes as hw
from ..rules.apertura import ajustar_frentes


def alacena(
    id: str,
    ancho: float,
    alto: float = ALTO_SUPERIOR_DEFAULT,
    prof: float = PROF_SUPERIOR,
    puertas: int = 1,
    entrepanos: int = 1,
    esp_frente: float = T_FRENTE_STD,
    material: str = "MEL-BLA-15-IMP",
    material_frente: str | None = None,
    apertura: str = "jaladera",
    gola_hueco: float = 0.0,
    led: bool = False,
) -> Module:
    lo, hi = PROF_SUPERIOR_RANGO
    if not lo <= prof <= hi:
        raise ValueError(f"profundidad de superior fuera de rango {PROF_SUPERIOR_RANGO}: {prof}")

    material_frente = material_frente or material
    hay_divisor = ancho > ANCHO_MAX_SIN_DIVISOR

    m = Module(id=id, tipo="superior", ancho=ancho, alto=alto, prof=prof,
               apertura=apertura, led=led)
    m.panels += est.casco_colgado(id, ancho, alto, prof, material=material)

    if entrepanos:
        for v in est.vanos(ancho, hay_divisor):
            m.panels.append(est.entrepano(id, v, prof, n=entrepanos, material=material))

    tipo_bis = hw.tipo_bisagra(puertas, hay_divisor)
    ancho_p = hw.ancho_puerta(ancho, puertas, tipo_bis)
    alto_p = ajustar_frentes(alto - GAP_FRENTES, apertura, gola_hueco)

    m.panels.append(Panel(
        name=f"{id}_puerta", largo=alto_p, ancho=ancho_p, espesor=esp_frente,
        cantidad=puertas, material=material_frente, rol_estructural="frente",
        justificacion=f"Bisagra {tipo_bis}.",
        cantos=cantos(True, True, True, True), veta="vertical",
        drilling=hw.perforaciones_cazoleta(alto_p)))

    m.hardware.append(hw.bisagras_para(alto_p, tipo_bis, puertas))
    m.hardware += hw.union_estructura(num_uniones=8)
    m.notas.append("Techo y piso CAPTURADOS entre laterales: el tornillo trabaja a cortante.")
    m.notas.append("Fijar al muro por el riel colgador posterior superior.")
    return m
