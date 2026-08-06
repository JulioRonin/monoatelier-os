"""Prueba de humo: proyecto completo con tramo, cubierta y LED."""

from mono_forge.cutlist import resumen
from mono_forge.generators.base import gabinete_base
from mono_forge.generators.cajonera import cajon
from mono_forge.generators.cubierta import cubierta
from mono_forge.generators.superior import alacena
from mono_forge.models import Project, Tramo


def proyecto_demo() -> Project:
    p = Project(cliente="DEMO", nombre="Cocina demo")
    p.modules += [
        gabinete_base("B01", ancho=600, prof=600),
        gabinete_base("B02", ancho=1240, prof=600, puertas=2, tarja=True),
        cajon("C01", ancho_interior=570, alto_frente=200, prof_modulo=600),
        alacena("S01", ancho=600, alto=750, prof=350, led=True),
    ]
    panels, notas = cubierta("T01", largo_tramo=1840, recortes=["tarja"])
    p.tramos.append(Tramo(id="T01", muro="A",
                          modulos=["B01", "B02"], panels=panels, notas=notas))
    return p


def test_proyecto_completo_genera_cutlist():
    p = proyecto_demo()
    r = resumen(p)
    assert r["area_paneles_m2"] > 0
    assert r["ml_cubrecanto"] > 0
    assert sum(r["hojas_por_material"].values()) >= 1


def test_roundtrip_json(tmp_path):
    p = proyecto_demo()
    f = tmp_path / "project.json"
    p.to_json(str(f))
    q = Project.from_json(str(f))
    assert len(q.modules) == len(p.modules)
    assert q.all_panels()[0].largo == p.all_panels()[0].largo
