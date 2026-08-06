/**
 * Tests de `room-props.ts` (F5, ART_KIT_PLAN.md §5): determinismo por id de
 * sala, límites de densidad y respeto de las categorías de la restricción de
 * diseño (suelo en cualquier punto salvo hazards; esquinas dentro de su
 * huella; parapeto siempre fuera del interior).
 */

import { describe, expect, it } from 'vitest';
import type { AABB } from '@/engine/geometry';
import type { HazardSpawn } from '@/game/world/types';
import {
  computeRoomProps,
  floorScatterPlacements,
  wallClutterPlacements,
  wallDecorPlacements,
  WALL_CLUTTER_KINDS,
  FLOOR_SCATTER_VARIANTS,
} from './room-props';
import { createRng } from '@/engine/rng';

const SMALL_ROOM: AABB = { minX: -4.5, maxX: 4.5, minY: -4.5, maxY: 4.5 }; // 9×9
const BOSS_ROOM: AABB = { minX: -7.5, maxX: 7.5, minY: -7.5, maxY: 7.5 }; // 15×15

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
    const a = floorScatterPlacements(SMALL_ROOM, seedFor('room-a'), []);
    const b = floorScatterPlacements(SMALL_ROOM, seedFor('room-a'), []);
    expect(a).toEqual(b);
  });

  it('la cuenta respeta el mínimo/máximo y crece con el área de la sala', () => {
    const small = floorScatterPlacements(SMALL_ROOM, seedFor('s'), []);
    const big = floorScatterPlacements(BOSS_ROOM, seedFor('s'), []);
    expect(small.length).toBeGreaterThanOrEqual(1);
    expect(small.length).toBeLessThanOrEqual(4);
    expect(big.length).toBeLessThanOrEqual(4); // tope duro (FLOOR_SCATTER_MAX)
    expect(big.length).toBeGreaterThanOrEqual(small.length);
  });

  it('todas las variantes elegidas pertenecen al catálogo declarado', () => {
    const placements = floorScatterPlacements(BOSS_ROOM, seedFor('variantes'), []);
    for (const p of placements) {
      expect(FLOOR_SCATTER_VARIANTS).toContain(p.variant);
    }
  });

  it('nunca coloca un decal dentro (ni cerca) del rectángulo de un hazard', () => {
    const hazard: HazardSpawn = { id: 'pit-1', kind: 'pit', position: { x: 0, y: 0 }, width: 4, height: 4 };
    const placements = floorScatterPlacements(BOSS_ROOM, seedFor('con-hazard'), [hazard]);
    for (const p of placements) {
      const insideMarginedHazard = Math.abs(p.x - 0) < 4 / 2 + 0.6 && Math.abs(p.z - 0) < 4 / 2 + 0.6;
      expect(insideMarginedHazard).toBe(false);
    }
  });

  it('respeta el margen de muro: ningún decal cae fuera de bounds ni pegado al borde', () => {
    const placements = floorScatterPlacements(SMALL_ROOM, seedFor('margen'), []);
    for (const p of placements) {
      expect(p.x).toBeGreaterThan(SMALL_ROOM.minX);
      expect(p.x).toBeLessThan(SMALL_ROOM.maxX);
      expect(p.z).toBeGreaterThan(SMALL_ROOM.minY);
      expect(p.z).toBeLessThan(SMALL_ROOM.maxY);
    }
  });

  it('sala demasiado pequeña para dejar margen por los 4 lados: ningún decal (mejor ninguno que uno pegado al muro)', () => {
    const tiny: AABB = { minX: -1, maxX: 1, minY: -1, maxY: 1 }; // 2×2, menor que 2×FLOOR_SCATTER_WALL_MARGIN
    expect(floorScatterPlacements(tiny, seedFor('tiny'), [])).toEqual([]);
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
    const a = computeRoomProps('sala-1', BOSS_ROOM, true, []);
    const b = computeRoomProps('sala-1', BOSS_ROOM, true, []);
    expect(a).toEqual(b);
  });

  it('featured=false nunca añade bandera/candelabro; featured=true siempre añade exactamente 2', () => {
    const combate = computeRoomProps('sala-combate', BOSS_ROOM, false, []);
    expect(combate.wallDecor).toEqual([]);
    const jefe = computeRoomProps('sala-jefe', BOSS_ROOM, true, []);
    expect(jefe.wallDecor).toHaveLength(2);
  });

  it('ids de sala distintos producen (típicamente) atrezzo distinto: no es una constante global', () => {
    const a = computeRoomProps('room-alpha', BOSS_ROOM, false, []);
    const b = computeRoomProps('room-beta', BOSS_ROOM, false, []);
    expect(a).not.toEqual(b);
  });
});
