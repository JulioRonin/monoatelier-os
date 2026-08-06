"""Cocina rosa pastel en L — Mono Atelier.

Se arma con las MISMAS herramientas del agente de prompts (forge_agent), así
que este archivo es la transcripción exacta de lo que el modelo hace cuando el
prompt llega desde la plataforma. Ninguna medida se escribe a mano: todas las
deriva el motor a partir de anchos, altos y reglas del taller.

    python projects/cocina-rosa-pastel/build.py

Distribución
    MURO A (2700 de frente)
        A-torre   T01  torre 600 × 2100          x    0 –  600
        A-piso    B01  cajonera 600, 3 cajones   x  600 – 1200
                  B02  tarja 900                 x 1200 – 2100
                  B03  puerta 600 + entrepaño    x 2100 – 2700
        A-aire    A01/A02/A03 alacenas           x  600 – 2700
    MURO B (retorno derecho, 1200 de frente)
        B-piso    B04  puerta 600 + entrepaño
                  B05  cajonera 600, 3 cajones
        B-aire    A04/A05 alacenas
"""

from __future__ import annotations

import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(AQUI, "..", "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(AQUI, "..", "..")))

from forge_agent import herramientas as h   # noqa: E402

# ── acabados ─────────────────────────────────────────────────────────────
CASCO = "MEL-ROSA-PASTEL-15"        # cascos, entrepaños y cajas de cajón
FRENTE = "LAC-ROSA-PASTEL-15"       # puertas y frentes de cajón
CUBIERTA = "CUA-ROSA-PASTEL-19"     # cubierta


def construir() -> dict:
    h.reiniciar()
    print(h.definir_proyecto(
        cliente="Mono Atelier — prueba en casa",
        nombre="cocina-rosa-pastel",
        material=CASCO, material_frente=FRENTE,
        material_cubierta=CUBIERTA, apertura="jaladera"))

    # ── MURO A ───────────────────────────────────────────────────────
    print(h.agregar_torre(
        "T01", ancho=600, alto_total=2100,
        nichos=[{"tipo": "horno", "alto_nicho": 600, "ventilacion": 30}],
        material=CASCO, material_frente=FRENTE))
    print(h.agregar_cajonera("B01", ancho=600, altos_frentes=[266, 266, 268],
                             material=CASCO, material_frente=FRENTE))
    print(h.agregar_gabinete_base("B02", ancho=900, tarja=True, entrepanos=0,
                                  material=CASCO, material_frente=FRENTE))
    print(h.agregar_tarja("B02", ancho=600, fondo=450, profundidad=200))
    print(h.agregar_gabinete_base("B03", ancho=600, entrepanos=1,
                                  material=CASCO, material_frente=FRENTE))

    for mid, ancho in (("A01", 600), ("A02", 900), ("A03", 600)):
        print(h.agregar_alacena(mid, ancho=ancho, alto=750, entrepanos=1,
                                led=True, material=CASCO,
                                material_frente=FRENTE))

    # ── MURO B (retorno) ─────────────────────────────────────────────
    print(h.agregar_gabinete_base("B04", ancho=600, entrepanos=1,
                                  material=CASCO, material_frente=FRENTE))
    print(h.agregar_cajonera("B05", ancho=600, altos_frentes=[266, 266, 268],
                             material=CASCO, material_frente=FRENTE))
    for mid in ("A04", "A05"):
        print(h.agregar_alacena(mid, ancho=600, alto=750, entrepanos=1,
                                led=True, material=CASCO,
                                material_frente=FRENTE))

    # ── jaladeras de moño en TODOS los frentes ───────────────────────
    for mid in ("T01", "B01", "B02", "B03", "B04", "B05",
                "A01", "A02", "A03", "A04", "A05"):
        print(h.agregar_jaladeras(mid, silueta="bow"))

    # ── tramos: cada corrida sabe en qué muro va y dónde arranca ─────
    print(h.agregar_tramo("TA0", muro="A", modulos=["T01"],
                          lleva_cubierta=False))
    print(h.agregar_tramo("TA1", muro="A", modulos=["B01", "B02", "B03"],
                          desplazamiento=600, recortes=["tarja"]))
    print(h.agregar_tramo("TA2", muro="A", modulos=["A01", "A02", "A03"],
                          lleva_cubierta=False, desplazamiento=600))

    print(h.agregar_tramo("TB1", muro="B", modulos=["B04", "B05"],
                          retorno_de="TA1"))
    print(h.agregar_tramo("TB2", muro="B", modulos=["A04", "A05"],
                          lleva_cubierta=False, retorno_de="TA1"))

    print(h.calcular_led(temperatura_k=3000, control="dimmer"))
    print(h.agregar_nota(
        "Cocina en L: el muro B apoya contra el extremo del muro A con filler "
        "de esquina de 50mm. Montar SIEMPRE el muro A completo primero y "
        "arrancar el retorno desde el filler, nunca al revés."))
    print(h.agregar_nota(
        "Jaladera de moño: es pieza comprada. Perforar los frentes ANTES de "
        "lacar; una perforación después del lacado se cuartea."))
    print(h.estado_actual())
    return h.finalizar()


if __name__ == "__main__":
    data = construir()
    destino = os.path.join(AQUI, "project.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\nOK → {destino}")
