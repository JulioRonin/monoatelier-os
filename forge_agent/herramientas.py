"""Las herramientas que Claude usa para construir un proyecto Mono Atelier.

Cada herramienta llama a un generador del motor: el modelo elige QUÉ módulos
poner y con qué parámetros, pero las MEDIDAS las sigue derivando mono-forge.
El modelo nunca inventa una dimensión — ese es el punto.
"""

from __future__ import annotations

from anthropic import beta_tool

from mono_forge.constants import (
    ALTO_SUPERIOR_DEFAULT, ALTO_TORRE_DEFAULT, PROF_BASE, PROF_SUPERIOR,
    PROF_TORRE, T_FRENTE_BRILLO, T_FRENTE_STD,
)
from mono_forge.costing import catalogo_herrajes, catalogo_materiales
from mono_forge.cutlist import resumen
from mono_forge.generators.base import gabinete_base
from mono_forge.generators.cajonera import cajon
from mono_forge.generators.cubierta import cubierta
from mono_forge.generators.superior import alacena
from mono_forge.generators.torre import torre
from mono_forge.models import Project, Tramo
from mono_forge.rules import led as regla_led
from mono_forge.rules.apertura import cargar_golas, gola_de_tramo, gola_por_sku
from mono_forge.rules.posicion import colocar


class Estado:
    """El proyecto en construcción. Una instancia por trabajo."""

    def __init__(self) -> None:
        self.project = Project(cliente="Cliente", nombre="Proyecto")
        self.material_default = "MEL-BLA-15-IMP"
        self.material_frente_default: str | None = None
        self.apertura_default = "jaladera"
        self.gola_sku_default: str | None = None
        self.bitacora: list[str] = []

    def log(self, msg: str) -> None:
        self.bitacora.append(msg)

    def modulo(self, id: str):
        return next((m for m in self.project.modules if m.id == id), None)


ESTADO = Estado()


def reiniciar(base: dict | None = None) -> Estado:
    """Nuevo trabajo. Con `base` continúa iterando sobre un diseño existente."""
    global ESTADO
    ESTADO = Estado()
    if base:
        ESTADO.project = Project.from_dict(base)
    return ESTADO


def _gola_hueco(sku: str | None) -> float:
    if not sku:
        return 0.0
    try:
        return float(gola_por_sku(sku)["alto_hueco_mm"])
    except Exception:
        return 0.0


def _apertura(apertura: str | None) -> str:
    return apertura or ESTADO.apertura_default


# ── Contexto ─────────────────────────────────────────────────────────────

@beta_tool
def ver_catalogo() -> str:
    """Lista los materiales, perfiles de gola y herrajes disponibles en el
    catálogo del taller, con sus precios cuando existen. Consúltalo ANTES de
    elegir un material o un perfil de gola: nunca inventes un SKU."""
    mats = catalogo_materiales()
    golas = cargar_golas()
    herr = catalogo_herrajes()

    lineas = ["MATERIALES (sku | descripción | marca | espesor | costo_m2):"]
    for sku, r in mats.items():
        precio = r.get("costo_m2") or "SIN PRECIO"
        lineas.append(f"  {sku} | {r['descripcion']} | {r.get('marca','-')} | "
                      f"{r['espesor_mm']}mm | {precio}")
    lineas.append("\nGOLAS (sku | tipo | alto_hueco | retranqueo | largo comercial):")
    for sku, r in golas.items():
        lineas.append(f"  {sku} | {r['tipo']} | {r['alto_hueco_mm']}mm | "
                      f"{r['retranqueo_mm']}mm | {r['largo_comercial_mm']}mm")
    lineas.append(f"\nHERRAJES: {len(herr)} SKUs en catálogo "
                  f"(bisagras, correderas, patas, minifix, LED).")
    return "\n".join(lineas)


