/**
 * Test de humo del catálogo del kit (F1, docs/plans/ART_KIT_PLAN.md): entorno
 * `node` de vitest (sin DOM ni three, ver `vite.config.ts`), así que aquí SÍ
 * se puede tocar disco con `node:fs`/`node:path` — es justo lo que hace único
 * a este test frente al resto de la suite (que corre sobre la sim pura).
 *
 * Objetivo: que `KIT_MODELS` (mantenida a mano en `kit-models.ts`) y el
 * contenido real de `public/models/kaykit/` nunca diverjan en silencio — ni
 * un modelo listado que falte en disco, ni un `.gltf` añadido a mano a la
 * carpeta que se quede fuera del catálogo (y por tanto sin precargar).
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KIT_DIR, KIT_MODELS, kitModelUrl } from './kit-models';

const KIT_ROOT = resolve(process.cwd(), 'public', KIT_DIR);

describe('KIT_MODELS ↔ public/models/kaykit/', () => {
  it('cada nombre de KIT_MODELS tiene su .gltf y su .bin en disco', () => {
    for (const name of KIT_MODELS) {
      expect(existsSync(resolve(KIT_ROOT, `${name}.gltf`))).toBe(true);
      expect(existsSync(resolve(KIT_ROOT, `${name}.bin`))).toBe(true);
    }
  });

  it('no hay ningún .gltf en la carpeta que no esté registrado en KIT_MODELS', () => {
    const registered = new Set<string>(KIT_MODELS);
    const gltfFilesOnDisk = readdirSync(KIT_ROOT).filter((file) => file.endsWith('.gltf'));
    for (const file of gltfFilesOnDisk) {
      const name = file.slice(0, -'.gltf'.length);
      expect(registered.has(name), `${file} existe en disco pero no está en KIT_MODELS`).toBe(true);
    }
  });

  it('KIT_MODELS no tiene entradas huérfanas (mismo tamaño que los .gltf en disco)', () => {
    const gltfFilesOnDisk = readdirSync(KIT_ROOT).filter((file) => file.endsWith('.gltf'));
    expect(KIT_MODELS.length).toBe(gltfFilesOnDisk.length);
  });

  it('la textura compartida dungeon_texture.png existe', () => {
    expect(existsSync(resolve(KIT_ROOT, 'dungeon_texture.png'))).toBe(true);
  });
});

describe('kitModelUrl', () => {
  it('compone la ruta con un baseUrl con barra final (caso típico de import.meta.env.BASE_URL)', () => {
    expect(kitModelUrl('barrier', './')).toBe('./models/kaykit/barrier.gltf');
    expect(kitModelUrl('column', '/')).toBe('/models/kaykit/column.gltf');
  });

  it('compone la ruta igual con un baseUrl sin barra final', () => {
    expect(kitModelUrl('barrier', '.')).toBe('./models/kaykit/barrier.gltf');
    expect(kitModelUrl('column', '')).toBe('/models/kaykit/column.gltf');
  });
});
