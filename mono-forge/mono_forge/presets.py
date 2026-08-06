"""Presets estándar del taller Mono Atelier."""

from __future__ import annotations

from .constants import PROF_BASE, PROF_SUPERIOR, ALTO_SUPERIOR_DEFAULT, ALTO_TORRE_DEFAULT
from .generators.base import gabinete_base
from .generators.superior import alacena
from .generators.torre import torre

PRESETS = {
    "BASE-600":        dict(gen="base",     ancho=600,  prof=PROF_BASE, puertas=1, entrepanos=1),
    "BASE-TARJA-1240": dict(gen="base",     ancho=1240, prof=PROF_BASE, puertas=2, tarja=True),
    "BASE-TARJA-1300": dict(gen="base",     ancho=1300, prof=PROF_BASE, puertas=2, tarja=True),
    "SUP-750":         dict(gen="superior", ancho=600,  prof=PROF_SUPERIOR,
                            alto=ALTO_SUPERIOR_DEFAULT, puertas=1, entrepanos=1),
    "TORRE-HORNO":     dict(gen="torre",    ancho=600,  alto_total=ALTO_TORRE_DEFAULT,
                            nichos=[dict(tipo="horno", alto_nicho=600,
                                         desde_piso=850, ventilacion=30)]),
    "TORRE-MICRO":     dict(gen="torre",    ancho=600,  alto_total=ALTO_TORRE_DEFAULT,
                            nichos=[dict(tipo="microondas", alto_nicho=420,
                                         ventilacion=30)]),
}

_GEN = {"base": gabinete_base, "superior": alacena, "torre": torre}


def desde_preset(nombre: str, id: str, **overrides):
    if nombre not in PRESETS:
        raise KeyError(f"preset desconocido: {nombre}. Disponibles: {list(PRESETS)}")
    cfg = dict(PRESETS[nombre])
    gen = _GEN[cfg.pop("gen")]
    cfg.update(overrides)
    return gen(id=id, **cfg)