@beta_tool
def definir_proyecto(cliente: str, nombre: str,
                     material: str = "MEL-BLA-15-IMP",
                     material_frente: str = "",
                     apertura: str = "jaladera",
                     gola_sku: str = "") -> str:
    """Define los datos generales del proyecto y los valores por defecto que
    heredarán los módulos. Llámala PRIMERO, antes de agregar módulos.

    Args:
        cliente: nombre del cliente.
        nombre: nombre del proyecto (ej. "Cocina en L").
        material: SKU del tablero de estructura (ver ver_catalogo).
        material_frente: SKU de los frentes. Vacío = igual que la estructura.
        apertura: jaladera | gola_aluminio | gola_tablero | push.
        gola_sku: SKU del perfil de gola si la apertura es de gola.
    """
    ESTADO.project.cliente = cliente
    ESTADO.project.nombre = nombre
    ESTADO.material_default = material
    ESTADO.material_frente_default = material_frente or None
    ESTADO.apertura_default = apertura
    ESTADO.gola_sku_default = gola_sku or None
    if material_frente and "BRI" in material_frente:
        ESTADO.log("Frente alto brillo: cintilla PVC a MANO (tarifa de canto manual).")
    return (f"Proyecto «{nombre}» para {cliente}. Estructura {material}, "
            f"frentes {material_frente or material}, apertura {apertura}"
            + (f" con perfil {gola_sku} (hueco {_gola_hueco(gola_sku):.0f}mm)."
               if gola_sku else "."))


@beta_tool
def estado_actual() -> str:
    """Resumen de lo que llevas construido: módulos, tramos, área y hojas.
    Úsalo para verificar antes de terminar o cuando iteres sobre un diseño."""
    p = ESTADO.project
    if not p.modules:
        return "El proyecto está vacío: aún no has agregado módulos."
    lineas = [f"Proyecto «{p.nombre}» — {p.cliente}", "Módulos:"]
    for m in p.modules:
        lineas.append(f"  {m.id} | {m.tipo} | {m.ancho:.0f}×{m.alto:.0f}×{m.prof:.0f}mm"
                      f" | apertura {m.apertura}" + (" | LED" if m.led else ""))
    for t in p.tramos:
        lineas.append(f"  Tramo {t.id} (muro {t.muro}): {', '.join(t.modulos)}"
                      + (" + cubierta" if t.panels else ""))
    try:
        r = resumen(p)
        lineas.append(f"Área de tablero: {r['area_paneles_m2']} m² | "
                      f"cubrecanto {r['ml_cubrecanto']} ml")
        for mat, n in r["hojas_por_material"].items():
            lineas.append(f"  {mat}: {n} hoja(s) "
                          f"({r['aprovechamiento'][mat]*100:.0f}% aprovechamiento)")
    except Exception as e:
        lineas.append(f"(no se pudo calcular el cutlist: {e})")
    return "\n".join(lineas)


# ── Módulos ──────────────────────────────────────────────────────────────

@beta_tool
def agregar_gabinete_base(id: str, ancho: float, prof: float = PROF_BASE,
                          puertas: int = 1, entrepanos: int = 1,
                          tarja: bool = False, led: bool = False,
                          esp_frente: float = T_FRENTE_STD,
                          material: str = "", material_frente: str = "",
                          apertura: str = "") -> str:
    """Agrega un mueble INFERIOR (900mm de alto con zoclo). La base corre a
    todo el ancho y los laterales descansan sobre ella.

    Args:
        id: identificador corto y único (ej. "B01").
        ancho: ancho exterior en mm. Si supera 900 se agrega divisor central.
        prof: profundidad, normalmente 600.
        puertas: 1 o 2. Con 2 puertas y divisor la bisagra es semicurva.
        entrepanos: entrepaños móviles por vano. El módulo de tarja no lleva.
        tarja: True para el módulo donde va la tarja (sin entrepaño, refuerzos de 80mm).
        led: True para iluminación LED en este módulo.
        esp_frente: 15 estándar, 19 para alto brillo.
        material: SKU de estructura. Vacío = el del proyecto.
        material_frente: SKU de frente. Vacío = el del proyecto.
        apertura: vacío = la del proyecto.
    """
    if ESTADO.modulo(id):
        return f"ERROR: ya existe un módulo con id {id}. Usa otro."
    ap = _apertura(apertura)
    m = gabinete_base(
        id=id, ancho=ancho, prof=prof, puertas=puertas, entrepanos=entrepanos,
        esp_frente=esp_frente,
        material=material or ESTADO.material_default,
        material_frente=material_frente or ESTADO.material_frente_default,
        apertura=ap, gola_hueco=_gola_hueco(ESTADO.gola_sku_default),
        tarja=tarja, led=led)
    m.gola_sku = ESTADO.gola_sku_default
    ESTADO.project.modules.append(m)
    return (f"{id}: mueble inferior {ancho:.0f}×900×{prof:.0f}mm, {puertas} puerta(s)"
            + (", módulo de tarja" if tarja else "")
            + (f", divisor central (ancho > 900)" if ancho > 900 else "")
            + f". {len(m.panels)} piezas.")


