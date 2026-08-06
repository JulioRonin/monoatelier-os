"""Publica un proyecto mono-forge en la plataforma (Supabase) SIN dependencias.

    python -m mono_forge.publish projects/demo-cocina --name "Cocina Pérez"

Sube al bucket público 'forge':
    project.json                     (la fuente de verdad)
    deliverables/preview.glb         (si existe — visor web + AR Android)
    deliverables/preview.usdz        (si existe — AR iOS)
y registra/actualiza la fila en la tabla forge_models.

Credenciales por variables de entorno:
    SUPABASE_URL          p. ej. https://xxxx.supabase.co
    SUPABASE_KEY          service_role (recomendado para CLI) o anon key
"""

from __future__ import annotations

import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
import uuid


def _req(url: str, key: str, data: bytes | None = None, method: str = "GET",
         content_type: str = "application/json", extra: dict | None = None):
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": content_type,
    }
    headers.update(extra or {})
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(r) as resp:
        body = resp.read()
        return resp.status, body


def _subir_storage(base: str, key: str, bucket: str, path: str, archivo: str) -> str:
    ctype = mimetypes.guess_type(archivo)[0] or "application/octet-stream"
    if archivo.endswith(".glb"):
        ctype = "model/gltf-binary"
    if archivo.endswith(".usdz"):
        ctype = "model/vnd.usdz+zip"
    with open(archivo, "rb") as f:
        data = f.read()
    url = f"{base}/storage/v1/object/{bucket}/{path}"
    _req(url, key, data, method="POST", content_type=ctype,
         extra={"x-upsert": "true"})
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    if not args:
        print("uso: python -m mono_forge.publish <dir_proyecto> [--name NOMBRE]")
        return 1
    proyecto_dir = args[0]
    name = None
    if "--name" in argv:
        name = argv[argv.index("--name") + 1]

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        print("ERROR: define SUPABASE_URL y SUPABASE_KEY en el entorno.")
        return 1

    ruta_json = os.path.join(proyecto_dir, "project.json")
    if not os.path.exists(ruta_json):
        print(f"ERROR: no existe {ruta_json}. Genera primero con "
              "`python -m mono_forge.cli <PRESET> --out <dir>`.")
        return 1

    with open(ruta_json, encoding="utf-8") as f:
        project = json.load(f)
    name = name or project.get("nombre") or os.path.basename(proyecto_dir)

    model_id = str(uuid.uuid4())
    print(f"Publicando '{name}' → {base} (id {model_id})")

    json_url = _subir_storage(base, key, "forge", f"{model_id}/project.json", ruta_json)
    print(f"  ✓ project.json → {json_url}")

    glb_url = usdz_url = None
    deliv = os.path.join(proyecto_dir, "deliverables")
    glb = os.path.join(deliv, "preview.glb")
    usdz = os.path.join(deliv, "preview.usdz")
    if os.path.exists(glb):
        glb_url = _subir_storage(base, key, "forge", f"{model_id}/preview.glb", glb)
        print(f"  ✓ preview.glb → {glb_url}")
    else:
        print("  · sin preview.glb (córrelo en Blender, o publícalo desde la "
              "plataforma con 'Publicar en AR')")
    if os.path.exists(usdz):
        usdz_url = _subir_storage(base, key, "forge", f"{model_id}/preview.usdz", usdz)
        print(f"  ✓ preview.usdz → {usdz_url}")

    fila = {
        "id": model_id,
        "name": name,
        "description": f"{project.get('cliente', '')} — "
                       f"{len(project.get('modules', []))} módulos (publicado desde CLI)",
        "project_json": project,
        "glb_url": glb_url,
        "usdz_url": usdz_url,
        "status": "published" if glb_url else "draft",
    }
    try:
        _req(f"{base}/rest/v1/forge_models", key,
             json.dumps(fila).encode(), method="POST",
             extra={"Prefer": "return=minimal"})
    except urllib.error.HTTPError as e:
        print(f"ERROR al insertar en forge_models: {e.read().decode()[:300]}")
        return 1

    print(f"  ✓ registrado en forge_models")
    print(f"\nVisor AR: <tu-plataforma>/?ar={model_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
