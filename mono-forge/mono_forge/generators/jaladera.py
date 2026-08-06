"""Generador de JALADERAS — piezas de REFERENCIA, no de corte.

La jaladera se compra: entra a la lista de herrajes, no al cutlist. Aquí se
modela además su volumen para que se vea en el 3D, en el AR y en el render —
en una cocina, la jaladera es la mitad del carácter del mueble.

La jaladera "moño" (bow) se arma con tres cajas: lazo izquierdo, nudo y lazo
derecho. El motor sólo produce cajas alineadas a ejes, así que la silueta es
una APROXIMACIÓN volumétrica de la pieza real, suficiente para leer la
proporción y la posición sobre el frente. La pieza que se compra y se cotiza es
la del SKU, no esta geometría.
"""

from __future__ import annotations

from ..models import HardwareItem, Module, Panel, cantos

#: catálogo de siluetas. (suf, dx, largo, ancho, espesor) en mm — dx es el
#: desplazamiento del centro de la caja respecto al centro de la jaladera.
SILUETAS: dict[str, tuple[str, list[tuple[str, float, float, float, float]]]] = {
    "bow": ("Jaladera tipo moño (bow) 128mm", [
        ("lazo_izq", -37.0, 56.0, 34.0, 18.0),
        ("nudo",       0.0, 20.0, 22.0, 24.0),
        ("lazo_der",  37.0, 56.0, 34.0, 18.0),
    ]),
    "barra": ("Jaladera de barra 128mm", [
        ("barra", 0.0, 128.0, 14.0, 30.0),
    ]),
}

#: distancia del canto superior del frente al centro de la jaladera, en puertas
RETRANQUEO_SUPERIOR = 80.0

#: un frente más bajo que esto es de cajón: la jaladera va centrada
ALTO_FRENTE_CAJON = 400.0


def jaladeras(modulo: Module, sku: str = "JAL-MONO-BOW", silueta: str = "bow",
              material: str = "MET-ROSA-MONO") -> list[Panel]:
    """Agrega una jaladera por hoja de frente del módulo.

    Devuelve las piezas de referencia añadidas (vacío si el módulo no tiene
    frentes, p. ej. una alacena abierta).
    """
    if silueta not in SILUETAS:
        raise ValueError(
            f"Silueta '{silueta}' desconocida. Disponibles: "
            f"{', '.join(sorted(SILUETAS))}.")
    if modulo.apertura != "jaladera":
        raise ValueError(
            f"{modulo.id} abre con '{modulo.apertura}': una gola o un push no "
            f"llevan jaladera. Cambia la apertura del módulo primero.")

    hojas = sum(int(p.cantidad) for p in modulo.panels
                if p.rol_estructural == "frente")
    if not hojas:
        return []

    descripcion, piezas = SILUETAS[silueta]
    nuevas: list[Panel] = []
    for suf, dx, largo, ancho, espesor in piezas:
        p = Panel(
            name=f"{modulo.id}_jal_{suf}", largo=largo, ancho=ancho,
            espesor=espesor, cantidad=hojas, material=material,
            rol_estructural="accesorio_jaladera", accesorio=True,
            justificacion=(f"{descripcion} — se COMPRA ({sku}). No entra al "
                           f"cutlist ni al costeo de tablero; se modela para el "
                           f"3D, el AR y el render."),
            cantos=cantos())
        modulo.panels.append(p)
        nuevas.append(p)

    modulo.flags["jaladeras"] = {
        "sku": sku, "silueta": silueta,
        "offsets": {suf: dx for suf, dx, *_ in piezas},
        "retranqueo_superior": RETRANQUEO_SUPERIOR,
    }
    modulo.hardware.append(HardwareItem(
        sku=sku, descripcion=descripcion, cantidad=hojas, unidad="pza"))
    modulo.notas.append(
        f"{hojas} jaladera(s) {descripcion.lower()}. En puertas va a "
        f"{RETRANQUEO_SUPERIOR:.0f}mm del canto superior; en cajones, centrada. "
        f"Perforar el frente ANTES de lacar.")
    return nuevas
