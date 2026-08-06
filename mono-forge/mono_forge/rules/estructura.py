"""LA REGLA ESTRUCTURAL de Mono Atelier.

    El tornillo nunca debe cargar el peso; el tablero sí.
    El tornillo sólo alinea.

    mueble APOYADO (inferior, torre) → el LATERAL descansa SOBRE la base.
        La carga baja por los laterales, entra a la base en compresión pura
        y pasa al zoclo y al piso.
        Verificación aritmética del taller: 100 (zoclo) + 15 (base) + 785 = 900 ✓
        Ese 785 SÓLO existe si el lateral se apoya sobre la base.

    mueble COLGADO (superior) → techo y piso van CAPTURADOS entre los laterales.
        Los tornillos que entran por la cara del lateral al canto del panel
        trabajan a CORTANTE (su modo fuerte), no a extracción. Al revés, todo el
        peso colgaría de la resistencia a extracción de un tornillo en canto de
        aglomerado — que es justo donde falla.
"""

from __future__ import annotations

from ..constants import (
    T, TIRA_REFUERZO, ANCHO_MAX_SIN_DIVISOR, HOLGURA_ENTREPANO,
    RETRANQUEO_ENTREPANO, alto_lateral, alto_cuerpo,
)
from ..models import Panel, cantos, fondo_aplicado

MAT_STD = "MEL-BLA-15-IMP"


def _p(name, largo, ancho, **kw) -> Panel:
    return Panel(name=name, largo=largo, ancho=ancho, **kw)


def casco_apoyado(prefijo: str, tipo: str, ancho: float, prof: float,
                  alto_total: float | None = None,
                  tira: float = TIRA_REFUERZO,
                  material: str = MAT_STD,
                  con_fondo: bool = True) -> list[Panel]:
    """Mueble inferior / torre: la base corre a TODO el ancho, los laterales encima."""
    h_lat = alto_lateral(tipo, alto_total)
    h_cuerpo = alto_cuerpo(tipo, alto_total)
    largo_ref = ancho - 2 * T

    panels = [
        _p(f"{prefijo}_base", ancho, prof, material=material,
           rol_estructural="base_portante",
           justificacion=("Corre a todo el ancho exterior. Los laterales se apoyan "
                          "encima: la carga entra en compresión, el tornillo sólo alinea."),
           cantos=cantos(frontal=True)),
        _p(f"{prefijo}_lateral", h_lat, prof, cantidad=2, material=material,
           rol_estructural="lateral_apoyado",
           justificacion=(f"Alto {h_lat} = alto_cuerpo − espesor de base. DESCANSA sobre "
                          "la base, no va capturado entre ella."),
           cantos=cantos(frontal=True), veta="vertical"),
        _p(f"{prefijo}_ref_sup_frente", largo_ref, tira, material=material,
           rol_estructural="refuerzo",
           justificacion="Refuerzo superior frontal entre laterales.",
           cantos=cantos(frontal=True)),
        _p(f"{prefijo}_ref_sup_trasero", largo_ref, tira, material=material,
           rol_estructural="refuerzo",
           justificacion="Refuerzo superior trasero entre laterales.",
           cantos=cantos()),
        _p(f"{prefijo}_ref_post_inferior", largo_ref, tira, material=material,
           rol_estructural="refuerzo",
           justificacion="Refuerzo posterior inferior: rigidiza contra el paralelogramo.",
           cantos=cantos()),
    ]

    if ancho > ANCHO_MAX_SIN_DIVISOR:
        panels.append(
            _p(f"{prefijo}_divisor", h_lat, prof, material=material,
               rol_estructural="divisor",
               justificacion=(f"Ancho {ancho} > {ANCHO_MAX_SIN_DIVISOR}: sin divisor la "
                              "base y los refuerzos flechan."),
               cantos=cantos(frontal=True), veta="vertical"))

    if con_fondo:
        panels.append(fondo_aplicado(f"{prefijo}_fondo", ancho, h_cuerpo))

    return panels


def casco_colgado(prefijo: str, ancho: float, alto: float, prof: float,
                  tira: float = TIRA_REFUERZO,
                  material: str = MAT_STD,
                  con_fondo: bool = True) -> list[Panel]:
    """Mueble superior: laterales completos, techo y piso capturados entre ellos."""
    largo_cap = ancho - 2 * T

    panels = [
        _p(f"{prefijo}_lateral", alto, prof, cantidad=2, material=material,
           rol_estructural="lateral_portante",
           justificacion=("Corre a altura COMPLETA. El mueble cuelga: el techo y el piso "
                          "van capturados entre los laterales para que el tornillo trabaje "
                          "a cortante y no a extracción en canto de aglomerado."),
           cantos=cantos(frontal=True), veta="vertical"),
        _p(f"{prefijo}_techo", largo_cap, prof, material=material,
           rol_estructural="capturado",
           justificacion="Capturado entre laterales (ancho − 2T).",
           cantos=cantos(frontal=True)),
        _p(f"{prefijo}_piso", largo_cap, prof, material=material,
           rol_estructural="capturado",
           justificacion="Capturado entre laterales. Recibe la carga del contenido.",
           cantos=cantos(frontal=True)),
        _p(f"{prefijo}_riel_colgador", largo_cap, 120, material=material,
           rol_estructural="riel_colgador",
           justificacion="Posterior superior: AQUÍ van los tornillos de fijación al muro.",
           cantos=cantos()),
    ]

    if ancho > ANCHO_MAX_SIN_DIVISOR:
        panels.append(
            _p(f"{prefijo}_divisor", alto - 2 * T, prof, material=material,
               rol_estructural="divisor",
               justificacion=f"Ancho {ancho} > {ANCHO_MAX_SIN_DIVISOR}.",
               cantos=cantos(frontal=True), veta="vertical"))

    if con_fondo:
        panels.append(fondo_aplicado(f"{prefijo}_fondo", ancho, alto))

    return panels


def entrepano(prefijo: str, vano: float, prof: float, n: int = 1,
              fijo: bool = False, material: str = MAT_STD) -> Panel:
    return _p(f"{prefijo}_entrepano", vano - HOLGURA_ENTREPANO,
              prof - RETRANQUEO_ENTREPANO, cantidad=n, material=material,
              rol_estructural="entrepano_fijo" if fijo else "entrepano_movil",
              justificacion=("Entrepaño FIJO: carga el electrodoméstico." if fijo
                             else "Entrepaño móvil sobre soportes del sistema 32."),
              cantos=cantos(frontal=True))


def vanos(ancho: float, hay_divisor: bool) -> list[float]:
    """Anchos interiores libres del módulo."""
    interior = ancho - 2 * T
    if not hay_divisor:
        return [interior]
    return [(interior - T) / 2] * 2
