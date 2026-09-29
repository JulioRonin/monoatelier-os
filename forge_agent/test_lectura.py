"""Lectura de foto → ficha → instrucciones para el constructor.

La llamada real a Claude no se prueba aquí (gasta y necesita llave). Lo que se
prueba es todo lo que decide el CÓDIGO: qué se manda al modelo, qué se puede
construir, cómo se escalan las proporciones y cómo enruta el worker.

El caso del closet es la foto que mandó Julio: un vestidor en L blanco, con
colgado doble, entrepaños con LED, cajonera con vitrina y zapatera.
"""

from __future__ import annotations

import copy
import json
import types

import pytest

from forge_agent import lectura, worker
from forge_agent.lectura import (FICHA_SCHEMA, evaluar, ficha_a_prompt,
                                 leer_foto, resumen_de_ficha)


def _elem(tipo, fr, ancho, **kw):
    base = dict(tipo=tipo, fraccion_ancho=fr, ancho_estimado_mm=ancho,
                alto_estimado_mm=kw.pop("alto", 2400), puertas=0, cajones=0,
                entrepanos=0, led=False, detalle="")
    base.update(kw)
    return base


VESTIDOR = {
    "nombre_proyecto": "Vestidor en L", "cliente": "", "tipo": "closet",
    "resumen": "Vestidor blanco en L con LED bajo cada entrepaño.",
    "distribucion": "L",
    "muros": [
        {"id": "A", "descripcion": "muro izquierdo", "elementos": [
            _elem("closet_colgado_doble", 1.0, 1000, entrepanos=2, led=True,
                  detalle="maletero arriba, dos tubos"),
        ]},
        {"id": "B", "descripcion": "muro del fondo", "elementos": [
            _elem("esquinero", 0.12, 250),
            _elem("closet_cajonera", 0.5, 1000, cajones=3, entrepanos=3, led=True,
                  detalle="cajón superior con tapa de vidrio para relojes"),
            _elem("closet_colgado_sencillo", 0.38, 750, entrepanos=2,
                  detalle="zapatera de dos niveles abajo"),
        ]},
    ],
    "acabados": [{"zona": "estructura", "descripcion": "melamina blanco mate",
                  "sku_sugerido": "MEL-BLA-15-IMP"}],
    "apertura": "jaladera",
    "led": {"lleva": True, "zonas": ["bajo entrepaño"]},
    "no_fabricable": [{"elemento": "tira LED sin ruteo visible",
                       "por_que": "la foto no muestra por dónde corre el cable",
                       "propuesta": "canal en el canto frontal y paso por el fondo"}],
    "medidas": [
        {"clave": "largo_muro_A", "pregunta": "¿Largo del muro izquierdo?",
         "estimado_mm": 1000, "base": "tubo de ~1m"},
        {"clave": "alto_total", "pregunta": "¿Altura al plafón?",
         "estimado_mm": 2400, "base": "plafón típico"},
    ],
    "supuestos": ["fondo de 600"],
}

COCINA = {
    "nombre_proyecto": "Cocina lineal", "cliente": "Pérez", "tipo": "cocina",
    "resumen": "Cocina blanca con torre e isla.", "distribucion": "lineal",
    "muros": [{"id": "A", "descripcion": "muro principal", "elementos": [
        _elem("torre", 0.2, 600, puertas=2, detalle="horno y micro"),
        _elem("cajonera", 0.2, 600, cajones=3, alto=900),
        _elem("tarja", 0.3, 900, puertas=2, alto=900),
        _elem("hueco", 0.3, 900, detalle="refrigerador"),
    ]}, {"id": "I", "descripcion": "isla al centro", "elementos": [
        _elem("isla", 1.0, 1800, alto=900)]}],
    "acabados": [], "apertura": "gola_aluminio",
    "led": {"lleva": False, "zonas": []}, "no_fabricable": [],
    "medidas": [
        {"clave": "largo_muro_A", "pregunta": "¿Largo del muro?",
         "estimado_mm": 3000, "base": "cubierta a 900"},
        {"clave": "largo_muro_I", "pregunta": "¿Largo de la isla?",
         "estimado_mm": 1800, "base": "proporción"}],
    "supuestos": [],
}


