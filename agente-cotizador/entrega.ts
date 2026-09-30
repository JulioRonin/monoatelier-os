/**
 * Cómo se le pide a Hermes que suba un archivo al chat.
 *
 * Hermes sube un archivo como adjunto nativo cuando el TEXTO FINAL del agente
 * lleva una etiqueta `MEDIA:<ruta>`. Su expresión regular (gateway/platforms/
 * base.py) acepta rutas de Windows con letra de unidad, `C:/…` o `C:\…`, y
 * trata los PDF como documentos. Reglas que hay que respetar:
 *
 *   1. Sólo mira el texto final del agente, no la salida de las herramientas.
 *   2. Ignora lo que va dentro de `comillas invertidas` o de un bloque de
 *      código, para no romper ejemplos: si el modelo formatea la etiqueta
 *      como código, no se adjunta nada y el usuario ve la ruta.
 *
 * Antes se pedía la RUTA SUELTA, sin etiqueta. Esa detección está pensada para
 * rutas estilo Linux (`/home/…`); con `C:\Users\…` en Windows no adjuntaba y
 * llegaba el texto de la ruta. La etiqueta sí funciona en las dos.
 *
 * Se escribe con `/` y no con `\`: Discord trata la barra invertida como
 * escape y los modelos la duplican o se la comen al copiar.
 */

/** C:\Users\ORKA\x.pdf → C:/Users/ORKA/x.pdf. Windows abre las dos. */
export const rutaParaChat = (ruta: string): string => ruta.replace(/\\/g, '/');

export const etiquetaMedia = (ruta: string): string => `MEDIA:${rutaParaChat(ruta)}`;

export const comoEntregar = (ruta: string): string =>
    'Para que el usuario reciba el PDF como archivo adjunto en el chat, termina tu ' +
    'respuesta con esta línea EXACTA, sola en su renglón, sin comillas invertidas ' +
    'y sin bloque de código (si la formateas como código no se adjunta):\n' +
    etiquetaMedia(ruta);
