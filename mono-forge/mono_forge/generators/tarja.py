"""Generador de TARJA — pieza de REFERENCIA, no de corte.

La tarja se compra, no se fabrica: no entra al cutlist ni al costeo. Pero sí
tiene que verse en el 3D y en el render, y su hueco tiene que quedar acotado
en el plano de cubierta. Por eso se modela como accesorio.
"""

from __future__ import annotations

from ..constants import ALTO_TOTAL_BASE, T
from ..models import Module, Panel, cantos

#: medidas típicas de tarja de un tazón (mm). Confirmar contra el modelo real.
TARJA_ANCHO = 550
TARJA_FONDO = 450
TARJA_PROFUNDIDAD = 200


def tarja(modulo: Module, ancho: float = TARJA_ANCHO, fondo: float = TARJA_FONDO,
          profundidad: float = TARJA_PROFUNDIDAD,
          material: str = "ACERO-INOX") -> Panel:
    """Agrega el tazón de la tarja al módulo, colgando del nivel de cubierta.

    Devuelve el Panel accesorio ya añadido al módulo.
    """
    if ancho > modulo.ancho - 2 * T:
        raise ValueError(
            f"Tarja de {ancho:.0f}mm no cabe en un módulo de {modulo.ancho:.0f}mm "
            f"(interior libre {modulo.ancho - 2 * T:.0f}mm). Usa un módulo más ancho "
            f"o una tarja más chica.")
    if fondo > modulo.prof - T:
        raise ValueError(
            f"Tarja de {fondo:.0f}mm de fondo no cabe en un módulo de "
            f"{modulo.prof:.0f}mm de profundidad.")

    p = Panel(
        name=f"{modulo.id}_tarja", largo=ancho, ancho=fondo, espesor=profundidad,
        material=material, rol_estructural="accesorio_tarja", accesorio=True,
        justificacion=("Tarja de referencia: se COMPRA, no se fabrica. No entra al "
                       "cutlist ni al costeo; sirve para el render y para acotar "
                       "el recorte de la cubierta."),
        cantos=cantos())
    modulo.panels.append(p)
    modulo.flags["tarja"] = {"ancho": ancho, "fondo": fondo,
                             "profundidad": profundidad}
    modulo.notas.append(
        f"Tarja de {ancho:.0f}×{fondo:.0f}mm, tazón de {profundidad:.0f}mm de "
        f"profundidad. El recorte va en la CUBIERTA (nivel {ALTO_TOTAL_BASE}mm); "
        f"coordinar plantilla con el proveedor de la piedra antes de cortar.")
    return p