# ── el esquema ───────────────────────────────────────────────────────────

def _objetos(esquema):
    if esquema.get("type") == "object":
        yield esquema
        for p in esquema["properties"].values():
            yield from _objetos(p)
    elif esquema.get("type") == "array":
        yield from _objetos(esquema["items"])


def test_el_esquema_cumple_lo_que_exige_la_salida_estructurada():
    # sin additionalProperties false y todos los campos en required, la API
    # rechaza el esquema y la lectura falla antes de empezar
    for o in _objetos(FICHA_SCHEMA):
        assert o["additionalProperties"] is False
        assert set(o["required"]) == set(o["properties"])


def test_la_ficha_de_ejemplo_respeta_el_esquema():
    # si el ejemplo de la prueba se sale del esquema, la prueba no prueba nada
    def valida(valor, esq):
        t = esq.get("type")
        if "enum" in esq:
            assert valor in esq["enum"], valor
        if t == "object":
            assert set(valor) == set(esq["properties"]), set(valor) ^ set(esq["properties"])
            for k, sub in esq["properties"].items():
                valida(valor[k], sub)
        elif t == "array":
            for v in valor:
                valida(v, esq["items"])
    valida(VESTIDOR, FICHA_SCHEMA)
    valida(COCINA, FICHA_SCHEMA)


# ── qué se puede construir lo decide el código ───────────────────────────

def test_el_vestidor_de_la_foto_ya_se_construye():
    f = evaluar(copy.deepcopy(VESTIDOR))
    assert f["construible"] is True
    assert f["omitidos"] == []


def test_lo_que_no_tiene_generador_sigue_sin_construirse():
    f = copy.deepcopy(VESTIDOR)
    f["tipo"] = "mueble_tv"
    f["muros"] = [{"id": "A", "descripcion": "", "elementos": [
        _elem("panel_decorativo", 0.7, 1400), _elem("repisa_abierta", 0.3, 600)]}]
    f = evaluar(f)
    assert f["construible"] is False
    assert f["omitidos"] == ["panel_decorativo", "repisa_abierta"]
    assert "generador" in resumen_de_ficha(f)


def test_un_esquinero_solo_no_es_un_mueble():
    f = copy.deepcopy(VESTIDOR)
    f["muros"] = [{"id": "A", "descripcion": "", "elementos": [_elem("esquinero", 1, 50)]}]
    assert evaluar(f)["construible"] is False


def test_el_retorno_de_una_L_descuenta_la_esquina():
    # muro B de 1500: 600 del fondo del muro A + 50 de relleno = 850 para módulos
    f = evaluar(copy.deepcopy(VESTIDOR))
    b = next(m for m in f["medidas"] if m["clave"] == "largo_muro_B")
    b["valor_mm"] = 1500
    p = ficha_a_prompt(f)
    assert "quedan 850mm para módulos" in p
    # el esquinero no se escala ni se construye: 0.5 y 0.38 se reparten los 850
    assert "closet_cajonera · ~480mm" in p
    assert "closet_colgado_sencillo · ~370mm" in p
    assert "esquinero  [NO es módulo" in p


def test_una_cocina_con_isla_se_construye_sin_la_isla():
    f = evaluar(copy.deepcopy(COCINA))
    assert f["construible"] is True
    assert f["omitidos"] == ["isla"]


def test_si_falta_el_largo_de_un_muro_se_agrega_con_la_suma_de_lo_visto():
    f = evaluar(copy.deepcopy(VESTIDOR))
    b = next(m for m in f["medidas"] if m["clave"] == "largo_muro_B")
    assert b["estimado_mm"] == 250 + 1000 + 750


def test_solo_huecos_no_es_construible():
    f = copy.deepcopy(COCINA)
    f["muros"] = [{"id": "A", "descripcion": "", "elementos": [_elem("hueco", 1, 900)]}]
    assert evaluar(f)["construible"] is False


