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
