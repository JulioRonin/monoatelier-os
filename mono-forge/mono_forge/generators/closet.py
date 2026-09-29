"""Generador de CLOSET / VESTIDOR — módulos abiertos de piso a plafón.

Estructura: exactamente la de la torre. Zoclo 100, base a todo el ancho y
laterales de UNA pieza apoyados encima (el tornillo sólo alinea). La altura
sale del plafón: módulo = plafón − 40, porque el techo nunca está a nivel y un
módulo del alto exacto no se puede levantar en sitio; el copete se corta en obra.

El interior se arma de ABAJO HACIA ARRIBA según el tipo:

    colgado_doble     tubos a 1000 y 2000 del piso, maletero arriba
    colgado_sencillo  zapatera opcional abajo, tubo a 1700, maletero arriba
    entrepanos        entrepaños repartidos en toda la altura
    cajonera          cajones abajo (el de arriba puede ser vitrina), entrepaños arriba
    zapatera          repisas fijas en toda la altura

Entrepaños: móviles sobre sistema 32, salvo los que cargan algo o llevan LED —
el que sostiene un tubo, el piso del maletero, las repisas de zapatos y
cualquiera con LED son FIJOS.

Todas las alturas se derivan aquí y se DECLARAN en flags["closet"]; la
colocación 3D sólo las lee.
"""

from __future__ import annotations

from ..constants import (
    T, T_FRENTE_STD, ALTO_ZOCLO, ANCHO_MAX_SIN_DIVISOR, CAJA_MENOS_FRENTE,
    GAP_FRENTES, HOLGURA_ENTREPANO, RETRANQUEO_ENTREPANO, LED_RETRANQUEO,
    PROF_CLOSET, HOLGURA_PLAFON, ALTO_CLOSET_MAX, ANCHO_CLOSET_MAX,
    TUBO_SENCILLO, TUBOS_DOBLE, TUBO_BAJO_ENTREPANO, COLGADO_MIN,
    FRENTE_CAJON_CLOSET, NIVEL_ZAPATO, VANO_MIN_CLOSET,
    alto_lateral, seleccionar_corredera,
)
from ..models import HardwareItem, Module, Panel, cantos
from ..rules import estructura as est
from ..rules import herrajes as hw
from ..rules.apertura import ajustar_frentes
from .cajonera import piezas_de_caja

TIPOS = ("colgado_doble", "colgado_sencillo", "entrepanos", "cajonera", "zapatera")


def alto_desde_plafon(plafon: float) -> tuple[float, float]:
    """(alto del módulo, alto del copete). El módulo nunca pasa de lo que da
    una hoja; lo que sobre hasta el plafón lo cubre el copete."""
    alto = min(plafon - HOLGURA_PLAFON, ALTO_CLOSET_MAX)
    return alto, plafon - alto


def _repartir(z0: float, z1: float, n: int) -> list[float]:
    """n entrepaños con claros iguales entre z0 y z1 (cara inferior de cada uno)."""
    if n <= 0:
        return []
    claro = (z1 - z0 - n * T) / (n + 1)
    return [round(z0 + claro * (k + 1) + T * k, 1) for k in range(n)]


def _claro(z_lista: list[float], z0: float, z1: float) -> float:
    """El menor claro libre entre entrepaños ya repartidos."""
    bordes = [z0] + [z for zz in z_lista for z in (zz, zz + T)] + [z1]
    return min(bordes[i + 1] - bordes[i] for i in range(0, len(bordes), 2))


