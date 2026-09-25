/**
 * ¿Por qué no funciona el agente? — revisa la cadena y dice dónde se rompe.
 *
 *     npm run doctor:agente
 *
 * Va en orden, de lo más básico a lo más caro: compilación → llaves →
 * Supabase → tablas → catálogo → plantilla → PDF de prueba. Cada línea que
 * falla dice QUÉ hacer, no sólo que falló.
 *
 * No modifica nada de la base. Sí escribe un PDF de prueba para comprobar que
 * el paso final funciona de verdad.
 */

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { raizRepo, rutaPlantilla, rutaSalida } from './rutas.js';
import { urlSupabase, llaveSupabase } from './supabase.js';

const OK = '  ✓', MAL = '  ✗', AVISO = '  !';
let fallas = 0;

function linea(marca: string, texto: string, ayuda = '') {
    if (marca === MAL) fallas++;
    console.log(`${marca} ${texto}`);
    for (const l of ayuda.split('\n').filter(Boolean)) console.log(`      ${l}`);
}

async function rest(ruta: string): Promise<{ codigo: number; cuerpo: string }> {
    const k = llaveSupabase()!;
    try {
        const r = await fetch(`${urlSupabase()}/rest/v1${ruta}`, {
            headers: { apikey: k, Authorization: `Bearer ${k}` },
        });
        return { codigo: r.status, cuerpo: (await r.text()).slice(0, 300) };
    } catch (e: any) {
        return { codigo: 0, cuerpo: e.message };
    }
}

