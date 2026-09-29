import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * En `npm run dev` monta la misma función que Vercel sirve en /api/facturapi,
 * con las variables del .env.local. Así la llave de Facturapi tampoco pasa por
 * el navegador en desarrollo.
 */
const funcionesLocales = (env: Record<string, string>): Plugin => ({
    name: 'funciones-locales',
    configureServer(server) {
        for (const [k, v] of Object.entries(env)) {
            if (process.env[k] === undefined) process.env[k] = v;
        }
        server.middlewares.use('/api/facturapi', async (req, res) => {
            const { default: handler } = await import('./api/facturapi');
            await handler(req as any, res);
        });
    },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), funcionesLocales(env)],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
