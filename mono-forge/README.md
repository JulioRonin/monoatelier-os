# Mono Forge

Motor de diseño paramétrico de muebles de Mono Atelier: de una especificación salen el
modelo 3D con medidas reales, la lista de corte optimizada, los herrajes, los costos, la
cotización, el manual de ensamble y el documento de entrega.

## Principio

> **El modelo de datos es la fuente de verdad. Blender es el visor.**
> Los documentos se generan del JSON, nunca midiendo mallas.

## Arranque

```bash
git clone <tu-repo> mono-forge && cd mono-forge
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q
python -m mono_forge.cli BASE-600
python -m mono_forge.cli BASE-TARJA-1240 SUP-750
```

## Blender

```bash
# interactivo (MCP)
claude mcp add blender -- uvx blender-mcp

# producción (headless)
blender --background --python blender/build_from_json.py -- projects/x/project.json
```

## Estructura

```
mono_forge/
  constants.py     ← constantes calibradas del taller. Nada de números mágicos.
  models.py        ← Project / Module / Panel / HardwareItem. La fuente de verdad.
  rules/
    estructura.py  ← LA regla: el tornillo no carga el peso, el tablero sí.
    posicion.py    ← colocación 3D derivada por rol_estructural (va al JSON).
    herrajes.py    ← bisagras recta/semicurva/curva, correderas, patas.
    apertura.py    ← jaladera / gola (aluminio o tablero) / push.
    led.py         ← tira, fuente y notas de ruteo.
  generators/      ← base, superior, cajonera, torre, cubierta.
  cutlist.py       ← nesting CON KERF. Sin kerf el taller no puede ejecutarlo.
  costing.py       ← dos tarifas de canto; el margen nunca sale en documentos.
  publish.py       ← sube project.json + GLB/USDZ a la plataforma (bucket 'forge').
  docs/            ← cutlist.xlsx, herrajes.xlsx, cotización, manual, entrega, costos.
catalog/           ← materiales, herrajes, golas. Los precios viven aquí, no en el código.
style/             ← manifiesto de estilo Mono Atelier (LLENAR).
blender/           ← build_from_json, materiales, presets de render.
tests/             ← red de seguridad de medidas.
```

## Reglas que el código codifica

| Regla | Dónde |
|---|---|
| Inferior: el lateral descansa sobre la base (100+15+785=900) | `rules/estructura.casco_apoyado` |
| Superior: techo y piso capturados entre laterales | `rules/estructura.casco_colgado` |
| Cajón: laterales completos = largo de corredera | `generators/cajonera` |
| Corredera estándar 500 | `constants.seleccionar_corredera` |
| Cubrecanto pieza por pieza, nunca en bloque | `models.Panel.cantos` |
| Kerf de 4mm inflando cada pieza | `cutlist.nesting` |
| Gola por tramo, medidas desde catálogo | `rules/apertura` |

## AR — ver los diseños desde el teléfono

Todo diseño publicado se puede colocar a ESCALA REAL con la cámara del
teléfono (Android: Scene Viewer / iOS: Quick Look). Paso a paso en
`docs/AR_GUIDE.md`; conexión con Blender en `docs/BLENDER_SETUP.md`.

```bash
python -m mono_forge.cli BASE-600 SUP-750 --out projects/x   # genera project.json + colocación 3D
python -m mono_forge.publish projects/x --name "Cocina X"    # sube a la plataforma → QR / link AR
```

## Entregables

```bash
python -m mono_forge.docs projects/x --margen 0.35 --canto-maquina 12 \
       --canto-manual 45 --mano-obra 850
```

Genera cutlist.xlsx, herrajes.xlsx, manual_ensamble.pdf, cotizacion.pdf,
entrega.pdf y costos_internos.pdf, y corre la verificación de consistencia.
El margen vive SÓLO en el reporte interno. Detalle en `docs/ENTREGABLES.md`.

## Pendiente (fases siguientes)

- [x] Posicionamiento real por `rol_estructural` (`rules/posicion.py` → colocación en el JSON)
- [x] Integración con la plataforma (módulo Forge: storage + visor 3D + AR)
- [x] Vistas y planos con cotas (alzado, planta, despiece, plan de corte)
- [x] cutlist.xlsx, herrajes.xlsx, cotizacion.pdf, manual_ensamble.pdf, entrega.pdf
- [x] Reporte interno de costos con simulación por proveedor
- [ ] Renders hiperrealistas por escena (atmósferas) desde render_presets.py
- [ ] Diseño por prompts desde la plataforma (Forge Agent)
