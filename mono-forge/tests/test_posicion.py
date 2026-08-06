"""La colocación 3D se DERIVA de las reglas estructurales — estos tests
verifican que la geometría colocada respeta la aritmética del taller."""

from mono_forge.constants import (
    T, ALTO_ZOCLO, ALTO_TOTAL_BASE, ALTO_LATERAL_BASE, ZOCLO_RETRANQUEO,
)
from mono_forge.generators.base import gabinete_base
from mono_forge.generators.cajonera import cajon
from mono_forge.generators.cubierta import cubierta
from mono_forge.generators.superior import alacena
from mono_forge.models import Project, Tramo
from mono_forge.rules.posicion import colocar, ALTO_COLGADO_DEFAULT


def _proyecto():
    p = Project(cliente="TEST", nombre="posicion")
    p.modules.append(gabinete_base("B01", ancho=600))
    p.modules.append(gabinete_base("B02", ancho=600, tarja=True, entrepanos=0))
    p.modules.append(alacena("A01", ancho=600))
    p.modules.append(cajon("C01", ancho_interior=570, alto_frente=200, prof_modulo=600))
    t = Tramo(id="T1", muro="A", modulos=["B01", "B02"])
    panels, _ = cubierta("T1", 1200)
    t.panels += panels
    p.tramos.append(t)
    return p


def test_todo_colocado_sin_reglas_faltantes():
    p = _proyecto()
    r = colocar(p)
    assert r["sin_regla"] == []
    for panel in p.all_panels():
        assert len(panel.colocacion) == panel.cantidad, panel.name


def test_lateral_descansa_sobre_la_base():
    """100 (zoclo) + 15 (base) + 785 (lateral) = 900 — en la geometría real."""
    p = _proyecto()
    colocar(p)
    b01 = p.modules[0]
    lat = next(q for q in b01.panels if q.rol_estructural == "lateral_apoyado")
    c = lat.colocacion[0]
    base_inferior_lateral = c["z"] - c["sz"] / 2
    assert base_inferior_lateral == ALTO_ZOCLO + T          # apoya SOBRE la base
    assert c["z"] + c["sz"] / 2 == ALTO_TOTAL_BASE          # remata en 900
    assert c["sz"] == ALTO_LATERAL_BASE                     # 785 derivado


def test_base_corre_todo_el_ancho_y_zoclo_retranqueado():
    p = _proyecto()
    colocar(p)
    b01 = p.modules[0]
    base = next(q for q in b01.panels if q.rol_estructural == "base_portante")
    assert base.colocacion[0]["sx"] == b01.ancho             # TODO el ancho exterior
    zoclo = next(q for q in b01.panels if q.rol_estructural == "zoclo")
    frente_zoclo = zoclo.colocacion[0]["y"] - zoclo.colocacion[0]["sy"] / 2
    assert frente_zoclo == ZOCLO_RETRANQUEO


def test_colgado_captura_horizontales_entre_laterales():
    p = _proyecto()
    colocar(p)
    a01 = next(m for m in p.modules if m.id == "A01")
    techo = next(q for q in a01.panels if q.name.endswith("_techo"))
    lat = next(q for q in a01.panels if q.rol_estructural == "lateral_portante")
    # el techo mide ancho − 2T y queda ENTRE los laterales, no encima
    assert techo.colocacion[0]["sx"] == a01.ancho - 2 * T
    assert lat.colocacion[0]["sz"] == a01.alto               # lateral COMPLETO
    # módulo colgado: elevado a la altura de colgado
    assert techo.colocacion[0]["z"] > ALTO_COLGADO_DEFAULT


def test_cubierta_sobre_el_tramo():
    p = _proyecto()
    colocar(p)
    cub = p.tramos[0].panels[0]
    c = cub.colocacion[0]
    assert c["z"] - c["sz"] / 2 == ALTO_TOTAL_BASE           # apoya sobre los 900
    assert c["y"] - c["sy"] / 2 < 0                          # vuelo frontal


def test_roundtrip_json_conserva_colocacion(tmp_path):
    p = _proyecto()
    colocar(p)
    ruta = str(tmp_path / "project.json")
    p.to_json(ruta)
    p2 = Project.from_json(ruta)
    assert [q.colocacion for q in p2.all_panels()] == \
           [q.colocacion for q in p.all_panels()]
