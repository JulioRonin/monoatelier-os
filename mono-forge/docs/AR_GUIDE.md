# Módulo AR — ver los diseños a escala real desde el teléfono

Cualquier diseño generado por mono-forge se puede colocar en el espacio real
del cliente (o del taller) con la cámara del teléfono. Sin apps: el visor AR
usa las capacidades nativas del sistema.

| Plataforma | Tecnología | Formato |
|---|---|---|
| Android | Scene Viewer / WebXR | `preview.glb` |
| iPhone / iPad | AR Quick Look | `preview.usdz` |

**Escala real garantizada**: los modelos se exportan en metros directamente
desde las medidas en mm del `project.json`. Un mueble de 900mm mide 900mm en
el piso del cliente.

## Flujo completo (de parámetros a AR en 4 pasos)

```
1. GENERAR      python -m mono_forge.cli BASE-600 SUP-750 --out projects/x
2. IMPORTAR     Plataforma → Forge → "Importar project.json"
3. PUBLICAR     Botón "Publicar en AR"  (genera GLB + USDZ en el navegador
                y los sube al bucket 'forge' de Supabase)
4. VER          Escanear el QR con el teléfono → tocar el ícono AR → colocar
                el mueble en el piso real
```

### Paso a paso detallado

1. **Genera el diseño** con el CLI (ver `docs/BLENDER_SETUP.md`, pasos 1–2).
   El `project.json` resultante ya trae la colocación 3D derivada.

2. **Entra a Forge** en Mono Atelier OS (ítem "Forge" del menú lateral).
   Pulsa **Importar project.json** y elige el archivo. Verás el diseño en el
   visor 3D (órbita con el mouse). Ponle nombre y **Guardar en Forge**.

3. **Publicar en AR**. El navegador construye la escena three.js desde el
   JSON, exporta `preview.glb` (Android) y `preview.usdz` (iOS) y los sube al
   bucket público `forge`. El diseño queda marcado `published`.

4. **Abrir en el teléfono**. Aparece un **código QR**: escanéalo con la cámara.
   Se abre el visor público (`/?ar=<id>` — no requiere login, se lo puedes
   mandar al cliente por WhatsApp). Toca el ícono de AR:
   - **Android**: se abre Scene Viewer; apunta al piso y el mueble se asienta.
   - **iOS**: se abre Quick Look; mueve el teléfono y coloca el modelo.

## Ruta alternativa: desde Blender / CLI sin tocar la plataforma

Si ya corriste el build headless de Blender (que exporta GLB y USDZ):

```bash
export SUPABASE_URL="https://<tu-proyecto>.supabase.co"
export SUPABASE_KEY="<service_role_key>"
python -m mono_forge.publish projects/cocina-perez --name "Cocina Pérez"
# → imprime el link /?ar=<id> listo para compartir
```

## Requisitos de la plataforma (una sola vez)

1. Aplicar la migración `supabase/migrations/20260806_forge_models.sql`
   (crea la tabla `forge_models`, el bucket público `forge` y sus políticas).
   Desde el SQL Editor de Supabase o con `supabase db push`.
2. Variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` configuradas
   (las mismas que ya usa el resto de la app).

## Requisitos del teléfono

- **Android**: Google Play Services for AR (ARCore) — se instala solo al abrir.
- **iOS**: iOS 12+ (Quick Look nativo, no requiere nada).
- El link del QR debe ser accesible desde el teléfono (misma red si corres
  `npm run dev`, o el dominio público en producción). Scene Viewer y Quick
  Look requieren HTTPS en producción.

## Problemas frecuentes

- **El botón AR no aparece en el teléfono** → el navegador no soporta AR
  (usa Chrome en Android, Safari en iOS) o el link no es HTTPS.
- **"Este diseño aún no está publicado en AR"** → falta pulsar *Publicar en AR*
  en la plataforma (o el build de Blender no subió el GLB).
- **En iOS abre el visor 3D pero no AR** → falta el `preview.usdz`; vuelve a
  *Publicar en AR* desde la plataforma (el navegador lo genera siempre).
