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
from mono_forge.rules.posicion import colocar, esquina_en_l, ALTO_COLGADO_DEFAULT


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


def _cocina_en_l():
    """Muro A de 1200 sobre X; muro B girado −90°, arrancando donde termina A."""
    p = Project(cliente="TEST", nombre="L")
    p.modules.append(gabinete_base("B01", ancho=600))
    p.modules.append(gabinete_base("B02", ancho=600))
    p.modules.append(gabinete_base("B03", ancho=600))
    p.tramos.append(Tramo(id="TA", muro="A", modulos=["B01", "B02"]))
    p.tramos.append(Tramo(id="TB", muro="B", modulos=["B03"],
                          **esquina_en_l(1200)))
    return p


def test_un_muro_recto_no_escribe_rz():
    """Los project.json de un solo muro no deben cambiar de forma."""
    p = _proyecto()
    colocar(p)
    assert all("rz" not in c for q in p.all_panels() for c in q.colocacion)


def test_el_tramo_girado_transforma_la_colocacion():
    """La aritmética del mueble se resuelve en el marco LOCAL del muro y sólo
    al final se gira: un mueble en el muro B mide lo mismo que en el muro A."""
    p = _cocina_en_l()
    colocar(p)

    b01 = next(m for m in p.modules if m.id == "B01")
    b03 = next(m for m in p.modules if m.id == "B03")
    base_a = next(q for q in b01.panels if q.rol_estructural == "base_portante")
    base_b = next(q for q in b03.panels if q.rol_estructural == "base_portante")
    ca, cb = base_a.colocacion[0], base_b.colocacion[0]

    # mismas medidas: el giro no toca el cutlist
    assert (base_a.largo, base_a.ancho) == (base_b.largo, base_b.ancho)
    assert (cb["sx"], cb["sy"], cb["sz"]) == (ca["sx"], ca["sy"], ca["sz"])

    # local (300, 300), origen (1200−600, −50), girado −90° → (900, −350)
    assert cb["rz"] == -90.0
    assert cb["x"] == pytest.approx(900.0)
    assert cb["y"] == pytest.approx(-350.0)
    assert cb["z"] == pytest.approx(ca["z"])          # misma altura


def test_los_dos_muros_de_la_l_no_se_encinan():
    """El muro B arranca donde termina el A: en planta no pueden solaparse."""
    from mono_forge.docs.planos import _rects

    p = _cocina_en_l()
    colocar(p)
    ids = {"TA": ["B01", "B02"], "TB": ["B03"]}
    huellas = {}
    for tid, mids in ids.items():
        rs = _rects([q for m in p.modules if m.id in mids for q in m.panels],
                    "planta")
        huellas[tid] = (min(r[0] for r in rs), min(r[1] for r in rs),
                        max(r[0] + r[2] for r in rs),
                        max(r[1] + r[3] for r in rs))
    (ax0, ay0, ax1, ay1), (bx0, by0, bx1, by1) = huellas["TA"], huellas["TB"]
    solape = (max(0.0, min(ax1, bx1) - max(ax0, bx0))
              * max(0.0, min(ay1, by1) - max(ay0, by0)))
    assert solape < 1.0, f"los muros se encinan {solape:.0f} mm²"


def _aabb(c):
    """Caja envolvente real: con rz=±90 las extensiones locales se intercambian."""
    if (c.get("rz", 0.0) % 360) in (90.0, 270.0):
        return {**c, "sx": c["sy"], "sy": c["sx"]}
    return c


def test_en_una_l_ningun_mueble_se_atraviesa_con_otro():
    """El giro no puede meter una pieza dentro de otra.

    Se comparan cajas envolventes REALES: comparar sx/sy locales de un muro
    girado da falsos positivos y esconde los choques de verdad.
    """
    p = _cocina_en_l()
    p.modules.append(alacena("A01", ancho=600))
    p.tramos[1].modulos.append("A01")
    colocar(p)

    cajas = [(q.name, _aabb(c)) for q in p.all_panels()
             if not q.accesorio for c in q.colocacion]
    for i, (n1, c1) in enumerate(cajas):
        for n2, c2 in cajas[i + 1:]:
            v = _volumen_traslape(c1, c2)
            assert v < 1.0, f"{n1} y {n2} se atraviesan ({v:.0f} mm³)"


