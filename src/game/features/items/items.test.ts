/**
 * Tests de objetos (GDD §9): recogida de moneda/poción/llave y drop de
 * monedas al morir un enemigo (docs/plans/ECONOMY_PLAN.md: N monedas por
 * dureza, esparcidas). También la puntuación al limpiar la sala (modo sala
 * única): ya NO cambia de fase (la mejora-por-sala desaparece).
 */

import { describe, expect, it } from 'vitest';
import { applyDamageToEnemy } from '@/game/features/combat/combat';
import { createEventQueue, drainEvents, type GameEvent } from '@/engine/events';
import { COIN_DROP_MIN_SEPARATION, COIN_MAGNET_RADIUS_BY_LEVEL, VICTORY_COIN_MAGNET_SPEED } from './constants';
import { dropCoinAt, stepItems } from './items';
import { BOSS_VICTORY_PAUSE_DURATION, stepWorld } from '@/game/world/step';
import { createWorld } from '@/game/world/create';
import type { EnemySpawn, ItemSpawn, RoomData, World } from '@/game/world/types';

const FIXED_DT = 1 / 60;

function makeRoom(partial: Partial<RoomData> = {}): RoomData {
  return {
    version: 1,
    id: 'item-room',
    name: 'Items',
    width: 30,
    height: 30,
    playerStart: { x: 0, y: 0 },
    tags: ['combate'],
    doorSlots: [],
    enemies: [],
    hazards: [],
    items: [],
    ...partial,
  };
}

function makeWorld(items: ItemSpawn[] = [], enemies: EnemySpawn[] = []): World {
  return createWorld(makeRoom({ items, enemies }));
}

describe('moneda', () => {
  it('se recoge al contacto: +1 monedero, +1 total recogido, +1 punto, item desactivado', () => {
    const world = makeWorld([{ id: 'c1', kind: 'coin', position: { x: 0.3, y: 0 } }]);
    const events = createEventQueue(16);
    stepItems(world, FIXED_DT, events);
    expect(world.hero.coins).toBe(1);
    expect(world.stats.coinsCollected).toBe(1);
    expect(world.stats.score).toBe(1);
    expect(world.items[0].active).toBe(false);

    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).toContain('item-pickup');
  });

  it('fuera de alcance no se recoge', () => {
    const world = makeWorld([{ id: 'c1', kind: 'coin', position: { x: 5, y: 5 } }]);
    const events = createEventQueue(16);
    stepItems(world, FIXED_DT, events);
    expect(world.stats.coinsCollected).toBe(0);
    expect(world.items[0].active).toBe(true);
  });
});

describe('poción', () => {
  it('cura 1 corazón', () => {
    const world = makeWorld([{ id: 'p1', kind: 'potion', position: { x: 0.3, y: 0 } }]);
    const events = createEventQueue(16);
    world.hero.hp = 3;
    stepItems(world, FIXED_DT, events);
    expect(world.hero.hp).toBe(4);
  });

  it('no supera la vida máxima', () => {
    const world = makeWorld([{ id: 'p1', kind: 'potion', position: { x: 0.3, y: 0 } }]);
    const events = createEventQueue(16);
    stepItems(world, FIXED_DT, events);
    expect(world.hero.hp).toBe(world.hero.maxHp);
  });
});

describe('llave', () => {
  it('marca hasKey en el héroe', () => {
    const world = makeWorld([{ id: 'k1', kind: 'key', position: { x: 0.3, y: 0 } }]);
    const events = createEventQueue(16);
    expect(world.hero.hasKey).toBe(false);
    stepItems(world, FIXED_DT, events);
    expect(world.hero.hasKey).toBe(true);
  });
});

