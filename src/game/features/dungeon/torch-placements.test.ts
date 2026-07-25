/**
 * Tests de `collectTorchEmitters` (base compartida del pool de 3 antorchas
 * por cercanía, ver cabecera de torch-placements.ts): mundos mínimos vía
 * `createWorld` en modo sala única (mismo patrón que `bosses/movement.test.ts`
 * y `dungeon-world.test.ts` — sin jefe/tendero, `roomId` queda `undefined` y
 * `bossRoomBounds`/la búsqueda de sala del tendero caen a `world.bounds`).
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@/game/world/create';
import type { EnemySpawn, ItemSpawn, RoomData } from '@/game/world/types';
import { collectTorchEmitters } from './torch-placements';

function makeRoom(partial: Partial<RoomData> = {}): RoomData {
  return {
    version: 1,
    id: 'torch-room',
    name: 'Sala de antorchas',
    width: 15,
    height: 15,
    playerStart: { x: 0, y: 0 },
    tags: ['jefe'],
    doorSlots: [],
    enemies: [],
    hazards: [],
    items: [],
    ...partial,
  };
}

const BOSS: EnemySpawn = { id: 'b1', kind: 'boss', position: { x: 0, y: 0 } };
const SHOPKEEPER: ItemSpawn = { id: 'shopkeeper', kind: 'shopkeeper', position: { x: 1, y: -2 } };

describe('collectTorchEmitters', () => {
  it('mundo sin jefe ni tendero: lista vacía', () => {
    const world = createWorld(makeRoom());
    expect(collectTorchEmitters(world)).toEqual([]);
  });

  it('mundo con jefe (sala grande, ≥8u): 4 esquinas + 2 puntos medios, todo kind=torch', () => {
    // Sala cuadrada 15x15 (≥ MIN_WALL_LENGTH_FOR_MIDPOINTS=8 de wallTorchLayout): califica para puntos medios.
    const world = createWorld(makeRoom({ enemies: [BOSS] }));
    const emitters = collectTorchEmitters(world);
    expect(emitters).toHaveLength(6);
    expect(emitters.every((e) => e.kind === 'torch')).toBe(true);
  });

  it('mundo con jefe en sala pequeña (<8u): solo 4 esquinas, sin puntos medios', () => {
    const world = createWorld(makeRoom({ width: 6, height: 6, enemies: [BOSS] }));
    const emitters = collectTorchEmitters(world);
    expect(emitters).toHaveLength(4);
    expect(emitters.every((e) => e.kind === 'torch')).toBe(true);
  });

  it('mundo con tendero: 4 esquinas (sin puntos medios, aunque la sala sea grande) + el emisor del tendero', () => {
    const world = createWorld(makeRoom({ items: [SHOPKEEPER] }));
    const emitters = collectTorchEmitters(world);
    expect(emitters).toHaveLength(5);

    const torches = emitters.filter((e) => e.kind === 'torch');
    const shopLights = emitters.filter((e) => e.kind === 'shopkeeper');
    expect(torches).toHaveLength(4); // sin puntos medios pese a la sala 15x15: forzado a false por diseño
    expect(shopLights).toHaveLength(1);

    const shopLight = shopLights[0];
    expect(shopLight.x).toBeCloseTo(SHOPKEEPER.position.x, 9);
    expect(shopLight.z).toBeCloseTo(SHOPKEEPER.position.y, 9); // Vec2.y del mundo ≡ Z del render
    expect(shopLight.dirX).toBe(0);
    expect(shopLight.dirZ).toBe(0); // cono vertical hacia el suelo, sin componente horizontal
  });

  it('mundo con jefe Y tendero: acumula ambos grupos de emisores', () => {
    const world = createWorld(makeRoom({ enemies: [BOSS], items: [SHOPKEEPER] }));
    const emitters = collectTorchEmitters(world);
    // 6 antorchas de jefe (sala grande, con puntos medios) + 4 antorchas de tienda + 1 luz de tendero.
    expect(emitters).toHaveLength(11);
    expect(emitters.filter((e) => e.kind === 'shopkeeper')).toHaveLength(1);
  });

  it('todas las direcciones de antorcha son unitarias y apuntan hacia el interior de la sala', () => {
    const world = createWorld(makeRoom({ enemies: [BOSS] }));
    const bounds = world.bounds; // modo sala única: la sala del jefe es world.bounds
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minY + bounds.maxY) / 2;

    for (const e of collectTorchEmitters(world)) {
      expect(e.kind).toBe('torch');
      const len = Math.hypot(e.dirX, e.dirZ);
      expect(len).toBeCloseTo(1, 9);

      // "Hacia dentro de la sala": el producto escalar entre la dirección y
      // el vector hacia el centro debe ser positivo (mismo sentido, no opuesto).
      const towardCenterX = centerX - e.x;
      const towardCenterZ = centerZ - e.z;
      const dot = e.dirX * towardCenterX + e.dirZ * towardCenterZ;
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('nunca lanza en un mundo sin roomRuntimes (modo sala única) con jefe/tendero presentes', () => {
    const world = createWorld(makeRoom({ enemies: [BOSS], items: [SHOPKEEPER] }));
    expect(world.roomRuntimes.size).toBe(0); // confirma que estamos en modo sala única (fallback a world.bounds)
    expect(() => collectTorchEmitters(world)).not.toThrow();
  });
});
