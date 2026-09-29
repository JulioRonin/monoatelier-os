"""Forge Agent — el puente entre tu plataforma y tu máquina.

Corre en TU PC. Escucha los prompts que escribes en el módulo Forge de
Mono Atelier OS, diseña con el agente, construye en Blender, genera los
entregables y sube todo de vuelta a la plataforma.

    python -m forge_agent.worker              # escucha trabajos en bucle
    python -m forge_agent.worker --una-vez    # procesa uno y sale
    python -m forge_agent.worker --prompt "cocina de 3m con tarja y torre de horno"
    python -m forge_agent.worker --leer foto.jpg [otra.png] [--indicaciones "..."]

Variables de entorno:
    FORGE_PROVEEDOR     anthropic (default) | nvidia | openai_compat
    ANTHROPIC_API_KEY   con FORGE_PROVEEDOR=anthropic — console.anthropic.com
    NVIDIA_API_KEY      con FORGE_PROVEEDOR=nvidia — build.nvidia.com
    FORGE_MODEL         id del modelo constructor (obligatorio fuera de Anthropic)
    FORGE_MODELO_LECTURA  quién lee las fotos (default claude-opus-5-5). Usa
                        ANTHROPIC_API_KEY aunque el constructor sea NVIDIA.
    FORGE_BASE_URL      endpoint OpenAI-compatible (NIM local, vLLM, Ollama)
    SUPABASE_URL        obligatoria para el modo escucha
    SUPABASE_KEY        service_role (recomendado) o anon key
    BLENDER_PATH        opcional — ruta a blender.exe; sin ella se omite el 3D
    FORGE_PROJECTS_DIR  opcional — dónde escribir los proyectos (default: ./projects)
    FORGE_SUBIR_COSTOS  "1" para subir también costos_internos.pdf al bucket
                        PRIVADO forge-interno. Apagado por defecto: ese PDF
                        lleva el margen. Lee la nota de la migración antes.
"""

from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid

from . import comando_instalar, faltantes
from .lectura import ficha_a_prompt, leer_foto, resumen_de_ficha

INTERVALO = float(os.environ.get("FORGE_POLL_SECONDS", "5"))
PROJECTS_DIR = os.environ.get("FORGE_PROJECTS_DIR", "projects")
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── Supabase (sin dependencias) ──────────────────────────────────────────

def _base() -> str:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("Define SUPABASE_URL en el entorno.")
    return url


def _key() -> str:
    key = os.environ.get("SUPABASE_KEY", "")
    if not key:
        raise RuntimeError("Define SUPABASE_KEY en el entorno.")
    return key


def _req(path: str, data: bytes | None = None, method: str = "GET",
         content_type: str = "application/json", extra: dict | None = None):
    url = path if path.startswith("http") else f"{_base()}{path}"
    headers = {"apikey": _key(), "Authorization": f"Bearer {_key()}",
               "Content-Type": content_type}
    headers.update(extra or {})
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(r) as resp:
        cuerpo = resp.read()
        return json.loads(cuerpo) if cuerpo else None


def _subir_a(bucket: str, model_id: str, nombre: str, ruta: str) -> str:
    """Sube un archivo y devuelve su ruta dentro del bucket."""
    destino = f"{model_id}/{nombre}"
    tipo = mimetypes.guess_type(nombre)[0] or "application/octet-stream"
    with open(ruta, "rb") as f:
        datos = f.read()
    _req(f"/storage/v1/object/{bucket}/{destino}", datos, "POST",
         extra={"Content-Type": tipo, "x-upsert": "true"})
    return destino


def _subir(model_id: str, nombre: str, ruta: str) -> str:
    ctype = mimetypes.guess_type(ruta)[0] or "application/octet-stream"
    if nombre.endswith(".glb"):
        ctype = "model/gltf-binary"
    elif nombre.endswith(".usdz"):
        ctype = "model/vnd.usdz+zip"
    with open(ruta, "rb") as f:
        datos = f.read()
    _req(f"/storage/v1/object/forge/{model_id}/{nombre}", datos, "POST",
         ctype, {"x-upsert": "true"})
    return f"{_base()}/storage/v1/object/public/forge/{model_id}/{nombre}"