@beta_tool
def agregar_alacena(id: str, ancho: float, alto: float = ALTO_SUPERIOR_DEFAULT,
                    prof: float = PROF_SUPERIOR, puertas: int = 1,
                    entrepanos: int = 1, led: bool = False,
                    esp_frente: float = T_FRENTE_STD,
                    material: str = "", material_frente: str = "",
                    apertura: str = "") -> str:
    """Agrega un mueble SUPERIOR colgado. Los laterales corren completos y el
    techo y el piso van capturados entre ellos.

    Args:
        id: identificador corto y único (ej. "A01").
        ancho: ancho exterior en mm.
        alto: 700, 750 (default) u 800.
        prof: entre 350 y 400. Fuera de ese rango falla.
        puertas: 1 o 2.
        entrepanos: entrepaños móviles por vano.
        led: True para LED bajo alacena.
        esp_frente: 15 estándar, 19 alto brillo.
        material: SKU de estructura. Vacío = el del proyecto.
        material_frente: SKU de frente. Vacío = el del proyecto.
        apertura: vacío = la del proyecto.
    """
    if ESTADO.modulo(id):
        return f"ERROR: ya existe un módulo con id {id}. Usa otro."
    try:
        m = alacena(
            id=id, ancho=ancho, alto=alto, prof=prof, puertas=puertas,
            entrepanos=entrepanos, esp_frente=esp_frente,
            material=material or ESTADO.material_default,
            material_frente=material_frente or ESTADO.material_frente_default,
            apertura=_apertura(apertura),
            gola_hueco=_gola_hueco(ESTADO.gola_sku_default), led=led)
    except ValueError as e:
        return f"ERROR: {e}"
    m.gola_sku = ESTADO.gola_sku_default
    ESTADO.project.modules.append(m)
    return (f"{id}: alacena {ancho:.0f}×{alto:.0f}×{prof:.0f}mm, {puertas} puerta(s)."
            f" {len(m.panels)} piezas. Se cuelga por el riel posterior superior.")


