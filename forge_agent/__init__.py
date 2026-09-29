"""Forge Agent.

El motor vive en ../mono-forge y su paquete se llama mono_forge. Si no se
instaló con `pip install -e mono-forge`, `python -m forge_agent.worker` desde la
raíz del repo no lo encontraba y todo tronaba con "No module named
'mono_forge'" antes de poder decir qué faltaba. Se agrega la carpeta a la ruta
para que funcione con o sin la instalación.
"""

import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_MOTOR = os.path.join(RAIZ, "mono-forge")
if os.path.isdir(_MOTOR) and _MOTOR not in sys.path:
    sys.path.insert(0, _MOTOR)

#: de dónde salió cada variable que se cargó del archivo (para el doctor)
DESDE_ARCHIVO: dict[str, str] = {}
#: variables que la terminal ya traía y el archivo reemplazó (para el doctor)
TAPADAS: dict[str, str] = {}
#: qué claves traía el archivo y si se pudo leer
LEIDO: dict[str, object] = {"ruta": None, "claves": []}

#: lo que la plataforma ya guarda en .env.local con otro nombre
_EQUIVALENTES = {"SUPABASE_URL": "VITE_SUPABASE_URL",
                 "SUPABASE_KEY": "VITE_SUPABASE_ANON_KEY"}

#: se cuelan al copiar de una página: espacio de ancho cero, BOM, NBSP
_INVISIBLES = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff\u00a0"))


def _limpio(t: str) -> str:
    return t.translate(_INVISIBLES).strip().strip('"').strip("'").strip()


def leer_texto(ruta: str) -> str | None:
    """El Bloc de notas guarda en UTF-8, UTF-8 con BOM o "Unicode" (UTF-16)."""
    try:
        with open(ruta, "rb") as f:
            crudo = f.read()
    except OSError:
        return None
    if crudo[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return crudo.decode("utf-16")
    try:
        return crudo.decode("utf-8-sig")
    except UnicodeDecodeError:
        return crudo.decode("latin-1")


def cargar_env_local(ruta: str | None = None) -> None:
    """Lee las llaves del .env.local del repo (no se sube a git).

    Definirlas con setx en Windows fallaba de mil formas: comillas guardadas
    como parte de la llave, el texto de ejemplo copiado tal cual, ventanas que
    no ven el cambio, y valores viejos que se quedan en el registro. Por eso
    el ARCHIVO manda: es lo único que se edita a la vista con el Bloc de
    notas. Lo que la terminal traía distinto se reporta en el doctor.
    """
    ruta = ruta or os.path.join(RAIZ, ".env.local")
    texto = leer_texto(ruta)
    if texto is None:
        return
    valores = {}
    for linea in texto.splitlines():
        linea = linea.translate(_INVISIBLES).strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        clave = clave.strip().removeprefix("export ").strip()
        valores[clave] = _limpio(valor)
    LEIDO.update(ruta=ruta, claves=sorted(valores))
    for clave, alterna in _EQUIVALENTES.items():
        if clave not in valores and valores.get(alterna):
            valores[clave] = valores[alterna]
    for clave, valor in valores.items():
        if not valor:
            continue
        actual = os.environ.get(clave)
        if actual is not None and _limpio(actual) != valor:
            TAPADAS[clave] = actual
        os.environ[clave] = valor
        DESDE_ARCHIVO[clave] = ruta


cargar_env_local()


def comando_instalar() -> str:
    """pip del MISMO Python que está corriendo.

    En Windows es común tener dos Python: `pip` instala en uno y `python`
    abre el otro, y el paquete "instalado" no aparece. Con el ejecutable
    exacto no hay forma de que caiga en el equivocado.
    """
    return f'"{sys.executable}" -m pip install -r forge_agent/requirements.txt'


def faltantes(modulos: list[str]) -> list[str]:
    """Los paquetes de la lista que ESTE Python no puede importar."""
    import importlib.util
    return [m for m in modulos if importlib.util.find_spec(m) is None]


def llave_anthropic() -> str | None:
    """ANTHROPIC_API_KEY sin espacios ni comillas alrededor.

    En cmd, `set ANTHROPIC_API_KEY="sk-ant-..."` guarda las comillas como
    parte del valor y Anthropic rechaza la llave. Una llave nunca lleva
    comillas, así que quitarlas es seguro.
    """
    return _limpio(os.environ.get("ANTHROPIC_API_KEY") or "") or None


def problemas_de_llave() -> list[str]:
    """Lo que se nota sin llamar a la API: comillas, texto de ejemplo, cortada."""
    crudo = os.environ.get("ANTHROPIC_API_KEY") or ""
    k = llave_anthropic() or ""
    p = []
    if not k:
        return ["no está definida: ponla en el archivo .env.local del repo"]
    if crudo != _limpio(crudo):
        p.append("trae comillas o espacios alrededor (se quitan solos, pero "
                 "corrige cómo la defines: en cmd va sin comillas)")
    if "..." in k or "…" in k:
        p.append("es el texto de EJEMPLO de las instrucciones, no tu llave: en "
                 "lugar de «sk-ant-...» va la llave COMPLETA (~108 caracteres) "
                 "que copias de console.anthropic.com")
    elif not k.startswith("sk-ant-"):
        p.append("no empieza con sk-ant- (¿es de otro servicio?)")
    elif len(k) < 90:
        p.append(f"mide {len(k)} caracteres; una llave completa mide ~108 "
                 "(¿se cortó al copiarla?)")
    return p


def llave_enmascarada() -> str:
    """Para comparar con la consola de Anthropic sin imprimir el secreto."""
    k = llave_anthropic() or ""
    if len(k) < 16:
        return f"«{k[:4]}…» ({len(k)} caracteres)"
    return f"{k[:12]}…{k[-4:]} ({len(k)} caracteres)"


def diagnostico_llave() -> list[str]:
    """Por qué no hay llave: qué se leyó del archivo y qué traía la terminal.
    Nombres de variables, nunca valores."""
    lineas = []
    ruta = LEIDO.get("ruta")
    if not ruta:
        lineas.append(f"No encontré {os.path.join(RAIZ, '.env.local')}.")
    else:
        claves = LEIDO.get("claves") or []
        lineas.append(f"Leí {ruta}: trae {', '.join(claves) or 'nada'}.")
        if "ANTHROPIC_API_KEY" not in claves:
            import difflib
            parecidas = difflib.get_close_matches(
                "ANTHROPIC_API_KEY", [c.upper() for c in claves], n=2, cutoff=0.75)
            lineas.append("No hay una línea ANTHROPIC_API_KEY=" + (
                f" (¿está mal escrita? veo {', '.join(parecidas)})" if parecidas
                else " guardada en ESE archivo (¿quedó sin guardar en el Bloc "
                     "de notas, o se guardó en otra carpeta?)."))
            for otro in (".env.local.txt", ".env", "env.local", ".env.txt"):
                if os.path.isfile(os.path.join(RAIZ, otro)):
                    lineas.append(f"Ojo: también existe {otro} en el repo; "
                                  "ése NO se lee.")
        elif _anthropic_vacia_en_archivo():
            lineas.append("La línea ANTHROPIC_API_KEY= está, pero sin nada "
                          "después del =.")
    if "ANTHROPIC_API_KEY" in TAPADAS:
        lineas.append("La terminal traía otra ANTHROPIC_API_KEY; se usa la del archivo.")
    return lineas


def _anthropic_vacia_en_archivo() -> bool:
    return ("ANTHROPIC_API_KEY" in (LEIDO.get("claves") or [])
            and "ANTHROPIC_API_KEY" not in DESDE_ARCHIVO)
