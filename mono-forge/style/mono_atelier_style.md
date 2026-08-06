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
Implementado en `blender/render_presets.py`; paso a paso en `docs/RENDERS.md`.

- **Luz en tres capas, nunca spots**: (1) ventana lateral grande y suave que da
  la dirección y las sombras largas; (2) cove lineal contra el plafón, cálido
  (2900K), que llena el ambiente por rebote; (3) LED de mueble, derivado de los
  módulos con `led=True`. Esa jerarquía es lo que separa el look cálido de la
  referencia del look de catálogo de ferretería.
- **Gestión de color**: AgX con exposición ligeramente alta — el rolloff suave
  en las altas luces es lo que da la sensación de luz natural abundante.
- **Escenas**: `cocina` (estuco crudo + microcemento, la entrega normal),
  `estudio` (fondo neutro sin esquinas, para piezas sueltas), `noche`
  (ambiente mínimo, protagonizan el LED y el cove).
- **Cámara**: 35mm para el tres cuartos principal, 50mm para el alzado,
  85mm para el detalle. Altura de mirada ~45% del alto del mueble, ligero
  picado. Los encuadres se derivan del bounding box, no se hardcodean.
- **Materiales**: la madera lleva veta VERTICAL marcada; la piedra es el único
  material "ruidoso" de la escena y va con vetas contrastantes; los muros son
  casi lisos con una irregularidad mínima que evita el look de plástico.

### Pendiente de afinar con más referencias
- HDRI de ventana real en vez de área rectangular (más fidelidad en reflejos).
- Atrezzo mínimo (un tazón, una tabla, una planta) — la referencia lo usa con
  mucha contención y ayuda a dar escala.
- Perfil de luminaria colgante sobre isla.

## Paleta de proyecto — ejemplo (cocina verde sage, 06.08.2026)
- Inferiores: roble natural claro (`MEL-ROBLE-NAT-15`), veta vertical.
- Superiores: verde sage mate (`LAC-VERDE-SAGE-15`).
- Cubierta: granito oscuro con vetas blancas — piedra natural, se cotiza
  aparte del cutlist (no la fabrica el taller).
- Apertura: jaladera simple — sin gola, para mantener el mueble "sencillo".
