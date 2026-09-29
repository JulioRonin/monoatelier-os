"""Closet / vestidor: la aritmética que el taller verifica con cinta.

Estándares confirmados por Julio: estructura de torre (zoclo 100 + base 15 +
lateral de una pieza), módulo = plafón − 40, fondo 600, tubos a 1700 (sencillo)
o 1000 y 2000 (doble), entrepaños móviles salvo los que cargan o llevan LED,
cajones de 200 con corredera de 500, relleno recto de 50 en la esquina.
"""

import pytest

from mono_forge.constants import (ALTO_CLOSET_MAX, ALTO_ZOCLO, T,
                                  TUBO_BAJO_ENTREPANO)
from mono_forge.cutlist import resumen
from mono_forge.generators.closet import alto_desde_plafon, closet
from mono_forge.models import Project, Tramo
from mono_forge.rules.posicion import colocar


def _pieza(m, sufijo):
    return next(p for p in m.panels if p.name == f"{m.id}_{sufijo}")


def _colocado(*mods):
    p = Project(cliente="x", nombre="x", modules=list(mods),
                tramos=[Tramo(id="T", muro="A", modulos=[m.id for m in mods],
                              lleva_cubierta=False)])
    r = colocar(p)
    assert r["sin_regla"] == []
    return p


# ── altura ───────────────────────────────────────────────────────────────

def test_el_modulo_mide_40_menos_que_el_plafon():
    assert alto_desde_plafon(2400) == (2360, 40)


def test_arriba_de_lo_que_da_una_hoja_crece_el_copete():
    # el fondo aplicado (alto − 100) tiene que salir de una hoja de 2440 − kerf
    assert ALTO_CLOSET_MAX == 2536
    assert alto_desde_plafon(2700) == (2536, 164)


def test_suma_vertical_y_nesting_al_maximo():
    m = closet("V", 900, "entrepanos", plafon=3000)
    lat = _pieza(m, "lateral")
    assert ALTO_ZOCLO + T + lat.largo == m.alto == 2536
    resumen(Project(cliente="x", nombre="x", modules=[m]))   # no truena: cabe en la hoja


def test_mas_ancho_que_la_hoja_se_rechaza():
    with pytest.raises(ValueError, match="Divídelo en dos"):
        closet("V", 1300, "entrepanos")


# ── colgados ─────────────────────────────────────────────────────────────

def test_colgado_doble_estandar():
    m = closet("V", 900, "colgado_doble", plafon=2400)
    cfg = m.flags["closet"]
    assert sorted(z for zs in cfg["tubos"].values() for z in zs) == [1000, 2000]
    # el entrepaño que carga cada tubo está 60mm arriba de él, y es FIJO
    assert cfg["niveles"]["V_ent_fijo"] == [1000 + TUBO_BAJO_ENTREPANO,
                                            2000 + TUBO_BAJO_ENTREPANO]
    assert "V_ent_movil" not in cfg["niveles"]


def test_un_maletero_que_no_cabe_se_dice():
    with pytest.raises(ValueError, match="maletero"):
        closet("V", 900, "colgado_doble", plafon=2200)


def test_tubos_a_pedido_del_cliente():
    m = closet("V", 900, "colgado_doble", plafon=2400, tubos=[950, 1900])
    assert sorted(z for zs in m.flags["closet"]["tubos"].values() for z in zs) == [950, 1900]


def test_colgado_sencillo_con_zapatera_abajo():
    m = closet("V", 600, "colgado_sencillo", plafon=2400, repisas_zapatos=2, entrepanos=1)
    cfg = m.flags["closet"]["niveles"]
    # dos niveles de 200 libres sobre la base (cara superior en 115)
    assert cfg["V_rep_zapato"] == [315, 530]
    assert cfg["V_ent_fijo"] == [1760]
    assert len(cfg["V_ent_movil"]) == 1          # el del maletero, móvil


def test_un_colgado_sin_espacio_para_colgar_se_rechaza():
    with pytest.raises(ValueError, match="libres"):
        closet("V", 600, "colgado_sencillo", repisas_zapatos=6)


# ── cajonera y vitrina ───────────────────────────────────────────────────

