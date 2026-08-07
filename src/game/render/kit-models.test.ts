/**
 * Test de humo del catálogo del kit (F1, docs/plans/ART_KIT_PLAN.md): entorno
 * `node` de vitest (sin DOM ni three, ver `vite.config.ts`), así que aquí SÍ
 * se puede tocar disco con `node:fs`/`node:path` — es justo lo que hace único
 * a este test frente al resto de la suite (que corre sobre la sim pura).
 *
 * Objetivo: que ningún nombre de `KIT_MODELS` (mantenida a mano en
 * `kit-models.ts`) apunte a un fichero que no está en disco — eso reventaría
 * la precarga entera al arrancar el juego.
 *
 * Lo que este test NO comprueba, a propósito (decisión de David, 2026-08-05:
 * "deja el kit entero en public, y ya veremos qué usamos"): que no sobren
 * `.gltf` en la carpeta. Están los 283 modelos del pack, mientras que
 * `KIT_MODELS` es la lista de los que el juego PRECARGA — y son dos cosas
 * distintas a propósito: tener el pack completo en disco permite probar una
 * pieza nueva cambiando una línea, sin volver al zip original, pero
 * precargarlos todos costaría ~9 MB en el arranque y el GDD §14 pide entrar a
 * jugar en segundos. Registrar un modelo es lo que lo mete en la precarga; el
 * resto está disponible pero no pesa.
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KIT_DIR, KIT_MODELS, kitModelUrl } from './kit-models';

const KIT_ROOT = resolve(process.cwd(), 'public', KIT_DIR);

describe('KIT_MODELS ↔ public/models/kaykit/', () => {
  it('cada nombre de KIT_MODELS tiene su .glb en disco', () => {
    for (const name of KIT_MODELS) {
      expect(existsSync(resolve(KIT_ROOT, `${name}.glb`))).toBe(true);
    }
  });

  it('no queda ningún .gltf/.bin suelto: el pack está empaquetado en .glb', () => {
    const sueltos = readdirSync(KIT_ROOT).filter((f) => f.endsWith('.gltf') || f.endsWith('.bin'));
    expect(sueltos, `sobran ficheros sin empaquetar: ${sueltos.join(', ')}`).toEqual([]);
  });

  it('KIT_MODELS no tiene nombres repetidos (un duplicado cargaría el mismo modelo dos veces)', () => {
    expect(new Set<string>(KIT_MODELS).size).toBe(KIT_MODELS.length);
  });

  it('el catálogo precargado es un SUBCONJUNTO del pack en disco, y bastante menor', () => {
    const glbFilesOnDisk = readdirSync(KIT_ROOT).filter((file) => file.endsWith('.glb'));
    // Menos de la mitad: si algún día se registra el pack casi entero, es señal
    // de que la precarga se ha desmadrado y toca revisar el arranque (GDD §14),
    // no de que este test sobre.
    expect(KIT_MODELS.length).toBeLessThan(glbFilesOnDisk.length / 2);
  });

  it('la textura compartida dungeon_texture.png existe', () => {
    expect(existsSync(resolve(KIT_ROOT, 'dungeon_texture.png'))).toBe(true);
  });
});

describe('kitModelUrl', () => {
  it('compone la ruta con un baseUrl con barra final (caso típico de import.meta.env.BASE_URL)', () => {
    expect(kitModelUrl('wall', './')).toBe('./models/kaykit/wall.glb');
    expect(kitModelUrl('column', '/')).toBe('/models/kaykit/column.glb');
  });

  it('compone la ruta igual con un baseUrl sin barra final', () => {
    expect(kitModelUrl('wall', '.')).toBe('./models/kaykit/wall.glb');
    expect(kitModelUrl('column', '')).toBe('/models/kaykit/column.glb');
  });
});
