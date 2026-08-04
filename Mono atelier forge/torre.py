"""Generador de TORRE (microondas / horno). Altura final 2100–2200mm."""

from __future__ import annotations

from ..constants import (
    T, T_FRENTE_STD, PROF_TORRE, ALTO_TORRE_DEFAULT, ALTO_TORRE_RANGO,
    ALTO_ZOCLO, GAP_FRENTES, alto_lateral,
)
from ..models import Module, Panel, cantos
from ..rules import estructura as est
from ..rules import herrajes as hw


def torre(
    id: str,
    ancho: float = 600,
    alto_total: float = ALTO_TORRE_DEFAULT,
    prof: float = PROF_TORRE,
    nichos: list[dict] | None = None,
    esp_frente: float = T_FRENTE_STD,
    material: str = "MEL-BLA-15-IMP",
    material_frente: str | None = None,
) -> Module:
    """nichos: [{"tipo":"horno","alto_nicho":600,"desde_piso":850,"ventilacion":30}, ...]"""
    lo, hi = ALTO_TORRE_RANGO
    if not lo <= alto_total <= hi:
        raise ValueError(f"altura de torre fuera de rango {ALTO_TORRE_RANGO}: {alto_total}")

    material_frente = material_frente or material
    nichos = nichos or []
    h_lat = alto_lateral("torre", alto_total)

    m = Module(id=id, tipo="torre", ancho=ancho, alto=alto_total, prof=prof)
    m.panels += est.casco_apoyado(id, "torre", ancho, prof, alto_total=alto_total,
                                  material=material)
    m.panels.append(Panel(
        name=f"{id}_zoclo", largo=ancho, ancho=ALTO_ZOCLO, material=material,
        rol_estructural="zoclo", justificacion="Retranqueo 60mm.",
        cantos=cantos(superior=True)))

    vano = est.vanos(ancho, False)[0]

    # entrepaños FIJOS que forman los nichos (cargan el electrodoméstico)
    for n in nichos:
        m.panels.append(est.entrepano(f"{id}_{n['tipo']}", vano, prof, n=2, fijo=True,
                                      material=material))
        m.notas.append(
            f"Nicho {n['tipo']}: {n['alto_nicho']}mm de alto, "
            f"ventilación {n.get('ventilacion', 30)}mm. Entrepaños FIJOS.")

    # validación vertical
    ocupado = sum(n["alto_nicho"] + 2 * T + n.get("ventilacion", 30) for n in nichos)
    if ocupado > h_lat:
        raise ValueError(
            f"Los nichos ocupan {ocupado}mm pero el lateral mide {h_lat}mm.")
    restante = h_lat - ocupado

    # puertas: una inferior y una superior con el espacio restante
    if restante > 0:
        alto_p = restante / 2 - GAP_FRENTES
        m.panels.append(Panel(
            name=f"{id}_puerta", largo=alto_p, ancho=ancho - GAP_FRENTES,
            espesor=esp_frente, cantidad=2, material=material_frente,
            rol_estructural="frente", justificacion="Puertas superior e inferior de torre.",
            cantos=cantos(True, True, True, True), veta="vertical",
            drilling=hw.perforaciones_cazoleta(alto_p)))
        m.hardware.append(hw.bisagras_para(alto_p, "recta", 2))

    m.hardware.append(hw.patas_para(ancho))
    m.hardware += hw.union_estructura(num_uniones=12)
    m.notas.append(
        f"Laterales de UNA sola pieza ({h_lat}mm): nunca partidos — el empalme quedaría "
        "justo donde carga el electrodoméstico.")
    return m
