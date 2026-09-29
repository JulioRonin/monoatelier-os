"""Lectura de una foto de referencia → ficha que el taller puede revisar.

Dos pasos separados a propósito:

    1. LECTURA (este módulo). Un modelo con visión mira la foto y llena una
       ficha con esquema fijo: qué mueble es, sus elementos de izquierda a
       derecha en proporción, acabados, lo que no se puede fabricar como se ve,
       y las medidas que faltan con una estimación.
    2. CONSTRUCCIÓN (agente.py). Con la ficha ya revisada, el agente de
       siempre llama al motor. No necesita ver la foto: la ficha es la
       traducción, y lo que Julio aprobó es lo que se construye.

Una foto no trae escala, y una hecha con IA además miente: repisas que flotan,
proporciones imposibles, luces sin fuente. Por eso la lectura estima y
pregunta, y un humano confirma antes de cortar nada.

Qué partes puede construir el motor NO lo decide el modelo: lo decide
evaluar(), contra la lista de generadores que existen.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os

#: el que lee la foto. Independiente de FORGE_MODEL, que es el constructor:
#: se puede construir con Nemotron y leer con Claude.
MODELO_LECTURA = "claude-opus-5-5"

#: tipos de elemento que el motor sabe construir hoy
SOPORTADOS = {"gabinete_base", "cajonera", "tarja", "torre", "alacena", "hueco"}

TIPOS_ELEMENTO = [
    # cocina — el motor los construye
    "gabinete_base", "cajonera", "tarja", "torre", "alacena", "hueco",
    # closet y vestidor — sin generador todavía
    "closet_colgado_sencillo", "closet_colgado_doble", "closet_entrepanos",
    "closet_cajonera", "closet_zapatera", "closet_vitrina", "closet_maletero",
    "esquinero",
    # otros
    "repisa_abierta", "isla", "panel_decorativo", "otro",
]

_TEXTO = {"type": "string"}
_NUM = {"type": "number"}
_ENT = {"type": "integer"}
_BOOL = {"type": "boolean"}


def _obj(**props) -> dict:
    """Objeto estricto: la salida estructurada exige additionalProperties
    false y todos los campos en required."""
    return {"type": "object", "properties": props,
            "required": list(props), "additionalProperties": False}


FICHA_SCHEMA = _obj(
    nombre_proyecto=_TEXTO,
    cliente=_TEXTO,
    tipo={"type": "string",
          "enum": ["cocina", "closet", "bano", "mueble_tv", "otro"]},
    resumen=_TEXTO,
    distribucion={"type": "string",
                  "enum": ["lineal", "L", "U", "paralela", "isla", "otro"]},
    muros={"type": "array", "items": _obj(
        id=_TEXTO,
        descripcion=_TEXTO,
        elementos={"type": "array", "items": _obj(
            tipo={"type": "string", "enum": TIPOS_ELEMENTO},
            fraccion_ancho=_NUM,
            ancho_estimado_mm=_NUM,
            alto_estimado_mm=_NUM,
            puertas=_ENT,
            cajones=_ENT,
            entrepanos=_ENT,
            led=_BOOL,
            detalle=_TEXTO,
        )},
    )},
    acabados={"type": "array", "items": _obj(
        zona={"type": "string",
              "enum": ["estructura", "frentes", "cubierta", "interior", "otro"]},
        descripcion=_TEXTO,
        sku_sugerido=_TEXTO,
    )},
    apertura={"type": "string",
              "enum": ["jaladera", "gola_aluminio", "gola_tablero", "push",
                       "sin_frentes", "mixto"]},
    led=_obj(lleva=_BOOL, zonas={"type": "array", "items": _TEXTO}),
    no_fabricable={"type": "array", "items": _obj(
        elemento=_TEXTO, por_que=_TEXTO, propuesta=_TEXTO)},
    medidas={"type": "array", "items": _obj(
        clave=_TEXTO, pregunta=_TEXTO, estimado_mm=_NUM, base=_TEXTO)},
    supuestos={"type": "array", "items": _TEXTO},
)

SISTEMA_LECTURA = """Eres el lector de referencias de Mono Atelier, un taller de muebles a
medida en Juárez. Te llega una foto —muchas veces generada con IA— de lo que
quiere un cliente, y la traduces a una FICHA que el taller revisa antes de
fabricar. No diseñas: describes con precisión lo que se ve, estimas lo que
falta, y señalas lo que no se puede hacer así.

CÓMO FABRICA EL TALLER
Tablero de melamina o MDF de 15mm (frentes de 15 o 19), sistema 32, cubrecanto.
Los muebles de piso y las torres se APOYAN: zoclo de 100, base a todo el
ancho y los laterales sobre la base. Las alacenas se CUELGAN de un riel.
El tornillo nunca carga el peso: lo carga el tablero. Todo es modular:
módulos de 450 a 900 de ancho; arriba de 900 lleva divisor.

