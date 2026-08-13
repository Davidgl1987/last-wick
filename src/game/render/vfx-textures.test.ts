/**
 * Test de humo del catálogo de VFX (docs/plans/VFX_PLAN.md, T0): entorno
 * `node` de vitest (sin DOM ni three, ver `vite.config.ts`), calca
 * `kit-models.test.ts` — mismo objetivo: que ningún nombre de la tabla
 * (`VFX_TEXTURE_NAMES`, mantenida a mano en `vfx-textures.ts`) apunte a un
 * fichero que no está en disco.
 *
 * Este test puede importar `vfx-textures.ts` sin arrastrar DOM/three porque
 * ese módulo carga las texturas de forma PEREZOSA (ver su cabecera): solo se
 * evalúan aquí la tabla de nombres y la función pura `vfxTextureUrl`, nunca
 * `vfxTexture`/`additiveVfxMaterial`/`splatVfxMaterial` (esas sí tocarían
 * `THREE.TextureLoader`, que llama a `document.createElementNS` y reventaría
 * en este entorno).
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIGHT_MASK_NAMES, SPLAT_NAMES, VFX_DIR, VFX_TEXTURE_NAMES, vfxTextureUrl } from './vfx-textures';

const VFX_ROOT = resolve(process.cwd(), 'public', VFX_DIR);

describe('VFX_TEXTURE_NAMES ↔ public/textures/vfx/', () => {
  it('cada nombre de VFX_TEXTURE_NAMES tiene su .png en disco', () => {
    for (const name of VFX_TEXTURE_NAMES) {
      expect(existsSync(resolve(VFX_ROOT, `${name}.png`))).toBe(true);
    }
  });

  it('VFX_TEXTURE_NAMES no tiene nombres repetidos', () => {
    expect(new Set<string>(VFX_TEXTURE_NAMES).size).toBe(VFX_TEXTURE_NAMES.length);
  });

  it('LIGHT_MASK_NAMES y SPLAT_NAMES no se solapan (son tipos distintos a propósito, ver regla de blending)', () => {
    const overlap = LIGHT_MASK_NAMES.filter((name): boolean => (SPLAT_NAMES as readonly string[]).includes(name));
    expect(overlap).toEqual([]);
  });

  // Sin número total hardcodeado a propósito: el catálogo CRECE cada vez que
  // una familia de efectos pide su propia silueta (la ampliación de 2026-08-11
  // añadió 3 texturas y rompió este test cuando afirmaba "16 en total"). Lo que
  // debe seguir siendo cierto es la relación entre las tres listas, no su tamaño.
  it('VFX_TEXTURE_NAMES es exactamente la unión de LIGHT_MASK_NAMES y SPLAT_NAMES', () => {
    expect(VFX_TEXTURE_NAMES.length).toBe(LIGHT_MASK_NAMES.length + SPLAT_NAMES.length);
    expect([...VFX_TEXTURE_NAMES].sort()).toEqual([...LIGHT_MASK_NAMES, ...SPLAT_NAMES].sort());
  });

  it('no hay ningún .png suelto en public/textures/vfx/ fuera del catálogo (ni LICENSE/README)', () => {
    const pngsOnDisk = readdirSync(VFX_ROOT).filter((f) => f.endsWith('.png'));
    const catalogued = new Set<string>(VFX_TEXTURE_NAMES.map((name) => `${name}.png`));
    const huerfanos = pngsOnDisk.filter((f) => !catalogued.has(f));
    expect(huerfanos, `PNG en disco sin registrar en VFX_TEXTURE_NAMES: ${huerfanos.join(', ')}`).toEqual([]);
  });
});

describe('vfxTextureUrl', () => {
  it('compone la ruta con un baseUrl con barra final (caso típico de import.meta.env.BASE_URL)', () => {
    expect(vfxTextureUrl('circle_c', './')).toBe('./textures/vfx/circle_c.png');
    expect(vfxTextureUrl('splat00', '/')).toBe('/textures/vfx/splat00.png');
  });

  it('compone la ruta igual con un baseUrl sin barra final', () => {
    expect(vfxTextureUrl('circle_c', '.')).toBe('./textures/vfx/circle_c.png');
    expect(vfxTextureUrl('splat00', '')).toBe('/textures/vfx/splat00.png');
  });
});
