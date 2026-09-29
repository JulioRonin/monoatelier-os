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

#: lo que la plataforma ya guarda en .env.local con otro nombre
_EQUIVALENTES = {"SUPABASE_URL": "VITE_SUPABASE_URL",
                 "SUPABASE_KEY": "VITE_SUPABASE_ANON_KEY"}


def cargar_env_local(ruta: str | None = None) -> None:
    """Lee las llaves del .env.local del repo (no se sube a git).

    Definirlas con setx en Windows fallaba de mil formas: comillas guardadas
    como parte de la llave, el texto de ejemplo copiado tal cual, ventanas que
    no ven el cambio. Un archivo que se edita con el Bloc de notas no tiene
    esos problemas, y el agente cotizador ya lee sus llaves de ahí.

    Una variable del entorno siempre gana sobre el archivo.
    """
    ruta = ruta or os.path.join(RAIZ, ".env.local")
    try:
        with open(ruta, encoding="utf-8-sig") as f:
            lineas = f.read().splitlines()
    except OSError:
        return
    valores = {}
    for linea in lineas:
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        clave = clave.strip().removeprefix("export ").strip()
        valores[clave] = valor.strip().strip('"').strip("'").strip()
    for clave, alterna in _EQUIVALENTES.items():
        if clave not in valores and valores.get(alterna):
            valores[clave] = valores[alterna]
    for clave, valor in valores.items():
        actual = os.environ.get(clave, "")
        # "sk-ant-..." en el entorno es el ejemplo copiado, no una llave
        if valor and (not actual or "..." in actual):
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
    k = (os.environ.get("ANTHROPIC_API_KEY") or "").strip().strip('"').strip("'").strip()
    return k or None


def problemas_de_llave() -> list[str]:
    """Lo que se nota sin llamar a la API: comillas, texto de ejemplo, cortada."""
    crudo = os.environ.get("ANTHROPIC_API_KEY") or ""
    k = llave_anthropic() or ""
    p = []
    if not k:
        return ["no está definida: ponla en el archivo .env.local del repo"]
    if crudo != crudo.strip().strip('"').strip("'").strip():
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
