"""La colocación 3D se DERIVA de las reglas estructurales — estos tests
verifican que la geometría colocada respeta la aritmética del taller."""

import pytest

from mono_forge.constants import (
    T, ALTO_ZOCLO, ALTO_TOTAL_BASE, ALTO_LATERAL_BASE, ZOCLO_RETRANQUEO,
    GAP_FRENTES,
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


def _volumen_traslape(a, b):
    """Volumen de la intersección de dos cajas (0 si sólo se tocan)."""
    def solape(c1, c2, eje, tam):
        lo = max(c1[eje] - c1[tam] / 2, c2[eje] - c2[tam] / 2)
        hi = min(c1[eje] + c1[tam] / 2, c2[eje] + c2[tam] / 2)
        return max(0.0, hi - lo)
    return (solape(a, b, "x", "sx") * solape(a, b, "y", "sy")
            * solape(a, b, "z", "sz"))


def test_las_piezas_del_cajon_no_se_atraviesan():
    """Dos piezas de tablero no pueden ocupar el mismo espacio.

    El fondo de la caja corría a TODO el ancho mientras los laterales ocupan
    los 15mm de cada extremo: se atravesaban, y la pieza salía 30mm más ancha
    de lo que realmente cabe.
    """
    p = Project(cliente="TEST", nombre="traslape")
    p.modules.append(cajon("C01", ancho_interior=570, alto_frente=266,
                           prof_modulo=600, ancho_modulo=600))
    colocar(p)

    cajas = [(panel.name, c)
             for panel in p.modules[0].panels for c in panel.colocacion]
    for i, (n1, c1) in enumerate(cajas):
        for n2, c2 in cajas[i + 1:]:
            v = _volumen_traslape(c1, c2)
            assert v < 1.0, f"{n1} y {n2} se atraviesan ({v:.0f} mm³)"


def test_el_fondo_del_cajon_va_atrapado_entre_los_cuatro_lados():
    """Tablero de 15mm (un MDF de 3mm se pandea), inset en X y en Y.

    No descansa debajo de los laterales ni sobresale: queda atrapado entre
    los cuatro lados de la caja.
    """
    from mono_forge.constants import T_FONDO_CAJON

    m = cajon("C01", ancho_interior=570, alto_frente=266, prof_modulo=600,
              ancho_modulo=600)
    fondo = next(q for q in m.panels if q.name.endswith("_fondo_caja"))
    lateral = next(q for q in m.panels if q.rol_estructural == "lateral_caja")
    frente_caja = next(q for q in m.panels if q.name.endswith("_frente_caja"))

    assert T_FONDO_CAJON == 15
    assert fondo.espesor == T_FONDO_CAJON
    assert fondo.material == lateral.material        # tablero, no MDF de fondo
    assert fondo.largo == frente_caja.largo          # inset en X: entre laterales
    assert fondo.ancho == lateral.largo - 2 * T      # inset en Y: entre frente y trasera
    assert lateral.ancho == frente_caja.ancho        # caja de altura pareja

    p = Project(cliente="TEST", nombre="fondo")
    p.modules.append(m)
    colocar(p)
    cf, cl = fondo.colocacion[0], lateral.colocacion[0]
    assert cf["z"] - cf["sz"] / 2 == pytest.approx(cl["z"] - cl["sz"] / 2), \
        "el fondo se asienta a ras del canto inferior de la caja"


def test_la_cajonera_es_un_mueble_completo_no_cajones_flotando():
    """Sin casco no hay dónde atornillar la corredera: el cajón no es fabricable.

    Una cajonera debe traer las MISMAS piezas de casco que un mueble de puerta.
    """
    from mono_forge.generators.cajonera import cajonera

    m = cajonera("B01", ancho=450, altos_frentes=[266, 266, 268])
    roles = {q.rol_estructural for q in m.panels}
    base = {q.rol_estructural for q in gabinete_base("X", ancho=450).panels}
    casco = base - {"frente", "entrepano_movil", "entrepano_fijo"}
    assert casco <= roles, f"a la cajonera le falta casco: {casco - roles}"

    assert m.alto == ALTO_TOTAL_BASE                       # es un mueble inferior
    lat = next(q for q in m.panels if q.rol_estructural == "lateral_apoyado")
    assert lat.largo == ALTO_LATERAL_BASE                  # 785 derivado, igual que siempre
    assert len([q for q in m.panels if q.rol_estructural == "frente"]) == 3


def test_la_cajonera_completa_no_tiene_piezas_que_se_atraviesen():
    from mono_forge.generators.cajonera import cajonera

    p = Project(cliente="TEST", nombre="cajonera")
    p.modules.append(cajonera("B01", ancho=450, altos_frentes=[266, 266, 268]))
    colocar(p)

    cajas = [(q.name, c) for q in p.modules[0].panels for c in q.colocacion]
    for i, (n1, c1) in enumerate(cajas):
        for n2, c2 in cajas[i + 1:]:
            v = _volumen_traslape(c1, c2)
            assert v < 1.0, f"{n1} y {n2} se atraviesan ({v:.0f} mm³)"


def test_los_cajones_van_dentro_del_casco():
    """Las cajas no pueden salirse del mueble ni chocar entre ellas."""
    from mono_forge.generators.cajonera import cajonera

    p = Project(cliente="TEST", nombre="cajonera")
    m = cajonera("B01", ancho=450, altos_frentes=[266, 266, 268])
    p.modules.append(m)
    colocar(p)

    for q in m.panels:
        if q.rol_estructural not in ("lateral_caja", "capturado", "fondo_caja"):
            continue
        for c in q.colocacion:
            assert c["x"] - c["sx"] / 2 >= T - 0.01, f"{q.name} se sale por la izquierda"
            assert c["x"] + c["sx"] / 2 <= m.ancho - T + 0.01, f"{q.name} se sale por la derecha"
            assert c["z"] - c["sz"] / 2 >= ALTO_ZOCLO, f"{q.name} baja del zoclo"
            assert c["z"] + c["sz"] / 2 <= ALTO_TOTAL_BASE, f"{q.name} rebasa los 900"


def test_la_cajonera_valida_la_aritmetica_vertical():
    from mono_forge.generators.cajonera import cajonera
    import pytest as _pt

    with _pt.raises(ValueError, match="800"):
        cajonera("B01", ancho=450, altos_frentes=[200, 200])      # suman 400
    with _pt.raises(ValueError, match="divisor"):
        cajonera("B01", ancho=1200, altos_frentes=[400, 400])
