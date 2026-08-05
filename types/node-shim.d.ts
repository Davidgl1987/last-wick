/**
 * Shim mínimo de tipos de Node.
 *
 * El proyecto no incluye @types/node a propósito (la app es 100% navegador y
 * la sim debe permanecer libre de APIs de plataforma); el único código que
 * toca Node es el middleware dev del editor en vite.config.ts y el test de
 * `kit-models.ts` (que verifica en disco que `KIT_MODELS` coincide con
 * `public/models/kaykit/`, entorno `node` de vitest). Aquí se declara
 * EXCLUSIVAMENTE lo que esos ficheros usan, tipado sin `any`.
 */

declare module 'node:fs' {
  export function mkdirSync(path: string, options: { recursive: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}

/** Usado por vite.config.ts (ruta del middleware del editor) y por kit-models.test.ts (localizar `public/`). */
declare const process: { cwd(): string };
