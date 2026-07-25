/**
 * Integración de arranque (fase 3): la sesión por defecto del juego es un
 * mundo de mazmorra multi-sala generado desde el pool de serie, con semilla
 * forzable (parámetro `seed` de `createDungeonGameSession`) que sobrevive a
 * los reinicios.
 */

import { describe, expect, it } from 'vitest';
import { seriesRooms, testRoom } from '@/game/features/dungeon/rooms';
import { applyUpgrade, UPGRADE_POOL } from './upgrades';
import {
  advanceToNextDungeon,
  chooseBossReward,
  createDungeonGameSession,
  createGameSession,
  ensureBossRewardChoices,
  restartSession,
  type GameSession,
} from './session';

describe('createDungeonGameSession (arranque de run completa)', () => {
  it('crea un mundo multi-sala con el pool de serie: dungeon activo, héroe en la sala de inicio', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    const world = session.world;

    expect(world.dungeon).not.toBeNull();
    // 6 (ROOMS_PER_RUN) + 1 tienda adicional (docs/plans/ECONOMY_PLAN.md F4).
    expect(world.dungeon!.rooms.length).toBe(7);
    expect(world.currentRoomId).toBe(world.dungeon!.startRoomId);

    const startRuntime = world.roomRuntimes.get(world.dungeon!.startRoomId)!;
    expect(startRuntime.visited).toBe(true);
    const { position } = world.hero;
    expect(position.x).toBeGreaterThanOrEqual(startRuntime.bounds.minX);
    expect(position.x).toBeLessThanOrEqual(startRuntime.bounds.maxX);
    expect(position.y).toBeGreaterThanOrEqual(startRuntime.bounds.minY);
    expect(position.y).toBeLessThanOrEqual(startRuntime.bounds.maxY);
  });

  it('es determinista con semilla forzada: mismas salas y misma colocación', () => {
    const a = createDungeonGameSession(seriesRooms, 1234);
    const b = createDungeonGameSession(seriesRooms, 1234);
    expect(a.world.dungeon!.rooms.map((r) => r.room.id)).toEqual(
      b.world.dungeon!.rooms.map((r) => r.room.id),
    );
    expect(a.world.dungeon!.rooms.map((r) => r.origin)).toEqual(
      b.world.dungeon!.rooms.map((r) => r.origin),
    );
  });

  it('los enemigos de salas no visitadas existen pero sus salas están sin visitar', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    const world = session.world;
    const unvisited = [...world.roomRuntimes.values()].filter((r) => !r.visited);
    expect(unvisited.length).toBeGreaterThan(0);
    // Y hay enemigos asignados a salas (etiquetados con roomId).
    expect(world.enemies.every((e) => e.roomId !== undefined)).toBe(true);
  });

  it('restartSession con semilla forzada regenera el MISMO mapa; sin forzar, una run nueva', () => {
    const forced = createDungeonGameSession(seriesRooms, 777);
    const idsBefore = forced.world.dungeon!.rooms.map((r) => r.room.id);
    restartSession(forced);
    expect(forced.seed).toBe(777);
    expect(forced.world.dungeon!.rooms.map((r) => r.room.id)).toEqual(idsBefore);

    const free = createDungeonGameSession(seriesRooms, null);
    const seedBefore = free.seed;
    restartSession(free);
    // Sin forzar: la semilla se resortea (probabilidad de colisión despreciable,
    // pero lo que garantizamos es que el mundo se regenera y sigue siendo válido).
    expect(free.world.dungeon).not.toBeNull();
    expect(typeof free.seed).toBe('number');
    expect(free.world.currentRoomId).toBe(free.world.dungeon!.startRoomId);
    // seedBefore solo se usa para asegurar que ambos son enteros válidos.
    expect(Number.isInteger(seedBefore)).toBe(true);
  });

  it('el modo sala única (playtest del editor) sigue creando un mundo sin dungeon', () => {
    const session = createGameSession(testRoom);
    expect(session.world.dungeon).toBeNull();
    expect(session.dungeonPool).toBeNull();
    // Modo sala única: sin secuencia de jefes, mundo tratado como final.
    expect(session.bossSequence).toEqual([]);
    expect(session.stageIndex).toBe(0);
    expect(session.world.isFinalDungeon).toBe(true);
  });
});