MUROS Y ELEMENTOS
- Un muro por cada pared con muebles. Una esquina en L son dos muros; en U,
  tres. Identifícalos A, B, C en el orden en que se recorren.
- Los elementos de cada muro van de IZQUIERDA a DERECHA mirando ese muro.
- fraccion_ancho: qué parte del largo del muro ocupa ese elemento. Las de un
  muro suman 1 (incluye los huecos para refrigerador o estufa como "hueco").
- ancho_estimado_mm y alto_estimado_mm: tu estimación, no una medida.
- puertas, cajones, entrepanos: los que se ven (0 si no hay).
- detalle: lo que el taller necesita saber de ese elemento y no cabe en los
  números: "dos tubos colgadores", "cajón con tapa de vidrio para relojes",
  "horno y microondas empotrados".

Tipos de elemento:
  gabinete_base (mueble de piso con puertas) · cajonera (mueble de piso de
  cajones) · tarja (el módulo de la tarja) · torre (mueble alto de horno o
  despensa) · alacena (mueble colgado) · hueco (espacio sin mueble: refri,
  estufa libre) · closet_colgado_sencillo (un tubo) · closet_colgado_doble
  (dos tubos, uno sobre otro) · closet_entrepanos · closet_cajonera ·
  closet_zapatera · closet_vitrina (cajón o módulo con vidrio) ·
  closet_maletero (el entrepaño alto para maletas) · esquinero (el módulo que
  resuelve la esquina) · repisa_abierta · isla · panel_decorativo · otro.
Un módulo de closet con varias funciones apiladas (maletero arriba, colgado
abajo) se describe como su función principal y el resto va en detalle.

ESTIMAR SIN FALSA PRECISIÓN
Una foto no trae escala. Estima con anclas que se ven y di en `base` cuál
usaste: cubierta a 900 del piso · alacena de 750 · puerta de cuarto de 2100 ·
plafón de 2400 a 2600 · tubo sencillo a ~1700 del piso, doble a ~1000 y
~2000 · frente de cajón de 150 a 250 · zapato de ~300.
En `medidas` incluye SIEMPRE una por muro con clave "largo_muro_<id>" y una
"alto_total" (el mueble más alto). Agrega sólo las preguntas que cambian el
diseño (máximo seis); redacta cada pregunta como se la harías al taller.

LAS FOTOS HECHAS CON IA MIENTEN
Busca y reporta en no_fabricable: repisas largas que flotan sin apoyo,
proporciones imposibles (alacenas de 60cm de fondo, puertas de 1.2m de ancho),
luces sin fuente ni ruteo, vetas continuas que no existen en un tablero de
2440, esquinas que no cierran, cajones que chocarían con la puerta de al lado.
En `propuesta` di cómo lo resolvería el taller con sus métodos. Si algo está
bien pero el taller no lo hace (piedra, vidrio curvo, herrería), repórtalo
también: se compra o se subcontrata.

ACABADOS
Usa un SKU del catálogo sólo si de verdad corresponde; si no, sku_sugerido
vacío y la descripción clara ("melamina blanco mate", "MDF laqueado rosa").

