"""Motor de costos.

Dos tarifas de cubrecanto: máquina y MANUAL. El alto brillo de 19mm siempre lleva
cintilla pegada a mano — si el sistema promedia, las cotizaciones de alto brillo
salen cortas justo donde más mano de obra hay.
"""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass

from .constants import FACTOR_DESPERDICIO, HOJA_M2
from .models import Project

_CAT = os.path.join(os.path.dirname(__file__), "..", "catalog")


@dataclass
class Tarifas:
    canto_maquina_ml: float = 0.0
    canto_manual_ml: float = 0.0
    mano_obra_modulo: float = 0.0
    margen: float = 0.35            # NO se expone en la cotización al cliente


def _leer(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def catalogo_materiales() -> dict[str, dict]:
    return {r["sku"]: r for r in _leer(os.path.join(_CAT, "materiales.csv"))}


def catalogo_herrajes() -> dict[str, dict]:
    return {r["sku"]: r for r in _leer(os.path.join(_CAT, "herrajes.csv"))}


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def equivalente(sku: str, proveedor: str, mats: dict[str, dict]) -> dict | None:
    """El mismo tablero (misma descripción y espesor) en otra marca.

    Sin esto la simulación por proveedor devuelve el mismo precio para todos:
    el proveedor sólo cambia el costo si de verdad se sustituye el SKU.
    Si la marca no tiene el equivalente (o no tiene precio), regresa None y el
    cálculo se queda con el SKU original — nunca inventa un precio.
    """
    fila = mats.get(sku)
    if not fila:
        return None
    if (fila.get("marca") or "").strip().lower() == proveedor.strip().lower():
        return fila
    for otra in mats.values():
        if (otra.get("marca") or "").strip().lower() != proveedor.strip().lower():
            continue
        if (otra.get("descripcion") == fila.get("descripcion")
                and otra.get("espesor_mm") == fila.get("espesor_mm")
                and _f(otra.get("costo_m2"))):
            return otra
    return None


def costear(project: Project, tarifas: Tarifas | None = None,
            proveedor: str | None = None) -> dict:
    tarifas = tarifas or Tarifas()
    mats, herr = catalogo_materiales(), catalogo_herrajes()
    proveedor = proveedor or project.proveedor_preferente

    costo_material = 0.0
    faltantes: list[str] = []
    sustituciones: dict[str, str] = {}
    area_por_sku: dict[str, float] = {}
    for p in project.all_panels():
        area_por_sku[p.material] = area_por_sku.get(p.material, 0.0) + p.area_m2

    for sku, area in area_por_sku.items():
        fila = mats.get(sku)
        alterna = equivalente(sku, proveedor, mats) if proveedor else None
        if alterna is not None and alterna.get("sku") != sku:
            sustituciones[sku] = alterna["sku"]
            fila = alterna
        elif alterna is not None:
            fila = alterna
        if not fila or not _f(fila.get("costo_m2")):
            faltantes.append(sku)
            continue
        costo_material += area * (1 + FACTOR_DESPERDICIO) * _f(fila["costo_m2"])

    # cubrecanto: manual si el material es alto brillo
    ml_maq = ml_man = 0.0
    for p in project.all_panels():
        fila = mats.get(p.material, {})
        manual = "brillo" in (fila.get("descripcion", "") + p.material).lower()
        if manual:
            ml_man += p.ml_canto
        else:
            ml_maq += p.ml_canto
    costo_canto = ml_maq * tarifas.canto_maquina_ml + ml_man * tarifas.canto_manual_ml

    costo_herraje = 0.0
    for h in project.hardware_consolidado().values():
        fila = herr.get(h.sku)
        if not fila or not _f(fila.get("costo_unit")):
            faltantes.append(h.sku)
            continue
        costo_herraje += h.cantidad * _f(fila["costo_unit"])

    costo_mo = len(project.modules) * tarifas.mano_obra_modulo
    costo_directo = costo_material + costo_canto + costo_herraje + costo_mo
    precio = costo_directo / (1 - tarifas.margen) if tarifas.margen < 1 else costo_directo

    return {
        "moneda": project.moneda,
        "proveedor": proveedor,
        "material": round(costo_material, 2),
        "cubrecanto": round(costo_canto, 2),
        "cubrecanto_ml": {"maquina": round(ml_maq, 2), "manual": round(ml_man, 2)},
        "herraje": round(costo_herraje, 2),
        "mano_obra": round(costo_mo, 2),
        "costo_directo": round(costo_directo, 2),
        "precio_cliente": round(precio, 2),   # el margen NUNCA se imprime al cliente
        "skus_sin_precio": sorted(set(faltantes)),
        "sustituciones": sustituciones,       # sku original → sku del proveedor simulado
    }


def comparar_proveedores(project: Project, tarifas: Tarifas | None = None) -> dict:
    """El delta entre importación y marca es una palanca de margen real.

    Sólo se listan los proveedores que realmente pueden surtir algún tablero del
    proyecto con precio en catálogo: un proveedor sin equivalentes no es una
    alternativa, es un hueco de datos.
    """
    mats = catalogo_materiales()
    usados = {p.material for p in project.all_panels()}
    salida: dict[str, float] = {}
    for prov in sorted({r["marca"] for r in mats.values() if r.get("marca")}):
        if not any(equivalente(sku, prov, mats) for sku in usados):
            continue
        salida[prov] = costear(project, tarifas, proveedor=prov)["precio_cliente"]
    return salida
