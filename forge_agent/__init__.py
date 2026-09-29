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