def tomar_trabajo() -> dict | None:
    """Reclama el trabajo pendiente más antiguo (marcándolo running)."""
    q = "/rest/v1/forge_jobs?status=eq.pending&order=created_at.asc&limit=1"
    filas = _req(q) or []
    if not filas:
        return None
    job = filas[0]
    _req(f"/rest/v1/forge_jobs?id=eq.{job['id']}",
         json.dumps({"status": "running"}).encode(), "PATCH",
         extra={"Prefer": "return=minimal"})
    return job


def cerrar_trabajo(job_id: str, **campos) -> None:
    _req(f"/rest/v1/forge_jobs?id=eq.{job_id}",
         json.dumps(campos).encode(), "PATCH",
         extra={"Prefer": "return=minimal"})


# ── Pipeline ─────────────────────────────────────────────────────────────

def construir_en_blender(ruta_json: str) -> list[str]:
    """Ejecuta Blender headless si BLENDER_PATH está definido."""
    blender = os.environ.get("BLENDER_PATH")
    if not blender:
        print("  · BLENDER_PATH sin definir: se omite el modelo 3D "
              "(la plataforma generará el GLB en el navegador).")
        return []
    script = os.path.join(RAIZ, "mono-forge", "blender", "build_from_json.py")
    if not os.path.exists(script):
        script = os.path.join(RAIZ, "blender", "build_from_json.py")
    print("  · Blender construyendo el modelo…")
    r = subprocess.run([blender, "--background", "--python", script, "--", ruta_json],
                       capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        print("  ! Blender falló:", (r.stderr or r.stdout)[-500:])
        return []
    deliv = os.path.join(os.path.dirname(ruta_json), "deliverables")
    return [f for f in ("modelo.blend", "preview.glb", "preview.usdz")
            if os.path.exists(os.path.join(deliv, f))]


def _tarifas():
    from mono_forge.costing import Tarifas

    def num(k: str, d: float) -> float:
        try:
            return float(os.environ.get(k, d))
        except ValueError:
            return d
    return Tarifas(
        canto_maquina_ml=num("FORGE_CANTO_MAQUINA", 0.0),
        canto_manual_ml=num("FORGE_CANTO_MANUAL", 0.0),
        mano_obra_modulo=num("FORGE_MANO_OBRA", 0.0),
        margen=num("FORGE_MARGEN", 0.35),
    )


def procesar(prompt: str, base: dict | None = None,
             subir: bool = True, nombre_dir: str | None = None,
             imagenes: list[str] | None = None) -> dict:
    """Diseña → 3D → entregables → publica. Devuelve el resultado del trabajo."""
    # los documentos necesitan reportlab y openpyxl; se importan aquí para
    # que la lectura de fotos funcione aunque falten
    from mono_forge.docs import generar_todo, verificar
    from mono_forge.models import Project

    from .agente import disenar

    print(f"\n▸ Diseñando: {prompt[:90]}")
    if imagenes:
        print(f"  · {len(imagenes)} imagen(es) de referencia")
    r = disenar(prompt, base, imagenes=imagenes)
    project_dict = r["project"]
    print(f"  · {len(project_dict['modules'])} módulos "
          f"({r['uso']['output_tokens']} tokens de salida)")

    model_id = str(uuid.uuid4())
    carpeta = os.path.join(PROJECTS_DIR, nombre_dir or model_id[:8])
    os.makedirs(carpeta, exist_ok=True)
    ruta_json = os.path.join(carpeta, "project.json")
    with open(ruta_json, "w", encoding="utf-8") as f:
        json.dump(project_dict, f, ensure_ascii=False, indent=2)
    print(f"  · project.json → {ruta_json}")

    generados = construir_en_blender(ruta_json)

    project = Project.from_dict(project_dict)
    destino = os.path.join(carpeta, "deliverables")
    print("  · Generando entregables…")
    docs = generar_todo(project, destino, _tarifas())
    v = verificar(project, destino)
    for p in v["problemas"]:
        print(f"  ! {p}")

    urls: dict[str, str] = {}
    costos_path: str | None = None
    if subir:
        print("  · Publicando en la plataforma…")
        urls["project.json"] = _subir(model_id, "project.json", ruta_json)
        for nombre in generados:
            urls[nombre] = _subir(model_id, nombre, os.path.join(destino, nombre))
        for nombre, ruta in docs.items():
            if nombre == "costos_internos.pdf":
                # lleva margen y costo directo: bucket PRIVADO, y sólo si se
                # pide explícitamente. Nunca al bucket público.
                if os.environ.get("FORGE_SUBIR_COSTOS") == "1":
                    costos_path = _subir_a("forge-interno", model_id, nombre, ruta)
                    print("    · costos_internos.pdf → bucket privado")
                continue
            urls[nombre] = _subir(model_id, nombre, ruta)

        # todo lo que el cliente puede descargar, para que la plataforma lo
        # encuentre. Antes se calculaban estas URLs y se tiraban.
        documentos = {n: u for n, u in urls.items() if n != "preview.usdz"}
        fila = {
            "id": model_id,
            "name": project.nombre,
            "description": f"{project.cliente} — {len(project.modules)} módulos",
            "project_json": project_dict,
            "glb_url": urls.get("preview.glb"),
            "usdz_url": urls.get("preview.usdz"),
            "documentos": documentos,
            "costos_path": costos_path,
            "status": "published" if urls.get("preview.glb") else "draft",
        }
        _req("/rest/v1/forge_models", json.dumps(fila).encode(), "POST",
             extra={"Prefer": "return=minimal"})
        print(f"  ✓ registrado como {model_id}")

    return {
        "model_id": model_id,
        "resumen": r["resumen"],
        "bitacora": r["bitacora"],
        "carpeta": carpeta,
        "urls": urls,
        "costos_path": costos_path,
        "verificacion": v,
    }


def atender(job: dict) -> None:
    print(f"\n═ Trabajo {job['id']}")
    try:
        if (job.get("tipo") or "diseno") == "lectura":
            _atender_lectura(job)
        else:
            _atender_diseno(job)
    except Exception as e:
        traceback.print_exc()
        cerrar_trabajo(job["id"], status="error", error=str(e)[:2000])
        print(f"  ✗ trabajo fallido: {e}")


def _atender_lectura(job: dict) -> None:
    """Foto → ficha. No construye nada: la ficha espera la revisión de Julio."""
    imagenes = job.get("imagenes") or []
    print(f"▸ Leyendo {len(imagenes)} foto(s)")
    r = leer_foto(imagenes, job.get("prompt") or "")
    ficha = r["ficha"]
    print(f"  · {ficha.get('nombre_proyecto')} — "
          f"{'construible' if ficha['construible'] else 'sin generador'}")
    cerrar_trabajo(job["id"], status="done", ficha=ficha,
                   log=resumen_de_ficha(ficha), error=None)
    print("  ✓ ficha lista para revisar")


def _atender_diseno(job: dict) -> None:
    ficha = job.get("ficha")
    prompt, imagenes = job["prompt"], job.get("imagenes") or []
    if ficha:
        if not ficha.get("construible"):
            raise RuntimeError(
                "El motor todavía no tiene generador para esto ("
                + ", ".join(ficha.get("omitidos") or []) + "). "
                "La ficha quedó guardada para cuando exista.")
        # lo que Julio aprobó es lo que se construye: la ficha es la fuente,
        # no la foto. Además el constructor puede no ver imágenes.
        prompt, imagenes = ficha_a_prompt(ficha), []

    res = procesar(prompt, job.get("base_project_json"), imagenes=imagenes)
    log = res["resumen"]
    for aviso in res["bitacora"]:
        if aviso.startswith("AVISO"):
            log += f"\n\n{aviso}"
    if res["verificacion"]["problemas"]:
        log += "\n\nAvisos de verificación:\n" + \
            "\n".join(f"— {p}" for p in res["verificacion"]["problemas"])
    cerrar_trabajo(job["id"], status="done", result_model_id=res["model_id"],
                   log=log, error=None)
    print("  ✓ trabajo completado")


def _leer_desde_terminal(argv: list[str]) -> int:
    """--leer foto.jpg [...] [--indicaciones "..."]: imprime la ficha y las
    instrucciones que recibiría el constructor. No sube ni construye nada."""
    i = argv.index("--leer") + 1
    fotos = []
    while i < len(argv) and not argv[i].startswith("--"):
        fotos.append(argv[i])
        i += 1
    indicaciones = ""
    if "--indicaciones" in argv:
        indicaciones = argv[argv.index("--indicaciones") + 1]

    if not fotos:
        print("ERROR: falta la foto. Uso: python -m forge_agent.worker --leer <foto>")
        return 1
    for f in fotos:
        if not f.startswith(("http://", "https://")) and not os.path.isfile(f):
            print(f"ERROR: no encuentro la foto {f}")
            print("  Pon la ruta completa entre comillas, por ejemplo:")
            print('    --leer "C:\\Users\\ORKA\\Downloads\\vestidor.webp"')
            return 1

    import anthropic
    try:
        r = leer_foto(fotos, indicaciones)
    except anthropic.AuthenticationError:
        print("ERROR: Anthropic rechazó la llave. Revisa ANTHROPIC_API_KEY "
              "(console.anthropic.com → API keys).")
        return 1
    except anthropic.NotFoundError as e:
        print(f"ERROR: el modelo no existe para tu cuenta: {e.message}")
        return 1
    except anthropic.APIStatusError as e:
        print(f"ERROR {e.status_code} de Anthropic: {e.message}")
        return 1
    except anthropic.APIConnectionError:
        print("ERROR: no se pudo conectar con Anthropic. Revisa tu internet.")
        return 1
    print(json.dumps(r["ficha"], ensure_ascii=False, indent=2))
    print("\n" + "─" * 62 + "\n" + resumen_de_ficha(r["ficha"]))
    print("\nLo que recibiría el constructor:\n" + ficha_a_prompt(r["ficha"]))
    print(f"\n({r['modelo']} · {r['uso']['output_tokens']} tokens de salida)")
    return 0


def _revisar_paquetes(modulos: list[str]) -> bool:
    falta = faltantes(modulos)
    if falta:
        print(f"ERROR: a este Python le falta {', '.join(falta)}.")
        print(f"  Python en uso: {sys.executable}")
        print(f"  Instálalo en ESTE Python con:\n    {comando_instalar()}")
    return not falta


def main(argv: list[str]) -> int:
    if not _revisar_paquetes(["anthropic"]):
        return 1
    if "--leer" in argv:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("ERROR: la lectura de fotos usa Claude: define ANTHROPIC_API_KEY.")
            return 1
        return _leer_desde_terminal(argv)

    # falla aquí, con un mensaje claro, y no a media hora de trabajo
    if not _revisar_paquetes(["openpyxl", "reportlab"]):
        return 1
    from . import proveedores
    try:
        cfg = proveedores.configurar()
    except RuntimeError as e:
        print(f"ERROR de configuración: {e}")
        return 1
    if cfg["proveedor"] == "anthropic" and not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: define ANTHROPIC_API_KEY (console.anthropic.com), o usa "
              "FORGE_PROVEEDOR=nvidia con NVIDIA_API_KEY.")
        return 1
    print(f"Constructor: {cfg['proveedor']}/{cfg['modelo']}")
    if os.environ.get("ANTHROPIC_API_KEY"):
        print("Lectura de fotos: "
              + (os.environ.get("FORGE_MODELO_LECTURA") or "claude-opus-5-5"))
    else:
        print("AVISO: sin ANTHROPIC_API_KEY — las lecturas de foto van a fallar.")

    if "--prompt" in argv:
        prompt = argv[argv.index("--prompt") + 1]
        subir = bool(os.environ.get("SUPABASE_URL")) and "--sin-subir" not in argv
        res = procesar(prompt, subir=subir)
        print("\n" + res["resumen"])
        print(f"\nCarpeta: {res['carpeta']}")
        if res["urls"].get("preview.glb"):
            print(f"Visor AR: <tu-plataforma>/?ar={res['model_id']}")
        return 0

    una_vez = "--una-vez" in argv
    print(f"Forge Agent escuchando trabajos cada {INTERVALO:.0f}s. Ctrl+C para salir.")
    if not os.environ.get("BLENDER_PATH"):
        print("AVISO: BLENDER_PATH sin definir — no se generará el modelo 3D aquí.")
    while True:
        try:
            job = tomar_trabajo()
        except urllib.error.HTTPError as e:
            print(f"! Supabase respondió {e.code}: {e.read().decode()[:200]}")
            time.sleep(INTERVALO * 4)
            continue
        except Exception as e:
            print(f"! No se pudo consultar la cola: {e}")
            time.sleep(INTERVALO * 4)
            continue

        if job:
            atender(job)
            if una_vez:
                return 0
        elif una_vez:
            print("No hay trabajos pendientes.")
            return 0
        else:
            time.sleep(INTERVALO)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
