from mono_forge.constants import ALTO_LATERAL_BASE, ALTO_CUERPO_BASE, T
from mono_forge.generators.base import gabinete_base


def panel(m, sufijo):
    return next(p for p in m.panels if p.name.endswith(sufijo))


def test_base_600():
    m = gabinete_base("B01", ancho=600, prof=600)
    assert panel(m, "_base").largo == 600           # corre a todo el ancho
    assert panel(m, "_lateral").largo == 785        # descansa sobre la base
    assert panel(m, "_lateral").cantidad == 2
    assert panel(m, "_ref_sup_frente").largo == 570  # ancho - 2T
    assert panel(m, "_fondo").largo == 600
    assert panel(m, "_fondo").ancho == ALTO_CUERPO_BASE   # 800
    assert panel(m, "_puerta").largo == 797         # cuerpo 800 - gap 3
    assert panel(m, "_puerta").ancho == 597
    assert not any(p.name.endswith("_divisor") for p in m.panels)


def test_tarja_1240_lleva_divisor_y_no_entrepano():
    m = gabinete_base("B02", ancho=1240, prof=600, puertas=2, tarja=True)
    assert panel(m, "_divisor").largo == ALTO_LATERAL_BASE
    assert not any("entrepano" in p.name for p in m.panels)
    assert panel(m, "_ref_sup_frente").ancho == 80   # tira reducida para librar el tazon
    assert panel(m, "_puerta").ancho == (1240 - 3) / 2
    assert m.flags["requiere_recorte_cubierta"] is True
    bis = next(h for h in m.hardware if h.sku.startswith("BIS"))
    assert bis.sku == "BIS-35-SEM"                   # dos puertas comparten divisor


def test_lateral_no_es_capturado():
    """Si alguien invirtiera la regla, el lateral mediria 800 y el 785 desapareceria."""
    m = gabinete_base("B03", ancho=900, prof=600)
    assert panel(m, "_lateral").largo != ALTO_CUERPO_BASE
    assert panel(m, "_lateral").largo == ALTO_CUERPO_BASE - T