@beta_tool
def agregar_cajonera(id: str, ancho: float, altos_frentes: list[float],
                     prof: float = PROF_BASE, tipo_corredera: str = "lateral",
                     esp_frente: float = T_FRENTE_STD,
                     material: str = "", material_frente: str = "",
                     apertura: str = "") -> str:
    """Agrega una torre de cajones: un módulo por cajón, apilados.

    Args:
        id: prefijo del identificador (ej. "C01"; los cajones serán C01_1, C01_2...).
        ancho: ancho exterior del módulo en mm.
        altos_frentes: alto del frente de cada cajón, de abajo hacia arriba
            (ej. [200, 200, 300]). La suma debe caber en los 900mm del mueble.
        prof: profundidad del módulo. La corredera se elige sola (500 estándar).
        tipo_corredera: "lateral" o "bajo_cajon".
        esp_frente: 15 estándar, 19 alto brillo.
        material: SKU de estructura. Vacío = el del proyecto.
        material_frente: SKU de frente. Vacío = el del proyecto.
        apertura: vacío = la del proyecto.
    """
    from mono_forge.constants import T
    ancho_interior = ancho - 2 * T
    creados = []
    for i, alto_f in enumerate(altos_frentes, start=1):
        cid = f"{id}_{i}"
        if ESTADO.modulo(cid):
            return f"ERROR: ya existe un módulo con id {cid}."
        m = cajon(
            id=cid, ancho_interior=ancho_interior, alto_frente=alto_f,
            prof_modulo=prof, ancho_modulo=ancho, esp_frente=esp_frente,
            tipo_corredera=tipo_corredera,
            material=material or ESTADO.material_default,
            material_frente=material_frente or ESTADO.material_frente_default,
            apertura=_apertura(apertura),
            gola_hueco=_gola_hueco(ESTADO.gola_sku_default))
        m.gola_sku = ESTADO.gola_sku_default
        ESTADO.project.modules.append(m)
        creados.append(f"{cid} ({alto_f:.0f}mm)")
    total = sum(altos_frentes)
    aviso = ""
    if total > 900:
        aviso = (f" AVISO: los frentes suman {total:.0f}mm y el mueble inferior "
                 f"mide 900mm. Revisa la modulación.")
    return f"Cajonera {id}: {', '.join(creados)}. Corredera {tipo_corredera}.{aviso}"


@beta_tool
def agregar_torre(id: str, ancho: float = 600,
                  alto_total: float = ALTO_TORRE_DEFAULT,
                  prof: float = PROF_TORRE,
                  nichos: list[dict] | None = None,
                  esp_frente: float = T_FRENTE_STD,
                  material: str = "", material_frente: str = "") -> str:
    """Agrega una TORRE de horno o microondas. Los laterales van de una sola
    pieza y los entrepaños de los nichos son FIJOS (cargan el electrodoméstico).

    Args:
        id: identificador corto y único (ej. "T01").
        ancho: normalmente 600.
        alto_total: entre 2100 y 2200.
        prof: normalmente 600.
        nichos: lista como [{"tipo": "horno", "alto_nicho": 600, "ventilacion": 30}].
            La suma vertical se valida contra el lateral; si no cuadra, falla.
        esp_frente: 15 estándar, 19 alto brillo.
        material: SKU de estructura. Vacío = el del proyecto.
        material_frente: SKU de frente. Vacío = el del proyecto.
    """
    if ESTADO.modulo(id):
        return f"ERROR: ya existe un módulo con id {id}. Usa otro."
    try:
        m = torre(id=id, ancho=ancho, alto_total=alto_total, prof=prof,
                  nichos=nichos or [], esp_frente=esp_frente,
                  material=material or ESTADO.material_default,
                  material_frente=material_frente or ESTADO.material_frente_default)
    except ValueError as e:
        return f"ERROR: {e}"
    ESTADO.project.modules.append(m)
    tipos = ", ".join(n["tipo"] for n in (nichos or [])) or "sin nichos"
    return (f"{id}: torre {ancho:.0f}×{alto_total:.0f}×{prof:.0f}mm ({tipos}). "
            f"{len(m.panels)} piezas.")


@beta_tool
def eliminar_modulo(id: str) -> str:
    """Elimina un módulo del proyecto por su id. Úsalo al iterar cuando el
    cliente pide quitar o rehacer una parte del diseño."""
    m = ESTADO.modulo(id)
    if not m:
        return f"ERROR: no existe el módulo {id}."
    ESTADO.project.modules.remove(m)
    for t in ESTADO.project.tramos:
        if id in t.modulos:
            t.modulos.remove(id)
    return f"Módulo {id} eliminado."


# ── Tramos, cubierta, gola y LED ─────────────────────────────────────────

