"""El backend OpenAI-compatible corre las MISMAS herramientas que el de Anthropic.

Se prueba con un cliente falso que imita la forma de respuesta de OpenAI: lo que
se verifica es el bucle (esquema → llamada → resultado → siguiente vuelta) y que
los errores vuelvan como texto, no como excepción. La llamada de red real a
NVIDIA no se puede probar aquí y no debe probarse con la llave del taller.
"""

from __future__ import annotations

import json
import types

import pytest

from forge_agent import herramientas, proveedores


# ── cliente falso con la forma de la respuesta de OpenAI ─────────────────

def _llamada(id_, nombre, args):
    return types.SimpleNamespace(
        id=id_, type="function",
        function=types.SimpleNamespace(name=nombre, arguments=json.dumps(args)))


def _turno(texto=None, llamadas=None):
    msg = types.SimpleNamespace(content=texto, tool_calls=llamadas or None)
    return types.SimpleNamespace(
        choices=[types.SimpleNamespace(message=msg)],
        usage=types.SimpleNamespace(prompt_tokens=100, completion_tokens=20))


class _ClienteFalso:
    """Reproduce un guion de turnos y guarda lo que se le mandó."""

    def __init__(self, guion):
        self.guion = list(guion)
        self.recibido = []
        self.chat = types.SimpleNamespace(completions=self)

    def create(self, **kw):
        # copia: el bucle sigue mutando la lista de mensajes después de la
        # llamada, y un cliente real la serializa en este momento
        self.recibido.append({**kw, "messages": [dict(m) for m in kw["messages"]]})
        return self.guion.pop(0)


@pytest.fixture
def fingir(monkeypatch):
    def _fingir(guion):
        cliente = _ClienteFalso(guion)
        modulo = types.ModuleType("openai")
        modulo.OpenAI = lambda **kw: cliente
        monkeypatch.setitem(__import__("sys").modules, "openai", modulo)
        return cliente
    return _fingir


# ── esquema ─────────────────────────────────────────────────────────────

def test_el_esquema_openai_sale_de_las_mismas_herramientas():
    """Una sola definición por herramienta: no hay dos esquemas que puedan
    desincronizarse cuando se agregue un parámetro."""
    esquema = proveedores.esquema_openai()
    assert len(esquema) == len(herramientas.HERRAMIENTAS)

    por_nombre = {f["function"]["name"]: f["function"] for f in esquema}
    for t in herramientas.HERRAMIENTAS:
        f = por_nombre[t.name]
        assert f["description"] == t.description
        assert f["parameters"] == t.input_schema      # el MISMO objeto, no una copia a mano

    caj = por_nombre["agregar_cajonera"]["parameters"]
    assert set(caj["required"]) == {"id", "ancho", "altos_frentes"}
    assert "800" in caj["properties"]["altos_frentes"]["description"]


# ── ejecución: los errores viajan como texto ────────────────────────────

@pytest.mark.parametrize("nombre,args,fragmento", [
    ("no_existe", "{}", "no existe la herramienta"),
    ("agregar_gabinete_base", "{esto no es json", "no son JSON válido"),
    ("agregar_gabinete_base", "[1,2]", "objeto JSON"),
    ("agregar_gabinete_base", '{"parametro_inventado": 1}', "parámetros incorrectos"),
])
def test_los_errores_vuelven_como_texto_no_como_excepcion(nombre, args, fragmento):
    """Una excepción mataría el trabajo entero por un parámetro mal escrito.
    El modelo tiene que poder leer el error y corregir."""
    herramientas.reiniciar()
    salida = proveedores.ejecutar(nombre, args)
    assert salida.startswith("ERROR:")
    assert fragmento in salida


def test_el_error_de_validacion_del_motor_llega_al_modelo():
    """La aritmética del taller es la que enseña: el mensaje trae el número."""
    herramientas.reiniciar()
    salida = proveedores.ejecutar(
        "agregar_cajonera", {"id": "C1", "ancho": 450, "altos_frentes": [200, 200]})
    assert salida.startswith("ERROR:") and "800" in salida


# ── bucle completo ──────────────────────────────────────────────────────

def test_el_bucle_openai_construye_un_proyecto_real(fingir):
    fingir([
        _turno(llamadas=[_llamada("c1", "definir_proyecto",
                                  {"cliente": "Prueba", "nombre": "cocina"})]),
        _turno(llamadas=[_llamada("c2", "agregar_gabinete_base",
                                  {"id": "B01", "ancho": 600}),
                         _llamada("c3", "agregar_gabinete_base",
                                  {"id": "B02", "ancho": 900})]),
        _turno(llamadas=[_llamada("c4", "agregar_tramo",
                                  {"id": "T1", "muro": "A",
                                   "modulos": ["B01", "B02"]})]),
        _turno(texto="Listo: dos muebles inferiores, 1500mm de frente."),
    ])
    herramientas.reiniciar()

    r = proveedores.correr_openai_compat(
        "sistema", "una cocinita", modelo="m", base_url="http://x/v1", api_key="k")

    assert r["vueltas"] == 4
    assert r["uso"] == {"input_tokens": 400, "output_tokens": 80}
    assert "1500mm" in r["resumen"]

    p = herramientas.finalizar()
    assert [m["id"] for m in p["modules"]] == ["B01", "B02"]
    assert p["tramos"][0]["panels"], "el tramo debe traer cubierta"
    # las medidas las derivó el motor, no el modelo
    lat = next(q for m in p["modules"] for q in m["panels"]
               if q["rol_estructural"] == "lateral_apoyado")
    assert lat["largo"] == 785


