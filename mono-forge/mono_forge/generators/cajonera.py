"""Generador de CAJONES y de MUEBLES DE CAJONES — ensamble limpio Mono Atelier.

Los LATERALES de la caja corren completos (largo = longitud de la corredera) y
CAPTURAN al frente de caja y a la trasera.

Razón física, no estética: la corredera lateral se atornilla al lateral a lo largo
de toda su longitud. Si el frente capturara a los laterales, el lateral mediría
prof_caja − 2T y no podrías montar una corredera de 500mm en un lateral de 470mm.

El FONDO de la caja va en tablero de 15mm y queda ATRAPADO entre los cuatro
lados: no descansa debajo ni sobresale. Un fondo de 3mm se pandea con peso.

Al abrir, la esquina frontal forma una L limpia entre el canto del lateral y el
canto del frente de caja — ambos encintados, sin núcleo a la vista.

Un cajón NUNCA va suelto: vive dentro de un casco. `cajonera()` arma el mueble
completo (casco + N cajones); `cajon()` genera sólo la caja y el frente.
"""

from __future__ import annotations

from ..constants import (
    T, T_FRENTE_STD, T_FONDO_CAJON, GAP_FRENTES, CAJA_MENOS_FRENTE,
    ALTO_CUERPO_BASE, ALTO_TOTAL_BASE, ALTO_ZOCLO, ANCHO_MAX_SIN_DIVISOR,
    PROF_BASE, seleccionar_corredera,
)
from ..models import Module, Panel, HardwareItem, cantos
from ..rules import estructura as est
from ..rules import herrajes as hw
from ..rules.apertura import ajustar_frentes


def piezas_de_caja(prefijo: str, ancho_caja: float, alto_caja: float,
                   corredera: float, material: str) -> list[Panel]:
    """Las 4 piezas de la caja. El fondo queda ATRAPADO entre las otras cuatro."""
    largo_cap = ancho_caja - 2 * T
    return [
        Panel(name=f"{prefijo}_lateral_caja", largo=corredera, ancho=alto_caja,
              cantidad=2, material=material, rol_estructural="lateral_caja",
              justificacion=("Corre COMPLETO: la corredera se atornilla a él en toda "
                             "su longitud. Captura al frente de caja y a la trasera."),
              cantos=cantos(frontal=True, superior=True)),
        Panel(name=f"{prefijo}_frente_caja", largo=largo_cap, ancho=alto_caja,
              material=material, rol_estructural="capturado",
              justificacion="Capturado entre los laterales (ancho_caja − 2T).",
              cantos=cantos(superior=True)),
        Panel(name=f"{prefijo}_trasera_caja", largo=largo_cap, ancho=alto_caja,
              material=material, rol_estructural="capturado",
              justificacion="Capturada entre los laterales.",
              cantos=cantos(superior=True)),
        Panel(name=f"{prefijo}_fondo_caja", largo=largo_cap,
              ancho=corredera - 2 * T, espesor=T_FONDO_CAJON, material=material,
              rol_estructural="fondo_caja",
              justificacion=("Tablero de 15mm ATRAPADO entre los cuatro lados de la "
                             "caja: ni descansa debajo ni sobresale. Carga el "
                             "contenido — un fondo de 3mm se pandea con peso."),
              cantos=cantos()),
    ]


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
    """Un cajón suelto (caja + frente), SIN casco.

    Úsalo sólo para calcular o probar una caja aislada. Para un mueble real
    usa `cajonera()`: un cajón sin casco no tiene dónde atornillar la corredera.
    """
    material_frente = material_frente or material
    ancho_modulo = ancho_modulo or (ancho_interior + 2 * T)

    holgura = hw.holgura_corredera(tipo_corredera)
    ancho_caja = ancho_interior - 2 * holgura
    corredera = seleccionar_corredera(prof_modulo, esp_frente)
    alto_caja = alto_frente - CAJA_MENOS_FRENTE

    m = Module(id=id, tipo="cajonera", ancho=ancho_modulo,
               alto=alto_frente, prof=prof_modulo, apertura=apertura)
    # Medidas de la caja DECLARADAS, no deducidas midiendo piezas: si mañana
    # cambia el espesor o el ancho de una pieza, la colocación 3D sigue bien.
    m.flags["ancho_caja"] = ancho_caja
    m.flags["alto_caja"] = alto_caja
    m.flags["corredera"] = corredera

    m.panels += piezas_de_caja(id, ancho_caja, alto_caja, corredera, material)

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
    m.notas.append(
        f"Fondo de caja en tablero de {T_FONDO_CAJON}mm ATRAPADO entre los cuatro "
        f"lados, NO en MDF de 3mm: carga el contenido del cajón.")
    return m


