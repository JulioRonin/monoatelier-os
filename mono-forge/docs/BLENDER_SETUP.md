# Conexión funcional con Blender — paso a paso

El principio no cambia nunca: **el modelo de datos es la fuente de verdad, Blender es el visor.**
El flujo es: parámetros → generador Python → `project.json` (con colocación 3D) → Blender construye desde el JSON.

## 0. Requisitos

| Qué | Versión | Notas |
|---|---|---|
| Python | ≥ 3.11 | para el motor mono-forge |
| Blender | 4.x (recomendado 4.2 LTS+) | trae glTF y USD integrados |
| uv (opcional) | último | sólo para el modo interactivo MCP |

Instala Blender desde <https://www.blender.org/download/> y verifica que quede en el PATH:

```bash
blender --version
```

En macOS, si no está en PATH:
```bash
echo 'alias blender="/Applications/Blender.app/Contents/MacOS/Blender"' >> ~/.zshrc
```

## 1. Instalar el motor

```bash
cd mono-forge
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest -q        # 24 tests: la red de seguridad de medidas debe pasar SIEMPRE
```

## 2. Generar un proyecto (la fuente de verdad)

```bash
python -m mono_forge.cli BASE-600 BASE-TARJA-1240 SUP-750 --cliente "Familia Pérez" --out projects/cocina-perez
```

Esto imprime el cutlist + herrajes en consola y escribe
`projects/cocina-perez/project.json` **con la colocación 3D ya derivada**
(`mono_forge/rules/posicion.py` la calcula por `rol_estructural`:
la base corre a todo el ancho, el lateral de 785 descansa sobre ella, etc.).

Presets disponibles: `BASE-600`, `BASE-TARJA-1240`, `BASE-TARJA-1300`, `SUP-750`, `TORRE-HORNO`, `TORRE-MICRO`.

## 3. Construir en Blender (producción, headless)

```bash
blender --background --python blender/build_from_json.py -- projects/cocina-perez/project.json
```

Salidas en `projects/cocina-perez/deliverables/`:

| Archivo | Para qué |
|---|---|
| `modelo.blend` | trabajo interno, renders con `blender/render_presets.py` |
| `preview.glb` | visor web de la plataforma + AR en Android |
| `preview.usdz` | AR en iOS (Quick Look) — si tu build de Blender trae USD |

Cada panel es un objeto mesh independiente con el MISMO nombre del JSON
(ej. `M01_lateral_1`), agrupado en una colección por módulo — crítico para
vistas explotadas y anotaciones del manual de ensamble.

## 4. Modo interactivo (MCP) — iterar vistas y materiales con Claude

```bash
claude mcp add blender -- uvx blender-mcp
```

Luego abre Blender con el addon de blender-mcp activo y podrás pedirle a Claude
cosas como "abre el modelo de cocina-perez y muéstrame la vista frontal 3/4".
Reglas de la casa:

- Los renders SIEMPRE usan `blender/render_presets.py` — nunca inventes iluminación.
- Antes de cualquier propuesta visual, leer `style/mono_atelier_style.md`.
- PROHIBIDO derivar medidas midiendo mallas: si una medida no cuadra, el error
  está en los parámetros o en el generador, nunca se corrige "a ojo" en Blender.

## 5. Publicar a la plataforma (visor web + AR)

Con el diseño construido, súbelo a Mono Atelier OS:

```bash
export SUPABASE_URL="https://<tu-proyecto>.supabase.co"
export SUPABASE_KEY="<service_role_key>"
python -m mono_forge.publish projects/cocina-perez --name "Cocina Pérez"
```

O sin terminal: entra a **Forge** en la plataforma → *Importar project.json* →
*Publicar en AR* (el navegador genera el GLB/USDZ por ti).

## Problemas frecuentes

- **`preview.usdz` no se generó** → tu build de Blender no trae USD. No pasa nada:
  la plataforma genera el USDZ en el navegador al *Publicar en AR*.
- **Paneles apilados en columna** → el JSON no trae `colocacion` (fue generado con
  una versión vieja del motor). Regenera con `python -m mono_forge.cli ... --out ...`.
- **El modelo se ve gigante/minúsculo en AR** → el GLB va en metros (escala real).
  Nunca reescales el export; si algo mide mal, el error está en los parámetros.
