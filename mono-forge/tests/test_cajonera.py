from mono_forge.constants import T, HOLGURA_LATERAL, HOLGURA_BAJOCAJON
from mono_forge.generators.cajonera import cajon


def panel(m, sufijo):
    return next(p for p in m.panels if p.name.endswith(sufijo))


def test_lateral_corre_completo_igual_a_la_corredera():
    """LA razon fisica: la corredera se atornilla al lateral en toda su longitud."""
    m = cajon("C01", ancho_interior=570, alto_frente=200, prof_modulo=600)
    lat = panel(m, "_lateral_caja")
    corr = next(h for h in m.hardware if h.sku.startswith("COR"))
    assert lat.largo == 500
    assert corr.sku == "COR-LAT-500"
    assert lat.largo == int(corr.sku.split("-")[-1])


def test_frente_y_trasera_capturados():
    m = cajon("C02", ancho_interior=570, alto_frente=200, prof_modulo=600)
    ancho_caja = 570 - 2 * HOLGURA_LATERAL          # 544
    assert panel(m, "_frente_caja").largo == ancho_caja - 2 * T   # 514
    assert panel(m, "_trasera_caja").largo == ancho_caja - 2 * T


def test_cantos_pieza_por_pieza():
    """Encintar 'todos los cantos' en bloque infla el costo ~40%."""
    m = cajon("C03", ancho_interior=570, alto_frente=200, prof_modulo=600)
    lat = panel(m, "_lateral_caja")
    assert lat.cantos["frontal"] is True
    assert lat.cantos["superior"] is True
    assert lat.cantos["trasero"] is False
    assert lat.cantos["inferior"] is False


def test_holgura_bajo_cajon():
    m = cajon("C04", ancho_interior=570, alto_frente=200, prof_modulo=600,
              tipo_corredera="bajo_cajon")
    ancho_caja = 570 - 2 * HOLGURA_BAJOCAJON
    assert panel(m, "_frente_caja").largo == ancho_caja - 2 * T