def closet(
    id: str,
    ancho: float,
    tipo: str,
    plafon: float = 2400,
    prof: float = PROF_CLOSET,
    tubos: list[float] | None = None,
    altos_frentes: list[float] | None = None,
    vitrina: bool = False,
    entrepanos: int | None = None,
    repisas_zapatos: int = 0,
    led: bool = False,
    esp_frente: float = T_FRENTE_STD,
    material: str = "MEL-BLA-15-IMP",
    material_frente: str | None = None,
    apertura: str = "jaladera",
    gola_hueco: float = 0.0,
) -> Module:
    """Un módulo de closet completo: casco apoyado + su interior.

    Args:
        tipo: colgado_doble | colgado_sencillo | entrepanos | cajonera | zapatera.
        plafon: altura del piso al plafón; el módulo mide 40 menos.
        tubos: alturas del centro de los tubos desde el piso. Por omisión las
            del taller (sencillo 1700; doble 1000 y 2000).
        altos_frentes: cajonera — frentes de abajo hacia arriba (200 c/u).
        vitrina: cajonera — el cajón de ARRIBA lleva tapa de vidrio.
        entrepanos: extra en el maletero (colgados), arriba de los cajones
            (cajonera) o en toda la altura (entrepanos).
        repisas_zapatos: colgado_sencillo — niveles de zapatera abajo del
            colgado. zapatera — niveles en toda la altura (0 = los que quepan).
        led: tira LED bajo cada entrepaño; esos entrepaños quedan FIJOS.
    """
    if tipo not in TIPOS:
        raise ValueError(f"tipo de closet '{tipo}' desconocido. Usa: {', '.join(TIPOS)}.")
    if ancho > ANCHO_CLOSET_MAX:
        raise ValueError(
            f"Módulo de {ancho:.0f}mm: el fondo aplicado no cabe a lo ancho de la "
            f"hoja (máximo {ANCHO_CLOSET_MAX}mm). Divídelo en dos módulos.")
    if tipo == "cajonera" and ancho > ANCHO_MAX_SIN_DIVISOR:
        raise ValueError(
            f"Cajonera de closet de {ancho:.0f}mm: arriba de {ANCHO_MAX_SIN_DIVISOR}mm "
            f"el casco lleva divisor y parte el hueco de los cajones. Usa dos módulos.")

    alto, copete = alto_desde_plafon(plafon)
    material_frente = material_frente or material
    h_lat = alto_lateral("closet", alto)
    z_piso = ALTO_ZOCLO + T              # cara superior de la base
    z_techo = alto - T                   # bajo los refuerzos superiores

    m = Module(id=id, tipo="closet", ancho=ancho, alto=alto, prof=prof,
               apertura=apertura, led=led)
    m.flags["closet_tipo"] = tipo
    m.panels += est.casco_apoyado(id, "closet", ancho, prof, alto_total=alto,
                                  material=material)
    m.panels.append(Panel(
        name=f"{id}_zoclo", largo=ancho, ancho=ALTO_ZOCLO, material=material,
        rol_estructural="zoclo", justificacion="Retranqueo 60mm.",
        cantos=cantos(superior=True)))

    hay_divisor = ancho > ANCHO_MAX_SIN_DIVISOR
    anchos_vano = est.vanos(ancho, hay_divisor)
    vano = anchos_vano[0]
    nv = len(anchos_vano)
    xs = ([ancho / 2] if nv == 1 else
          [T + vano / 2, ancho - T - vano / 2])

    fijos: list[float] = []            # cargan tubo, maletero o marcan una zona
    moviles: list[float] = []
    zapatos: list[float] = []
    tubos_z: list[float] = []
    cajones: list[dict] = []

    def colgado(tubo: float, desde: float, nombre: str) -> float:
        """Zona de colgado con su tubo; devuelve la cara superior del entrepaño
        que lo carga."""
        libre = tubo - desde
        if libre < COLGADO_MIN:
            raise ValueError(
                f"{nombre}: el tubo a {tubo:.0f}mm deja sólo {libre:.0f}mm libres "
                f"abajo (mínimo {COLGADO_MIN}). Sube el tubo o quita repisas de abajo.")
        z = tubo + TUBO_BAJO_ENTREPANO
        fijos.append(z)
        tubos_z.append(tubo)
        return z + T

    def maletero(desde: float, extra: int) -> None:
        h = z_techo - desde
        if h < VANO_MIN_CLOSET:
            raise ValueError(
                f"El maletero queda de {h:.0f}mm (mínimo {VANO_MIN_CLOSET}) con un "
                f"módulo de {alto:.0f}mm. Baja los tubos o revisa la altura del plafón.")
        z = _repartir(desde, z_techo, extra)
        (fijos if led else moviles).extend(z)
        if z and _claro(z, desde, z_techo) < VANO_MIN_CLOSET:
            raise ValueError(f"{extra} entrepaños no caben en un maletero de {h:.0f}mm.")

    if tipo == "colgado_doble":
        bajo, alto_t = sorted(tubos or TUBOS_DOBLE)
        z = colgado(bajo, z_piso, "Colgado bajo")
        z = colgado(alto_t, z, "Colgado alto")
        maletero(z, entrepanos or 0)

    elif tipo == "colgado_sencillo":
        z = z_piso
        for k in range(1, repisas_zapatos + 1):
            zr = z_piso + k * NIVEL_ZAPATO + (k - 1) * T
            zapatos.append(zr)
            z = zr + T
        z = colgado((tubos or [TUBO_SENCILLO])[0], z, "Colgado")
        maletero(z, entrepanos or 0)

    elif tipo == "entrepanos":
        n = 5 if entrepanos is None else entrepanos
        z = _repartir(z_piso, z_techo, n)
        if z and _claro(z, z_piso, z_techo) < VANO_MIN_CLOSET:
            raise ValueError(f"{n} entrepaños no caben en {z_techo - z_piso:.0f}mm.")
        (fijos if led else moviles).extend(z)

    elif tipo == "zapatera":
        h = z_techo - z_piso
        n = repisas_zapatos - 1 if repisas_zapatos else int((h + T) // (NIVEL_ZAPATO + T)) - 1
        zapatos.extend(_repartir(z_piso, z_techo, n))
        if zapatos and _claro(zapatos, z_piso, z_techo) < NIVEL_ZAPATO - 50:
            raise ValueError(f"{n + 1} niveles de zapatos no caben en {h:.0f}mm.")

    elif tipo == "cajonera":
        frentes = list(altos_frentes or [FRENTE_CAJON_CLOSET] * 3)
        corredera = seleccionar_corredera(prof, esp_frente)
        holgura = hw.holgura_corredera("lateral")
        ancho_caja = vano - 2 * holgura
        z_frente = ALTO_ZOCLO            # como en cocina: el frente cubre el canto de la base
        for i, f in enumerate(frentes, start=1):
            alto_caja = f - CAJA_MENOS_FRENTE
            if alto_caja <= 0:
                raise ValueError(f"Cajón {i}: un frente de {f:.0f}mm no deja caja.")
            prefijo = f"{id}_c{i}"
            m.panels += piezas_de_caja(prefijo, ancho_caja, alto_caja, corredera, material)
            alto_f = ajustar_frentes(f - GAP_FRENTES, apertura, gola_hueco)
            m.panels.append(Panel(
                name=f"{prefijo}_frente", largo=alto_f, ancho=ancho - GAP_FRENTES,
                espesor=esp_frente, material=material_frente, rol_estructural="frente",
                justificacion=f"Frente visible del cajón {i} (de abajo hacia arriba).",
                cantos=cantos(True, True, True, True), veta="vertical"))
            m.hardware.append(hw.corredera_para(corredera, "lateral"))
            m.hardware.append(
                HardwareItem("TOR-35X16", "Tornillo 3.5x16 para corredera", 12, "pza"))
            cajones.append({"i": i, "z_frente": z_frente, "alto_frente": f,
                            "z_caja": z_frente + (f - alto_caja) / 2,
                            "alto_caja": alto_caja, "ancho_caja": ancho_caja,
                            "corredera": corredera})
            z_frente += f

        # el entrepaño fijo de arriba de los cajones queda al ras del último frente
        z_tapa = z_frente - T
        fijos.append(z_tapa)
        if vitrina:
            cj = cajones[-1]
            m.panels.append(Panel(
                name=f"{id}_c{cj['i']}_vidrio", largo=ancho_caja - 2 * T,
                ancho=corredera - 2 * T, espesor=6, material="VID-TEMP-6",
                rol_estructural="accesorio_vidrio", accesorio=True,
                justificacion="Tapa de vidrio templado 6mm canteado. Se subcontrata."))
            m.hardware.append(HardwareItem(
                "VID-TEMP-6", "Vidrio templado 6mm canteado (tapa de cajón vitrina)",
                round((ancho_caja - 2 * T) * (corredera - 2 * T) / 1e6, 3), "m2"))
            m.notas.append(
                f"Cajón {cj['i']} VITRINA: la tapa de vidrio asienta en un rebaje de 6mm "
                f"en el frente y los laterales de la caja. El vidrio se subcontrata: "
                f"{ancho_caja - 2 * T:.0f} x {corredera - 2 * T:.0f}mm.")
        z = _repartir(z_tapa + T, z_techo, entrepanos if entrepanos is not None else 4)
        if z and _claro(z, z_tapa + T, z_techo) < VANO_MIN_CLOSET:
            raise ValueError("Los entrepaños no caben sobre los cajones.")
        (fijos if led else moviles).extend(z)
        m.flags["cajones"] = cajones
        m.notas.append(
            f"{len(frentes)} cajones con corredera {corredera}mm de extensión total, "
            f"holgura {holgura}mm por lado. Fondo de caja en tablero de 15mm atrapado.")

    # ── piezas de entrepaño: una por tipo, una copia por nivel y por vano ──
    largo_ent = vano - HOLGURA_ENTREPANO
    ancho_ent = prof - RETRANQUEO_ENTREPANO
    niveles: dict[str, list[float]] = {}

    def entrepano(sufijo: str, zs: list[float], rol: str, por_que: str) -> None:
        if not zs:
            return
        nombre = f"{id}_{sufijo}"
        m.panels.append(Panel(
            name=nombre, largo=largo_ent, ancho=ancho_ent, cantidad=len(zs) * nv,
            material=material, rol_estructural=rol, justificacion=por_que,
            cantos=cantos(frontal=True)))
        niveles[nombre] = sorted(zs)

    entrepano("ent_fijo", fijos, "entrepano_fijo",
              "FIJO: carga un tubo, es piso del maletero, marca una zona o lleva LED.")
    entrepano("ent_movil", moviles, "entrepano_movil",
              "Móvil sobre soportes del sistema 32.")
    entrepano("rep_zapato", zapatos, "entrepano_fijo",
              "Repisa FIJA de zapatera, recta.")

    for k, zt in enumerate(sorted(tubos_z), start=1):
        m.panels.append(Panel(
            name=f"{id}_tubo{k}", largo=vano, ancho=15, espesor=30, cantidad=nv,
            material="MET-CROMO", rol_estructural="accesorio_tubo", accesorio=True,
            justificacion="Tubo oval cromado. Se compra; va a herrajes, no al cutlist."))
    if tubos_z:
        m.hardware.append(HardwareItem(
            "TUB-OVAL-CR", "Tubo oval cromado", round(len(tubos_z) * nv * vano / 1000, 2),
            "ml"))
        m.hardware.append(HardwareItem(
            "SOP-TUB-OVAL", "Soportes para tubo oval (par)", len(tubos_z) * nv, "par"))

    if moviles:
        m.hardware.append(HardwareItem(
            "SOP-ENT-5", "Soporte de entrepaño 5mm (sistema 32)", 4 * len(moviles) * nv, "pza"))
    m.hardware.append(hw.patas_para(ancho))
    fijos_total = len(fijos) + len(zapatos)
    m.hardware += hw.union_estructura(num_uniones=12 + 4 * fijos_total * nv)

    if led:
        n_led = (len(fijos) + len(zapatos)) * nv
        m.flags["led_ml"] = round(n_led * max(vano - LED_RETRANQUEO, 0) / 1000, 2)
        m.notas.append(
            f"LED bajo {n_led} entrepaño(s): todos FIJOS. Perfil embutido en ranura "
            f"bajo el frente; el cable baja por ranura trasera en los laterales.")

    m.flags["closet"] = {
        "vanos_x": xs,
        "niveles": niveles,
        "tubos": {f"{id}_tubo{k}": [zt] for k, zt in enumerate(sorted(tubos_z), start=1)},
    }

    m.notas.append(
        f"Laterales de UNA pieza ({h_lat:.0f}mm). Módulo de {alto:.0f}mm para un "
        f"plafón de {plafon:.0f}: copete de {copete:.0f}mm cortado en obra.")
    if tubos_z:
        m.notas.append(
            "Tubo(s) a " + ", ".join(f"{z:.0f}" for z in sorted(tubos_z)) +
            f"mm del piso, {TUBO_BAJO_ENTREPANO}mm bajo el entrepaño fijo que lo carga.")
    return m


def relleno_esquina(prefijo: str, alto: float, material: str = "MEL-BLA-15-IMP") -> Panel:
    """Relleno recto de 50 que tapa la esquina interior de un closet en L.

    Va en el plano del frente, entre el frente del muro previo y el primer
    módulo del retorno. En un closet abierto el claro dejaría ver el muro; en
    cocina lo tapan las puertas.
    """
    from ..constants import HOLGURA_ESQUINA
    return Panel(
        name=f"{prefijo}_relleno_esquina", largo=alto, ancho=HOLGURA_ESQUINA,
        material=material, rol_estructural="relleno_esquina",
        justificacion=(f"Relleno recto de {HOLGURA_ESQUINA:.0f}mm en la esquina: "
                       "se atornilla al lateral del primer módulo del retorno."),
        cantos=cantos(superior=True), veta="vertical")
