/**
 * Tests de `room-props.ts` (F5, ART_KIT_PLAN.md §5): determinismo por id de
 * sala, límites de densidad y respeto de las categorías de la restricción de
 * diseño (suelo en cualquier punto salvo hazards; esquinas dentro de su
 * huella; parapeto siempre fuera del interior).
 */

import { describe, expect, it } from 'vitest';
import type { AABB } from '@/engine/geometry';
import type { KitModelName } from '@/game/render/kit-models';
import type { HazardSpawn } from '@/game/world/types';
import {
  computeRoomProps,
  floorScatterPlacements,
  wallClutterPlacements,
  wallDecorPlacements,
  WALL_CLUTTER_KINDS,
} from './room-props';
import { createRng } from '@/engine/rng';

const SMALL_ROOM: AABB = { minX: -4.5, maxX: 4.5, minY: -4.5, maxY: 4.5 }; // 9×9
const BOSS_ROOM: AABB = { minX: -7.5, maxX: 7.5, minY: -7.5, maxY: 7.5 }; // 15×15

// Catálogo de decals que antes vivía en `room-props.ts` como
// `FLOOR_SCATTER_VARIANTS` (piedra fija) y ahora lo aporta la familia de
// suelo real de la sala (`FLOOR_FAMILIES[...].scatter`, ver
// `@/game/render/floor-families.ts`) — aquí se usa una lista de prueba propia
// para no acoplar este test a `render/` (que además no está disponible en el
// entorno `node` de vitest sin `three`, ver cabecera del fichero probado).
const STONE_VARIANTS: readonly KitModelName[] = [
  'floor_tile_small_broken_A',
  'floor_tile_small_broken_B',
  'floor_tile_small_weeds_A',
  'floor_tile_small_weeds_B',
  'floor_tile_large_rocks',
];

function seedFor(roomId: string) {
  // Mismo hash que usa internamente room-props.ts, reconstruido aquí solo
  // para poder invocar directamente `floorScatterPlacements`/etc. (que toman
  // un `Rng` ya creado, no un roomId) de forma determinista en los tests.
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) hash = (hash * 31 + roomId.charCodeAt(i)) | 0;
  return createRng(hash >>> 0);
}

