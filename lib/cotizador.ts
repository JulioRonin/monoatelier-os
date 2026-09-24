/**
 * Cotizador — el precio, sin pantalla de por medio.
 *
 * Esta lógica vivía dentro del componente de React, enredada con el estado de
 * la UI. El agente de chat no tiene UI, así que o se compartía o se copiaba; y
 * una copia se separa. En concreto volvería a aparecer el defecto que ya costó
 * dinero: tratar un adicional como sustitución hacía que elegir
 * "Cascada $2,000" en una cocina de $2,850/ml BAJARA el precio a $2,000/ml.
 *
 * Reglas que esto encapsula, y que nadie debe volver a escribir aparte:
 *
 *   sustitucion  REEMPLAZA el precio base   (granito en lugar de cuarzo)
 *   adicional    SE SUMA al precio base     (cascada, LED, herrajes)
 *   opcion       no mueve el precio         (4 / 6 / 8 personas)
 *
 * Todo aquí es puro: sin red, sin DOM, sin Supabase. Se puede probar solo.
 */

import type { Service, ServiceVariable, QuoteItem } from '../types';

// ---------------------------------------------------------------------------
// Clasificación
// ---------------------------------------------------------------------------

export interface VariantesClasificadas {
    sustituciones: ServiceVariable[];
    adicionales: ServiceVariable[];
    opciones: ServiceVariable[];
}

/** Separa las variantes de un servicio por lo que le hacen al precio. */
export function clasificarVariantes(
    variantes: ServiceVariable[],
    servicioId: string,
): VariantesClasificadas {
    const propias = variantes.filter(v => v.serviceId === servicioId && v.active !== false);
    return {
        sustituciones: propias.filter(v => v.kind === 'sustitucion'),
        adicionales:   propias.filter(v => v.kind === 'adicional'),
        opciones:      propias.filter(v => v.kind === 'opcion'),
    };
}

/**
 * Una sustitución que cuesta MENOS que su servicio casi siempre está mal
 * clasificada: es un incremento, no un reemplazo. Elegirla abarata la
 * cotización sin que nadie lo note.
 *
 * No se corrige sola —sería decidir un precio por el dueño— pero sí se avisa,
 * y el agente debe repetir el aviso antes de cotizar con ella.
 */
export function sospechaDeClasificacion(
    servicio: Service,
    variante: ServiceVariable,
): string | null {
    if (variante.kind !== 'sustitucion') return null;
    const p = Number(variante.price) || 0;
    const base = Number(servicio.basePrice) || 0;
    if (p <= 0 || base <= 0 || p >= base) return null;
    return `"${variante.name}" está marcada como sustitución y cuesta ${p} contra ` +
           `${base} del servicio: al elegirla el precio BAJA. Si es un extra, ` +
           `debería ser "adicional" — revísalo en la pantalla de Precios.`;
}

// ---------------------------------------------------------------------------
// Precio
// ---------------------------------------------------------------------------

/** Precio unitario de la partida base; la sustitución lo reemplaza. */
export function precioUnitario(
    servicio: Service,
    sustitucion?: ServiceVariable | null,
): number {
    if (sustitucion && Number(sustitucion.price) > 0) return Number(sustitucion.price);
    return Number(servicio.basePrice) || 0;
}

/**
 * Cuántas veces se cobra un adicional.
 *
 * Con la MISMA unidad que el servicio va por la misma cantidad; con unidad
 * distinta (o sin unidad) va como pieza. Multiplicar una cascada por los metros
 * de la cocina sería cobrarla cinco veces.
 */
export function cantidadDe(
    adicional: ServiceVariable,
    servicio: Service,
    cantidad: number,
): number {
    const ua = (adicional.units ?? '').toString().toLowerCase();
    const us = (servicio.units ?? '').toString().toLowerCase();
    return ua && us && ua === us ? cantidad : 1;
}