def test_el_modelo_corrige_despues_de_un_error(fingir):
    """El ciclo que hace viable un modelo más débil: falla, lee el ERROR, corrige."""
    fingir([
        _turno(llamadas=[_llamada("c1", "definir_proyecto",
                                  {"cliente": "P", "nombre": "n"})]),
        _turno(llamadas=[_llamada("c2", "agregar_cajonera",
                                  {"id": "C1", "ancho": 450,
                                   "altos_frentes": [200, 200]})]),   # suman 400
        _turno(llamadas=[_llamada("c3", "agregar_cajonera",
                                  {"id": "C1", "ancho": 450,
                                   "altos_frentes": [266, 266, 268]})]),
        _turno(texto="Cajonera de 3 cajones."),
    ])
    herramientas.reiniciar()
    proveedores.correr_openai_compat(
        "s", "una cajonera", modelo="m", base_url="http://x/v1", api_key="k")

    p = herramientas.finalizar()
    assert len(p["modules"]) == 1
    assert len([q for q in p["modules"][0]["panels"]
                if q["rol_estructural"] == "frente"]) == 3


def test_el_historial_conserva_los_tool_calls(fingir):
    """Sin el turno del asistente y su tool_call_id, el servidor rechaza el
    resultado y el bucle se rompe en la segunda vuelta."""
    cliente = fingir([
        _turno(llamadas=[_llamada("c1", "estado_actual", {})]),
        _turno(texto="ok"),
    ])
    herramientas.reiniciar()
    proveedores.correr_openai_compat(
        "s", "p", modelo="m", base_url="http://x/v1", api_key="k")

    mensajes = cliente.recibido[-1]["messages"]
    roles = [m["role"] for m in mensajes]
    assert roles == ["system", "user", "assistant", "tool"]
    assert mensajes[2]["tool_calls"][0]["id"] == "c1"
    assert mensajes[3]["tool_call_id"] == "c1"
    assert cliente.recibido[0]["tools"] == proveedores.esquema_openai()


def test_el_bucle_corta_si_el_modelo_se_cicla(fingir):
    fingir([_turno(llamadas=[_llamada(f"c{i}", "estado_actual", {})])
            for i in range(proveedores.MAX_VUELTAS)])
    herramientas.reiniciar()
    with pytest.raises(RuntimeError, match="ciclando"):
        proveedores.correr_openai_compat(
            "s", "p", modelo="m", base_url="http://x/v1", api_key="k")


# ── configuración: las llaves salen del entorno ─────────────────────────

def test_nvidia_exige_llave_y_modelo_del_entorno(monkeypatch):
    for v in ("FORGE_PROVEEDOR", "FORGE_MODEL", "FORGE_BASE_URL",
              "NVIDIA_API_KEY", "FORGE_API_KEY"):
        monkeypatch.delenv(v, raising=False)

    with pytest.raises(RuntimeError, match="NVIDIA_API_KEY"):
        proveedores.configurar("nvidia")

    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-xxx")
    with pytest.raises(RuntimeError, match="function calling"):
        proveedores.configurar("nvidia")       # sin FORGE_MODEL

    monkeypatch.setenv("FORGE_MODEL", "nvidia/algun-nemotron")
    cfg = proveedores.configurar("nvidia")
    assert cfg["base_url"] == proveedores.BASE_URL_NVIDIA
    assert cfg["api_key"] == "nvapi-xxx"


def test_endpoint_propio_exige_base_url(monkeypatch):
    monkeypatch.delenv("FORGE_BASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="FORGE_BASE_URL"):
        proveedores.configurar("openai_compat")

    monkeypatch.setenv("FORGE_BASE_URL", "http://localhost:8000/v1")
    assert proveedores.configurar("openai_compat")["base_url"] \
        == "http://localhost:8000/v1"


def test_anthropic_sigue_siendo_el_default(monkeypatch):
    monkeypatch.delenv("FORGE_PROVEEDOR", raising=False)
    monkeypatch.delenv("FORGE_MODEL", raising=False)
    cfg = proveedores.configurar()
    assert cfg["proveedor"] == "anthropic"
    assert cfg["modelo"] == "claude-opus-5"


def test_proveedor_desconocido_falla_claro():
    with pytest.raises(RuntimeError, match="desconocido"):
        proveedores.configurar("openai")
