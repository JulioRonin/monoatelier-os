# Entregables — del project.json al paquete completo

Todo sale del `project.json`. Ningún documento mide mallas ni reescribe medidas:
si un número no cuadra, el error está en los parámetros o en una regla.

## Generar el paquete

```bash
python -m mono_forge.docs projects/cocina-perez \
    --margen 0.35 --canto-maquina 12 --canto-manual 45 --mano-obra 850
```

Las tarifas son **tuyas** y cambian el costo real. Si las omites salen en cero y
el documento de costos te lo advierte en rojo.

| Bandera | Qué es |
|---|---|
| `--margen` | fracción, no porcentaje (0.35 = 35%). Default 0.35 |
| `--canto-maquina` | costo por metro lineal de cubrecanto a máquina |
| `--canto-manual` | costo por ml a mano — el alto brillo SIEMPRE usa esta tarifa |
| `--mano-obra` | costo de mano de obra por módulo |
| `--ar-url` | link AR que se imprime en el documento de entrega |

## Qué se genera en `<proyecto>/deliverables/`

| Archivo | Para quién | Contiene |
|---|---|---|
| `cutlist.xlsx` | taller | piezas, cubrecanto lado por lado, perforaciones, nesting con kerf, resumen de hojas |
| `herrajes.xlsx` | compras | consolidado por SKU con precios de catálogo y nota de bisagras |
| `manual_ensamble.pdf` | carpintero | alzado y planta, despiece acotado por módulo, secuencia de ensamble **con el por qué**, herraje por módulo, perforaciones y plan de corte hoja por hoja |
| `cotizacion.pdf` | cliente | partidas prorrateadas, precio final, incluye/no incluye, condiciones y firmas |
| `entrega.pdf` | cliente | renders (si existen), specs, link AR, garantía, cuidados y firma de recepción |
| `costos_internos.pdf` | **sólo tú** | desglose de costo directo, margen, utilidad y simulación por proveedor |

Más `modelo.blend` y `preview.glb`, que los produce Blender
(ver `docs/BLENDER_SETUP.md`).

## La regla del margen

El margen y el costo directo viven **únicamente** en `costos_internos.pdf`.
Hay un test (`test_el_margen_nunca_sale_en_documentos_de_cliente`) que abre la
cotización y el documento de entrega en binario y falla si encuentra rastro de
esa información. No es una convención: es una red.

## Verificación automática

Al terminar, el CLI corre la verificación que exige `CLAUDE.md`:

- área del cutlist ≈ área de paneles del JSON (±1%)
- bisagras declaradas == puertas × regla de altura
- suma vertical de torres cuadrada (zoclo + base + lateral = alto total)
- existencia de los 8 archivos del paquete

Cualquier discrepancia se imprime con `!`. Un paquete que reporta problemas
**no se entrega**.

## Precios del catálogo

El costeo lee `catalog/materiales.csv` (columna `costo_m2`) y
`catalog/herrajes.csv` (`costo_unit`). Hoy sólo están completas las tres
melaminas de 15mm; todo lo demás sale listado como "hueco de catálogo" en el
reporte interno y el costo real es **mayor** que el mostrado.

Completa esas dos columnas antes de comprometer un precio con un cliente.

## Simulación por proveedor

`costos_internos.pdf` compara el precio resultante cambiando de proveedor.
La sustitución es real: busca el mismo tablero (misma descripción y espesor) en
la otra marca y usa su precio. Un proveedor que no puede surtir ningún tablero
del proyecto no aparece en la tabla — no es una alternativa, es un hueco de datos.

## Flujo completo

```bash
python -m mono_forge.cli BASE-600 SUP-750 --cliente "Pérez" --out projects/perez
blender --background --python blender/build_from_json.py -- projects/perez/project.json
python -m mono_forge.docs projects/perez --margen 0.35 --canto-maquina 12 \
       --canto-manual 45 --mano-obra 850
python -m mono_forge.publish projects/perez --name "Cocina Pérez"
```

---

## Los entregables en la plataforma

Cuando el diseño nace de un prompt en Forge, el worker sube los entregables al
bucket `forge` y **guarda sus URLs** en `forge_models.documentos`. La página de
Forge los muestra como descargas junto al visor 3D.

Requiere la migración `supabase/migrations/20260807_forge_documentos.sql`.

Antes de esa migración las URLs se calculaban y se tiraban: los archivos
llegaban al bucket pero la plataforma no tenía cómo encontrarlos. Los diseños
generados antes no tienen `documentos`; vuelve a lanzar el prompt para
registrarlos.

### costos_internos.pdf va aparte

Es el único documento con el margen y el costo directo, así que **no** viaja
con los demás:

- Los entregables de cliente van al bucket **público** `forge`. Cualquiera con
  el link los abre — que es justo lo que quieres para mandarle la cotización a
  un cliente por WhatsApp.
- `costos_internos.pdf` va al bucket **privado** `forge-interno`, y sólo si
  defines `FORGE_SUBIR_COSTOS=1`. Viene apagado.
- En la plataforma se abre con una URL firmada de 5 minutos
  (`api.firmarCostosInternos`). No hay URL permanente que se pueda reenviar
  por accidente.

Mientras la plataforma no tenga login, la puerta real es el acceso a tu app,
no el bucket. Está escrito con detalle al final de la migración.
