"""Generador de CAJONES — ensamble limpio Mono Atelier.

Los LATERALES corren completos (largo = longitud de la corredera) y CAPTURAN al
frente de caja y a la trasera.

Razón física, no estética: la corredera lateral se atornilla al lateral a lo largo
de toda su longitud. Si el frente capturara a los laterales, el lateral mediría
prof_caja − 2T y no podrías montar una corredera de 500mm en un lateral de 470mm.

Al abrir, la esquina frontal forma una L limpia entre el canto del lateral y el
canto del frente de caja — ambos encintados, sin núcleo a la vista.
"""

from __future__ import annotations

from ..constants import (
    T, T_FRENTE_STD, T_FONDO, GAP_FRENTES, CAJA_MENOS_FRENTE,
    seleccionar_corredera,
)
from ..models import Module, Panel, HardwareItem, cantos
from ..rules import herrajes as hw
from ..rules.apertura import ajustar_frentes


def cajon(
    id: str,
    ancho_interior: float,
    alto_frente: float,
    prof_modulo: float,
    ancho_modulo: float | None = None,
    esp_frente: float = T_FRENTE_STD,
    tipo_corredera: str = "lateral",
    material: str = "MEL-BLA-15-IMP",
    material_frente: str | None = None,
    apertura: str = "jaladera",
    gola_hueco: float = 0.0,
) -> Module:
    material_frente = material_frente or material
    ancho_modulo = ancho_modulo or (ancho_interior + 2 * T)

    holgura = hw.holgura_corredera(tipo_corredera)
    ancho_caja = ancho_interior - 2 * holgura
    corredera = seleccionar_corredera(prof_modulo, esp_frente)
    alto_caja = alto_frente - CAJA_MENOS_FRENTE
    largo_cap = ancho_caja - 2 * T

    m = Module(id=id, tipo="cajonera", ancho=ancho_modulo,
               alto=alto_frente, prof=prof_modulo, apertura=apertura)

    m.panels += [
        Panel(name=f"{id}_lateral_caja", largo=corredera, ancho=alto_caja, cantidad=2,
              material=material, rol_estructural="lateral_caja",
              justificacion=("Corre COMPLETO: la corredera se atornilla a él en toda su "
                             "longitud. Captura al frente de caja y a la trasera."),
              cantos=cantos(frontal=True, superior=True)),
        Panel(name=f"{id}_frente_caja", largo=largo_cap, ancho=alto_caja,
              material=material, rol_estructural="capturado",
              justificacion="Capturado entre los laterales (ancho_caja − 2T).",
              cantos=cantos(superior=True)),
        Panel(name=f"{id}_trasera_caja", largo=largo_cap, ancho=alto_caja,
              material=material, rol_estructural="capturado",
              justificacion="Capturada entre los laterales.",
              cantos=cantos(superior=True)),
        Panel(name=f"{id}_fondo_caja", largo=ancho_caja, ancho=corredera,
              espesor=T_FONDO, material="MDF-003-FON", rol_estructural="fondo",
              justificacion="Fondo de la caja.", cantos=cantos()),
    ]

    alto_f = ajustar_frentes(alto_frente - GAP_FRENTES, apertura, gola_hueco)
    m.panels.append(Panel(
        name=f"{id}_frente", largo=alto_f, ancho=ancho_modulo - GAP_FRENTES,
        espesor=esp_frente, material=material_frente, rol_estructural="frente",
        justificacion="Frente visible del cajón.",
        cantos=cantos(True, True, True, True), veta="vertical"))

    m.hardware.append(hw.corredera_para(corredera, tipo_corredera))
    m.hardware.append(HardwareItem("TOR-35X16", "Tornillo 3.5x16 para corredera", 12, "pza"))

    m.notas.append(
        f"Corredera {corredera}mm ({tipo_corredera}), holgura {holgura}mm por lado. "
        f"Caja: {ancho_caja:.0f} x {corredera} x {alto_caja:.0f}mm.")
    m.notas.append("Encintar canto FRONTAL y SUPERIOR de los laterales; el trasero NO.")
    return m
