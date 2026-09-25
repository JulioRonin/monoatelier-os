/**
 * Dónde está el repositorio, sin que nadie tenga que escribirlo.
 *
 * Hermes lanza este servidor como subproceso y el directorio de trabajo es el
 * suyo, no el del repo. Si las rutas se resolvieran contra `process.cwd()`, la
 * plantilla no aparecería y el error sería un "no encontré el archivo" sin
 * pistas.
 *
 * Además la plantilla se llama "TEMPLATE Mono Atelier  (1).pdf" — con DOS
 * espacios seguidos. Escribir eso a mano en un YAML de Windows es una trampa;
 * mejor que el programa la encuentre solo.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let cache: string | null = null;

/** Sube directorios hasta encontrar el package.json del proyecto. */
export function raizRepo(): string {
    if (cache) return cache;
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
        const pj = join(dir, 'package.json');
        if (existsSync(pj)) {
            try {
                if (JSON.parse(readFileSync(pj, 'utf8')).name === 'mono-atelier-os') {
                    return (cache = dir);
                }
            } catch { /* package.json ilegible: seguir subiendo */ }
        }
        const padre = dirname(dir);
        if (padre === dir) break;
        dir = padre;
    }
    return (cache = process.cwd());
}

/**
 * La plantilla del PDF.
 *
 * Si COTIZADOR_PLANTILLA está definida, manda esa. Si no, se busca en public/
 * el primer PDF cuyo nombre empiece con TEMPLATE: así un renombre o un espacio
 * de más no rompe nada.
 */
export function rutaPlantilla(): string {
    const explicita = process.env.COTIZADOR_PLANTILLA;
    if (explicita) return resolve(explicita);

    const pub = join(raizRepo(), 'public');
    try {
        const candidatos = readdirSync(pub)
            .filter(f => /^template.*\.pdf$/i.test(f))
            .sort((a, b) => b.length - a.length);   // el más específico primero
        if (candidatos.length) return join(pub, candidatos[0]);
    } catch { /* sin carpeta public */ }
    return join(pub, 'TEMPLATE Mono Atelier  (1).pdf');
}

/** Dónde se escriben los PDF generados. */
export const rutaSalida = (): string =>
    process.env.COTIZADOR_SALIDA
        ? resolve(process.env.COTIZADOR_SALIDA)
        : join(raizRepo(), 'cotizaciones');
