"""manual_ensamble.pdf — el documento del CARPINTERO.

Cada paso lleva su POR QUÉ (panel.justificacion). Un manual que sólo dice
"atornille aquí" se ejecuta mal el día que la pieza no cuadra; uno que explica
que el lateral DESCANSA sobre la base se ejecuta bien siempre.
"""

from __future__ import annotations

import os

from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer

from ..constants import (
    CAZOLETA_CENTRO, CAZOLETA_D, HOJA_ANCHO, HOJA_LARGO, KERF,
    SISTEMA32_PASO, SISTEMA32_RETRANQUEO, ZOCLO_RETRANQUEO,
)
from ..cutlist import nesting
from ..models import Module, Project
from .estilo import A4, MARGEN, encabezado, estilos, marca, tabla
from .planos import Despiece, HojaNesting, Plano

ANCHO_UTIL = A4[0] - 2 * MARGEN


def _por_rol(m: Module, *roles: str):
    return [p for p in m.panels if p.rol_estructural in roles]


def pasos_de(m: Module) -> list[tuple[str, str, str]]:
    """(título del paso, instrucción, por qué). Derivados del rol estructural."""
    pasos: list[tuple[str, str, str]] = []
    apoyado = m.tipo in ("base", "base_tarja", "torre")

    base = _por_rol(m, "base_portante")
    lat_ap = _por_rol(m, "lateral_apoyado")
    lat_col = _por_rol(m, "lateral_portante")
    refuerzos = _por_rol(m, "refuerzo")
    capturados = _por_rol(m, "capturado")
    riel = _por_rol(m, "riel_colgador")
    divisor = _por_rol(m, "divisor")
    entrepanos = _por_rol(m, "entrepano_movil", "entrepano_fijo")
    fondo = _por_rol(m, "fondo")
    zoclo = _por_rol(m, "zoclo")
    frentes = _por_rol(m, "frente")
    lat_caja = _por_rol(m, "lateral_caja")

    pasos.append((
        "Verificar el corte",
        "Contrasta cada pieza contra el cutlist ANTES de perforar. Revisa que el "
        "cubrecanto esté aplicado sólo en los lados indicados por pieza.",
        "Un canto de más no se quita: se rehace la pieza."))

    if apoyado and base and lat_ap:
        b, l = base[0], lat_ap[0]
        pasos.append((
            "Apoyar los laterales SOBRE la base",
            f"Coloca la base ({b.largo:.0f}×{b.ancho:.0f}) en el banco y monta los "
            f"laterales ({l.largo:.0f} de alto) ENCIMA de ella, a ras de los "
            f"extremos. Atornilla desde ABAJO, a través de la base hacia el canto "
            f"del lateral.",
            l.justificacion or "La carga baja por los laterales y entra a la base en "
                               "compresión pura. El tornillo sólo alinea."))
    if lat_col and capturados:
        pasos.append((
            "Capturar techo y piso entre los laterales",
            "Con los laterales de altura completa parados, inserta el piso y el "
            "techo ENTRE ellos y atornilla por la cara exterior del lateral.",
            capturados[0].justificacion or "El mueble cuelga: así el tornillo trabaja "
                                           "a cortante, no a extracción en canto."))
    if divisor:
        pasos.append((
            "Montar el divisor central",
            f"Centra el divisor ({divisor[0].largo:.0f}mm) y fíjalo arriba y abajo.",
            divisor[0].justificacion or "Sin divisor la base y los refuerzos flechan."))
    if refuerzos:
        nombres = ", ".join(p.name.split("_", 1)[-1] for p in refuerzos)
        pasos.append((
            "Colocar los refuerzos",
            f"Instala {nombres}. Van entre laterales, a hueso con los cantos.",
            "Rigidizan contra el paralelogramo y dan dónde atornillar la cubierta."))
    if riel:
        pasos.append((
            "Instalar el riel colgador",
            f"Fija el riel de {riel[0].ancho:.0f}mm en la parte posterior superior.",
            riel[0].justificacion or "AQUÍ van los tornillos de fijación al muro."))
    if lat_caja:
        c = lat_caja[0]
        pasos.append((
            "Armar la caja del cajón",
            f"Los laterales corren completos ({c.largo:.0f}mm = largo de corredera) y "
            f"CAPTURAN al frente de caja y a la trasera.",
            c.justificacion or "La corredera se atornilla al lateral en toda su "
                               "longitud: si el frente capturara, no montaría."))
    if entrepanos:
        fijos = [p for p in entrepanos if p.rol_estructural == "entrepano_fijo"]
        pasos.append((
            "Entrepaños",
            f"Perfora el sistema 32 a {SISTEMA32_RETRANQUEO}mm del canto frontal con "
            f"paso de {SISTEMA32_PASO}mm." +
            (" Los entrepaños de nicho van FIJOS, atornillados." if fijos else
             " Montar sobre soportes."),
            "Los entrepaños fijos cargan el electrodoméstico: móviles no aguantan."))
    if fondo:
        pasos.append((
            "Escuadrar con el fondo",
            "Mide las DIAGONALES del mueble y ajústalas hasta que sean iguales. "
            "Sólo entonces atornilla el fondo de 3mm aplicado sobre el canto trasero.",
            fondo[0].justificacion or "El fondo es la pieza que escuadra el mueble. "
                                      "Si lo fijas torcido, el mueble queda torcido."))
    if zoclo:
        pasos.append((
            "Zoclo",
            f"Coloca el zoclo retranqueado {ZOCLO_RETRANQUEO}mm respecto del frente. "
            "Es pieza independiente: se monta al final, después de nivelar.",
            "Retranquearlo da la sombra que define la línea Mono Atelier."))
    if frentes:
        f = frentes[0]
        pasos.append((
            "Frentes",
            f"Cazoleta Ø{CAZOLETA_D:.0f}mm con centro a {CAZOLETA_CENTRO}mm del canto. "
            f"Puerta de {f.largo:.0f}×{f.ancho:.0f}mm. Ajusta las bisagras en los tres "
            f"ejes hasta igualar las juntas.",
            f.justificacion or "El tipo de bisagra lo definió la modulación y "
                               "determina el ancho de la puerta."))
    pasos.append((
        "Nivelar e instalar",
        "Nivela con las patas ANTES de fijar al muro o de montar la cubierta. "
        "Verifica que los frentes cierren parejos.",
        "Un mueble desnivelado desalinea todas las juntas del tramo."))
    return pasos


