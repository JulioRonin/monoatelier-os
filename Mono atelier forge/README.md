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
    herrajes.py    ← bisagras recta/semicurva/curva, correderas, patas.
    apertura.py    ← jaladera / gola (aluminio o tablero) / push.
    led.py         ← tira, fuente y notas de ruteo.
  generators/      ← base, superior, cajonera, torre, cubierta.
  cutlist.py       ← nesting CON KERF. Sin kerf el taller no puede ejecutarlo.
  costing.py       ← dos tarifas de canto; el margen nunca sale en documentos.
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

## Pendiente (fases siguientes)

- [ ] Posicionamiento real en Blender por `rol_estructural`
- [ ] Vistas explotadas + planos con cotas (SVG)
- [ ] cutlist.xlsx, cotizacion.pdf, manual_ensamble.pdf, entrega.pdf
- [ ] Integración con la plataforma (jobs + storage + visor glb)
