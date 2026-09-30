/**
 * La cotización en curso: en memoria Y en disco.
 *
 * Antes vivía sólo en la memoria del proceso y cada herramienta la buscaba por
 * un parámetro `sesion` que llenaba el modelo. Dos cosas la perdían:
 *
 *   · Que el proceso se reiniciara entre el primer renglón y el "sí, genérala"
 *     (Hermes reconecta sus servidores MCP cuando se cae la conexión).
 *   · Que el modelo mandara en cerrar_cotizacion un `sesion` distinto al de
 *     iniciar_cotizacion. Los modelos chicos inventan esos identificadores.
 *
 * En los dos casos el usuario veía "La sesión se perdió" y el modelo, para
 * arreglarlo, reabría la cotización de cero y había que dictar todo otra vez.
 *
 * Ahora hay UN borrador abierto a la vez, sin identificador de sesión, y cada
 * cambio se escribe a disco. Es una decisión para un taller donde cotiza una
 * persona: si algún día cotizan dos a la vez sobre el mismo bot, se pisarían
 * (y habría que volver a llevar una cuenta por conversación).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { QuoteItem } from '../types.js';

export interface Borrador {
    cliente: string;
    proyecto: string;
    fecha: string;
    entrega: string;
    notas?: string;
    items: QuoteItem[];
    avisos: string[];
}

/** Un borrador abandonado no debe resucitar mañana como si fuera de hoy. */
export const VIGENCIA_MS = 12 * 60 * 60 * 1000;

const SIN_BORRADOR =
    'No hay una cotización abierta. Usa iniciar_cotizacion con el cliente, ' +
    'el nombre del proyecto y la fecha de entrega.';

interface Guardado { actualizado: number; borrador: Borrador }

const igual = (a: string, b: string) =>
    a.trim().toLocaleLowerCase('es-MX') === b.trim().toLocaleLowerCase('es-MX');

export class Borradores {
    private actual: Guardado | null = null;
    private leido = false;
    private caducado = false;

    constructor(private ruta: () => string, private ahora: () => number = Date.now) {}

    /** Lee el archivo la primera vez: es lo que sobrevive a un reinicio. */
    private cargar(): void {
        if (this.leido) return;
        this.leido = true;
        try {
            const g = JSON.parse(readFileSync(this.ruta(), 'utf8')) as Guardado;
            const ok = g && typeof g.actualizado === 'number' && g.borrador
                && Array.isArray(g.borrador.items) && Array.isArray(g.borrador.avisos);
            if (!ok) return;
            if (this.ahora() - g.actualizado > VIGENCIA_MS) { this.caducado = true; return; }
            this.actual = g;
        } catch {
            /* sin archivo, o ilegible: se empieza limpio; un borrador no vale un fallo */
        }
    }

    private escribir(): void {
        const ruta = this.ruta();
        try {
            mkdirSync(dirname(ruta), { recursive: true });
            // se escribe aparte y se renombra: si matan el proceso a media
            // escritura, queda el archivo anterior entero y no uno cortado
            const tmp = `${ruta}.${process.pid}.tmp`;
            writeFileSync(tmp, JSON.stringify(this.actual));
            renameSync(tmp, ruta);
        } catch {
            /* sin disco el borrador sigue vivo en memoria: no se corta la conversación */
        }
    }

    /** ¿Hay algo abierto? Sin lanzar error, para decidir qué decirle al usuario. */
    hay(): Borrador | null {
        this.cargar();
        return this.actual && this.ahora() - this.actual.actualizado <= VIGENCIA_MS
            ? this.actual.borrador : null;
    }

    /**
     * Abre una cotización.
     *
     * Si ya hay una del MISMO cliente y proyecto, la conserva con sus
     * partidas: el modelo reabre "para arreglar algo" y borrarla es perder
     * todo lo dictado. Si es otra distinta, la reemplaza y lo dice.
     */
    abrir(nuevo: Omit<Borrador, 'items' | 'avisos'>): { borrador: Borrador; aviso?: string } {
        const previo = this.hay();
        if (previo && igual(previo.cliente, nuevo.cliente) && igual(previo.proyecto, nuevo.proyecto)) {
            previo.entrega = nuevo.entrega;
            previo.fecha = nuevo.fecha;
            this.guardar();
            return {
                borrador: previo,
                aviso: `Esa cotización ya estaba abierta y sigue con sus ${previo.items.length} ` +
                       `partida(s): no hace falta volver a abrirla.`,
            };
        }
        const aviso = previo && previo.items.length
            ? `Se descartó la cotización que estaba abierta (${previo.cliente} — ${previo.proyecto}, ` +
              `${previo.items.length} partida(s)) sin cerrarla.`
            : undefined;
        this.actual = { actualizado: this.ahora(), borrador: { ...nuevo, items: [], avisos: [] } };
        this.leido = true;
        this.caducado = false;
        this.escribir();
        return { borrador: this.actual.borrador, aviso };
    }

    tomar(): Borrador {
        const b = this.hay();
        if (b) return b;
        throw new Error(this.caducado
            ? 'La cotización que había quedado abierta es de hace más de 12 horas y se descartó. ' +
              SIN_BORRADOR
            : SIN_BORRADOR);
    }

    /** Escribe el estado actual. Se llama después de cada cambio al borrador. */
    guardar(): void {
        if (!this.actual) return;
        this.actual.actualizado = this.ahora();
        this.escribir();
    }

    /** La cotización se cerró: no debe quedar nada que pueda resucitar. */
    cerrar(): void {
        this.actual = null;
        this.leido = true;
        this.caducado = false;
        try { if (existsSync(this.ruta())) unlinkSync(this.ruta()); } catch { /* ya no está */ }
    }
}