OTROS CAMPOS
- nombre_proyecto: corto ("Vestidor en L", "Cocina en U gris").
- cliente: sólo si viene en las indicaciones; si no, vacío.
- resumen: dos o tres frases de lo que se ve.
- supuestos: lo que diste por hecho y el taller debería confirmar.
Español de México, conciso."""


# ── imágenes ─────────────────────────────────────────────────────────────

def tipo_de_imagen(crudo: bytes) -> str | None:
    """El tipo por el CONTENIDO, no por la extensión.

    Una foto WEBP guardada como "vestidor.jpg" (Windows esconde la extensión
    real) se mandaría como JPEG y la API la rechaza por no coincidir.
    """
    if crudo.startswith(b"\x89PNG"):
        return "image/png"
    if crudo.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if crudo.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if crudo[:4] == b"RIFF" and crudo[8:12] == b"WEBP":
        return "image/webp"
    return None


def bloque_imagen(ref: str) -> dict:
    """URL pública → bloque por URL. Ruta local → base64.

    La ruta local es para probar desde la terminal con la foto que mandó el
    cliente, sin subirla antes a ningún lado.
    """
    if os.path.isfile(ref):
        with open(ref, "rb") as f:
            crudo = f.read()
        tipo = tipo_de_imagen(crudo) or mimetypes.guess_type(ref)[0] or "image/jpeg"
        datos = base64.standard_b64encode(crudo).decode("ascii")
        return {"type": "image",
                "source": {"type": "base64", "media_type": tipo, "data": datos}}
    return {"type": "image", "source": {"type": "url", "url": ref}}


def _catalogo() -> str:
    """Los materiales del taller, para que el SKU sugerido exista."""
    try:
        from .herramientas import ver_catalogo
        return ver_catalogo.func()
    except Exception as e:                      # noqa: BLE001
        return f"(catálogo no disponible: {e})"


# ── lectura ──────────────────────────────────────────────────────────────

def leer_foto(imagenes: list[str], indicaciones: str = "", *,
              cliente=None, modelo: str | None = None) -> dict:
    """Manda las fotos al modelo con visión y devuelve la ficha evaluada.

    Returns:
        {"ficha": dict, "modelo": str, "uso": {...}}
    """
    if not imagenes:
        raise RuntimeError("La lectura necesita al menos una foto de referencia.")

    modelo = modelo or os.environ.get("FORGE_MODELO_LECTURA") or MODELO_LECTURA
    if cliente is None:
        from anthropic import Anthropic
        from . import llave_anthropic
        cliente = Anthropic(api_key=llave_anthropic())

    texto = ("Lee esta referencia y llena la ficha.\n\n"
             "CATÁLOGO DEL TALLER\n" + _catalogo() + "\n\n"
             "INDICACIONES DE JULIO\n" + (indicaciones.strip() or "(ninguna)"))

    r = cliente.beta.messages.create(
        model=modelo,
        max_tokens=16000,
        system=SISTEMA_LECTURA,
        messages=[{"role": "user", "content":
                   [bloque_imagen(u) for u in imagenes] +
                   [{"type": "text", "text": texto}]}],
        thinking={"type": "adaptive"},
        output_config={"effort": "high",
                       "format": {"type": "json_schema", "schema": FICHA_SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if r.stop_reason == "refusal":
        raise RuntimeError("El modelo declinó leer esta imagen.")
    if r.stop_reason == "max_tokens":
        raise RuntimeError("La lectura se cortó antes de terminar la ficha. "
                           "Prueba con menos fotos a la vez.")

    texto_salida = next((b.text for b in r.content if b.type == "text"), "")
    try:
        ficha = json.loads(texto_salida)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"La ficha no llegó como JSON válido: {e}") from e

    return {"ficha": evaluar(ficha), "modelo": modelo,
            "uso": {"input_tokens": r.usage.input_tokens,
                    "output_tokens": r.usage.output_tokens}}


# ── lo que el motor sí puede construir ───────────────────────────────────

def evaluar(ficha: dict) -> dict:
    """Marca qué se puede construir. Lo decide el código, no el modelo.

    Un elemento sin generador no bloquea al resto: una cocina con isla se
    construye sin la isla y lo dice. Pero si NADA de la ficha tiene generador
    (un closet, hoy), no hay qué construir.
    """
    tipos = [e.get("tipo") for m in ficha.get("muros", [])
             for e in m.get("elementos", [])]
    ficha["omitidos"] = sorted({t for t in tipos if t not in SOPORTADOS})
    ficha["construible"] = any(t in SOPORTADOS and t != "hueco" for t in tipos)

    # el largo de cada muro es LA medida: sin ella no hay a qué escalar las
    # proporciones. Si el modelo la olvidó, se agrega con la suma de lo que vio.
    claves = {m.get("clave") for m in ficha.setdefault("medidas", [])}
    for muro in ficha.get("muros", []):
        clave = f"largo_muro_{muro.get('id')}"
        if clave not in claves:
            suma = sum(float(e.get("ancho_estimado_mm") or 0)
                       for e in muro.get("elementos", []))
            ficha["medidas"].insert(0, {
                "clave": clave,
                "pregunta": f"¿Cuánto mide de largo el muro {muro.get('id')}?",
                "estimado_mm": round(suma), "base": "suma de los anchos estimados"})
    return ficha


def _valor(m: dict) -> float:
    """La medida confirmada si Julio la capturó; si no, la estimada."""
    v = m.get("valor_mm")
    return float(v) if v not in (None, "") else float(m.get("estimado_mm") or 0)


def _anchos(muro: dict, largo: float) -> list[float]:
    """Proporciones de la foto → mm sobre el largo confirmado del muro.

    Se normalizan: si las fracciones que leyó el modelo suman 0.96, escalar
    tal cual dejaría 4% del muro sin mueble.
    """
    elems = muro.get("elementos", [])
    fr = [max(float(e.get("fraccion_ancho") or 0), 0.0) for e in elems]
    total = sum(fr)
    if total <= 0:
        return [float(e.get("ancho_estimado_mm") or 0) for e in elems]
    return [round(largo * f / total / 10) * 10 for f in fr]


_HERRAMIENTA = {
    "gabinete_base": "agregar_gabinete_base",
    "cajonera": "agregar_cajonera",
    "tarja": "agregar_gabinete_base con tarja=True",
    "torre": "agregar_torre",
    "alacena": "agregar_alacena",
    "hueco": "no lleva mueble: parte el tramo o usa desplazamiento",
}


def ficha_a_prompt(ficha: dict) -> str:
    """La ficha revisada, en instrucciones para el agente constructor.

    Es texto porque el constructor puede ser un modelo que no ve imágenes: lo
    que no esté aquí, no existe para él.
    """
    medidas = {m.get("clave"): _valor(m) for m in ficha.get("medidas", [])}
    lineas = [
        "Construye este diseño. Viene de la lectura de una foto de referencia "
        "que Julio ya revisó; las medidas marcadas como confirmadas mandan.",
        "",
        f"Proyecto: {ficha.get('nombre_proyecto') or 'Proyecto'}"
        + (f" · Cliente: {ficha['cliente']}" if ficha.get("cliente") else ""),
        f"Tipo: {ficha.get('tipo')} · distribución {ficha.get('distribucion')}",
        f"Lo que se ve: {ficha.get('resumen', '')}",
        "",
        "MEDIDAS (mm):",
    ]
    for m in ficha.get("medidas", []):
        estado = "confirmada" if m.get("valor_mm") not in (None, "") else "estimada"
        lineas.append(f"  - {m.get('pregunta')} → {_valor(m):.0f} ({estado})")

    for muro in ficha.get("muros", []):
        mid = muro.get("id")
        largo = medidas.get(f"largo_muro_{mid}", 0.0)
        lineas += ["", f"MURO {mid} — {muro.get('descripcion', '')} — "
                       f"largo {largo:.0f}mm, de izquierda a derecha:"]
        for n, (e, ancho) in enumerate(zip(muro.get("elementos", []),
                                           _anchos(muro, largo)), 1):
            tipo = e.get("tipo")
            partes = [f"~{ancho:.0f}mm"]
            for campo in ("puertas", "cajones", "entrepanos"):
                if e.get(campo):
                    partes.append(f"{e[campo]} {campo}")
            if e.get("led"):
                partes.append("LED")
            if e.get("detalle"):
                partes.append(e["detalle"])
            como = (_HERRAMIENTA.get(tipo) if tipo in SOPORTADOS
                    else "NO CONSTRUIR: el motor no tiene generador")
            lineas.append(f"  {n}. {tipo} · {' · '.join(partes)}  [{como}]")

    lineas += ["", "ACABADOS:"]
    if not ficha.get("acabados"):
        lineas.append("  (no se distinguen en la foto: usa los del proyecto)")
    for a in ficha.get("acabados", []):
        sku = f" (SKU {a['sku_sugerido']})" if a.get("sku_sugerido") else ""
        lineas.append(f"  - {a.get('zona')}: {a.get('descripcion')}{sku}")
    lineas.append(f"Apertura: {ficha.get('apertura')}")
    led = ficha.get("led") or {}
    if led.get("lleva"):
        lineas.append("LED en: " + ", ".join(led.get("zonas") or []))

    if ficha.get("omitidos"):
        lineas += ["", "SIN GENERADOR — no los construyas ni los sustituyas por "
                       "algo parecido; dilo en tu resumen: "
                       + ", ".join(ficha["omitidos"])]
    if ficha.get("no_fabricable"):
        lineas += ["", "LO QUE NO SE FABRICA COMO EN LA FOTO (aplica la propuesta "
                       "si el motor puede; si no, dilo en tu resumen):"]
        for x in ficha["no_fabricable"]:
            lineas.append(f"  - {x.get('elemento')}: {x.get('por_que')} → "
                          f"{x.get('propuesta')}")
    if (ficha.get("indicaciones") or "").strip():
        lineas += ["", "INDICACIONES DE JULIO (mandan sobre la foto):",
                   ficha["indicaciones"].strip()]

    lineas += ["", "Los anchos con ~ son proporciones de la foto: ajústalos a "
                   "anchos de taller, pero cada muro —contando sus huecos— debe "
                   "sumar exactamente su largo. Si no cuadra, usa un filler y "
                   "anótalo con agregar_nota."]
    return "\n".join(lineas)


def resumen_de_ficha(ficha: dict) -> str:
    """Lo que se ve en la lista de trabajos de la plataforma."""
    n = sum(len(m.get("elementos", [])) for m in ficha.get("muros", []))
    txt = (f"{ficha.get('nombre_proyecto') or 'Lectura'} · "
           f"{len(ficha.get('muros', []))} muro(s), {n} elemento(s). ")
    if not ficha.get("construible"):
        txt += ("El motor todavía no tiene generador para esto ("
                + ", ".join(ficha.get("omitidos") or ["—"]) + "). ")
    elif ficha.get("omitidos"):
        txt += "Se omitirán: " + ", ".join(ficha["omitidos"]) + ". "
    return txt + "Revisa la ficha y confirma las medidas."
