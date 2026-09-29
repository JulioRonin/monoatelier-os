/**
 * Función de Vercel: /api/facturapi?ruta=invoices/abc/pdf&...
 *
 * Sólo adapta la petición de Node al núcleo (_facturapi.ts). El mismo
 * adaptador lo usa `npm run dev` (vite.config.ts), así que local y en Vercel
 * se comporta igual.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { atender, entornoDe } from './_facturapi.js';

type Req = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> };

async function leerCuerpo(req: Req): Promise<unknown> {
    // Vercel ya lo parsea; el servidor de desarrollo de Vite no
    if (req.body !== undefined) {
        return typeof req.body === 'string' ? JSON.parse(req.body || 'null') : req.body;
    }
    const partes: Buffer[] = [];
    for await (const c of req) partes.push(c as Buffer);
    const texto = Buffer.concat(partes).toString('utf8');
    return texto ? JSON.parse(texto) : undefined;
}

export default async function handler(req: Req, res: ServerResponse) {
    try {
        const url = new URL(req.url || '/', 'http://localhost');
        const query: Record<string, string> = {};
        url.searchParams.forEach((v, k) => { query[k] = v; });
        const r = await atender({
            metodo: req.method || 'GET',
            ruta: query.ruta || '',
            query,
            cuerpo: req.method === 'POST' ? await leerCuerpo(req) : undefined,
            authorization: req.headers.authorization,
        }, entornoDe(process.env));
        res.writeHead(r.status, r.headers);
        res.end(r.body);
    } catch (e: any) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `No se pudo hablar con Facturapi: ${e?.message || e}` }));
    }
}
