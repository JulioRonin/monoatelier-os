"""Red de seguridad. Si un test de medidas falla, NUNCA lo 'arregles' cambiando el
valor esperado sin explicar la matemática."""

import inspect

from mono_forge import constants as C


def test_stack_vertical_900():
    """100 (zoclo) + 15 (base) + 785 (lateral) = 900. Confirma la regla estructural."""
    assert C.ALTO_LATERAL_BASE == 785
    assert C.ALTO_ZOCLO + C.T + C.ALTO_LATERAL_BASE == C.ALTO_TOTAL_BASE


def test_785_es_derivado_no_hardcodeado():
    fuente = inspect.getsource(C)
    linea = [l for l in fuente.splitlines() if l.startswith("ALTO_LATERAL_BASE")][0]
    codigo = linea.split("#")[0]          # ignorar el comentario
    assert "785" not in codigo, "ALTO_LATERAL_BASE debe derivarse, no escribirse literal"


def test_corredera_estandar_500():
    assert C.seleccionar_corredera(600, 19) == 500
    assert C.seleccionar_corredera(600, 15) == 500      # no sube a 550
    assert C.seleccionar_corredera(450, 19) == 400


def test_alto_lateral_por_tipo():
    assert C.alto_lateral("base") == 785
    assert C.alto_lateral("torre", 2100) == 1985
    assert C.alto_lateral("torre", 2200) == 2085
    assert C.alto_lateral("superior", 750) == 750


def test_bisagras_por_altura():
    assert C.num_bisagras(797) == 2
    assert C.num_bisagras(1200) == 3
    assert C.num_bisagras(1985) == 4


def test_patas():
    assert C.num_patas(600) == 4
    assert C.num_patas(1240) == 5