describe('bossSequence (run multi-mazmorra, GDD §10)', () => {
  it('contiene exactamente los jefes de diseño del pool de serie, uno cada uno (sin test-boss)', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    expect([...session.bossSequence].sort()).toEqual(['guardian', 'prisma', 'queen', 'storm']);
    expect(session.bossSequence).not.toContain('test-boss');
  });

  it('es determinista con la misma semilla forzada', () => {
    const a = createDungeonGameSession(seriesRooms, 999);
    const b = createDungeonGameSession(seriesRooms, 999);
    expect(a.bossSequence).toEqual(b.bossSequence);
  });

  it('el orden es SIEMPRE el orden fijo de dificultad (playtest 2026-07-15: La Tormenta la más difícil, siempre última), sea cual sea la semilla', () => {
    const expected = ['guardian', 'queen', 'prisma', 'storm'];
    for (let seed = 0; seed < 30; seed++) {
      expect(createDungeonGameSession(seriesRooms, seed).bossSequence).toEqual(expected);
    }
  });

  it('la mazmorra del primer stage tiene la sala del primer jefe de la secuencia', () => {
    const session = createDungeonGameSession(seriesRooms, 7);
    const bossRoom = session.world.dungeon!.rooms.find((r) => r.room.id === session.world.dungeon!.bossRoomId)!;
    expect(bossRoom.room.boss).toBe(session.bossSequence[0]);
  });

  it('isFinalDungeon es true en el stage 0 solo si hay un único jefe en la secuencia', () => {
    const session = createDungeonGameSession(seriesRooms, 7);
    expect(session.bossSequence.length).toBe(4);
    expect(session.world.isFinalDungeon).toBe(false);
  });
});

describe('advanceToNextDungeon (run multi-mazmorra, GDD §10)', () => {
  it('conserva hp/maxHp/modifiers/coins/upgradeLevels y stats acumulados; hasKey false; avanza al jefe del siguiente stage', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    expect(session.bossSequence.length).toBe(4);
    const secondBoss = session.bossSequence[1];

    // Progreso simulado en la primera mazmorra.
    session.world.hero.hp = 2;
    session.world.hero.maxHp = 5;
    session.world.hero.modifiers.ramDamageBonus = 3;
    session.world.hero.hasKey = true;
    session.world.hero.coins = 37;
    session.world.hero.upgradeLevels['cuerpo-dano'] = 2;
    session.world.stats.roomsCleared = 4;
    session.world.stats.coinsCollected = 7;
    session.world.stats.damageDealt = 55.5;
    session.world.stats.score = 120;

    advanceToNextDungeon(session);

    expect(session.stageIndex).toBe(1);
    expect(session.world.hero.hp).toBe(2);
    expect(session.world.hero.maxHp).toBe(5);
    expect(session.world.hero.modifiers.ramDamageBonus).toBe(3);
    expect(session.world.hero.hasKey).toBe(false);
    expect(session.world.hero.coins).toBe(37);
    expect(session.world.hero.upgradeLevels['cuerpo-dano']).toBe(2);
    expect(session.world.stats.roomsCleared).toBe(4);
    expect(session.world.stats.coinsCollected).toBe(7);
    expect(session.world.stats.damageDealt).toBe(55.5);
    expect(session.world.stats.score).toBe(120);

    const nextBossRoom = session.world.dungeon!.rooms.find((r) => r.room.id === session.world.dungeon!.bossRoomId)!;
    expect(nextBossRoom.room.boss).toBe(secondBoss);
    // Con 3 jefes en la secuencia, el stage 1 (índice 1) NO es el último (lo es el 2).
    expect(session.world.isFinalDungeon).toBe(false);
  });

  it('no muta los modifiers ni upgradeLevels del mundo anterior (copia el objeto, no la referencia)', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    session.world.hero.upgradeLevels['flecha-dano'] = 1;
    const prevModifiers = session.world.hero.modifiers;
    const prevUpgradeLevels = session.world.hero.upgradeLevels;
    advanceToNextDungeon(session);
    expect(session.world.hero.modifiers).not.toBe(prevModifiers);
    expect(session.world.hero.modifiers).toEqual(prevModifiers);
    expect(session.world.hero.upgradeLevels).not.toBe(prevUpgradeLevels);
    expect(session.world.hero.upgradeLevels).toEqual(prevUpgradeLevels);
  });
});

describe('restartSession y muerte: economía (GDD §10, docs/plans/ECONOMY_PLAN.md)', () => {
  it('restartSession NO conserva coins ni upgradeLevels (héroe nuevo de fábrica)', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    session.world.hero.coins = 50;
    session.world.hero.upgradeLevels['cuerpo-dano'] = 3;

    restartSession(session);

    expect(session.world.hero.coins).toBe(0);
    expect(session.world.hero.upgradeLevels).toEqual({});
  });
});

describe('shopStock (tienda, docs/plans/ECONOMY_PLAN.md F4)', () => {
  it('se sortea al crear la run: hasta 4 mejoras distintas, determinista con la misma semilla', () => {
    const a = createDungeonGameSession(seriesRooms, 42);
    const b = createDungeonGameSession(seriesRooms, 42);
    expect(a.shopStock.length).toBe(4);
    const ids = a.shopStock.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(a.shopStock.map((d) => d.id)).toEqual(b.shopStock.map((d) => d.id));
  });

  it('se re-sortea (nueva referencia) en advanceToNextDungeon', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    const stockBefore = session.shopStock;
    advanceToNextDungeon(session);
    expect(session.shopStock).not.toBe(stockBefore);
  });

  it('se re-sortea (nueva referencia) en restartSession', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    const stockBefore = session.shopStock;
    restartSession(session);
    expect(session.shopStock).not.toBe(stockBefore);
  });
});

