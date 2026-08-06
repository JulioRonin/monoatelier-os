"""Generador de mueble INFERIOR (base) y variante de tarja."""

from __future__ import annotations

from ..constants import (
    T, T_FRENTE_STD, PROF_BASE, ALTO_TOTAL_BASE, ALTO_ZOCLO, ALTO_CUERPO_BASE,
    GAP_FRENTES, TIRA_REFUERZO, TIRA_REFUERZO_TARJA, ANCHO_MAX_SIN_DIVISOR,
)
from ..models import Module, Panel, cantos
from ..rules import estructura as est
from ..rules import herrajes as hw
from ..rules.apertura import ajustar_frentes


def gabinete_base(
    id: str,
    ancho: float,
    prof: float = PROF_BASE,
    puertas: int = 1,
    entrepanos: int = 1,
    esp_frente: float = T_FRENTE_STD,
    material: str = "MEL-BLA-15-IMP",
    material_frente: str | None = None,
    apertura: str = "jaladera",
    gola_hueco: float = 0.0,
    tarja: bool = False,
    led: bool = False,
) -> Module:
    """Mueble inferior estándar Mono Atelier.

    Stack vertical: zoclo 100 + base 15 + lateral 785 = 900 (sin cubierta).
    """
    tipo = "base_tarja" if tarja else "base"
    material_frente = material_frente or material
    tira = TIRA_REFUERZO_TARJA if tarja else TIRA_REFUERZO
    hay_divisor = ancho > ANCHO_MAX_SIN_DIVISOR

    m = Module(id=id, tipo=tipo, ancho=ancho, alto=ALTO_TOTAL_BASE, prof=prof,
               apertura=apertura, led=led)

    # ── casco ────────────────────────────────────────────────────────
    m.panels += est.casco_apoyado(id, tipo, ancho, prof, tira=tira, material=material)

    # ── entrepaños (el módulo de tarja NO lleva) ─────────────────────
    if entrepanos and not tarja:
        for v in est.vanos(ancho, hay_divisor):
            m.panels.append(est.entrepano(id, v, prof, n=entrepanos, material=material))

    # ── zoclo (pieza independiente) ──────────────────────────────────
    m.panels.append(Panel(
        name=f"{id}_zoclo", largo=ancho, ancho=ALTO_ZOCLO, material=material,
        rol_estructural="zoclo",
        justificacion="Pieza independiente, retranqueada 60mm del frente.",
        cantos=cantos(superior=True)))

    # ── frentes ──────────────────────────────────────────────────────
    tipo_bis = hw.tipo_bisagra(puertas, hay_divisor)
    ancho_p = hw.ancho_puerta(ancho, puertas, tipo_bis)
    alto_p = ajustar_frentes(ALTO_CUERPO_BASE - GAP_FRENTES, apertura, gola_hueco)

    puerta = Panel(
        name=f"{id}_puerta", largo=alto_p, ancho=ancho_p, espesor=esp_frente,
        cantidad=puertas, material=material_frente, rol_estructural="frente",
        justificacion=f"Bisagra {tipo_bis}. Apertura: {apertura}.",
        cantos=cantos(True, True, True, True), veta="vertical",
        drilling=hw.perforaciones_cazoleta(alto_p))
    m.panels.append(puerta)

    # ── herraje ──────────────────────────────────────────────────────
    m.hardware.append(hw.bisagras_para(alto_p, tipo_bis, puertas))
    m.hardware.append(hw.patas_para(ancho))
    m.hardware += hw.union_estructura(num_uniones=8 + (4 if hay_divisor else 0))

    # ── notas para el manual ─────────────────────────────────────────
    m.notas.append("Apoyar los laterales SOBRE la base; atornillar desde abajo.")
    m.notas.append("Escuadrar contra el fondo (diagonales iguales) ANTES de fijarlo.")
    if tarja:
        m.flags["requiere_recorte_cubierta"] = True
        m.notas.append("Módulo de tarja: sin entrepaño; refuerzos de 80mm para librar el tazón.")
    return m
