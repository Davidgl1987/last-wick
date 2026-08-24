/**
 * Factorías del mundo: pools preasignados, entidades de sala y `createWorld`.
 * Simulación pura: SIN imports de React ni three.js.
 */

import type { AABB, Vec2 } from '@/engine/geometry';
import { createRng, type Rng } from '@/engine/rng';
import { PROJECTILE_POOL_SIZE } from '@/game/features/combat/constants';
import { SHOOTER_CHASE_DURATION } from '@/game/features/enemies/shooter/constants';
import { PUDDLE_POOL_SIZE } from '@/game/features/hazards/constants';
import { HERO_RADIUS, HERO_START_HP } from '@/game/features/hero/constants';
import type {
  Barrel,
  Enemy,
  EnemyKind,
  EnemySpawn,
  HazardRuntime,
  HeroModifiers,
  Item,
  Obstacle,
  Projectile,
  Puddle,
  RoomData,
  World,
} from './types';

export function createProjectilePool(): Projectile[] {
  const pool: Projectile[] = [];
  for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
    pool.push({
      active: false,
      kind: 'arrow',
      owner: 'hero',
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      radius: 0.18,
      damage: 0,
      ttl: 0,
      bouncesLeft: 0,
      pierceLeft: 0,
      hitEnemyIds: [],
      colorTag: '',
    });
  }
  return pool;
}

export function createPuddlePool(): Puddle[] {
  const pool: Puddle[] = [];
  for (let i = 0; i < PUDDLE_POOL_SIZE; i++) {
    pool.push({ active: false, position: { x: 0, y: 0 }, radius: 0, ttl: 0, slows: false });
  }
  return pool;
}

export function createDefaultModifiers(): HeroModifiers {
  return {
    ramDamageBonus: 0,
    arrowDamageBonus: 0,
    spellDamageBonus: 0,
    spellRadiusBonus: 0,
    shieldCharges: 0,
    launchSpeedBonus: 0,
    knockbackTakenMultiplier: 1,
    arrowCountBonus: 0,
    arrowPierceBonus: 0,
    spellCountBonus: 0,
    spellBounceBonus: 0,
    coinMagnetLevel: 0,
  };
}

/** Deriva el destino de patrulla automático: el eje con más espacio libre dentro de la sala. */
function deriveAutoPatrolTarget(bounds: AABB, position: Vec2, margin: number): Vec2 {
  const spaceLeft = position.x - bounds.minX;
  const spaceRight = bounds.maxX - position.x;
  const spaceDown = position.y - bounds.minY;
  const spaceUp = bounds.maxY - position.y;
  const maxSpace = Math.max(spaceLeft, spaceRight, spaceDown, spaceUp);
  if (maxSpace === spaceLeft) return { x: position.x - Math.min(margin, spaceLeft), y: position.y };
  if (maxSpace === spaceRight) return { x: position.x + Math.min(margin, spaceRight), y: position.y };
  if (maxSpace === spaceDown) return { x: position.x, y: position.y - Math.min(margin, spaceDown) };
  return { x: position.x, y: position.y + Math.min(margin, spaceUp) };
}

function enemyHpFor(kind: EnemyKind, rng: Rng): number {
  switch (kind) {
    case 'dummy':
      return 2;
    case 'chaser':
      return 3;
    case 'spike':
      return 3;
    case 'trail':
      return 3 + Math.floor(rng() * 2); // 3–4
    case 'shooter':
      return 3 + Math.floor(rng() * 2); // 3–4
    case 'boss':
      // Placeholder: la vida real de un jefe la fija su `BossDef` (GDD §15.6,
      // `features/bosses/registry.ts`); `bosses/lifecycle.ts::initBossEnemies`
      // la sobreescribe justo después de construir el mundo (world/ no puede
      // importar la tabla de jefes sin crear un ciclo, ver nota de diseño en
      // lifecycle.ts).
      return 1;
  }
}

function createEnemy(spawn: EnemySpawn, bounds: AABB, rng: Rng, origin: Vec2, roomId?: string): Enemy {
  const spawnPos = { x: spawn.position.x + origin.x, y: spawn.position.y + origin.y };
  const patrolFrom = { x: spawnPos.x, y: spawnPos.y };
  const patrolTo = spawn.patrolTarget
    ? { x: spawn.patrolTarget.x + origin.x, y: spawn.patrolTarget.y + origin.y }
    : deriveAutoPatrolTarget(bounds, spawnPos, 1.6);
  const hp = spawn.hp ?? enemyHpFor(spawn.kind, rng);
  return {
    id: spawn.id,
    kind: spawn.kind,
    roomId,
    position: { x: spawnPos.x, y: spawnPos.y },
    velocity: { x: 0, y: 0 },
    radius: spawn.radius ?? 0.4,
    hp,
    maxHp: hp,
    patrolFrom,
    patrolTo,
    patrolForward: true,
    chasing: false,
    facing: spawn.facing ? { x: spawn.facing.x, y: spawn.facing.y } : { x: 0, y: 1 },
    trailDropTimer: 0,
    shooterPhase: 'chase',
    shooterPhaseTimer: SHOOTER_CHASE_DURATION,
    hitFlashUntil: 0,
    spikeDamageCooldownUntil: 0,
    knockbackUntil: 0,
    steerBias: 0,
    bossId: spawn.bossId,
    bossPhase: 1,
    bossVulnerable: false,
    bossDamageOutsideWindowFactor: 0,
    bossBarrelDamage: 0,
    bossVulnerableUntil: 0,
    bossTelegraphUntil: 0,
    bossTelegraphKind: '',
    bossTimer: 0,
    bossStage: 0,
    bossCounter: 0,
    bossWeaponGateA: '',
    bossWeaponGateB: '',
  };
}