describe('drop de moneda al morir un enemigo', () => {
  it('un dummy (dureza 1) suelta 1 moneda esparcida cerca de su posición (una sola vez)', () => {
    const world = makeWorld([], [{ id: 'e1', kind: 'dummy', position: { x: 5, y: 5 } }]);
    const events = createEventQueue(64);
    applyDamageToEnemy(world, world.enemies[0], 99, 1, 0, events);

    stepWorld(world, events);
    const coins = world.items.filter((i) => i.kind === 'coin' && i.active);
    expect(coins).toHaveLength(1);
    // Esparcida en un anillo de radio ~0.25-0.6 u alrededor del cadáver (ver COIN_DROP_MIN/MAX_RADIUS).
    const dist = Math.hypot(
      coins[0].position.x - world.enemies[0].position.x,
      coins[0].position.y - world.enemies[0].position.y,
    );
    expect(dist).toBeGreaterThanOrEqual(0.25 - 1e-6);
    expect(dist).toBeLessThanOrEqual(0.6 + 1e-6);

    // Ticks posteriores no duplican el drop.
    stepWorld(world, events);
    stepWorld(world, events);
    expect(world.items.filter((i) => i.kind === 'coin' && i.active)).toHaveLength(1);
  });

  it('un shooter (dureza 3) suelta 3 monedas', () => {
    const world = makeWorld([], [{ id: 'e1', kind: 'shooter', position: { x: 5, y: 5 } }]);
    const events = createEventQueue(64);
    applyDamageToEnemy(world, world.enemies[0], 99, 1, 0, events);

    stepWorld(world, events);
    expect(world.items.filter((i) => i.kind === 'coin' && i.active)).toHaveLength(3);
  });

  it('un jefe (dureza 10) suelta 10 monedas', () => {
    const world = makeWorld([], [{ id: 'b1', kind: 'boss', position: { x: 5, y: 5 } }]);
    const events = createEventQueue(64);
    applyDamageToEnemy(world, world.enemies[0], 999, 1, 0, events, true);

    stepWorld(world, events);
    expect(world.items.filter((i) => i.kind === 'coin' && i.active)).toHaveLength(10);
  });

  it('matar al último enemigo puntúa +50 sin cambiar de fase (docs/plans/ECONOMY_PLAN.md)', () => {
    const world = makeWorld([], [{ id: 'e1', kind: 'dummy', position: { x: 5, y: 5 } }]);
    const events = createEventQueue(64);
    applyDamageToEnemy(world, world.enemies[0], 99, 1, 0, events);
    drainEvents(events, () => {});

    stepWorld(world, events);
    expect(world.phase).toBe('playing');
    expect(world.stats.roomsCleared).toBe(1);
    expect(world.stats.score).toBeGreaterThanOrEqual(50);

    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).toContain('room-cleared');
  });

  it('la sim NO se pausa al limpiar la sala: sigue avanzando en el mismo tick de después', () => {
    const world = makeWorld([], [{ id: 'e1', kind: 'dummy', position: { x: 5, y: 5 } }]);
    const events = createEventQueue(64);
    applyDamageToEnemy(world, world.enemies[0], 99, 1, 0, events);
    stepWorld(world, events);
    expect(world.phase).toBe('playing');

    world.hero.velocity.x = 5;
    const xBefore = world.hero.position.x;
    stepWorld(world, events);
    expect(world.hero.position.x).toBeGreaterThan(xBefore);
  });
});

describe('separación entre monedas dropeadas (playtest: "no deberían salir tan juntas como para que se superpongan")', () => {
  it('dos monedas soltadas en el mismo punto acaban separadas al menos COIN_DROP_MIN_SEPARATION', () => {
    const world = makeWorld();
    dropCoinAt(world, 5, 5);
    dropCoinAt(world, 5, 5);
    const coins = world.items.filter((i) => i.kind === 'coin' && i.active);
    expect(coins).toHaveLength(2);
    const dist = Math.hypot(coins[0].position.x - coins[1].position.x, coins[0].position.y - coins[1].position.y);
    expect(dist).toBeGreaterThanOrEqual(COIN_DROP_MIN_SEPARATION - 1e-6);
  });

  it('tres monedas soltadas en el mismo punto quedan todas separadas por pares', () => {
    const world = makeWorld();
    dropCoinAt(world, -2, 4);
    dropCoinAt(world, -2, 4);
    dropCoinAt(world, -2, 4);
    const coins = world.items.filter((i) => i.kind === 'coin' && i.active);
    expect(coins).toHaveLength(3);
    for (let i = 0; i < coins.length; i++) {
      for (let j = i + 1; j < coins.length; j++) {
        const dist = Math.hypot(coins[i].position.x - coins[j].position.x, coins[i].position.y - coins[j].position.y);
        expect(dist).toBeGreaterThanOrEqual(COIN_DROP_MIN_SEPARATION - 1e-6);
      }
    }
  });

  it('un jefe soltando 10 monedas en el mismo punto no se cuelga (intentos acotados) y todas quedan activas con posición finita', () => {
    const world = makeWorld();
    for (let i = 0; i < 10; i++) dropCoinAt(world, 3, 3);
    const coins = world.items.filter((i) => i.kind === 'coin' && i.active);
    expect(coins).toHaveLength(10);
    for (const coin of coins) {
      expect(Number.isFinite(coin.position.x)).toBe(true);
      expect(Number.isFinite(coin.position.y)).toBe(true);
    }
  });

  it('una moneda lejos de cualquier otra no se reubica (se queda exactamente donde se pidió)', () => {
    const world = makeWorld();
    dropCoinAt(world, 0, 0);
    dropCoinAt(world, 10, 10);
    const far = world.items.find((i) => i.kind === 'coin' && i.active && i.position.x > 5);
    expect(far?.position.x).toBe(10);
    expect(far?.position.y).toBe(10);
  });
});

