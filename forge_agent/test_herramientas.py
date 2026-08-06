"""Las herramientas del agente son la superficie que toca el modelo.

Si una devuelve algo inconsistente con el motor, el diseño sale mal sin que
nadie lo note. Estos tests ejercitan la secuencia completa que haría el modelo,
sin llamar a la API.
"""

import json

import pytest

from mono_forge.constants import ALTO_TOTAL_BASE, T
from mono_forge.docs import verificar
from mono_forge.models import Project

from . import herramientas as h


def _llamar(tool, **kw):
    """Invoca una herramienta como lo haría el tool runner."""
    fn = getattr(tool, "_func", None) or getattr(tool, "func", None) or tool
    return fn(**kw)


@pytest.fixture(autouse=True)
def limpio():
    h.reiniciar()


def _cocina_demo():
    _llamar(h.definir_proyecto, cliente="Pérez", nombre="Cocina en L",
            material="MEL-BLA-15-IMP", apertura="gola_aluminio",
            gola_sku="GOL-ALU-C-45")
    _llamar(h.agregar_gabinete_base, id="B01", ancho=600)
    _llamar(h.agregar_gabinete_base, id="B02", ancho=900, puertas=2, tarja=True,
            entrepanos=0)
    _llamar(h.agregar_gabinete_base, id="B03", ancho=600, led=True)
    _llamar(h.agregar_alacena, id="A01", ancho=900, puertas=2, led=True)
    _llamar(h.agregar_tramo, id="T1", muro="A", modulos=["B01", "B02", "B03"],
            recortes=["tarja"])
    return h.ESTADO.project


def test_secuencia_completa_produce_proyecto_valido():
    _cocina_demo()
    data = h.finalizar()
    p = Project.from_dict(data)
    assert len(p.modules) == 4
    assert len(p.tramos) == 1
    # todos los paneles colocados en 3D
    for panel in p.all_panels():
        assert len(panel.colocacion) == panel.cantidad, panel.name
    # y el JSON viaja entero
    assert json.loads(json.dumps(data))["nombre"] == "Cocina en L"


def test_las_medidas_las_deriva_el_motor_no_el_modelo():
    """El agente sólo pasa el ancho: el alto de 785 sale de la regla."""
    _llamar(h.definir_proyecto, cliente="X", nombre="Y")
    _llamar(h.agregar_gabinete_base, id="B01", ancho=600)
    m = h.ESTADO.modulo("B01")
    lat = next(q for q in m.panels if q.rol_estructural == "lateral_apoyado")
    assert lat.largo == ALTO_TOTAL_BASE - 100 - T   # 785 derivado
    assert m.alto == ALTO_TOTAL_BASE


def test_la_gola_ajusta_el_alto_del_frente_desde_el_catalogo():
    """El hueco de la gola sale de catalog/golas.csv, nunca hardcodeado."""
    _llamar(h.definir_proyecto, cliente="X", nombre="Y",
            apertura="gola_aluminio", gola_sku="GOL-ALU-C-45")
    _llamar(h.agregar_gabinete_base, id="B01", ancho=600)
    con_gola = next(q for q in h.ESTADO.modulo("B01").panels
                    if q.rol_estructural == "frente")

    h.reiniciar()
    _llamar(h.definir_proyecto, cliente="X", nombre="Y")   # jaladera
    _llamar(h.agregar_gabinete_base, id="B01", ancho=600)
    sin_gola = next(q for q in h.ESTADO.modulo("B01").panels
                    if q.rol_estructural == "frente")

    assert con_gola.largo == sin_gola.largo - 45     # alto_hueco del SKU


def test_tramo_calcula_cubierta_y_gola_por_tramo():
    p = _cocina_demo()
    t = p.tramos[0]
    cub = next(q for q in t.panels if q.rol_estructural == "cubierta")
    assert cub.largo * cub.cantidad == 600 + 900 + 600      # el frente del tramo
    # la gola se cortó en tramos comerciales y dejó su herraje
    assert any(hw.sku.startswith("GOL-") for hw in t.hardware)
    assert any("gola" in n.lower() for n in t.notas)


def test_led_se_calcula_y_deja_nota_de_ruteo():
    _cocina_demo()
    salida = _llamar(h.calcular_led, temperatura_k=3000, control="dimmer")
    assert "LED" in salida
    p = h.ESTADO.project
    assert any(hw.sku.startswith("LED-") for hw in p.all_hardware())
    assert any("ruteo" in n.lower() or "perforac" in n.lower() for n in p.notas)