@beta_tool
def agregar_tramo(id: str, muro: str, modulos: list[str],
                  lleva_cubierta: bool = True,
                  recortes: list[str] | None = None) -> str:
    """Agrupa módulos contiguos de un mismo muro en un TRAMO y le calcula la
    cubierta y la gola. La cubierta y la gola SIEMPRE se calculan por tramo,
    nunca por módulo. Llámala después de agregar todos los módulos del muro.

    Args:
        id: identificador del tramo (ej. "T1").
        muro: etiqueta del muro (ej. "A").
        modulos: ids de los módulos de piso contiguos, en orden.
        lleva_cubierta: False para un tramo de alacenas.
        recortes: ["tarja", "parrilla"] — se acotan en el plano de cubierta.
    """
    faltantes = [mid for mid in modulos if not ESTADO.modulo(mid)]
    if faltantes:
        return f"ERROR: no existen los módulos {', '.join(faltantes)}."
    t = Tramo(id=id, muro=muro, modulos=list(modulos), lleva_cubierta=lleva_cubierta)
    largo = sum(ESTADO.modulo(mid).ancho for mid in modulos)
    notas = []

    if lleva_cubierta:
        prof = max(ESTADO.modulo(mid).prof for mid in modulos)
        panels, notas_cub = cubierta(id, largo, prof_modulo=prof, recortes=recortes or [])
        t.panels += panels
        t.notas += notas_cub
        notas += notas_cub

    sku = ESTADO.gola_sku_default
    if sku and any(ESTADO.modulo(mid).apertura.startswith("gola") for mid in modulos):
        try:
            gp, gh, gn = gola_de_tramo(id, largo, sku)
            t.panels += gp
            t.hardware += gh
            t.notas += gn
            notas += gn
        except Exception as e:
            notas.append(f"No se pudo calcular la gola del tramo: {e}")

    ESTADO.project.tramos.append(t)
    return (f"Tramo {id} (muro {muro}): {largo:.0f}mm de frente con "
            f"{len(modulos)} módulos.\n" + "\n".join(f"  · {n}" for n in notas))


@beta_tool
def calcular_led(temperatura_k: int = 3000, control: str = "switch") -> str:
    """Calcula la tira LED, la fuente y las notas de ruteo del proyecto, a
    partir de los módulos marcados con led=True. Llámala al final si hay LED.

    Args:
        temperatura_k: 2700, 3000 (cálido, default) o 4000.
        control: "switch", "dimmer" o "sensor".
    """
    if not any(m.led for m in ESTADO.project.modules):
        return "Ningún módulo tiene LED. No hay nada que calcular."
    items, notas = regla_led.calcular(ESTADO.project, temperatura_k, control)
    if ESTADO.project.tramos:
        ESTADO.project.tramos[0].hardware += items
    else:
        ESTADO.project.modules[0].hardware += items
    ESTADO.project.notas += notas
    detalle = "; ".join(f"{h.descripcion} ×{h.cantidad:g} {h.unidad}" for h in items)
    return f"LED calculado: {detalle}.\n" + "\n".join(f"  · {n}" for n in notas)


@beta_tool
def agregar_nota(nota: str) -> str:
    """Registra una nota del proyecto que debe llegar al taller o al cliente
    (una condición del sitio, una decisión de diseño, una advertencia)."""
    ESTADO.project.notas.append(nota)
    return f"Nota registrada: {nota}"


HERRAMIENTAS = [
    ver_catalogo, definir_proyecto, estado_actual,
    agregar_gabinete_base, agregar_alacena, agregar_cajonera, agregar_torre,
    eliminar_modulo, agregar_tramo, calcular_led, agregar_nota,
]


def finalizar() -> dict:
    """Cierra el proyecto: calcula la colocación 3D y devuelve el dict del JSON."""
    r = colocar(ESTADO.project)
    if r["sin_regla"]:
        ESTADO.log("Paneles sin regla de colocación: " + ", ".join(r["sin_regla"]))
    return ESTADO.project.to_dict()