describe('floorScatterPlacements', () => {
  it('determinista: misma sala (mismo rng fresco) produce exactamente los mismos decals', () => {
    const a = floorScatterPlacements(SMALL_ROOM, seedFor('room-a'), [], STONE_VARIANTS);
    const b = floorScatterPlacements(SMALL_ROOM, seedFor('room-a'), [], STONE_VARIANTS);
    expect(a).toEqual(b);
  });

  it('la cuenta respeta el mínimo/máximo y crece con el área de la sala', () => {
    const small = floorScatterPlacements(SMALL_ROOM, seedFor('s'), [], STONE_VARIANTS);
    const big = floorScatterPlacements(BOSS_ROOM, seedFor('s'), [], STONE_VARIANTS);
    expect(small.length).toBeGreaterThanOrEqual(1);
    expect(small.length).toBeLessThanOrEqual(4);
    expect(big.length).toBeLessThanOrEqual(4); // tope duro (FLOOR_SCATTER_MAX)
    expect(big.length).toBeGreaterThanOrEqual(small.length);
  });

  it('todas las variantes elegidas salen de la lista que se pasó', () => {
    const placements = floorScatterPlacements(BOSS_ROOM, seedFor('variantes'), [], STONE_VARIANTS);
    expect(placements.length).toBeGreaterThan(0); // si esto no genera nada, el resto del test no prueba nada
    for (const p of placements) {
      expect(STONE_VARIANTS).toContain(p.variant);
    }
  });

  it('con OTRA lista de variantes (tierra, distinta de la de piedra), las elegidas salen de ESA lista', () => {
    const dirtVariants: readonly KitModelName[] = ['floor_dirt_small_weeds', 'floor_dirt_large_rocky'];
    const placements = floorScatterPlacements(BOSS_ROOM, seedFor('variantes-tierra'), [], dirtVariants);
    expect(placements.length).toBeGreaterThan(0);
    for (const p of placements) {
      expect(dirtVariants).toContain(p.variant);
      expect(STONE_VARIANTS).not.toContain(p.variant);
    }
  });

  it('lista de variantes VACÍA (familia madera, sin decals de suelo): ningún decal, sea cual sea el tamaño de la sala', () => {
    expect(floorScatterPlacements(SMALL_ROOM, seedFor('madera-1'), [], [])).toEqual([]);
    expect(floorScatterPlacements(BOSS_ROOM, seedFor('madera-2'), [], [])).toEqual([]);
  });

  it('lista vacía: no se consume ni un número del rng (el resto del atrezzo de la sala no debe moverse por la familia)', () => {
    const rng = seedFor('madera-consumo');
    const before = rng();
    // Rebobinar con la MISMA semilla y volver a leer el primer número: si
    // `floorScatterPlacements` hubiera consumido algo antes de rendirse,
    // este segundo `rng()` ya no devolvería el mismo valor que `before`.
    const rngOtraVez = seedFor('madera-consumo');
    floorScatterPlacements(BOSS_ROOM, rngOtraVez, [], []);
    const afterEmptyScatter = rngOtraVez();
    expect(afterEmptyScatter).toBe(before);
  });

  it('nunca coloca un decal dentro (ni cerca) del rectángulo de un hazard', () => {
    const hazard: HazardSpawn = { id: 'pit-1', kind: 'pit', position: { x: 0, y: 0 }, width: 4, height: 4 };
    const placements = floorScatterPlacements(BOSS_ROOM, seedFor('con-hazard'), [hazard], STONE_VARIANTS);
    for (const p of placements) {
      const insideMarginedHazard = Math.abs(p.x - 0) < 4 / 2 + 0.6 && Math.abs(p.z - 0) < 4 / 2 + 0.6;
      expect(insideMarginedHazard).toBe(false);
    }
  });

  it('respeta el margen de muro: ningún decal cae fuera de bounds ni pegado al borde', () => {
    const placements = floorScatterPlacements(SMALL_ROOM, seedFor('margen'), [], STONE_VARIANTS);
    for (const p of placements) {
      expect(p.x).toBeGreaterThan(SMALL_ROOM.minX);
      expect(p.x).toBeLessThan(SMALL_ROOM.maxX);
      expect(p.z).toBeGreaterThan(SMALL_ROOM.minY);
      expect(p.z).toBeLessThan(SMALL_ROOM.maxY);
    }
  });

  it('sala demasiado pequeña para dejar margen por los 4 lados: ningún decal (mejor ninguno que uno pegado al muro)', () => {
    const tiny: AABB = { minX: -1, maxX: 1, minY: -1, maxY: 1 }; // 2×2, menor que 2×FLOOR_SCATTER_WALL_MARGIN
    expect(floorScatterPlacements(tiny, seedFor('tiny'), [], STONE_VARIANTS)).toEqual([]);
  });
});

describe('wallClutterPlacements', () => {
  it('determinista y nunca supera el tope de 2 piezas', () => {
    const a = wallClutterPlacements(BOSS_ROOM, seedFor('clutter'), []);
    const b = wallClutterPlacements(BOSS_ROOM, seedFor('clutter'), []);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(2);
  });

  it('toda pieza cae en una de las 4 esquinas del interior (dentro del inset declarado), nunca en mitad de la sala', () => {
    // Corre bastantes semillas para ejercitar las 4 esquinas y las dos ramas de la moneda (WALL_CLUTTER_CHANCE).
    for (let seed = 0; seed < 40; seed++) {
      const placements = wallClutterPlacements(BOSS_ROOM, createRng(seed), []);
      for (const p of placements) {
        const nearCornerX = Math.abs(p.x - BOSS_ROOM.minX) < 1 || Math.abs(p.x - BOSS_ROOM.maxX) < 1;
        const nearCornerZ = Math.abs(p.z - BOSS_ROOM.minY) < 1 || Math.abs(p.z - BOSS_ROOM.maxY) < 1;
        expect(nearCornerX).toBe(true);
        expect(nearCornerZ).toBe(true);
        expect(WALL_CLUTTER_KINDS).toContain(p.kind);
      }
    }
  });

  it('una esquina que cae dentro de un hazard se descarta', () => {
    // Hazard grande centrado en la esquina (minX,minY) del BOSS_ROOM.
    const hazard: HazardSpawn = {
      id: 'h',
      kind: 'rock',
      position: { x: BOSS_ROOM.minX + 0.75, y: BOSS_ROOM.minY + 0.75 },
      width: 3,
      height: 3,
    };
    for (let seed = 0; seed < 20; seed++) {
      const placements = wallClutterPlacements(BOSS_ROOM, createRng(seed), [hazard]);
      for (const p of placements) {
        const atBlockedCorner = Math.abs(p.x - (BOSS_ROOM.minX + 0.75)) < 0.01 && Math.abs(p.z - (BOSS_ROOM.minY + 0.75)) < 0.01;
        expect(atBlockedCorner).toBe(false);
      }
    }
  });
});

