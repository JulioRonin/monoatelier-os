# Renders — del project.json a la imagen

Los renders **siempre** pasan por `blender/render_presets.py`. Nunca se
improvisa iluminación: el lenguaje visual vive en `style/mono_atelier_style.md`
y se traduce ahí a luces, materiales y encuadres.

## Correr un render

En Windows usa el atajo — encuentra Blender solo y no hay rutas que teclear:

```powershell
cd <ruta-del-repo>\mono-forge
.\forge.ps1 render projects\cocina-sage
```

El comando equivalente a mano (sustituye la ruta REAL de tu blender.exe;
`.\forge.ps1 blender` te la imprime):

```powershell
& "C:\Program Files\Blender Foundation\Blender 4.2\blender.exe" --background `
  --python blender\render.py -- projects\cocina-sage\project.json
```

Salen en `projects/cocina-sage/deliverables/renders/`. Después regenera los
documentos para que `entrega.pdf` los incluya:

```powershell
python -m mono_forge.docs projects\cocina-sage
```

## Banderas

| Bandera | Default | Qué hace |
|---|---|---|
| `--escena` | `cocina` | `cocina`, `estudio` o `noche` |
| `--vistas` | `frontal_34,frontal,detalle` | lista separada por comas |
| `--muestras` | `128` | muestras de Cycles. 64 para previsualizar, 256–512 para entregar |
| `--res` | `1920x1080` | resolución |
| `--salida` | `<proyecto>/deliverables/renders` | carpeta destino |

## Escenas

| Escena | Para qué | Luz |
|---|---|---|
| `cocina` | La entrega normal. Muro de estuco crudo, piso de microcemento | Ventana lateral 4200K + cove indirecto 2900K en el plafón |
| `estudio` | Piezas sueltas sobre fondo neutro, sin esquinas | Luz difusa 5000K, mucho relleno |
| `noche` | Vender la iluminación del mueble | Ambiente mínimo; protagonizan el LED y el cove |

## Vistas

Los encuadres son **relativos**, no coordenadas fijas: se calculan desde el
bounding box del proyecto, así que el mismo preset encuadra bien un mueble de
600mm y una cocina de 4m. Hay un test que lo verifica.

| Vista | Lente | Para qué |
|---|---|---|
| `frontal` | 50mm | Alzado limpio, poca deformación |
| `frontal_34` | 35mm | La imagen principal — tres cuartos, ligero picado |
| `lateral` | 35mm | Lee la profundidad y el zoclo retranqueado |
| `detalle` | 85mm | Acercamiento a la junta de frentes y el canto |
| `cenital` | 35mm | Planta en perspectiva, útil para distribución |

## Cómo se ilumina

Tres capas, en el orden en que importan:

1. **Ventana lateral** — un área grande y suave. Es la que da la dirección y
   las sombras largas de la referencia. Su tamaño y potencia escalan con el
   ancho del proyecto.
2. **Cove indirecto** — una tira contra el plafón, apuntando hacia arriba.
   Nunca spots puntuales: eso es lo que separa el look cálido del look de
   catálogo de ferretería.
3. **LED de mueble** — se deriva de los módulos con `led=True` en el JSON.
   Si un módulo lleva LED en el presupuesto, se ve encendido en el render.
   Es el mismo dato, no una decisión aparte.

## Materiales

`build_from_json` asigna materiales **planos** (los que viajan al GLB para AR,
donde las texturas procedurales no existen). Al renderizar, `materiales_render()`
los sustituye por versiones procedurales:

| SKU | Se convierte en |
|---|---|
| `MEL-ROBLE-NAT-15`, `ROBLE-CLARO` | Roble con veta **vertical** (bandas en X + distorsión) y bump suave |
| `MEL-BLA-19-CUB`, `GRANITO-OSCURO` | Piedra oscura con vetas blancas finas (Voronoi distance-to-edge) |
| `LAC-VERDE-SAGE-15` | Lacado satinado |
| `BRI-BLA-19-ARA` | Alto brillo |

Un SKU que no esté en `RECETAS` conserva su color plano — sale correcto, sólo
sin textura. Para agregar uno nuevo, mete su receta en `RECETAS` y su color
plano en `materials.py` **y** en `lib/forge3d.ts` (el visor web), o el 3D de la
plataforma no coincidirá con el render.

## Tiempos

Con GPU (se activa sola si hay OPTIX/CUDA/HIP/METAL disponible) una vista a
128 muestras y 1920×1080 tarda del orden de minutos. Sin GPU, bastante más:
usa `--muestras 64` para iterar y sube sólo para la entrega final.

## Ver el modelo con tus propios ojos

`--background` significa **sin interfaz**: Blender corre invisible, escribe los
archivos y se cierra. Es lo correcto para producción, pero no ves nada moverse.
Para abrir el modelo y girarlo:

```powershell
.\forge.ps1 ver projects\cocina-sage
```

Eso abre `deliverables\modelo.blend` en la interfaz de Blender. Si aún no
existe, lo construye primero.

## Problemas frecuentes

- **`El término 'C:\Program Files\...\blender.exe' no se reconoce`** → copiaste
  una ruta abreviada con puntos suspensivos. Usa `.\forge.ps1`, o corre
  `.\forge.ps1 blender` para ver la ruta real de tu instalación.
- **`could not be opened: No such file or directory`** → estás corriendo desde
  otra carpeta. Haz `cd` a `mono-forge` primero, o pasa la ruta completa del
  script.
- **"El project.json no trae colocación 3D"** → el JSON es de una versión vieja
  del motor. Regenéralo.
- **Todo sale plano o quemado** → tu build de Blender no tiene AgX y cayó a
  Standard. Ajusta `exposicion` en la escena de `render_presets.py`.
- **Sale muy oscuro** → usa `--escena cocina` (la escena `noche` es
  deliberadamente oscura para lucir el LED).
