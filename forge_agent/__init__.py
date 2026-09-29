"""Forge Agent.

El motor vive en ../mono-forge y su paquete se llama mono_forge. Si no se
instaló con `pip install -e mono-forge`, `python -m forge_agent.worker` desde la
raíz del repo no lo encontraba y todo tronaba con "No module named
'mono_forge'" antes de poder decir qué faltaba. Se agrega la carpeta a la ruta
para que funcione con o sin la instalación.
"""

import os
import sys

_MOTOR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "mono-forge")
if os.path.isdir(_MOTOR) and _MOTOR not in sys.path:
    sys.path.insert(0, _MOTOR)


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
        return ["no está definida en ESTA terminal"]
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
