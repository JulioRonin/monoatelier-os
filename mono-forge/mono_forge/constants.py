"""Constantes calibradas del taller Mono Atelier.

REGLA: nada de números mágicos. Todo lo que se pueda derivar, se deriva.
Si mañana cambia el espesor de tablero o la altura del zoclo, TODO se recalcula
solo. Por eso ALTO_LATERAL_BASE nunca se escribe como 785 literal.

Todas las medidas en MILÍMETROS.
"""

# ── Espesores ────────────────────────────────────────────────────────────
T = 15                      # estructura (laterales, base, techo, refuerzos, divisores)
T_FRENTE_STD = 15           # frentes estándar
T_FRENTE_BRILLO = 19        # alto brillo — cintilla PVC pegada a MANO
T_FONDO = 3                 # fondos APLICADOS del casco (los que escuadran el mueble)
T_FONDO_CAJON = 15          # fondo de la caja del cajón: carga el contenido, va en tablero

# ── Corte ────────────────────────────────────────────────────────────────
HOJA_LARGO = 2440
HOJA_ANCHO = 1220
HOJA = (HOJA_LARGO, HOJA_ANCHO)
HOJA_M2 = (HOJA_LARGO / 1000) * (HOJA_ANCHO / 1000)   # 2.9768 m²
KERF = 4                    # ancho de sierra — CRÍTICO para el nesting
FACTOR_DESPERDICIO = 0.10

# ── Mueble inferior (base) ───────────────────────────────────────────────
ALTO_TOTAL_BASE = 900       # suelo → tope del mueble, SIN cubierta
ALTO_ZOCLO = 100            # claro para patas niveladoras + zoclo
ZOCLO_RETRANQUEO = 60
ALTO_CUERPO_BASE = ALTO_TOTAL_BASE - ALTO_ZOCLO       # = 800
ALTO_LATERAL_BASE = ALTO_CUERPO_BASE - T              # = 785  ← DERIVADO
PROF_BASE = 600

#: filler de esquina interior (cocinas en L / U). Sin este claro, la puerta del
#: último mueble de un muro golpea la del primero del muro de retorno.
HOLGURA_ESQUINA = 50

# ── Mueble superior ──────────────────────────────────────────────────────
PROF_SUPERIOR = 350         # rango válido 350–400
PROF_SUPERIOR_RANGO = (350, 400)
ALTURAS_SUPERIOR = (700, 750, 800)
ALTO_SUPERIOR_DEFAULT = 750

# ── Torres ───────────────────────────────────────────────────────────────
ALTO_TORRE_RANGO = (2100, 2200)
ALTO_TORRE_DEFAULT = 2100
PROF_TORRE = 600

# ── Correderas ───────────────────────────────────────────────────────────
CORREDERAS_STD = (300, 350, 400, 450, 500, 550)
CORREDERA_DEFAULT = 500     # estándar del taller: NO subir a 550 aunque el módulo dé
HOLGURA_LATERAL = 13        # por lado (rango real 13–15)
HOLGURA_BAJOCAJON = 7       # por lado (rango real 6–8)
HOLGURA_TRASERA = 25        # holgura detrás de la caja del cajón
CAJA_MENOS_FRENTE = 70      # alto_caja = alto_frente − esto

# ── Frentes y modulación ─────────────────────────────────────────────────
GAP_FRENTES = 3
GAP_INSET = 3               # holgura perimetral en puerta interior (bisagra curva)
ANCHO_MAX_SIN_DIVISOR = 900
TIRA_REFUERZO = 100
TIRA_REFUERZO_TARJA = 80    # máx. para librar el tazón
HOLGURA_ENTREPANO = 2       # juego total para que entre el entrepaño
RETRANQUEO_ENTREPANO = 20   # el entrepaño no llega al frente

# ── Bisagras cazoleta 35mm ───────────────────────────────────────────────
BISAGRAS_POR_ALTURA = ((900, 2), (1600, 3), (2000, 4), (float("inf"), 5))
CAZOLETA_D = 35
CAZOLETA_CENTRO = 21.5      # centro de cazoleta desde el canto de la puerta
CAZOLETA_EXTREMOS = 100     # primera y última desde los extremos de la puerta