/** Resultado de construir las entidades de una sala colocada en coordenadas de mundo. */
export interface RoomEntityBundle {
  obstacles: Obstacle[];
  hazards: HazardRuntime[];
  barrels: Barrel[];
  enemies: Enemy[];
  items: Item[];
}

/**
 * Construye las entidades vivas de una sala (enemigos/hazards/barriles/items)
 * trasladadas por `origin` a coordenadas de mundo. Usado tanto por
 * `createWorld` (origin {0,0}, modo sala única) como por `createDungeonWorld`
 * (una llamada por sala colocada, origin = PlacedRoom.origin).
 */
export function buildRoomEntities(
  room: RoomData,
  origin: Vec2,
  bounds: AABB,
  rng: Rng,
  roomId?: string,
): RoomEntityBundle {
  // Los ids de las entidades son locales a cada sala (dos salas del pool
  // pueden tener ambas un 'dummy-1'): en la mazmorra multi-sala se
  // prefijan con el id de sala para que sean únicos en el mundo fusionado —
  // los cooldowns de contacto, el registro de drops y las keys de React
  // indexan por id global.
  const globalId = (localId: string): string => (roomId !== undefined ? `${roomId}:${localId}` : localId);

  const obstacles: Obstacle[] = [];
  const hazards: HazardRuntime[] = [];
  const barrels: Barrel[] = [];
  for (const hazard of room.hazards) {
    const worldPos = { x: hazard.position.x + origin.x, y: hazard.position.y + origin.y };
    if (hazard.kind === 'rock') {
      obstacles.push({
        id: globalId(hazard.id),
        roomId,
        aabb: {
          minX: worldPos.x - hazard.width / 2,
          maxX: worldPos.x + hazard.width / 2,
          minY: worldPos.y - hazard.height / 2,
          maxY: worldPos.y + hazard.height / 2,
        },
      });
    } else if (hazard.kind === 'barrel') {
      barrels.push({
        id: globalId(hazard.id),
        roomId,
        position: worldPos,
        radius: Math.max(hazard.width, hazard.height) / 2,
        exploded: false,
      });
    } else {
      hazards.push({ ...hazard, id: globalId(hazard.id), position: worldPos, roomId });
    }
  }

  const enemies = room.enemies.map((spawn) =>
    createEnemy(roomId !== undefined ? { ...spawn, id: globalId(spawn.id) } : spawn, bounds, rng, origin, roomId),
  );

  const items: Item[] = room.items.map((spawn) => ({
    id: globalId(spawn.id),
    kind: spawn.kind,
    position: { x: spawn.position.x + origin.x, y: spawn.position.y + origin.y },
    active: true,
    roomId,
  }));

  return { obstacles, hazards, barrels, enemies, items };
}

/** Construye el estado vivo inicial a partir de los datos de una sala. Determinista: RNG con semilla. */
export function createWorld(room: RoomData, seed = 1): World {
  const halfW = room.width / 2;
  const halfH = room.height / 2;
  const bounds: AABB = { minX: -halfW, minY: -halfH, maxX: halfW, maxY: halfH };
  const rng = createRng(seed);
  const origin: Vec2 = { x: 0, y: 0 };

  const { obstacles, hazards, barrels, enemies, items } = buildRoomEntities(room, origin, bounds, rng);

  const playerStart = { x: room.playerStart.x, y: room.playerStart.y };

  return {
    room,
    bounds,
    obstacles,
    hero: {
      position: { x: playerStart.x, y: playerStart.y },
      velocity: { x: 0, y: 0 },
      radius: HERO_RADIUS,
      hp: HERO_START_HP,
      maxHp: HERO_START_HP,
      invulnerableUntil: 0,
      lastLaunchTime: -10,
      weaponMode: 'body',
      lastArrowTime: -10,
      lastSpellTime: -10,
      hasKey: false,
      modifiers: createDefaultModifiers(),
      upgradeLevels: {},
      coins: 0,
      trailDwell: 0,
    },
    enemies,
    projectiles: createProjectilePool(),
    puddles: createPuddlePool(),
    items,
    barrels,
    bossState: null,
    hazards,
    safePosition: { x: playerStart.x, y: playerStart.y },
    fallingUntil: 0,
    phase: 'playing',
    stats: { roomsCleared: 0, coinsCollected: 0, damageDealt: 0, score: 0 },
    rng,
    heroAiming: false,
    heroMove: { x: 0, y: 0 },
    contactDamageCooldowns: new Map(),
    spikeDamageCooldowns: new Map(),
    deadEnemiesDropped: new Set(),
    bossDefeatedEmitted: new Set(),
    time: 0,
    bossVictoryPauseUntil: 0,
    bossVictoryNextPhase: null,
    dungeon: null,
    roomRuntimes: new Map(),
    currentRoomId: room.id,
    wallVersion: 0,
    lockedNoticeCooldownUntil: 0,
    isFinalDungeon: true,
    shopGreeterArmed: true,
    godMode: false,
  };
}
