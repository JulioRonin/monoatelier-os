# MONO FORGE — Motor de diseño paramétrico de Mono Atelier

## Qué es esto
Sistema que convierte especificaciones de muebles en: modelo 3D con medidas reales,
cutlist optimizada, lista de herrajes, costos, cotización, manual de ensamble y
documento de entrega.

## Regla de oro
EL MODELO DE DATOS ES LA FUENTE DE VERDAD. Nunca modeles "a ojo" en Blender.
Flujo obligatorio: parámetros → generador Python → project.json → Blender construye
desde el JSON → los documentos se generan desde el JSON.
PROHIBIDO derivar medidas midiendo mallas de Blender.

## Unidades y convenciones
- TODO en milímetros. Blender scene: unit_scale=0.001, length_unit='MILLIMETERS'.
- Hoja 2440×1220. KERF = 4mm.
- Nomenclatura de paneles: {modulo}_{pieza} (ej. B01_lateral).
- Veta vertical en puertas, laterales y divisores.
- Sistema 32: perforaciones a 37mm del canto frontal, paso 32mm.

## REGLA ESTRUCTURAL (la que define a Mono Atelier)
El tornillo nunca carga el peso; el tablero sí. El tornillo sólo alinea.

- MUEBLE INFERIOR / TORRE (apoyado): la base corre a TODO el ancho exterior y los
  laterales DESCANSAN sobre ella. alto_lateral = alto_cuerpo − T.
  Verificación: 100 (zoclo) + 15 (base) + 785 (lateral) = 900 ✓
  Ese 785 sólo existe si el lateral se apoya. Si alguien lo captura, sería 800.
- MUEBLE SUPERIOR (colgado): los laterales corren a altura COMPLETA; techo y piso van
  CAPTURADOS entre ellos (largo = ancho − 2T). El tornillo trabaja a cortante, no a
  extracción en canto de aglomerado.
- Mnemotecnia: colgado → horizontales entre laterales | apoyado → lateral sobre base.

## Refuerzos (siempre)
- Inferiores: refuerzo superior frente + superior trasero + posterior inferior.
  Largo = ancho − 2T, tira de 100mm (80mm en módulo de tarja, para librar el tazón).
- Superiores: riel colgador posterior superior de 120mm — ahí van los tornillos al muro.
- Divisor central OBLIGATORIO si ancho > 900mm.

## Constantes calibradas (ver mono_forge/constants.py — no duplicar aquí)
- T=15 | frentes 15 o 19 | alto brillo 19 SIEMPRE con cintilla PVC a MANO | fondos 3mm
- Base: total 900 = zoclo 100 + base 15 + lateral 785 (DERIVADO). Prof 600. Zoclo retranqueo 60.
- Superior: prof 350–400, alturas 700/750/800 (default 750). Laterales completos.
- Torre: 2100–2200, prof 600, lateral = alto − 100 − 15. Laterales de UNA pieza.
  Nichos con entrepaño FIJO. Validar que la suma vertical cuadre.
- Corredera estándar 500 SIEMPRE (no subir a 550 aunque el módulo dé).
- Fondo 3mm APLICADO sobre el canto trasero, cubre los refuerzos y ESCUADRA el mueble.

## Cajones — ensamble limpio
- Los LATERALES corren completos: largo = longitud de la corredera. El frente de caja y
  la trasera van CAPTURADOS entre ellos (largo = ancho_caja − 2T).
  Razón física: la corredera lateral se atornilla al lateral en toda su longitud; si el
  frente capturara, el lateral mediría prof−2T y no podrías montar una corredera de 500
  en un lateral de 470.
- Cantos: FRONTAL + SUPERIOR en los laterales; SUPERIOR en frente y trasera.
  El canto trasero NO lleva. Nunca aplicar "todos los cantos" en bloque: infla ~40%.
- ancho_caja = ancho_interior − 2×holgura (lateral 13 | bajo cajón 7).

## Bisagras cazoleta 35mm
- RECTA: sobreposición total, puerta única por lateral.
- SEMICURVA: media sobreposición, dos puertas comparten divisor.
- CURVA: puerta interior a ras, holgura perimetral 3mm.
- El tipo lo decide la modulación y DETERMINA el ancho de la puerta. No son
  intercambiables al comprar: reflejarlo en la lista de herrajes.
- Cantidad: <900→2 | 900–1600→3 | 1600–2000→4 | >2000→5.
- Cazoleta Ø35, centro a 21.5mm del canto, extremas a 100mm.

## Sistema de apertura (afecta geometría, no es accesorio)
- jaladera | gola_aluminio | gola_tablero | push
- Con gola: alto_frente = alto_normal − gola_hueco. Leer alto_hueco y retranqueo de
  catalog/golas.csv por SKU — NUNCA hardcodear (varía mucho por perfil).
- La gola se calcula POR TRAMO (suma de módulos contiguos), no por módulo, y se corta en
  tramos comerciales reportando desperdicio y uniones.
- costing.py debe poder comparar gola_aluminio vs gola_tablero.

## Cubierta
- La fabrica Mono Atelier: entra al cutlist. Espesor 19, vuelo 20 → prof 620.
- Se calcula POR TRAMO. Unión si el tramo > 2440 (nunca sobre el hueco de la tarja).
- Recortes de tarja y parrilla con cotas en el plano de cubierta.

## LED
- Zonas: bajo_alacena | interior_nicho | gola | interior_closet.
- ml = Σ(ancho_módulo − 40); W = ml × 14.4; fuente = W × 1.25 → valor comercial superior.
- Generar SIEMPRE la NOTA DE RUTEO: perforaciones de paso en refuerzos traseros, ANTES
  de armar.