# ── Sistema 32 ───────────────────────────────────────────────────────────
SISTEMA32_PASO = 32
SISTEMA32_RETRANQUEO = 37   # desde el canto frontal

# ── Patas niveladoras ────────────────────────────────────────────────────
PATAS_BASE = 4
PATA_EXTRA_SI_ANCHO_MAYOR_A = 900

# ── Cubierta (fabricación propia) ────────────────────────────────────────
CUBIERTA_ESPESOR = 19
CUBIERTA_VUELO = 20                                    # vuelo frontal
PROF_CUBIERTA = PROF_BASE + CUBIERTA_VUELO             # = 620
CUBIERTA_LARGO_MAX_SIN_UNION = HOJA_LARGO              # 2440

# ── LED ──────────────────────────────────────────────────────────────────
LED_W_POR_M = 14.4
LED_MARGEN_FUENTE = 1.25
LED_RETRANQUEO = 40         # ml_tira = ancho_módulo − esto
FUENTES_COMERCIALES = (30, 60, 100, 150, 200, 300)


# ── Derivaciones ─────────────────────────────────────────────────────────
def alto_lateral(tipo: str, alto_total: float | None = None) -> float:
    """Único punto del sistema donde se decide la altura del lateral.

    base     → descansa sobre la base       → alto_cuerpo − T   (785)
    cajonera → es un mueble inferior         → igual que base
    torre    → mismo principio, pieza única → alto − zoclo − T  (2100 → 1985)
    superior → corre completo               → alto
    """
    if tipo in ("base", "base_tarja", "cajonera"):
        return ALTO_LATERAL_BASE
    if tipo == "torre":
        return (alto_total or ALTO_TORRE_DEFAULT) - ALTO_ZOCLO - T
    if tipo == "superior":
        return alto_total or ALTO_SUPERIOR_DEFAULT
    raise ValueError(f"tipo de mueble desconocido: {tipo}")


def alto_cuerpo(tipo: str, alto_total: float | None = None) -> float:
    """Alto del cuerpo (sin zoclo). Es el alto del fondo aplicado."""
    if tipo in ("base", "base_tarja", "cajonera"):
        return ALTO_CUERPO_BASE
    if tipo == "torre":
        return (alto_total or ALTO_TORRE_DEFAULT) - ALTO_ZOCLO
    if tipo == "superior":
        return alto_total or ALTO_SUPERIOR_DEFAULT
    raise ValueError(f"tipo de mueble desconocido: {tipo}")


def seleccionar_corredera(prof_modulo: float,
                          esp_frente: float = T_FRENTE_STD,
                          tope: int = CORREDERA_DEFAULT) -> int:
    """Estándar del taller = 500. Sólo baja si el módulo no da.

    600 de fondo con frente de 19 → límite 556 → devuelve 500 (no 550).
    """
    limite = prof_modulo - esp_frente - HOLGURA_TRASERA
    candidatas = [c for c in CORREDERAS_STD if c <= limite and c <= tope]
    if not candidatas:
        raise ValueError(
            f"Módulo de {prof_modulo}mm con frente de {esp_frente}mm no admite "
            f"ninguna corredera estándar (límite {limite}mm)."
        )
    return max(candidatas)


def num_bisagras(alto_puerta: float) -> int:
    for limite, n in BISAGRAS_POR_ALTURA:
        if alto_puerta < limite:
            return n
    return BISAGRAS_POR_ALTURA[-1][1]


def num_patas(ancho: float) -> int:
    return PATAS_BASE + (1 if ancho > PATA_EXTRA_SI_ANCHO_MAYOR_A else 0)


def fuente_led(watts: float) -> int:
    objetivo = watts * LED_MARGEN_FUENTE
    for f in FUENTES_COMERCIALES:
        if f >= objetivo:
            return f
    return FUENTES_COMERCIALES[-1]