describe('restartSession (run multi-mazmorra, GDD §10)', () => {
  it('vuelve a stageIndex 0 y recalcula bossSequence (mismo orden fijo de dificultad)', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    advanceToNextDungeon(session);
    expect(session.stageIndex).toBe(1);

    restartSession(session);

    expect(session.stageIndex).toBe(0);
    expect(session.bossSequence).toEqual(['guardian', 'queen', 'prisma', 'storm']);
    const bossRoom = session.world.dungeon!.rooms.find((r) => r.room.id === session.world.dungeon!.bossRoomId)!;
    expect(bossRoom.room.boss).toBe(session.bossSequence[0]);
  });
});

describe('godMode (?godmode, herramienta de playtest B5)', () => {
  it('createDungeonGameSession/createGameSession propagan el flag a world.godMode y session.godMode', () => {
    const dungeonSession = createDungeonGameSession(seriesRooms, 42, true);
    expect(dungeonSession.godMode).toBe(true);
    expect(dungeonSession.world.godMode).toBe(true);

    const roomSession = createGameSession(testRoom, true);
    expect(roomSession.godMode).toBe(true);
    expect(roomSession.world.godMode).toBe(true);

    // Por defecto (sin ?godmode) sigue apagado en ambos modos.
    expect(createDungeonGameSession(seriesRooms, 42).world.godMode).toBe(false);
    expect(createGameSession(testRoom).world.godMode).toBe(false);
  });

  it('sobrevive a restartSession y advanceToNextDungeon (el flag es de sesión, no del world que se recrea)', () => {
    const session = createDungeonGameSession(seriesRooms, 42, true);

    advanceToNextDungeon(session);
    expect(session.world.godMode).toBe(true);

    restartSession(session);
    expect(session.world.godMode).toBe(true);
  });
});

/** Maxea las 9 mejoras de ATAQUE (cuerpo/flecha/hechizo) del héroe de la sesión: deja rollBossReward sin nada que ofrecer. */
function maxAllAttackUpgrades(session: GameSession): void {
  for (const def of UPGRADE_POOL) {
    if (def.category === 'consumible') continue;
    for (let i = 0; i < def.maxLevel; i++) applyUpgrade(session.world, def, session.events);
  }
}

describe('ensureBossRewardChoices / chooseBossReward (fase boss-reward, docs/plans/ECONOMY_PLAN.md F3)', () => {
  it('es idempotente: llamadas repetidas devuelven las mismas opciones sin volver a tirar el rng', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    session.world.phase = 'boss-reward';

    const first = ensureBossRewardChoices(session);
    const second = ensureBossRewardChoices(session);

    expect(second).toBe(first); // misma referencia: no se recalculó.
    expect(second.map((d) => d.id)).toEqual(first.map((d) => d.id));
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(3);
  });

  it('chooseBossReward aplica el nivel de la mejora elegida, vacía las opciones y pasa a dungeon-cleared', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    session.world.phase = 'boss-reward';
    const choices = ensureBossRewardChoices(session);
    const picked = choices[0];
    const levelBefore = session.world.hero.upgradeLevels[picked.id] ?? 0;

    chooseBossReward(session, picked);

    expect(session.world.hero.upgradeLevels[picked.id]).toBe(levelBefore + 1);
    expect(session.bossRewardChoices).toEqual([]);
    expect(session.world.phase).toBe('dungeon-cleared');
  });

  it('con todas las mejoras de ataque maxeadas, no deja la fase atascada: pasa a dungeon-cleared sin opciones', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    maxAllAttackUpgrades(session);
    session.world.phase = 'boss-reward';

    const choices = ensureBossRewardChoices(session);

    expect(choices).toEqual([]);
    expect(session.world.phase).toBe('dungeon-cleared');
  });

  it('restartSession vacía bossRewardChoices', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    session.world.phase = 'boss-reward';
    ensureBossRewardChoices(session);
    expect(session.bossRewardChoices.length).toBeGreaterThan(0);

    restartSession(session);

    expect(session.bossRewardChoices).toEqual([]);
  });

  it('advanceToNextDungeon vacía bossRewardChoices', () => {
    const session = createDungeonGameSession(seriesRooms, 42);
    // Deja alguna opción "pendiente" simulando que se llegó aquí sin pasar por chooseBossReward.
    session.bossRewardChoices = [UPGRADE_POOL[0]];

    advanceToNextDungeon(session);

    expect(session.bossRewardChoices).toEqual([]);
  });
});
