"""El encuadre y las luces se DERIVAN del proyecto, no se hardcodean.

Estos tests corren sin Blender: verifican la matemática que decide dónde va la
cámara y qué se ilumina. Si el encuadre falla en producción, falla aquí primero.
"""

import json
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "blender"))
import render_presets as presets  # noqa: E402

from mono_forge.generators.base import gabinete_base  # noqa: E402
from mono_forge.generators.superior import alacena  # noqa: E402
from mono_forge.models import Project  # noqa: E402
from mono_forge.rules.posicion import colocar  # noqa: E402


def _proyecto(ancho=600, con_led=False):
    p = Project(cliente="TEST", nombre="render")
    p.modules.append(gabinete_base("B01", ancho=ancho))
    p.modules.append(alacena("A01", ancho=ancho, led=con_led))
    colocar(p)
    return json.loads(json.dumps(p.to_dict()))


def test_bbox_sale_del_json_en_metros():
    data = _proyecto(ancho=600)
    b = presets.bbox_de(data)
    assert b["ancho"] == pytest.approx(0.6, abs=0.01)     # 600mm → 0.6m
    assert b["min_z"] == pytest.approx(0.0, abs=0.01)     # apoyado en el piso
    # la alacena cuelga a 1500: el alto total llega arriba de 2.2m
    assert b["max_z"] > 2.2


def test_bbox_falla_claro_si_el_json_no_trae_colocacion():
    with pytest.raises(ValueError, match="colocación"):
        presets.bbox_de({"modules": [{"id": "X", "panels": [{"name": "p"}]}]})


def test_la_camara_se_aleja_cuando_el_mueble_crece():
    """El mismo preset debe encuadrar un mueble de 600 y una cocina de 3.6m."""
    chico = presets.camara_para("frontal_34", presets.bbox_de(_proyecto(600)))
    grande = presets.camara_para("frontal_34", presets.bbox_de(_proyecto(3600)))

    def dist(c):
        return math.dist(c["loc"], c["objetivo"])

    assert dist(grande) > dist(chico) * 1.5


def test_la_camara_queda_frente_al_mueble():
    """El frente mira a −Y (rules/posicion.py): la cámara va del lado negativo."""
    b = presets.bbox_de(_proyecto(900))
    for vista in presets.VISTAS:
        c = presets.camara_para(vista, b)
        assert c["loc"][1] < b["min_y"], f"{vista} quedó detrás del mueble"


def test_el_encuadre_cubre_el_mueble_completo():
    """Con el lente y la distancia calculados, el mueble entra en cuadro."""
    b = presets.bbox_de(_proyecto(2400))
    for vista in ("frontal", "frontal_34", "lateral"):
        c = presets.camara_para(vista, b)
        d = math.dist(c["loc"], c["objetivo"])
        fov = 2 * math.atan(36.0 / (2 * c["lente"]))
        cubre = 2 * d * math.tan(fov / 2)
        assert cubre >= max(b["ancho"], b["alto"]), f"{vista} recorta el mueble"


def test_detalle_se_acerca_mas_que_el_general():
    b = presets.bbox_de(_proyecto(2400))
    d_gen = math.dist(*[presets.camara_para("frontal_34", b)[k]
                        for k in ("loc", "objetivo")])
    d_det = math.dist(*[presets.camara_para("detalle", b)[k]
                        for k in ("loc", "objetivo")])
    assert d_det < d_gen


def test_el_led_del_render_sale_de_los_modulos_con_led():
    """La luz de mueble se deriva del mismo dato que la lista de herrajes."""
    assert presets.zonas_led(_proyecto(600, con_led=False)) == []
    zonas = presets.zonas_led(_proyecto(600, con_led=True))
    assert len(zonas) == 1 and zonas[0]["id"] == "A01"
    # la tira va bajo la alacena, no dentro de ella
    b = presets.bbox_de(_proyecto(600, con_led=True))
    assert zonas[0]["centro"][2] < b["max_z"]


def test_kelvin_calido_es_mas_rojo_que_frio():
    calido = presets.kelvin_a_rgb(2700)
    frio = presets.kelvin_a_rgb(6500)
    assert calido[0] >= frio[0] and calido[2] < frio[2]
    for v in calido + frio:
        assert 0.0 <= v <= 1.0


def test_las_vistas_de_entrega_existen_y_son_tres():
    assert len(presets.VISTAS_ENTREGA) >= 3
    assert all(v in presets.VISTAS for v in presets.VISTAS_ENTREGA)
    assert all(e in presets.ESCENAS for e in ("cocina", "estudio", "noche"))