# ── instrucciones para el constructor ────────────────────────────────────

def test_los_anchos_salen_del_largo_CONFIRMADO_no_del_estimado():
    f = evaluar(copy.deepcopy(COCINA))
    f["medidas"][0]["valor_mm"] = 3600          # Julio midió el muro
    p = ficha_a_prompt(f)
    assert "largo 3600mm" in p
    # 0.2 · 0.2 · 0.3 · 0.3 de 3600
    assert "torre · ~720mm" in p
    assert "tarja · ~1080mm" in p
    assert "→ 3600 (confirmada)" in p


def test_fracciones_que_no_suman_uno_se_normalizan():
    f = evaluar(copy.deepcopy(COCINA))
    for e in f["muros"][0]["elementos"]:
        e["fraccion_ancho"] *= 0.9                # el modelo leyó 0.9 del muro
    anchos = lectura._anchos(f["muros"][0], 3000)
    assert sum(anchos) == 3000


def test_lo_omitido_y_lo_no_fabricable_llegan_al_constructor():
    f = evaluar(copy.deepcopy(COCINA))
    f["no_fabricable"] = [{"elemento": "repisa flotante", "por_que": "sin apoyo",
                           "propuesta": "ménsula oculta"}]
    f["indicaciones"] = "la torre va a la derecha"
    p = ficha_a_prompt(f)
    assert "NO CONSTRUIR" in p and "isla" in p
    assert "ménsula oculta" in p
    assert "la torre va a la derecha" in p
    assert "agregar_gabinete_base con tarja=True" in p


# ── la llamada al modelo ─────────────────────────────────────────────────

class _ClienteFalso:
    def __init__(self, ficha, stop="end_turn"):
        self.pedido = None
        texto = types.SimpleNamespace(type="text", text=json.dumps(ficha))
        self._r = types.SimpleNamespace(
            content=[texto], stop_reason=stop,
            usage=types.SimpleNamespace(input_tokens=10, output_tokens=20))
        self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(
            create=self._crear))

    def _crear(self, **kw):
        self.pedido = kw
        return self._r


def test_la_foto_y_el_esquema_viajan_al_modelo(tmp_path):
    local = tmp_path / "vestidor.png"
    local.write_bytes(b"\x89PNG falso")
    cli = _ClienteFalso(VESTIDOR)
    r = leer_foto(["https://x.supabase.co/forge/refs/a.webp", str(local)],
                  "para la señora Díaz", cliente=cli)

    bloques = cli.pedido["messages"][0]["content"]
    assert bloques[0]["source"] == {"type": "url",
                                    "url": "https://x.supabase.co/forge/refs/a.webp"}
    assert bloques[1]["source"]["type"] == "base64"
    assert bloques[1]["source"]["media_type"] == "image/png"
    assert "para la señora Díaz" in bloques[-1]["text"]
    assert cli.pedido["output_config"]["format"]["schema"] is FICHA_SCHEMA
    assert cli.pedido["model"] == "claude-opus-5-5"
    assert r["ficha"]["construible"] is True        # ya viene evaluada


def test_sin_fotos_no_hay_lectura():
    with pytest.raises(RuntimeError, match="al menos una foto"):
        leer_foto([], "algo", cliente=_ClienteFalso(VESTIDOR))


def test_un_rechazo_no_se_disfraza_de_ficha():
    with pytest.raises(RuntimeError, match="declinó"):
        leer_foto(["https://x/a.png"], cliente=_ClienteFalso({}, stop="refusal"))


# ── el worker enruta por tipo ────────────────────────────────────────────

@pytest.fixture
def cierres(monkeypatch):
    registro = []
    monkeypatch.setattr(worker, "cerrar_trabajo",
                        lambda job_id, **c: registro.append(c))
    return registro