def test_la_alacena_se_cuelga_del_muro_no_del_frente():
    """La alacena es 250mm menos profunda que el mueble de piso. Alineada al
    frente quedaría flotando esos 250mm adentro del cuarto."""
    p = Project(cliente="TEST", nombre="muro")
    p.modules.append(gabinete_base("B01", ancho=600))
    p.modules.append(alacena("A01", ancho=600))
    colocar(p)

    def respaldo(mid):
        m = next(x for x in p.modules if x.id == mid)
        f = next(q for q in m.panels if q.rol_estructural == "fondo")
        c = f.colocacion[0]
        return c["y"] + c["sy"] / 2

    assert respaldo("A01") == pytest.approx(respaldo("B01"))


def test_el_alzado_de_un_muro_girado_se_dibuja_de_frente():
    """Sin deshacer el giro, el muro B se vería de canto (ancho ≈ 0)."""
    from mono_forge.docs.planos import _rects, alzados

    p = _cocina_en_l()
    colocar(p)
    por_muro = {t: (pn, mc) for t, pn, mc in alzados(p)}
    assert len(por_muro) == 2, "una L necesita un alzado por muro"

    titulo_b = next(t for t in por_muro if t.endswith("B"))
    paneles, marco = por_muro[titulo_b]
    rs = _rects(paneles, "frontal", marco)
    ancho = max(r[0] + r[2] for r in rs) - min(r[0] for r in rs)
    assert ancho == pytest.approx(600.0), "el muro girado debe verse de frente"


def test_las_jaladeras_se_cuelgan_del_frente_y_no_se_cortan():
    from mono_forge.generators.jaladera import jaladeras

    p = Project(cliente="TEST", nombre="jaladeras")
    m = gabinete_base("B01", ancho=800, puertas=2)
    piezas = jaladeras(m, silueta="bow")
    p.modules.append(m)
    colocar(p)

    hojas = sum(int(q.cantidad) for q in m.panels
                if q.rol_estructural == "frente")
    assert hojas == 2
    assert len(piezas) == 3                       # lazo + nudo + lazo
    for q in piezas:
        assert q.accesorio and q not in p.piezas_de_corte()
        assert len(q.colocacion) == q.cantidad == hojas

    frente = next(q for q in m.panels if q.rol_estructural == "frente")
    cara = min(c["y"] - c["sy"] / 2 for c in frente.colocacion)
    for q in piezas:
        for c in q.colocacion:
            assert c["y"] + c["sy"] / 2 <= cara + 0.01, \
                f"{q.name} se mete dentro del frente en lugar de sobresalir"

    herraje = {h.sku: h.cantidad for h in m.hardware}
    assert herraje["JAL-MONO-BOW"] == hojas


def test_la_jaladera_del_cajon_va_centrada_y_la_de_la_puerta_arriba():
    from mono_forge.generators.cajonera import cajonera
    from mono_forge.generators.jaladera import jaladeras, RETRANQUEO_SUPERIOR

    p = Project(cliente="TEST", nombre="jal2")
    caj = cajonera("B01", ancho=450, altos_frentes=[266, 266, 268])
    jaladeras(caj, silueta="bow")
    puerta = gabinete_base("B02", ancho=600)
    jaladeras(puerta, silueta="bow")
    p.modules += [caj, puerta]
    colocar(p)

    nudo_caj = next(q for q in caj.panels if q.name.endswith("_jal_nudo"))
    frentes_caj = [c for q in caj.panels if q.rol_estructural == "frente"
                   for c in q.colocacion]
    for c, cf in zip(nudo_caj.colocacion, frentes_caj):
        assert c["z"] == pytest.approx(cf["z"])        # cajón: centrada

    nudo_p = next(q for q in puerta.panels if q.name.endswith("_jal_nudo"))
    cf = next(q for q in puerta.panels
              if q.rol_estructural == "frente").colocacion[0]
    assert nudo_p.colocacion[0]["z"] == pytest.approx(
        cf["z"] + cf["sz"] / 2 - RETRANQUEO_SUPERIOR)   # puerta: arriba


def test_la_cajonera_valida_la_aritmetica_vertical():
    from mono_forge.generators.cajonera import cajonera
    import pytest as _pt

    with _pt.raises(ValueError, match="800"):
        cajonera("B01", ancho=450, altos_frentes=[200, 200])      # suman 400
    with _pt.raises(ValueError, match="divisor"):
        cajonera("B01", ancho=1200, altos_frentes=[400, 400])