def test_errores_se_devuelven_al_modelo_en_vez_de_reventar():
    """El modelo debe poder corregirse: los errores son texto, no excepciones."""
    _llamar(h.definir_proyecto, cliente="X", nombre="Y")
    _llamar(h.agregar_gabinete_base, id="B01", ancho=600)
    assert "ERROR" in _llamar(h.agregar_gabinete_base, id="B01", ancho=600)
    assert "ERROR" in _llamar(h.agregar_alacena, id="A9", ancho=600, prof=800)
    assert "ERROR" in _llamar(h.agregar_torre, id="T9", alto_total=2500)
    assert "ERROR" in _llamar(h.agregar_tramo, id="TX", muro="A", modulos=["NOPE"])


def test_iterar_sobre_un_diseno_existente():
    _cocina_demo()
    data = h.finalizar()

    h.reiniciar(data)                      # así arranca una iteración
    assert len(h.ESTADO.project.modules) == 4
    _llamar(h.eliminar_modulo, id="A01")
    _llamar(h.agregar_alacena, id="A02", ancho=600, alto=800)
    p2 = Project.from_dict(h.finalizar())
    assert [m.id for m in p2.modules] == ["B01", "B02", "B03", "A02"]


def test_el_paquete_de_entregables_sale_del_proyecto_del_agente(tmp_path):
    _cocina_demo()
    p = Project.from_dict(h.finalizar())
    from mono_forge.docs import generar_todo
    destino = str(tmp_path / "deliverables")
    generar_todo(p, destino)
    v = verificar(p, destino)
    assert v["problemas"] == []
    assert set(v["faltantes"]) <= {"modelo.blend", "preview.glb"}


def test_ver_catalogo_no_inventa_skus():
    salida = _llamar(h.ver_catalogo)
    assert "MEL-BLA-15-IMP" in salida
    assert "GOL-ALU-C-45" in salida
    assert "SIN PRECIO" in salida        # los huecos del catálogo se declaran


def test_la_cajonera_es_un_mueble_con_casco():
    """Un cajón sin casco no tiene dónde atornillar la corredera."""
    _llamar(h.definir_proyecto, cliente="X", nombre="Y")
    _llamar(h.agregar_gabinete_base, id="G01", ancho=600)
    salida = _llamar(h.agregar_cajonera, id="B01", ancho=450,
                     altos_frentes=[266, 266, 268])
    assert "ERROR" not in salida

    m = h.ESTADO.modulo("B01")
    roles = {q.rol_estructural for q in m.panels}
    assert {"base_portante", "lateral_apoyado", "refuerzo", "zoclo"} <= roles
    assert len([q for q in m.panels if q.rol_estructural == "frente"]) == 3

    # y entra al tramo como UN módulo, no como tres
    _llamar(h.agregar_tramo, id="T1", muro="A", modulos=["G01", "B01"])
    assert h.ESTADO.project.tramos[0].modulos == ["G01", "B01"]


def test_la_cajonera_rechaza_una_aritmetica_vertical_imposible():
    _llamar(h.definir_proyecto, cliente="X", nombre="Y")
    assert "ERROR" in _llamar(h.agregar_cajonera, id="B01", ancho=450,
                              altos_frentes=[200, 200])          # suman 400, no 800
    assert "ERROR" in _llamar(h.agregar_cajonera, id="B02", ancho=1200,
                              altos_frentes=[400, 400])          # exigiría divisor


def test_la_tarja_no_entra_al_cutlist():
    """Se compra, no se fabrica: se ve en el 3D pero no se corta."""
    from mono_forge.cutlist import resumen

    _llamar(h.definir_proyecto, cliente="X", nombre="Y")
    _llamar(h.agregar_gabinete_base, id="B01", ancho=900, puertas=2, tarja=True,
            entrepanos=0)
    area_antes = resumen(h.ESTADO.project)["area_paneles_m2"]

    salida = _llamar(h.agregar_tarja, modulo_id="B01")
    assert "ERROR" not in salida
    tz = next(q for q in h.ESTADO.modulo("B01").panels
              if q.rol_estructural == "accesorio_tarja")
    assert tz.accesorio is True
    assert resumen(h.ESTADO.project)["area_paneles_m2"] == area_antes

    # pero sí se coloca en 3D, colgando del nivel de cubierta
    h.finalizar()
    assert len(tz.colocacion) == 1
    assert tz.colocacion[0]["z"] < ALTO_TOTAL_BASE

    assert "ERROR" in _llamar(h.agregar_tarja, modulo_id="B01")     # duplicada
    assert "ERROR" in _llamar(h.agregar_tarja, modulo_id="NOPE")