def test_un_trabajo_de_lectura_guarda_la_ficha_y_no_construye(monkeypatch, cierres):
    monkeypatch.setattr(worker, "leer_foto", lambda imgs, txt: {
        "ficha": evaluar(copy.deepcopy(VESTIDOR)), "modelo": "m", "uso": {}})
    monkeypatch.setattr(worker, "procesar",
                        lambda *a, **k: pytest.fail("la lectura no debe construir"))
    worker.atender({"id": "j1", "tipo": "lectura", "prompt": "",
                    "imagenes": ["https://x/a.png"]})
    assert cierres[0]["status"] == "done"
    assert cierres[0]["ficha"]["nombre_proyecto"] == "Vestidor en L"
    assert "Revisa la ficha" in cierres[0]["log"]


def test_construir_sin_generador_falla_con_un_motivo_claro(monkeypatch, cierres):
    monkeypatch.setattr(worker, "procesar",
                        lambda *a, **k: pytest.fail("no hay generador"))
    f = copy.deepcopy(VESTIDOR)
    f["muros"] = [{"id": "A", "descripcion": "", "elementos": [_elem("isla", 1, 1800)]}]
    worker.atender({"id": "j2", "tipo": "diseno", "prompt": "Construir", "ficha": evaluar(f)})
    assert cierres[0]["status"] == "error"
    assert "isla" in cierres[0]["error"]


def test_construir_desde_ficha_usa_la_ficha_y_no_la_foto(monkeypatch, cierres):
    llamado = {}

    def procesar(prompt, base=None, imagenes=None, **k):
        llamado.update(prompt=prompt, imagenes=imagenes)
        return {"model_id": "m1", "resumen": "listo", "bitacora": [],
                "verificacion": {"problemas": []}}

    monkeypatch.setattr(worker, "procesar", procesar)
    worker.atender({"id": "j3", "tipo": "diseno", "prompt": "Construir: Cocina",
                    "imagenes": ["https://x/a.png"],
                    "ficha": evaluar(copy.deepcopy(COCINA))})
    assert cierres[0]["status"] == "done"
    assert "MURO A" in llamado["prompt"]
    # lo aprobado es la ficha; además Nemotron no ve imágenes
    assert llamado["imagenes"] == []


def test_un_trabajo_viejo_sin_tipo_sigue_siendo_de_diseno(monkeypatch, cierres):
    llamado = {}

    def procesar(prompt, base=None, imagenes=None, **k):
        llamado.update(prompt=prompt, imagenes=imagenes)
        return {"model_id": "m1", "resumen": "ok", "bitacora": [],
                "verificacion": {"problemas": []}}

    monkeypatch.setattr(worker, "procesar", procesar)
    worker.atender({"id": "j4", "prompt": "cocina de 3m",
                    "imagenes": ["https://x/a.png"]})
    assert llamado == {"prompt": "cocina de 3m", "imagenes": ["https://x/a.png"]}


# ── el constructor con Claude ya ve las fotos ────────────────────────────

def test_el_constructor_con_claude_recibe_las_imagenes(monkeypatch):
    import anthropic

    from forge_agent import agente
    visto = {}

    class _Runner:
        def until_done(self):
            return types.SimpleNamespace(
                stop_reason="end_turn",
                content=[types.SimpleNamespace(type="text", text="ok")],
                usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))

    class _Anthropic:
        def __init__(self, **kw):
            self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(
                tool_runner=lambda **kw: visto.update(kw) or _Runner()))

    monkeypatch.setattr(anthropic, "Anthropic", _Anthropic)
    agente._con_anthropic("una cocina", "claude-opus-5-5", "k",
                          ["https://x/ref.jpg"])
    contenido = visto["messages"][0]["content"]
    assert contenido[0]["source"]["url"] == "https://x/ref.jpg"
    assert contenido[-1] == {"type": "text", "text": "una cocina"}


def test_el_tipo_de_imagen_sale_del_contenido_no_de_la_extension(tmp_path):
    # un WEBP que Windows dejó como .jpg: mandarlo como JPEG lo hace rechazar
    f = tmp_path / "vestidor.webp.jpg"
    f.write_bytes(b"RIFF\x00\x00\x00\x00WEBPVP8 resto")
    assert lectura.bloque_imagen(str(f))["source"]["media_type"] == "image/webp"