## Costeo
- Leer precios de catalog/materiales.csv (costo_m2) y catalog/herrajes.csv.
- DOS tarifas de cubrecanto: canto_maquina_ml y canto_manual_ml. El alto brillo siempre
  usa la manual.
- Factor desperdicio 10% + nesting real con KERF.
- El margen NUNCA se imprime en documentos del cliente: sólo el precio final.
- Poder simular proveedor alterno (Importación / Duraplay / Arauco / Mademel).

## Nesting
- Inflar cada pieza por KERF antes de acomodar. Un nesting sin kerf es un cutlist que el
  taller no puede ejecutar.
- Reportar # hojas, % aprovechamiento y ALERTA cuando queda muy poco para otra tira.

## Estilo
Antes de cualquier render o propuesta visual, leer style/mono_atelier_style.md.
Los renders SIEMPRE usan blender/render_presets.py — nunca inventes iluminación.

## Renders
- blender --background --python blender/render.py -- <json> [--escena --vistas
  --muestras --res]. Escenas: cocina | estudio | noche.
- Los ENCUADRES se derivan del bounding box del proyecto (bbox_de lee el JSON,
  no mide mallas). Nunca hardcodear coordenadas de cámara: un preset debe
  encuadrar igual de bien un mueble de 600mm y una cocina de 4m.
- Tres capas de luz: ventana lateral + cove indirecto contra el plafón + LED de
  mueble. El LED se deriva de los módulos con led=True — mismo dato que la
  lista de herrajes, no una decisión aparte.
- materials.py = materiales PLANOS (los que viajan al GLB para AR).
  render_presets.RECETAS = los procedurales, sustituidos sólo al renderizar.
  Un SKU nuevo va en los tres lados: materials.py, RECETAS y lib/forge3d.ts.
- Paso a paso: docs/RENDERS.md.

## Posicionamiento 3D
- La colocación se DERIVA en rules/posicion.py por rol_estructural y se escribe
  en el project.json (campo colocacion: centro + extensión por eje, en mm).
- Blender y el visor web/AR de la plataforma SÓLO leen colocacion. Si un panel
  aparece mal puesto, se corrige la regla en posicion.py, nunca la malla.

## Blender
- Interactivo: tools del MCP blender para iterar vistas y materiales.
- Producción: blender --background --python blender/build_from_json.py -- <json>
- Cada panel = un objeto mesh independiente nombrado igual que en el JSON.
- build_from_json exporta modelo.blend + preview.glb (+ preview.usdz si hay USD).
- Setup paso a paso: docs/BLENDER_SETUP.md.

## AR (plataforma)
- Módulo Forge de Mono Atelier OS: importa project.json, visor 3D three.js,
  genera GLB/USDZ en el navegador y publica al bucket 'forge' de Supabase.
- Visor público /?ar=<id> (QR) — Android Scene Viewer, iOS Quick Look, escala real.
- Paso a paso: docs/AR_GUIDE.md. Publicación por CLI: mono_forge/publish.py.

## Generación de entregables
- python -m mono_forge.docs <dir_proyecto> [--margen --canto-maquina --canto-manual
  --mano-obra --ar-url]. Todo se deriva del project.json, nunca de las mallas.
- mono_forge/docs/: estilo.py (identidad), planos.py (alzado/planta/despiece/nesting),
  xlsx.py, cotizacion.py, manual.py, entrega.py, costos.py.
- El margen y el costo directo SÓLO aparecen en costos_internos.pdf. Hay un test
  que abre cotizacion.pdf y entrega.pdf en binario y falla si se filtran.
- docs.verificar() corre la verificación de cierre de pipeline (ver abajo).
- Paso a paso: docs/ENTREGABLES.md.

## Agente de diseño por prompts (forge_agent/)
- El modelo elige QUÉ módulos y con qué anchos; el motor deriva TODAS las medidas.
  Las herramientas de herramientas.py sólo llaman a los generadores — si una
  herramienta calcula una medida por su cuenta, está mal escrita.
- Los errores se devuelven al modelo como texto ("ERROR: ...") para que corrija,
  nunca como excepción que mate el trabajo.
- Modelo: claude-opus-5, adaptive thinking, effort high. Sin temperature.
- La cola vive en forge_jobs (Supabase); el worker corre en la máquina del taller
  porque Blender es local. Paso a paso: docs/AGENTE_PROMPTS.md.

## Entregables por proyecto (los 7)
1. modelo.blend + preview.glb
2. renders/ (mín. 3 vistas, Cycles 1920×1080)
3. cutlist.xlsx (piezas + cubrecanto + perforaciones + nesting + hojas)
4. herrajes.xlsx
5. cotizacion.pdf (cliente)
6. manual_ensamble.pdf (carpintero: explotado, planos por pieza, pasos, herraje por paso)
7. entrega.pdf (cliente: renders, specs, garantía, cuidados, firma)
+ costos_internos.pdf — INTERNO, con margen y simulación por proveedor. No se entrega.

## Tests
Los tests son la red de seguridad. Si un test de medidas falla, NUNCA lo "arregles"
cambiando el valor esperado sin explicar la matemática primero.

## Al terminar cualquier pipeline
Verifica: área de cutlist ≈ área de paneles del JSON (±1%), bisagras == puertas × regla,
suma vertical de torres cuadrada, y que existan los 7 archivos en
projects/{proyecto}/deliverables/. Reporta cualquier discrepancia.