export interface Seleccion {
    servicio: Service;
    cantidad: number;
    sustitucion?: ServiceVariable | null;
    adicionales?: ServiceVariable[];
}

/**
 * Convierte una selección en partidas de cotización.
 *
 * Cada adicional va como SU PROPIA partida: el cliente lo ve desglosado y cada
 * uno lleva la cantidad que le toca.
 */
export function partidasDe(sel: Seleccion): QuoteItem[] {
    const { servicio, cantidad, sustitucion, adicionales = [] } = sel;

    const partidas: QuoteItem[] = [{
        description: sustitucion ? `${servicio.name} - ${sustitucion.name}` : servicio.name,
        quantity: cantidad,
        unitPrice: precioUnitario(servicio, sustitucion),
    }];

    for (const a of adicionales) {
        partidas.push({
            description: a.name,
            quantity: cantidadDe(a, servicio, cantidad),
            unitPrice: Number(a.price) || 0,
        });
    }
    return partidas;
}

/** Importe de una partida. */
export const importeDe = (i: QuoteItem): number =>
    (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0);

export interface Totales {
    subtotal: number;
    iva: number;
    total: number;
    tasaIva: number;
}

/** Los tres números de abajo de la cotización, con la tasa que se usó. */
export function totalesDe(items: QuoteItem[], tasaIva: number): Totales {
    const subtotal = redondear(items.reduce((t, i) => t + importeDe(i), 0));
    const iva = redondear(subtotal * tasaIva);
    return { subtotal, iva, total: redondear(subtotal + iva), tasaIva };
}

export function redondear(n: number, decimales = 2): number {
    const f = 10 ** decimales;
    return Math.round((n + Number.EPSILON) * f) / f;
}

// ---------------------------------------------------------------------------
// Precio desde costo
// ---------------------------------------------------------------------------

/**
 * Precio a partir del costo directo y el margen.
 *
 * El margen es sobre PRECIO, no sobre costo: `precio = costo / (1 − margen)`.
 * Es la misma fórmula de `mono_forge/costing.py`; calcularlo como
 * `costo × (1 + margen)` daría menos precio y una sensación de ganancia que no
 * existe (35% sobre costo es apenas 26% sobre precio).
 *
 * El margen NUNCA se imprime en un documento del cliente.
 */
export function precioDesdeCosto(costoDirecto: number, margen: number): number {
    if (!(margen > 0) || margen >= 1) return redondear(costoDirecto);
    return redondear(costoDirecto / (1 - margen));
}

/** Margen real de un precio ya puesto: (precio − costo) / precio. */
export function margenDe(precio?: number | null, costo?: number | null): number | null {
    if (precio == null || costo == null || precio <= 0) return null;
    return (precio - costo) / precio;
}

// ---------------------------------------------------------------------------
// Búsqueda por nombre (para el agente)
// ---------------------------------------------------------------------------

const normalizar = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Busca servicios por nombre aproximado.
 *
 * El agente recibe "cocina" o "cubierta de cuarzo" en lenguaje natural; esto
 * devuelve los candidatos ORDENADOS para que el agente pregunte cuál, en vez
 * de elegir por su cuenta. Un servicio mal elegido es una cotización mal hecha.
 */
export function buscarServicios(servicios: Service[], texto: string): Service[] {
    const q = normalizar(texto);
    if (!q) return [];
    const palabras = q.split(/\s+/);
    return servicios
        .filter(s => s.active !== false)
        .map(s => {
            const n = normalizar(s.name);
            const c = normalizar(s.category ?? '');
            let puntos = 0;
            if (n === q) puntos += 100;
            if (n.includes(q)) puntos += 50;
            for (const p of palabras) {
                if (n.includes(p)) puntos += 10;
                if (c.includes(p)) puntos += 3;
            }
            return { s, puntos };
        })
        .filter(x => x.puntos > 0)
        .sort((a, b) => b.puntos - a.puntos)
        .map(x => x.s);
}