describe('imán de monedas (Canto de Urraca, docs/plans/ECONOMY_PLAN.md F2)', () => {
  it('sin nivel de imán, una moneda fuera de alcance de recogida no se mueve', () => {
    const world = makeWorld([{ id: 'c1', kind: 'coin', position: { x: 2, y: 0 } }]);
    const events = createEventQueue(16);
    for (let i = 0; i < 30; i++) stepItems(world, FIXED_DT, events);
    expect(world.items[0].position.x).toBeCloseTo(2, 9);
    expect(world.items[0].position.y).toBeCloseTo(0, 9);
  });

  it('con nivel 1, una moneda dentro del radio (2.5 u) se acerca al héroe tras un tick y acaba recogida tras varios', () => {
    const world = makeWorld([{ id: 'c1', kind: 'coin', position: { x: 2, y: 0 } }]);
    const events = createEventQueue(16);
    world.hero.modifiers.coinMagnetLevel = 1;
    expect(COIN_MAGNET_RADIUS_BY_LEVEL[1]).toBe(2.5);

    stepItems(world, FIXED_DT, events);
    // Un tick a COIN_MAGNET_SPEED=7 u/s: 2 - 7/60 ≈ 1.883, se acercó pero no llegó.
    expect(world.items[0].position.x).toBeLessThan(2);
    expect(world.items[0].position.x).toBeGreaterThan(1.8);
    expect(world.items[0].active).toBe(true);

    for (let i = 0; i < 30; i++) stepItems(world, FIXED_DT, events);
    expect(world.items[0].active).toBe(false); // ya la recogió por contacto al acercarse
  });

  it('con nivel 1, una moneda fuera del radio (2.5 u) no se mueve', () => {
    const world = makeWorld([{ id: 'c1', kind: 'coin', position: { x: 10, y: 0 } }]);
    const events = createEventQueue(16);
    world.hero.modifiers.coinMagnetLevel = 1;

    for (let i = 0; i < 30; i++) stepItems(world, FIXED_DT, events);
    expect(world.items[0].position.x).toBeCloseTo(10, 9);
    expect(world.items[0].active).toBe(true);
  });

  it('subir de nivel amplía el radio: una moneda a 4 u solo se atrae con nivel 2+', () => {
    const world = makeWorld([{ id: 'c1', kind: 'coin', position: { x: 4, y: 0 } }]);
    const events = createEventQueue(16);
    world.hero.modifiers.coinMagnetLevel = 1;

    stepItems(world, FIXED_DT, events);
    expect(world.items[0].position.x).toBeCloseTo(4, 9); // fuera del radio de nivel 1 (2.5 u)

    world.hero.modifiers.coinMagnetLevel = 2;
    expect(COIN_MAGNET_RADIUS_BY_LEVEL[2]).toBe(4);
    stepItems(world, FIXED_DT, events);
    expect(world.items[0].position.x).toBeLessThan(4); // dentro del radio de nivel 2, ya se acerca
  });
});

