"""Cutlist + nesting con KERF.

Un nesting sin kerf es un cutlist que el taller NO puede ejecutar:
    620 (cubierta) + 4 (sierra) + 596 = 1220  → un lateral de 600 YA NO CABE.

Packer de estanterías (shelf/guillotine) sin dependencias externas. Para producción
de alto volumen se puede sustituir por rectpack manteniendo el inflado por kerf.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .constants import HOJA_LARGO, HOJA_ANCHO, KERF, HOJA_M2
from .models import Project, Panel


@dataclass
class Colocacion:
    panel: str
    x: float
    y: float
    largo: float
    ancho: float
    rotada: bool = False


@dataclass
class Hoja:
    indice: int
    material: str
    piezas: list[Colocacion] = field(default_factory=list)

    @property
    def area_usada(self) -> float:
        return sum((c.largo / 1000) * (c.ancho / 1000) for c in self.piezas)

    @property
    def aprovechamiento(self) -> float:
        return self.area_usada / HOJA_M2


def _expandir(panels: list[Panel]) -> list[tuple[str, float, float, str, bool]]:
    """Una entrada por unidad física. (nombre, largo, ancho, material, veta_fija)"""
    out = []
    for p in panels:
        for i in range(int(p.cantidad)):
            nombre = p.name if p.cantidad == 1 else f"{p.name}_{i+1}"
            out.append((nombre, p.largo, p.ancho, p.material, p.veta != "libre"))
    return out


def nesting(panels: list[Panel], kerf: float = KERF) -> dict[str, list[Hoja]]:
    """Agrupa por material y acomoda por estanterías, inflando cada pieza por el kerf."""
    por_material: dict[str, list] = {}
    for item in _expandir(panels):
        por_material.setdefault(item[3], []).append(item)

    resultado: dict[str, list[Hoja]] = {}
    for material, items in por_material.items():
        # ordenar por lado mayor descendente
        items.sort(key=lambda t: max(t[1], t[2]), reverse=True)
        hojas: list[Hoja] = []
        estantes: list[list] = []   # [hoja_idx, y, altura_estante, x_usado]

        for nombre, largo, ancho, _mat, veta_fija in items:
            l, a = largo, ancho
            if not veta_fija and a > l:
                l, a = a, l          # acostar la pieza si la veta lo permite
            lw, aw = l + kerf, a + kerf     # inflado por sierra

            if lw > HOJA_LARGO or aw > HOJA_ANCHO:
                if not veta_fija and aw <= HOJA_LARGO and lw <= HOJA_ANCHO:
                    l, a = a, l
                    lw, aw = l + kerf, a + kerf
                else:
                    raise ValueError(
                        f"La pieza {nombre} ({largo}x{ancho}) no cabe en la hoja "
                        f"{HOJA_LARGO}x{HOJA_ANCHO} con kerf de {kerf}mm.")

            colocada = False
            for e in estantes:
                if e[2] >= aw and e[3] + lw <= HOJA_LARGO:
                    hojas[e[0]].piezas.append(Colocacion(nombre, e[3], e[1], l, a))
                    e[3] += lw
                    colocada = True
                    break
            if colocada:
                continue

            # nuevo estante en la última hoja, o nueva hoja
            y_libre = 0.0
            if hojas:
                y_libre = max((e[1] + e[2]) for e in estantes if e[0] == len(hojas) - 1)
            if not hojas or y_libre + aw > HOJA_ANCHO:
                hojas.append(Hoja(indice=len(hojas), material=material))
                y_libre = 0.0
            hojas[-1].piezas.append(Colocacion(nombre, 0.0, y_libre, l, a))
            estantes.append([len(hojas) - 1, y_libre, aw, lw])

        resultado[material] = hojas
    return resultado


def resumen(project: Project) -> dict:
    panels = project.piezas_de_corte()
    hojas = nesting(panels)
    alertas: list[str] = []

    for material, hs in hojas.items():
        for h in hs:
            libre = HOJA_ANCHO - max((c.y + c.ancho) for c in h.piezas)
            if 0 < libre < 40:
                alertas.append(
                    f"{material} hoja {h.indice + 1}: quedan {libre:.0f}mm libres. "
                    "Ajustando una pieza pocos mm podrías ganar otra tira.")

    return {
        "area_paneles_m2": round(sum(p.area_m2 for p in panels), 3),
        "ml_cubrecanto": round(sum(p.ml_canto for p in panels), 2),
        "hojas_por_material": {m: len(hs) for m, hs in hojas.items()},
        "aprovechamiento": {
            m: round(sum(h.area_usada for h in hs) / (len(hs) * HOJA_M2), 3)
            for m, hs in hojas.items()},
        "alertas": alertas,
        "detalle": hojas,
    }


def imprimir(project: Project) -> None:
    r = resumen(project)
    print(f"\n{'='*78}\nCUTLIST — {project.nombre} ({project.cliente})\n{'='*78}")
    print(f"{'PIEZA':<34}{'CANT':>5}{'LARGO':>8}{'ANCHO':>8}{'ESP':>5}  CANTOS")
    print("-" * 78)
    for p in project.piezas_de_corte():
        c = "".join(k[0].upper() for k, v in p.cantos.items() if v) or "-"
        print(f"{p.name:<34}{int(p.cantidad):>5}{p.largo:>8.1f}{p.ancho:>8.1f}"
              f"{p.espesor:>5.0f}  {c}")
    print("-" * 78)
    print(f"Área total: {r['area_paneles_m2']} m²   "
          f"Cubrecanto: {r['ml_cubrecanto']} ml")
    for m, n in r["hojas_por_material"].items():
        print(f"  {m}: {n} hoja(s), aprovechamiento {r['aprovechamiento'][m]*100:.1f}%")
    for a in r["alertas"]:
        print(f"  ! {a}")
    print("\nHERRAJE")
    print("-" * 78)
    for h in project.hardware_consolidado().values():
        print(f"{h.sku:<20}{h.descripcion:<44}{h.cantidad:>6g} {h.unidad}")
