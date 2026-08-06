"""Modelo de datos — LA FUENTE DE VERDAD del sistema.

Blender construye desde aquí. El cutlist, los costos, la cotización y el manual
salen de aquí. Nunca se miden mallas para obtener medidas.

Todas las medidas en MILÍMETROS.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Any

from .constants import T, T_FONDO


# ── Cantos ───────────────────────────────────────────────────────────────
def cantos(frontal: bool = False, trasero: bool = False,
           superior: bool = False, inferior: bool = False) -> dict[str, bool]:
    """Cubrecanto lado por lado. NUNCA aplicar 'todos los cantos' en bloque:
    infla el costo de cubrecanto ~40% y el taller no lo hace así."""
    return {"frontal": frontal, "trasero": trasero,
            "superior": superior, "inferior": inferior}


CANTO_NINGUNO = cantos()
CANTO_FRONTAL = cantos(frontal=True)
CANTO_VISTA_4 = cantos(True, True, True, True)


@dataclass
class DrillOp:
    """Perforación: cazoleta, sistema 32, minifix, corredera."""
    tipo: str                  # cazoleta | sistema32 | minifix | corredera | paso_led
    diametro: float
    x: float                   # desde el canto izquierdo/frontal de la pieza
    y: float                   # desde el canto inferior de la pieza
    profundidad: float = 12.0
    cara: str = "interior"     # interior | exterior | canto
    nota: str = ""


@dataclass
class Panel:
    """Una pieza a cortar."""
    name: str
    largo: float
    ancho: float
    espesor: float = T
    cantidad: int = 1
    material: str = "MEL-BLA-15-IMP"
    rol_estructural: str = ""      # base_portante | lateral_apoyado | refuerzo | frente...
    justificacion: str = ""        # POR QUÉ va así — se imprime en el manual de ensamble
    cantos: dict[str, bool] = field(default_factory=cantos)
    veta: str = "libre"            # libre | vertical | horizontal
    #: True = pieza de REFERENCIA (tarja, electrodoméstico). Se ve en el 3D y
    #: en el render, pero NO se corta ni entra al cutlist ni al costeo.
    accesorio: bool = False
    drilling: list[DrillOp] = field(default_factory=list)
    # Colocación 3D DERIVADA por rules/posicion.py — una entrada por copia:
    # {"x","y","z","sx","sy","sz"} (centro y extensión por eje, en mm).
    # Blender y el visor web sólo leen esto; nunca calculan posiciones.
    colocacion: list[dict] = field(default_factory=list)

    @property
    def area_m2(self) -> float:
        return (self.largo / 1000) * (self.ancho / 1000) * self.cantidad

    @property
    def ml_canto(self) -> float:
        """Metros lineales de cubrecanto de esta pieza."""
        ml = 0.0
        if self.cantos.get("frontal"):
            ml += self.ancho / 1000
        if self.cantos.get("trasero"):
            ml += self.ancho / 1000
        if self.cantos.get("superior"):
            ml += self.largo / 1000
        if self.cantos.get("inferior"):
            ml += self.largo / 1000
        return ml * self.cantidad


@dataclass
class HardwareItem:
    sku: str
    descripcion: str
    cantidad: float
    unidad: str = "pza"        # pza | par | ml | jgo


@dataclass
class Module:
    id: str
    tipo: str                  # base | base_tarja | superior | torre | cajonera
    ancho: float
    alto: float
    prof: float
    panels: list[Panel] = field(default_factory=list)
    hardware: list[HardwareItem] = field(default_factory=list)
    apertura: str = "jaladera"     # jaladera | gola_aluminio | gola_tablero | push
    gola_sku: str | None = None
    led: bool = False
    notas: list[str] = field(default_factory=list)
    flags: dict[str, Any] = field(default_factory=dict)

    @property
    def area_m2(self) -> float:
        return sum(p.area_m2 for p in self.panels)

    @property
    def ml_canto(self) -> float:
        return sum(p.ml_canto for p in self.panels)


@dataclass
class Tramo:
    """Conjunto de módulos contiguos sobre un mismo muro.
    La cubierta, la gola y el zoclo se calculan A NIVEL DE TRAMO, no por módulo."""
    id: str
    muro: str
    modulos: list[str] = field(default_factory=list)   # ids de Module
    lleva_cubierta: bool = True
    panels: list[Panel] = field(default_factory=list)  # cubierta, zoclo, gola de tablero
    hardware: list[HardwareItem] = field(default_factory=list)
    notas: list[str] = field(default_factory=list)


@dataclass
class Project:
    cliente: str
    nombre: str
    moneda: str = "MXN"
    proveedor_preferente: str = "Importacion"
    style_preset: str = "mono-atelier-base"
    modules: list[Module] = field(default_factory=list)
    tramos: list[Tramo] = field(default_factory=list)
    notas: list[str] = field(default_factory=list)

    # ── serialización ────────────────────────────────────────────────
    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)

    @staticmethod
    def from_json(path: str) -> "Project":
        with open(path, encoding="utf-8") as f:
            return Project.from_dict(json.load(f))

    @staticmethod
    def from_dict(d: dict) -> "Project":
        def panel(pd: dict) -> Panel:
            pd = dict(pd)
            pd["drilling"] = [DrillOp(**x) for x in pd.get("drilling", [])]
            return Panel(**pd)

        modules = []
        for md in d.get("modules", []):
            md = dict(md)
            md["panels"] = [panel(p) for p in md.get("panels", [])]
            md["hardware"] = [HardwareItem(**h) for h in md.get("hardware", [])]
            modules.append(Module(**md))

        tramos = []
        for td in d.get("tramos", []):
            td = dict(td)
            td["panels"] = [panel(p) for p in td.get("panels", [])]
            td["hardware"] = [HardwareItem(**h) for h in td.get("hardware", [])]
            tramos.append(Tramo(**td))

        base = {k: v for k, v in d.items() if k not in ("modules", "tramos")}
        return Project(modules=modules, tramos=tramos, **base)

    # ── agregados ────────────────────────────────────────────────────
    def all_panels(self) -> list[Panel]:
        out: list[Panel] = []
        for m in self.modules:
            out.extend(m.panels)
        for t in self.tramos:
            out.extend(t.panels)
        return out

    def piezas_de_corte(self) -> list[Panel]:
        """Sólo lo que el taller CORTA: sin accesorios de referencia."""
        return [p for p in self.all_panels() if not p.accesorio]

    def all_hardware(self) -> list[HardwareItem]:
        out: list[HardwareItem] = []
        for m in self.modules:
            out.extend(m.hardware)
        for t in self.tramos:
            out.extend(t.hardware)
        return out

    def hardware_consolidado(self) -> dict[str, HardwareItem]:
        acc: dict[str, HardwareItem] = {}
        for h in self.all_hardware():
            if h.sku in acc:
                acc[h.sku].cantidad += h.cantidad
            else:
                acc[h.sku] = HardwareItem(h.sku, h.descripcion, h.cantidad, h.unidad)
        return acc


def fondo_aplicado(name: str, ancho: float, alto: float,
                   material: str = "MDF-003-FON") -> Panel:
    """Fondo de 3mm aplicado sobre el canto trasero, cubriendo los refuerzos.
    Es la pieza que ESCUADRA el mueble."""
    return Panel(
        name=name, largo=ancho, ancho=alto, espesor=T_FONDO,
        material=material, rol_estructural="fondo",
        justificacion=("Aplicado sobre el canto trasero cubriendo los refuerzos. "
                       "Escuadra el mueble: atornillar sólo después de verificar "
                       "diagonales iguales."),
        cantos=cantos(),
    )