describe('imán de monedas de VICTORIA (encargo 2026-08-31: "atrae a las monedas hasta el personaje antes de la animación de victoria", TODOS los jefes)', () => {
  /** Fuerza la fase 'boss-victory-pause' sin pasar por un jefe/mazmorra real (equivalente ligero al helper de dungeon-world.test.ts, aquí sobre un World de sala única). */
  function enterVictoryPause(world: World, nextPhase: 'victory' | 'boss-reward' = 'victory'): void {
    world.phase = 'boss-victory-pause';
    world.bossVictoryPauseUntil = world.time + BOSS_VICTORY_PAUSE_DURATION;
    world.bossVictoryNextPhase = nextPhase;
  }

  /**
   * Avanza `stepWorld` hasta que la fase deje de ser 'boss-victory-pause'.
   * Guiado por `world.phase` (no por un nº de ticks calculado a mano, mismo
   * motivo que `advanceThroughBossVictoryPause` en dungeon-world.test.ts: el
   * error de coma flotante de sumar FIXED_DT repetidamente hace que
   * `BOSS_VICTORY_PAUSE_DURATION / FIXED_DT` ticks exactos no siempre basten).
   */
  function advanceThroughVictoryPause(world: World, events: ReturnType<typeof createEventQueue>, maxTicks = 300): void {
    let guard = 0;
    while (world.phase === 'boss-victory-pause' && guard < maxTicks) {
      stepWorld(world, events);
      guard++;
    }
    expect(guard).toBeLessThan(maxTicks); // red de seguridad: si esto salta, el imán no llegó a tiempo
  }

  it('una moneda lejana se acerca al héroe tick a tick y acaba recogida, sin que el héroe se mueva', () => {
    const world = makeWorld([{ id: 'c1', kind: 'coin', position: { x: 8, y: 0 } }]);
    const events = createEventQueue(16);
    world.hero.velocity.x = 0;
    world.hero.velocity.y = 0;
    const heroXBefore = world.hero.position.x;
    const heroYBefore = world.hero.position.y;
    enterVictoryPause(world);

    stepWorld(world, events);
    // Un tick a VICTORY_COIN_MAGNET_SPEED=12 u/s: 8 - 12/60 = 7.8, se acercó pero no llegó todavía.
    expect(world.items[0].position.x).toBeLessThan(8);
    expect(world.items[0].position.x).toBeCloseTo(8 - VICTORY_COIN_MAGNET_SPEED * FIXED_DT, 9);
    expect(world.items[0].active).toBe(true);

    const types: string[] = [];
    advanceThroughVictoryPause(world, events);
    drainEvents(events, (e: GameEvent) => types.push(e.type));

    expect(world.items[0].active).toBe(false);
    expect(world.hero.coins).toBe(1);
    expect(world.stats.coinsCollected).toBe(1);
    expect(types).toContain('item-pickup');
    // El mundo está CONGELADO a propósito durante 'boss-victory-pause'
    // (world/step.ts): el héroe no se mueve ni una unidad pese a que la
    // moneda sí lo hace hasta él.
    expect(world.hero.position.x).toBe(heroXBefore);
    expect(world.hero.position.y).toBe(heroYBefore);
  });

  it('al terminar la pausa no quedan monedas activas, ni con la moneda en la esquina más lejana posible de la sala de jefe más grande (boss-queen.json, 11×21 u)', () => {
    const world = createWorld(
      makeRoom({
        width: 11,
        height: 21,
        items: [
          { id: 'near', kind: 'coin', position: { x: 0, y: 0 } },
          { id: 'mid-edge', kind: 'coin', position: { x: -5, y: 9 } },
          // Peor caso teórico (ver cálculo de holgura en items/constants.ts):
          // esquina opuesta a la del héroe, a ~0.1u de los 4 muros.
          { id: 'far-corner', kind: 'coin', position: { x: 5.4, y: 10.4 } },
        ],
      }),
    );
    const events = createEventQueue(16);
    // Héroe en la esquina opuesta a 'far-corner': distancia ≈ diagonal completa de la sala (~23.4u de las ~23.71u teóricas).
    world.hero.position.x = -5.4;
    world.hero.position.y = -10.4;
    world.hero.velocity.x = 0;
    world.hero.velocity.y = 0;
    enterVictoryPause(world);

    advanceThroughVictoryPause(world, events);

    expect(world.phase).toBe('victory'); // la transición de fase de siempre sigue intacta
    expect(world.items.filter((i) => i.kind === 'coin' && i.active)).toHaveLength(0);
    expect(world.hero.coins).toBe(3);
    expect(world.stats.coinsCollected).toBe(3);
  });

  it("NO actúa durante 'playing' (ahí manda el imán de mejora, con su radio y su nivel): una moneda lejana con coinMagnetLevel=0 no se mueve", () => {
    const world = makeWorld([{ id: 'c1', kind: 'coin', position: { x: 8, y: 0 } }]);
    const events = createEventQueue(16);
    expect(world.phase).toBe('playing');
    expect(world.hero.modifiers.coinMagnetLevel).toBe(0);

    for (let i = 0; i < 60; i++) stepWorld(world, events);

    expect(world.items[0].position.x).toBeCloseTo(8, 9);
    expect(world.items[0].position.y).toBeCloseTo(0, 9);
    expect(world.items[0].active).toBe(true);
  });
});
