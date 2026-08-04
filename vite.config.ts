/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Los tipos de node:fs/node:path vienen de types/node-shim.d.ts (el proyecto
// no incluye @types/node a propósito: la app es 100% navegador).
declare const process: { cwd(): string };

/** Forma mínima de la petición/respuesta HTTP de Connect que usa el middleware. */
interface DevRequest {
  method?: string;
  on(event: 'data', listener: (chunk: { toString(encoding: 'utf8'): string }) => void): void;
  on(event: 'end', listener: () => void): void;
}
interface DevResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

/**
 * Middleware SOLO en dev (GDD §13): el editor hace POST /api/editor/rooms con
 * el JSON de una sala y aquí se escribe en
 * src/game/features/dungeon/levels/<id>.json, para que las salas creadas en el
 * editor entren al repo (y al pool de serie) sin copiar ficheros a mano. En
 * build/producción este endpoint no existe.
 */
function editorRoomsEndpoint(): Plugin {
  return {
    name: 'last-wick-editor-rooms-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/editor/rooms', (rawReq, rawRes) => {
        const req = rawReq as unknown as DevRequest;
        const res = rawRes as unknown as DevResponse;
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString('utf8');
        });
        req.on('end', () => {
          void (async () => {
            try {
              const parsed: unknown = JSON.parse(body);
              const id =
                typeof parsed === 'object' && parsed !== null && 'id' in parsed
                  ? String((parsed as { id: unknown }).id)
                  : '';
              // El id se usa como nombre de fichero: solo caracteres seguros.
              if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
                res.statusCode = 400;
                res.end('Identificador de sala inválido para nombre de fichero.');
                return;
              }
              const { mkdirSync, writeFileSync } = await import('node:fs');
              const { resolve } = await import('node:path');
              const levelsDir = resolve(process.cwd(), 'src/game/features/dungeon/levels');
              mkdirSync(levelsDir, { recursive: true });
              writeFileSync(resolve(levelsDir, `${id}.json`), JSON.stringify(parsed, null, 2) + '\n', 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, file: `src/game/features/dungeon/levels/${id}.json` }));
            } catch {
              res.statusCode = 400;
              res.end('JSON inválido.');
            }
          })();
        });
      });
    },
  };
}

// base './' → rutas relativas, necesario para servir desde GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react(), editorRoomsEndpoint()],
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
    },
  },
  server: {
    host: true,
    // Dominios de túnel ngrok permitidos (Vite bloquea por defecto cualquier
    // Host header no listado, para prevenir DNS-rebinding). El sufijo previo
    // (.ngrok-free.dev) estaba mal escrito: el dominio real de los túneles
    // gratuitos de ngrok es .ngrok-free.app; .ngrok.io es el legado de pago.
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.io'],
  },
  build: {
    rollupOptions: {
      output: {
        // Troceo del bundle (arranque rápido, GDD §14): three es con diferencia
        // la dependencia más pesada y cambia poco → chunk propio cacheable;
        // react/react-dom y fiber igual. El código del juego queda en un chunk
        // pequeño, el único que cambia entre despliegues.
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
          r3f: ['@react-three/fiber'],
        },
      },
    },
    // three.js es un vendor monolítico: su chunk minificado ronda los 700 kB
    // (~180 kB gzip) y no se puede trocear más. Con el troceo de arriba el
    // código propio queda muy por debajo; subimos el umbral solo para no
    // convertir ese chunk conocido y cacheable en un warning permanente.
    chunkSizeWarningLimit: 750,
  },
  test: {
    // Solo tests headless de la simulación (sin DOM ni three.js).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