describe('wallDecorPlacements', () => {
  it('devuelve exactamente 2 piezas (bandera + candelabro) en muros DISTINTOS', () => {
    const placements = wallDecorPlacements(BOSS_ROOM, seedFor('decor'));
    expect(placements).toHaveLength(2);
    const banner = placements.find((p) => p.kind === 'banner_red' || p.kind === 'banner_blue');
    const candle = placements.find((p) => p.kind === 'candle_triple');
    expect(banner).toBeDefined();
    expect(candle).toBeDefined();
    expect(banner!.x === candle!.x && banner!.z === candle!.z).toBe(false);
  });

  it('las dos piezas quedan SIEMPRE fuera del interior jugable (categoría (b) de la restricción de diseño)', () => {
    for (let seed = 0; seed < 30; seed++) {
      const placements = wallDecorPlacements(BOSS_ROOM, createRng(seed));
      for (const p of placements) {
        const inside = p.x > BOSS_ROOM.minX && p.x < BOSS_ROOM.maxX && p.z > BOSS_ROOM.minY && p.z < BOSS_ROOM.maxY;
        expect(inside).toBe(false);
      }
    }
  });

  it('la dirección de cada pieza es unitaria y apunta hacia el centro de la sala', () => {
    for (let seed = 0; seed < 10; seed++) {
      const placements = wallDecorPlacements(BOSS_ROOM, createRng(seed));
      for (const p of placements) {
        const len = Math.hypot(p.dirX, p.dirZ);
        expect(len).toBeCloseTo(1, 9);
        const towardCenterX = 0 - p.x; // BOSS_ROOM está centrada en el origen
        const towardCenterZ = 0 - p.z;
        expect(p.dirX * towardCenterX + p.dirZ * towardCenterZ).toBeGreaterThan(0);
      }
    }
  });
});

describe('computeRoomProps', () => {
  it('determinista de punta a punta por roomId: dos llamadas con los mismos argumentos son idénticas', () => {
    const a = computeRoomProps('sala-1', BOSS_ROOM, true, [], STONE_VARIANTS);
    const b = computeRoomProps('sala-1', BOSS_ROOM, true, [], STONE_VARIANTS);
    expect(a).toEqual(b);
  });

  it('featured=false nunca añade bandera/candelabro; featured=true siempre añade exactamente 2', () => {
    const combate = computeRoomProps('sala-combate', BOSS_ROOM, false, [], STONE_VARIANTS);
    expect(combate.wallDecor).toEqual([]);
    const jefe = computeRoomProps('sala-jefe', BOSS_ROOM, true, [], STONE_VARIANTS);
    expect(jefe.wallDecor).toHaveLength(2);
  });

  it('lista de variantes de suelo vacía (familia madera): floorScatter vacío, pero el resto del atrezzo sigue en pie', () => {
    const sinDecals = computeRoomProps('sala-madera', BOSS_ROOM, true, [], []);
    expect(sinDecals.floorScatter).toEqual([]);
    // featured=true sigue añadiendo bandera/candelabro: la ausencia de
    // decals de suelo es SOLO de esa categoría, no un cortocircuito de todo
    // `computeRoomProps`.
    expect(sinDecals.wallDecor).toHaveLength(2);
  });

  it('todos los decals de suelo de la sala salen de la lista de variantes que se pasó', () => {
    const dirtVariants: readonly KitModelName[] = ['floor_dirt_small_weeds', 'floor_dirt_large_rocky'];
    const { floorScatter } = computeRoomProps('sala-tierra', BOSS_ROOM, false, [], dirtVariants);
    for (const p of floorScatter) {
      expect(dirtVariants).toContain(p.variant);
    }
  });

  it('ids de sala distintos producen (típicamente) atrezzo distinto: no es una constante global', () => {
    const a = computeRoomProps('room-alpha', BOSS_ROOM, false, [], STONE_VARIANTS);
    const b = computeRoomProps('room-beta', BOSS_ROOM, false, [], STONE_VARIANTS);
    expect(a).not.toEqual(b);
  });
});
