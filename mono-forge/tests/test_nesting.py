from mono_forge.constants import HOJA_ANCHO, KERF
from mono_forge.cutlist import nesting
from mono_forge.models import Panel


def test_el_kerf_impide_cubierta_mas_lateral():
    """620 + 4 + 600 = 1224 > 1220. El nesting teorico dice que si; la sierra dice que no."""
    assert 620 + KERF + 600 > HOJA_ANCHO
    assert 620 + KERF + 596 == HOJA_ANCHO


def test_dos_laterales_de_600_caben_a_lo_ancho():
    assert 600 + KERF + 600 <= HOJA_ANCHO


def test_nesting_agrupa_por_material():
    panels = [
        Panel("lateral", 785, 600, cantidad=6, material="MEL-BLA-15-IMP", veta="vertical"),
        Panel("fondo", 600, 800, espesor=3, material="MDF-003-FON"),
    ]
    hojas = nesting(panels)
    assert set(hojas) == {"MEL-BLA-15-IMP", "MDF-003-FON"}
    assert len(hojas["MEL-BLA-15-IMP"]) >= 1
