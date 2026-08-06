# Manifiesto de estilo Mono Atelier

> Basado en la referencia visual entregada el 06.08.2026 (cocina con isla curva,
> paneles de roble acanalado, luz cálida indirecta, piedra con vetas). Este
> archivo define el lenguaje de diseño; cada proyecto elige su propia paleta
> dentro de estas reglas (ver "Paleta de proyecto" al final).

## Identidad
- Estética: **minimalismo cálido / orgánico** — superficies limpias sin
  moldura, pero con curvas suaves que rompen la caja rectangular (islas con
  esquinas redondeadas, cantos vivos en la piedra, formas de gota en luminarias).
- Materiales firma: madera natural (roble) en superficies verticales grandes,
  a menudo con veta/canal vertical; piedra o granito con vetas marcadas como
  único elemento "ruidoso" del espacio; tonos neutros cálidos (crema, arena,
  beige) en muros y plafones.
- Detalles firma: jaladera perfilada delgada o push (nunca jaladera de bulto);
  luz indirecta de cove/perfil en vez de spots puntuales; acentos en negro
  mate o bronce SOLO en líneas delgadas (grifería, colgantes, marcos de vano).
- Un acento de color por proyecto (verde sage, terracota, etc.) contra una
  base neutra — nunca dos acentos saturados compitiendo.

## Paleta
- Maderas: roble natural claro (veta vertical) como madera base del sistema;
  admite tonos más oscuros (nogal) para proyectos que pidan mayor contraste.
- Sólidos: blanco roto / crema para superficies ocultas y muros; negro mate
  y bronce cepillado sólo en accesorios y líneas, nunca en superficies grandes.
- Acentos: un color por proyecto sobre gabinetes superiores o un tramo
  específico — verde sage, terracota, azul petróleo. La base siempre queda neutra.
- Piedra: granito o mármol con vetas contrastantes (blanco sobre oscuro, o al
  revés) como cubierta — es la pieza que "ancla" visualmente la cocina.

## Reglas de composición
- Contraste de dos tonos entre inferiores y superiores es la firma de la casa
  (ej. inferiores en madera natural, superiores en el color de acento).
- Curvas: se permiten en cubiertas, remates de isla y perfiles de luminaria.
  **Limitación actual del motor**: los generadores producen piezas planas
  rectangulares (mono_forge es un sistema de tablero plano, no de MDF curvado
  ni termoformado). Un frente de puerta genuinamente curvo no es un panel de
  corte — es una pieza especial de otro proceso de fabricación. Hasta que
  exista un generador para eso, los muebles curvos de la referencia se
  documentan como pendientes (ver README) y los proyectos usan frentes rectos
  con la paleta y proporciones del estilo.
- Proporciones de frentes: puertas y cajones sin partir vanos grandes en
  piezas angostas — prefiere 1–2 puertas por módulo de hasta 900mm.
- Qué NUNCA hacemos: molduras clásicas, jaladeras tipo arco o cromadas,
  más de un acento de color saturado por proyecto, cubrecanto en bloque.

## Renders
- Luz: cálida (3000K), indirecta — cove/perfil lineal en vez de spots.
  Ventana lateral grande como fuente principal cuando la escena la tenga.
- Escenas: cocina con piso de microcemento claro y muro de estuco crudo;
  estudio con fondo neutro crema para piezas sueltas.
- Cámara: 35mm, altura 1400mm, ligero picado — igual que blender/render_presets.py.

## Paleta de proyecto — ejemplo (cocina verde sage, 06.08.2026)
- Inferiores: roble natural claro (`MEL-ROBLE-NAT-15`), veta vertical.
- Superiores: verde sage mate (`LAC-VERDE-SAGE-15`).
- Cubierta: granito oscuro con vetas blancas — piedra natural, se cotiza
  aparte del cutlist (no la fabrica el taller).
- Apertura: jaladera simple — sin gola, para mantener el mueble "sencillo".