def cajonera(
    id: str,
    ancho: float,
    altos_frentes: list[float],
    prof: float = PROF_BASE,
    esp_frente: float = T_FRENTE_STD,
    tipo_corredera: str = "lateral",
    material: str = "MEL-BLA-15-IMP",
    material_frente: str | None = None,
    apertura: str = "jaladera",
    gola_hueco: float = 0.0,
    led: bool = False,
) -> Module:
    """Mueble inferior de CAJONES: casco completo + los cajones adentro.

    Es un mueble inferior como cualquier otro (900 de alto: zoclo 100 + base 15
    + lateral 785) pero en vez de puertas y entrepaños lleva N cajones. El casco
    es lo que sostiene las correderas: sin él el cajón no es fabricable.
    """
    material_frente = material_frente or material

    if not altos_frentes:
        raise ValueError("Una cajonera necesita al menos un cajón.")
    if ancho > ANCHO_MAX_SIN_DIVISOR:
        raise ValueError(
            f"Cajonera de {ancho:.0f}mm: arriba de {ANCHO_MAX_SIN_DIVISOR}mm el casco "
            f"exige divisor central, y un divisor parte el hueco de los cajones. "
            f"Divide el frente en dos cajoneras.")

    suma = sum(altos_frentes)
    if abs(suma - ALTO_CUERPO_BASE) > 1:
        raise ValueError(
            f"Los frentes de la cajonera suman {suma:.0f}mm y deben sumar exactamente "
            f"{ALTO_CUERPO_BASE}mm (el alto del cuerpo). Ej. 3 cajones: "
            f"[266, 266, 268]; 4 cajones: [200, 200, 200, 200].")

    m = Module(id=id, tipo="cajonera", ancho=ancho, alto=ALTO_TOTAL_BASE, prof=prof,
               apertura=apertura, led=led)

    # ── casco: exactamente el de un mueble inferior ──────────────────
    m.panels += est.casco_apoyado(id, "base", ancho, prof, material=material)
    m.panels.append(Panel(
        name=f"{id}_zoclo", largo=ancho, ancho=ALTO_ZOCLO, material=material,
        rol_estructural="zoclo",
        justificacion="Pieza independiente, retranqueada 60mm del frente.",
        cantos=cantos(superior=True)))

    # ── cajones ──────────────────────────────────────────────────────
    ancho_interior = ancho - 2 * T
    holgura = hw.holgura_corredera(tipo_corredera)
    ancho_caja = ancho_interior - 2 * holgura
    corredera = seleccionar_corredera(prof, esp_frente)

    cajones: list[dict] = []
    z_frente = ALTO_ZOCLO                    # los frentes arrancan sobre el zoclo
    for i, alto_frente in enumerate(altos_frentes, start=1):
        prefijo = f"{id}_c{i}"
        alto_caja = alto_frente - CAJA_MENOS_FRENTE
        if alto_caja <= 0:
            raise ValueError(
                f"Cajón {i}: un frente de {alto_frente:.0f}mm no deja caja "
                f"(hacen falta más de {CAJA_MENOS_FRENTE}mm).")

        m.panels += piezas_de_caja(prefijo, ancho_caja, alto_caja, corredera, material)

        alto_f = ajustar_frentes(alto_frente - GAP_FRENTES, apertura, gola_hueco)
        m.panels.append(Panel(
            name=f"{prefijo}_frente", largo=alto_f, ancho=ancho - GAP_FRENTES,
            espesor=esp_frente, material=material_frente, rol_estructural="frente",
            justificacion=f"Frente visible del cajón {i} (de abajo hacia arriba).",
            cantos=cantos(True, True, True, True), veta="vertical"))

        m.hardware.append(hw.corredera_para(corredera, tipo_corredera))
        m.hardware.append(
            HardwareItem("TOR-35X16", "Tornillo 3.5x16 para corredera", 12, "pza"))

        cajones.append({
            "i": i,
            "z_frente": z_frente,
            "alto_frente": alto_frente,
            # la caja va centrada en el alto del frente
            "z_caja": z_frente + (alto_frente - alto_caja) / 2,
            "alto_caja": alto_caja,
            "ancho_caja": ancho_caja,
            "corredera": corredera,
        })
        z_frente += alto_frente

    # Medidas declaradas para que la colocación 3D no tenga que deducirlas
    m.flags["cajones"] = cajones

    m.hardware.append(hw.patas_para(ancho))
    m.hardware += hw.union_estructura(num_uniones=8)

    m.notas.append("Apoyar los laterales SOBRE la base; atornillar desde abajo.")
    m.notas.append(
        f"{len(altos_frentes)} cajones con corredera {corredera}mm ({tipo_corredera}), "
        f"holgura {holgura}mm por lado. Caja: {ancho_caja:.0f}mm de ancho.")
    m.notas.append(
        f"Fondo de caja en tablero de {T_FONDO_CAJON}mm ATRAPADO entre los cuatro "
        f"lados, NO en MDF de 3mm: carga el contenido del cajón.")
    m.notas.append("Encintar canto FRONTAL y SUPERIOR de los laterales; el trasero NO.")
    return m