async function main() {
    console.log('\nDIAGNÓSTICO DEL AGENTE COTIZADOR\n' + '─'.repeat(62));
    console.log(`\nRepo: ${raizRepo()}`);

    // ── 1. compilación ───────────────────────────────────────────────────
    console.log('\nCompilación');
    const servidor = join(raizRepo(), 'agente-cotizador/dist/agente-cotizador/servidor.js');
    if (existsSync(servidor)) {
        linea(OK, 'servidor compilado');
        console.log(`      ${servidor}`);
        console.log('      ↑ ESTA es la ruta que va en el config de Hermes');
    } else {
        linea(MAL, 'falta compilar el servidor', 'Corre:  npm run build:agente');
    }

    // ── 2. llaves ────────────────────────────────────────────────────────
    console.log('\nLlaves');
    const url = urlSupabase();
    const llave = llaveSupabase();
    if (url) linea(OK, `SUPABASE_URL → ${url}`);
    else linea(MAL, 'sin SUPABASE_URL',
        'Ponla en el config de Hermes, o deja VITE_SUPABASE_URL en el .env.local del repo.');

    if (llave) {
        const tipo = llave.length > 100 ? 'JWT' : 'corta';
        linea(OK, `SUPABASE_KEY presente (${tipo}, termina en …${llave.slice(-6)})`);
    } else {
        linea(MAL, 'sin SUPABASE_KEY',
            'Supabase → Project Settings → API. Empieza con la anon key;\n' +
            'si los guardados fallan por permisos, usa la service_role.');
    }

    if (!url || !llave) {
        console.log('\n' + '─'.repeat(62));
        console.log('Sin llaves no puedo revisar lo demás.\n');
        return 1;
    }

    // ── 3. Supabase y tablas ─────────────────────────────────────────────
    console.log('\nPlataforma');
    const TABLAS: [string, string][] = [
        ['services', 'supabase/migrations/20260808_master_list.sql'],
        ['service_variables', 'supabase/migrations/20260808_master_list.sql'],
        ['ajustes', 'supabase/migrations/20260924_tarifas.sql'],
        ['quotes', 'la tabla de cotizaciones de la plataforma'],
        ['projects', 'la tabla de proyectos de la plataforma'],
    ];
    for (const [tabla, migracion] of TABLAS) {
        const r = await rest(`/${tabla}?select=*&limit=1`);
        if (r.codigo === 0) {
            linea(MAL, `no pude conectar a Supabase: ${r.cuerpo}`,
                'Revisa SUPABASE_URL y que la red no bloquee el dominio.');
            break;
        }
        if (r.codigo === 401 || r.codigo === 403) {
            linea(MAL, 'Supabase rechazó la llave',
                'La llave no corresponde a este proyecto, o caducó.');
            break;
        }
        if (r.codigo === 404 || r.cuerpo.includes('does not exist')) {
            linea(MAL, `falta la tabla ${tabla}`, `Corre ${migracion}`);
            continue;
        }
        if (r.codigo >= 400) { linea(MAL, `${tabla} respondió ${r.codigo}: ${r.cuerpo}`); continue; }
        linea(OK, `tabla ${tabla} accesible`);
    }

    // Que la tabla exista no basta: una migración a medias deja la tabla sin
    // las columnas nuevas, y el error que sale ("column ... does not exist") no
    // dice qué archivo falta. Se piden por nombre, que es como se detecta.
    console.log('\nColumnas');
    const COLUMNAS: [string, string[], string][] = [
        ['services', ['cost', 'active', 'price_updated_at', 'sku'],
         'supabase/migrations/20260808_master_list.sql'],
        ['service_variables', ['kind', 'sort_order', 'cost', 'units', 'active'],
         'supabase/migrations/20260808_master_list.sql'],
        ['projects', ['sold_at', 'quote_id'],
         'supabase/migrations/20260925_fecha_de_venta.sql'],
    ];
    for (const [tabla, columnas, migracion] of COLUMNAS) {
        const faltan: string[] = [];
        for (const col of columnas) {
            const r = await rest(`/${tabla}?select=${col}&limit=1`);
            if (r.codigo >= 400) faltan.push(col);
        }
        if (faltan.length) {
            linea(MAL, `a ${tabla} le faltan columnas: ${faltan.join(', ')}`,
                `Corre ${migracion}\n` +
                (faltan.includes('kind')
                    ? 'Sin "kind" no se distingue una sustitución de un adicional,\n' +
                      'que es lo que hace que una cotización salga de menos.\n'
                    : '') +
                (faltan.includes('sold_at')
                    ? 'Sin "sold_at" el reporte de ventas no sabe en qué mes entró\n' +
                      'cada venta y tiene que medir con la fecha de arranque de obra,\n' +
                      'que puede caer meses después.'
                    : ''));
        } else {
            linea(OK, `${tabla} tiene las columnas que el agente necesita`);
        }
    }

    // ── 4. catálogo con datos ────────────────────────────────────────────
    console.log('\nCatálogo');
    try {
        const { leerServicios, leerVariantes, leerAjustes } = await import('./supabase.js');
        const [svc, vars, aj] = await Promise.all([leerServicios(), leerVariantes(), leerAjustes()]);
        const activos = svc.filter(s => s.active !== false);
        if (!activos.length) {
            linea(MAL, 'no hay servicios activos',
                'Sin catálogo el agente no puede cotizar de lista. Cárgalos en Precios.');
        } else {
            linea(OK, `${activos.length} servicio(s) activos, ${vars.length} variante(s)`);
        }

        const iva = typeof aj.iva === 'number' ? aj.iva : null;
        if (iva == null) linea(AVISO, 'sin IVA en ajustes: se usará 8% por omisión');
        else linea(OK, `IVA ${(iva * 100).toFixed(0)}%`);

        const margen = typeof aj.margen_objetivo === 'number' ? aj.margen_objetivo : null;
        if (margen == null || margen <= 0) {
            linea(AVISO, 'sin margen objetivo',
                'Cotizar POR COSTO no va a funcionar hasta capturarlo en Precios.');
        } else {
            linea(OK, `margen objetivo ${(margen * 100).toFixed(0)}%`);
        }

        // Las variantes que abaratan: el defecto que cotiza de menos
        const sospechosas = vars.filter(v => {
            if (v.active === false || v.kind !== 'sustitucion' || !v.price) return false;
            const s = svc.find(x => x.id === v.service_id);
            return !!s && Number(v.price) < Number(s.base_price ?? 0);
        });
        if (sospechosas.length) {
            linea(AVISO, `${sospechosas.length} variante(s) marcadas como sustitución que ABARATAN su servicio`,
                'Elegirlas baja el precio de la cotización. Arréglalas en Precios:\n' +
                sospechosas.slice(0, 5).map(v => `  · ${v.name}`).join('\n'));
        } else {
            linea(OK, 'ninguna variante abarata su servicio');
        }
    } catch (e: any) {
        // 42703 = columna inexistente. Es siempre una migración sin correr, y
        // decirlo así ahorra ir a buscar qué significa el código.
        const falta = /column ([\w.]+) does not exist/.exec(e.message)?.[1];
        linea(MAL, `no pude leer el catálogo: ${e.message.slice(0, 120)}`,
            falta
                ? `Falta la columna ${falta}: corre supabase/migrations/20260808_master_list.sql`
                : '');
    }

    // ── 5. plantilla y PDF ───────────────────────────────────────────────
    console.log('\nPDF');
    const plantilla = rutaPlantilla();
    if (!existsSync(plantilla)) {
        linea(MAL, `no encuentro la plantilla en ${plantilla}`,
            'Debe estar en public/ del repo, o define COTIZADOR_PLANTILLA.');
    } else {
        linea(OK, `plantilla: ${plantilla}`);
        try {
            const { generarCotizacionPdf } = await import('../lib/cotizacionPdf.js');
            const bytes = await generarCotizacionPdf({
                id: '', projectName: 'Prueba del doctor', clientName: 'Cliente de prueba',
                deliveryTime: '2026-12-31', date: new Date().toISOString().slice(0, 10),
                items: [{ description: 'Partida de prueba', quantity: 1, unitPrice: 1000 }],
                status: 'Draft', totalAmount: 1000,
            } as any, { plantilla: readFileSync(plantilla), iva: 0.08 });

            mkdirSync(rutaSalida(), { recursive: true });
            const destino = join(rutaSalida(), '_prueba_doctor.pdf');
            writeFileSync(destino, bytes);
            linea(OK, `PDF de prueba generado (${Math.round(bytes.length / 1024)} KB)`);
            console.log(`      ${destino}`);
        } catch (e: any) {
            linea(MAL, `no pude generar el PDF: ${e.message}`);
        }
    }

    console.log('\n' + '─'.repeat(62));
    if (!fallas) {
        console.log('Todo en orden. Copia la ruta del servidor al config de Hermes\n' +
                    '(~/.hermes/config.yaml) y pídele en Discord: "muéstrame el catálogo".\n');
        return 0;
    }
    console.log(`Arregla las ${fallas} línea(s) con ✗ y vuelve a correr esto.\n`);
    return 1;
}

process.exit(await main());