def manual_pdf(project: Project, destino: str) -> str:
    st = estilos()
    ruta = os.path.join(destino, "manual_ensamble.pdf")
    doc = SimpleDocTemplate(ruta, pagesize=A4, leftMargin=MARGEN, rightMargin=MARGEN,
                            topMargin=MARGEN + 10 * mm, bottomMargin=MARGEN + 6 * mm,
                            title=f"Manual de ensamble — {project.nombre}",
                            author="Mono Atelier")
    doc._mono_subtitulo = "MANUAL DE ENSAMBLE"

    fl = encabezado("Manual de ensamble",
                    f"TALLER · {project.nombre} · {project.cliente}", st)

    fl.append(Paragraph("La regla que define todo", st["h2"]))
    fl.append(Paragraph(
        "<b>El tornillo nunca carga el peso; el tablero sí. El tornillo sólo alinea.</b>",
        st["cuerpo"]))
    fl.append(Paragraph(
        "Mueble apoyado (inferior y torre): la base corre a todo el ancho y los "
        "laterales DESCANSAN sobre ella. Mueble colgado (alacena): los laterales "
        "corren completos y el techo y el piso van CAPTURADOS entre ellos.",
        st["cuerpo"]))
    fl.append(Paragraph(
        "Mnemotecnia: colgado → horizontales entre laterales | apoyado → lateral "
        "sobre base.", st["porque"]))

    fl.append(Paragraph("Antes de empezar", st["h2"]))
    for n in [
        f"Todas las medidas en milímetros. Hoja {HOJA_LARGO}×{HOJA_ANCHO}, "
        f"sierra de {KERF}mm.",
        "Veta vertical en puertas, laterales y divisores.",
        "El cubrecanto va lado por lado según el cutlist. Nunca 'todos los cantos'.",
        "Perfora TODO antes de armar: con el mueble cerrado ya no entra el taladro.",
    ]:
        fl.append(Paragraph(f"— {n}", st["cuerpo"]))

    paneles_pos = [p for p in project.all_panels() if p.colocacion]
    if paneles_pos:
        fl.append(Paragraph("Conjunto", st["h2"]))
        fl.append(Plano(paneles_pos, "frontal", ANCHO_UTIL, 75 * mm,
                        titulo="alzado frontal"))
        fl.append(Spacer(1, 6))
        fl.append(Plano(paneles_pos, "planta", ANCHO_UTIL, 55 * mm,
                        titulo="planta"))

    # ── Un capítulo por módulo ──────────────────────────────────────
    for m in project.modules:
        fl.append(PageBreak())
        fl.append(Paragraph(f"MÓDULO {m.id} · {m.tipo.replace('_', ' ').upper()}",
                            st["kicker"]))
        fl.append(Paragraph(
            f"{m.ancho:.0f} × {m.alto:.0f} × {m.prof:.0f} mm", st["titulo"]))
        fl.append(Spacer(1, 8))

        if any(p.colocacion for p in m.panels):
            fl.append(Plano([p for p in m.panels if p.colocacion], "frontal",
                            ANCHO_UTIL, 62 * mm, titulo=f"{m.id} · alzado"))
            fl.append(Spacer(1, 6))

        # el título viaja con el dibujo: si no cabe, saltan juntos de página
        fl.append(KeepTogether([
            Paragraph("Despiece", st["h2"]),
            Paragraph("La línea gruesa marca los lados con cubrecanto.", st["nota"]),
            Despiece([q for q in m.panels if not q.accesorio], ANCHO_UTIL),
            Spacer(1, 8),
        ]))

        filas = [["Pieza", "Cant", "Largo", "Ancho", "Esp", "Cantos", "Veta"]]
        for p in m.panels:
            if p.accesorio:
                continue
            lados = ", ".join(k for k, v in p.cantos.items() if v) or "—"
            filas.append([p.name.split("_", 1)[-1], str(int(p.cantidad)),
                          f"{p.largo:.0f}", f"{p.ancho:.0f}", f"{p.espesor:.0f}",
                          lados, p.veta])
        fl.append(tabla(filas, [ANCHO_UTIL * 0.26, ANCHO_UTIL * 0.07,
                                ANCHO_UTIL * 0.10, ANCHO_UTIL * 0.10,
                                ANCHO_UTIL * 0.08, ANCHO_UTIL * 0.27,
                                ANCHO_UTIL * 0.12], tam=7))

        fl.append(Paragraph("Secuencia de ensamble", st["h2"]))
        for i, (titulo, instruccion, porque) in enumerate(pasos_de(m), start=1):
            fl.append(KeepTogether([
                Paragraph(f"{i}. {titulo}", st["h3"]),
                Paragraph(instruccion, st["cuerpo"]),
                Paragraph(f"Por qué: {porque}", st["porque"]),
            ]))

        if m.hardware:
            fl.append(Paragraph("Herraje de este módulo", st["h2"]))
            fl.append(tabla(
                [["SKU", "Descripción", "Cant", "Unidad"]] +
                [[h.sku, h.descripcion, f"{h.cantidad:g}", h.unidad] for h in m.hardware],
                [ANCHO_UTIL * 0.18, ANCHO_UTIL * 0.58, ANCHO_UTIL * 0.12,
                 ANCHO_UTIL * 0.12], tam=7.5))

        perforaciones = [(p, d) for p in m.panels for d in p.drilling]
        if perforaciones:
            fl.append(Paragraph("Perforaciones", st["h2"]))
            fl.append(tabla(
                [["Pieza", "Tipo", "Ø", "X", "Y", "Prof", "Cara"]] +
                [[p.name.split("_", 1)[-1], d.tipo, f"{d.diametro:g}", f"{d.x:g}",
                  f"{d.y:g}", f"{d.profundidad:g}", d.cara]
                 for p, d in perforaciones],
                [ANCHO_UTIL * 0.24, ANCHO_UTIL * 0.16, ANCHO_UTIL * 0.09,
                 ANCHO_UTIL * 0.13, ANCHO_UTIL * 0.13, ANCHO_UTIL * 0.12,
                 ANCHO_UTIL * 0.13], tam=7))

        if m.notas:
            fl.append(Paragraph("Notas del módulo", st["h2"]))
            for n in m.notas:
                fl.append(Paragraph(f"— {n}", st["cuerpo"]))

    # ── Tramos (cubierta) ───────────────────────────────────────────
    for t in project.tramos:
        if not t.panels:
            continue
        fl.append(PageBreak())
        fl.append(Paragraph(f"TRAMO {t.id} · MURO {t.muro}", st["kicker"]))
        fl.append(Paragraph("Cubierta", st["titulo"]))
        fl.append(Spacer(1, 8))
        fl.append(tabla(
            [["Pieza", "Cant", "Largo", "Ancho", "Esp", "Material"]] +
            [[p.name.split("_", 1)[-1], str(int(p.cantidad)), f"{p.largo:.0f}",
              f"{p.ancho:.0f}", f"{p.espesor:.0f}", p.material] for p in t.panels],
            [ANCHO_UTIL * 0.24, ANCHO_UTIL * 0.10, ANCHO_UTIL * 0.14,
             ANCHO_UTIL * 0.14, ANCHO_UTIL * 0.10, ANCHO_UTIL * 0.28], tam=7.5))
        for n in t.notas:
            fl.append(Paragraph(f"— {n}", st["cuerpo"]))

    # ── Plan de corte ───────────────────────────────────────────────
    fl.append(PageBreak())
    fl.append(Paragraph("PLAN DE CORTE", st["kicker"]))
    fl.append(Paragraph("Acomodo por hoja", st["titulo"]))
    fl.append(Paragraph(
        f"Cada pieza está inflada por el kerf de {KERF}mm: el acomodo es ejecutable "
        f"tal cual en la sierra.", st["nota"]))
    fl.append(Spacer(1, 6))
    for material, hojas in nesting(project.piezas_de_corte()).items():
        for h in hojas:
            fl.append(KeepTogether([
                Paragraph(f"{material} — hoja {h.indice + 1} de {len(hojas)} "
                          f"· aprovechamiento {h.aprovechamiento*100:.1f}%", st["h3"]),
                HojaNesting(h, HOJA_LARGO, HOJA_ANCHO, ANCHO_UTIL),
                Spacer(1, 8),
            ]))

    doc.build(fl, onFirstPage=marca, onLaterPages=marca)
    return ruta