def test_cajonera_de_closet():
    m = closet("V", 900, "cajonera", plafon=2400, vitrina=True, entrepanos=3)
    cajones = m.flags["cajones"]
    assert [c["alto_frente"] for c in cajones] == [200, 200, 200]
    # el entrepaño fijo sobre los cajones queda al ras del último frente
    tapa = m.flags["closet"]["niveles"]["V_ent_fijo"][0]
    assert tapa + T == ALTO_ZOCLO + 600
    assert any(h.sku == "COR-LAT-500" for h in m.hardware)
    assert any(h.sku == "VID-TEMP-6" for h in m.hardware)
    vidrio = _pieza(m, "c3_vidrio")
    assert vidrio.accesorio          # se ve en 3D pero no se corta


def test_cajonera_de_mas_de_900_se_rechaza():
    with pytest.raises(ValueError, match="divisor"):
        closet("V", 1000, "cajonera")


# ── LED, divisor y herrajes ──────────────────────────────────────────────

def test_con_led_todos_los_entrepanos_son_fijos():
    m = closet("V", 600, "entrepanos", entrepanos=4, led=True)
    assert "V_ent_movil" not in m.flags["closet"]["niveles"]
    assert len(m.flags["closet"]["niveles"]["V_ent_fijo"]) == 4
    assert m.flags["led_ml"] == round(4 * (600 - 2 * T - 40) / 1000, 2)


def test_mas_de_900_lleva_divisor_y_todo_va_por_vano():
    m = closet("V", 1000, "colgado_doble")
    assert any(p.rol_estructural == "divisor" for p in m.panels)
    assert _pieza(m, "ent_fijo").cantidad == 4          # 2 niveles × 2 vanos
    assert _pieza(m, "tubo1").cantidad == 2
    tubo = next(h for h in m.hardware if h.sku == "TUB-OVAL-CR")
    assert tubo.cantidad == round(4 * (1000 - 3 * T) / 2 / 1000, 2)


def test_los_moviles_llevan_soportes_y_los_tubos_no_se_cortan():
    m = closet("V", 600, "entrepanos", entrepanos=5)
    sop = next(h for h in m.hardware if h.sku == "SOP-ENT-5")
    assert sop.cantidad == 20
    m2 = closet("W", 600, "colgado_sencillo")
    p = Project(cliente="x", nombre="x", modules=[m2])
    assert not [x for x in p.piezas_de_corte() if "tubo" in x.name]


# ── 3D: nada se sale del mueble ni choca ─────────────────────────────────

@pytest.mark.parametrize("tipo,kw", [
    ("colgado_doble", {}),
    ("colgado_sencillo", {"repisas_zapatos": 2, "entrepanos": 2}),
    ("entrepanos", {"entrepanos": 6}),
    ("cajonera", {"vitrina": True}),
    ("zapatera", {}),
])
def test_todo_cae_dentro_del_mueble(tipo, kw):
    m = closet("V", 900 if tipo == "cajonera" else 1000, tipo, **kw)
    _colocado(m)
    for p in m.panels:
        assert len(p.colocacion) == p.cantidad, p.name
        if p.rol_estructural in ("fondo", "frente", "accesorio_jaladera"):
            continue                     # el fondo va detrás y los frentes delante
        for c in p.colocacion:
            assert c["x"] - c["sx"] / 2 >= -0.01 and c["x"] + c["sx"] / 2 <= m.ancho + 0.01, p.name
            assert c["z"] - c["sz"] / 2 >= -0.01 and c["z"] + c["sz"] / 2 <= m.alto + 0.01, p.name
            assert c["y"] - c["sy"] / 2 >= -0.01 and c["y"] + c["sy"] / 2 <= m.prof + 0.01, p.name


def test_los_entrepanos_no_se_enciman_ni_tocan_los_tubos():
    m = closet("V", 900, "colgado_sencillo", repisas_zapatos=2, entrepanos=2)
    _colocado(m)
    horizontales = sorted(
        (c["z"] - c["sz"] / 2, c["z"] + c["sz"] / 2)
        for p in m.panels if p.rol_estructural.startswith("entrepano")
        for c in p.colocacion)
    for (_, arriba), (abajo, _) in zip(horizontales, horizontales[1:]):
        assert abajo >= arriba, horizontales
    tubo = _pieza(m, "tubo1").colocacion[0]
    sobre = min(a for a, _ in horizontales if a > tubo["z"])
    assert tubo["z"] + tubo["sz"] / 2 < sobre
