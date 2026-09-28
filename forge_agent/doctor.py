"""¿Por qué no pasa nada? — revisa la cadena completa y dice dónde se rompe.

    python -m forge_agent.doctor

Va en orden, de lo más básico a lo más caro, y para en el primer error grave:
paquetes → modelos y llaves → Supabase → migraciones → Blender → prueba del
constructor → la cola.
Cada línea dice qué hacer si falla, no sólo que falló.

No modifica nada. Es seguro correrlo cuantas veces quieras.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import urllib.error
import urllib.request

OK, MAL, AVISO = "  ✓", "  ✗", "  !"


def _linea(marca: str, texto: str, ayuda: str = "") -> None:
    print(f"{marca} {texto}")
    if ayuda:
        for l in ayuda.split("\n"):
            print(f"      {l}")


def _supabase(ruta: str, metodo: str = "GET", cuerpo: bytes | None = None):
    """Llamada cruda a la API REST. Devuelve (código, texto)."""
    url = os.environ["SUPABASE_URL"].rstrip("/") + ruta
    key = os.environ["SUPABASE_KEY"]
    req = urllib.request.Request(url, data=cuerpo, method=metodo, headers={
        "apikey": key, "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]
    except Exception as e:                          # noqa: BLE001
        return 0, str(e)


# ── 1. paquetes ─────────────────────────────────────────────────────────

INSTALAR = "pip install -r forge_agent/requirements.txt"


def revisar_paquetes(proveedor: str) -> bool:
    """Antes de importar nada del agente: si falta un paquete, el import de
    las herramientas truena con un traceback que no dice qué instalar."""
    ok = True
    try:
        import mono_forge  # noqa: F401
        _linea(OK, "mono-forge importable")
    except ImportError:
        _linea(MAL, "no encuentro mono-forge",
               "Corre los comandos desde la raíz del repo (la carpeta que tiene\n"
               "mono-forge/ y forge_agent/).")
        ok = False

    # anthropic siempre: las herramientas se declaran con su @beta_tool y la
    # lectura de fotos usa Claude aunque el constructor sea NVIDIA
    requeridos = [("anthropic", "anthropic"), ("openpyxl", "openpyxl"),
                  ("reportlab", "reportlab")]
    if proveedor != "anthropic":
        requeridos.append(("openai", "openai"))
    for modulo, paquete in requeridos:
        try:
            __import__(modulo)
            _linea(OK, f"paquete {paquete} instalado")
        except ImportError:
            _linea(MAL, f"falta el paquete {paquete}", INSTALAR)
            ok = False
    return ok


def revisar_lectura() -> bool:
    modelo = os.environ.get("FORGE_MODELO_LECTURA") or "claude-opus-5-5"
    if os.environ.get("ANTHROPIC_API_KEY"):
        _linea(OK, f"lectura de fotos con {modelo}")
        return True
        _linea(MAL, "sin ANTHROPIC_API_KEY: la lectura de fotos no va a funcionar",
               "La foto la lee Claude aunque construyas con NVIDIA.\n"
               "Genera la llave en console.anthropic.com.")
    return False


# ── 2. el modelo responde y llama herramientas ──────────────────────────

def revisar_modelo(cfg: dict) -> bool:
    from . import herramientas, proveedores
    from .agente import SISTEMA, disenar        # noqa: F401

    etiqueta = f"{cfg['proveedor']}/{cfg['modelo']}"
    if cfg["proveedor"] == "anthropic":
        _linea(AVISO, f"modelo {etiqueta} — la prueba de humo sólo corre en "
                      "endpoints OpenAI-compatibles")
        return True

    herramientas.reiniciar()
    try:
        proveedores.correr_openai_compat(
            SISTEMA, "un gabinete inferior de 600mm con una puerta",
            modelo=cfg["modelo"], base_url=cfg["base_url"],
            api_key=cfg["api_key"])
    except Exception as e:                          # noqa: BLE001
        msg = str(e).split("\n")[0][:180]
        ayuda = "El modelo no respondió. Revisa el id exacto en build.nvidia.com."
        if "401" in msg or "403" in msg:
            ayuda = "La llave fue rechazada. Regenera NVIDIA_API_KEY."
        elif "404" in msg:
            ayuda = (f"'{cfg['modelo']}' no existe en ese endpoint.\n"
                     f"Lista los disponibles: python -m forge_agent.probar_modelo --listar")
        elif "tool" in msg.lower() or "function" in msg.lower():
            ayuda = ("El modelo NO acepta function calling: sin eso este agente "
                     "no puede trabajar.\nElige otro y compáralos con "
                     "python -m forge_agent.probar_modelo <id-1> <id-2>")
        _linea(MAL, f"modelo {etiqueta}: {msg}", ayuda)
        return False

    p = herramientas.finalizar()
    if not p["modules"]:
        _linea(MAL, f"modelo {etiqueta} respondió pero NO llamó herramientas",
               "No hace function calling multi-turno de verdad. Prueba otro:\n"
               "python -m forge_agent.probar_modelo <id-1> <id-2>")
        return False
    _linea(OK, f"modelo {etiqueta} diseña y llama herramientas")
    return True


# ── 3. Supabase, migraciones y cola ─────────────────────────────────────

COLUMNAS = {
    "forge_jobs": [("imagenes", "20260807_forge_job_imagenes.sql"),
                   ("tipo", "20260928_forge_lectura.sql"),
                   ("ficha", "20260928_forge_lectura.sql")],
    "forge_models": [("documentos", "20260807_forge_documentos.sql"),
                     ("costos_path", "20260807_forge_documentos.sql")],
}


def revisar_supabase() -> bool:
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        _linea(AVISO, "sin SUPABASE_URL / SUPABASE_KEY",
               "Sólo podrás usar --prompt en local; el modo escucha necesita las dos.")
        return True

    ok = True
    for tabla, columnas in COLUMNAS.items():
        codigo, texto = _supabase(f"/rest/v1/{tabla}?select=id&limit=1")
        if codigo == 0:
            _linea(MAL, f"no pude conectar a Supabase: {texto[:120]}",
                   "Revisa SUPABASE_URL, y que la red no bloquee el dominio.")
            return False
        if codigo == 404 or "does not exist" in texto:
            _linea(MAL, f"la tabla {tabla} no existe",
                   f"Corre supabase/migrations/20260806_{tabla}.sql")
            ok = False
            continue
        if codigo in (401, 403):
            _linea(MAL, "Supabase rechazó la llave",
                   "SUPABASE_KEY debe ser la service_role del proyecto.")
            return False
        if codigo >= 400:
            _linea(MAL, f"{tabla} respondió {codigo}: {texto[:140]}")
            ok = False
            continue
        _linea(OK, f"tabla {tabla} accesible")

        # ¿están las columnas nuevas? Pedirlas por nombre da 400 si faltan.
        for columna, migracion in columnas:
            c, t = _supabase(f"/rest/v1/{tabla}?select={columna}&limit=1")
            if c >= 400:
                _linea(MAL, f"a {tabla} le falta la columna '{columna}'",
                       f"Corre supabase/migrations/{migracion}\n"
                       f"Sin ella la plataforma da 400 al guardar.")
                ok = False
            else:
                _linea(OK, f"{tabla}.{columna} presente")
    return ok


def revisar_cola() -> None:
    if not os.environ.get("SUPABASE_URL"):
        return
    codigo, texto = _supabase(
        "/rest/v1/forge_jobs?status=eq.pending&select=id,prompt&order=created_at")
    if codigo >= 400 or codigo == 0:
        return
    try:
        filas = json.loads(texto)
    except json.JSONDecodeError:
        return
    if not filas:
        _linea(OK, "no hay trabajos esperando")
        return
    _linea(AVISO, f"{len(filas)} trabajo(s) en cola sin atender",
           "Los va a tomar en cuanto dejes corriendo:\n"
           "  python -m forge_agent.worker\n"
           "Ese proceso debe quedarse ABIERTO: es quien diseña.")
    for f in filas[:3]:
        print(f"        · {f['prompt'][:70]}")


# ── 4. Blender ──────────────────────────────────────────────────────────

def revisar_blender() -> None:
    ruta = os.environ.get("BLENDER_PATH")
    if ruta and os.path.exists(ruta):
        _linea(OK, f"Blender en {ruta}")
    elif ruta:
        _linea(MAL, f"BLENDER_PATH apunta a algo que no existe: {ruta}")
    elif shutil.which("blender"):
        _linea(AVISO, "hay blender en el PATH pero BLENDER_PATH no está definido",
               "Defínela para que el worker genere el 3D.")
    else:
        _linea(AVISO, "sin BLENDER_PATH: no se generará modelo 3D ni GLB",
               "Los documentos (cutlist, PDFs) sí se generan.")


# ── ─────────────────────────────────────────────────────────────────────

def main() -> int:
    print("\nDIAGNÓSTICO DE FORGE\n" + "─" * 62)

    proveedor = (os.environ.get("FORGE_PROVEEDOR") or "anthropic").strip().lower()
    print("\nPaquetes")
    paquetes_ok = revisar_paquetes(proveedor)
    if not paquetes_ok:
        print("\n" + "─" * 62)
        print(f"Instala lo que falta y vuelve a correr esto:\n  {INSTALAR}\n")
        return 1

    from . import proveedores
    print("\nModelos")
    try:
        cfg = proveedores.configurar()
        _linea(OK, f"constructor: {cfg['proveedor']} · {cfg['modelo']}")
    except RuntimeError as e:
        _linea(MAL, "configuración incompleta", str(e))
        print("\n" + "─" * 62)
        print("Arregla eso primero; lo demás depende de ello.\n")
        return 1
    lectura_ok = revisar_lectura()

    print("\nPlataforma")
    supa_ok = revisar_supabase()

    print("\nBlender")
    revisar_blender()

    print("\nModelo (esto sí gasta tokens)")
    modelo_ok = revisar_modelo(cfg)

    print("\nCola")
    revisar_cola()

    print("\n" + "─" * 62)
    if supa_ok and modelo_ok and lectura_ok:
        print("Todo en orden. Si aun así no pasa nada, es que el worker no está\n"
              "corriendo: déjalo abierto con  python -m forge_agent.worker\n")
        return 0
    print("Arregla las líneas con ✗ y vuelve a correr este diagnóstico.\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
