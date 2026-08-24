/**
 * Ensambla un `World` multi-sala a partir de un `DungeonMap` ya generado
 * (features/dungeon/dungeon.ts): coloca todas las salas en coordenadas continuas de
 * mundo, fusiona sus entidades (enemigos/hazards/items/obstáculos) en los
 * arrays planos que el resto de la sim ya recorre, y construye los muros y
 * las puertas.
 *
 * Modelo de puertas (GDD §10.2):
 * - Los MUROS son estáticos: se construyen UNA vez con el hueco de puerta ya
 *   recortado en cada lado que participa en una conexión (los doorSlots de la
 *   sala que no conectan con nada quedan como muro sólido).
 * - Cada conexión tiene un PORTÓN ("door gate"): un obstáculo AABB que tapa
 *   el hueco mientras la puerta está cerrada (el héroe rebota contra él como
 *   contra un muro) y se retira al abrirse. El estado abierto/cerrado es POR
 *   CONEXIÓN: abrir una puerta la abre para las dos salas a la vez.
 *
 * SIN imports de React ni three.js.
 */

import { DOOR_WIDTH, WALL_THICKNESS } from '@/game/world/constants';
import { HERO_RADIUS, HERO_START_HP } from '@/game/features/hero/constants';
import { buildRoomWallSegments, type DungeonMap } from './dungeon';
import { createRng } from '@/engine/rng';
import { buildRoomEntities, createDefaultModifiers, createProjectilePool, createPuddlePool } from '@/game/world/create';
import type { AABB, Vec2 } from '@/engine/geometry';
import type { Barrel, DoorSide, Enemy, HazardRuntime, Item, Obstacle, RoomDoorRuntime, RoomRuntime, World } from '@/game/world/types';

/** Prefijo de id de los obstáculos-portón (para filtrarlos al reconstruir y al renderizar). */
export const DOOR_GATE_ID_PREFIX = 'door-gate-';

const OPPOSITE_SIDE: Record<DoorSide, DoorSide> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/** true si la sala no tiene enemigos: cuenta como limpiada desde el tick 0 (misma regla que step.ts). */
function isRoomInitiallyCleared(enemyCount: number): boolean {
  return enemyCount === 0;
}

/** Offset local (a lo largo del lado) de un hueco de puerta, a partir de su centro en mundo. */
function doorOffsetFor(origin: Vec2, side: DoorSide, center: Vec2): number {
  return side === 'north' || side === 'south' ? center.x - origin.x : center.y - origin.y;
}

/**
 * AABB del portón de una conexión: tapa el hueco entre los interiores de las
 * dos salas. Con ROOM_GAP = WALL_THICKNESS los muros de ambas salas coinciden
 * en el mismo bloque de grosor t, así que el portón ocupa exactamente ese
 * bloque: desde el borde interior de la sala A hasta el de la sala B.
 */
export function doorGateAabb(center: Vec2, sideOnA: DoorSide): AABB {
  const t = WALL_THICKNESS;
  const halfDoor = DOOR_WIDTH / 2;
  switch (sideOnA) {
    case 'north':
      return { minX: center.x - halfDoor, maxX: center.x + halfDoor, minY: center.y - t, maxY: center.y };
    case 'south':
      return { minX: center.x - halfDoor, maxX: center.x + halfDoor, minY: center.y, maxY: center.y + t };
    case 'east':
      return { minX: center.x, maxX: center.x + t, minY: center.y - halfDoor, maxY: center.y + halfDoor };
    case 'west':
      return { minX: center.x - t, maxX: center.x, minY: center.y - halfDoor, maxY: center.y + halfDoor };
  }
}

/**
 * Abre una conexión (ambos lados a la vez: la puerta es una sola físicamente)
 * y reconstruye los portones. Idempotente. Evento raro: no es hot-path.
 */
export function openConnection(world: World, connectionIndex: number): void {
  let changed = false;
  for (const runtime of world.roomRuntimes.values()) {
    for (const door of runtime.doors) {
      if (door.connectionIndex === connectionIndex && !door.open) {
        door.open = true;
        changed = true;
      }
    }
  }
  if (changed) {
    syncDoorGates(world);
  }
}

/**
 * Cierra una conexión (ambos lados). Usado por el sellado de la sala de jefe
 * (GDD §15.1 punto 7): la puerta por la que se entró con llave vuelve a
 * cerrarse en cuanto el héroe está dentro, para que no se pueda salir e
 * interrumpir el combate. Idempotente; reconstruye los portones igual que
 * `openConnection`.
 */
export function closeConnection(world: World, connectionIndex: number): void {
  let changed = false;
  for (const runtime of world.roomRuntimes.values()) {
    for (const door of runtime.doors) {
      if (door.connectionIndex === connectionIndex && door.open) {
        door.open = false;
        changed = true;
      }
    }
  }
  if (changed) {
    syncDoorGates(world);
  }
}

/**
 * Reconstruye los obstáculos-portón a partir del estado de puertas: un AABB
 * sólido por conexión CERRADA; nada por conexión abierta. Incrementa
 * `wallVersion` para que el render reconstruya sus mallas.
 */
export function syncDoorGates(world: World): void {
  const dungeon = world.dungeon;
  if (!dungeon) return;

  for (let i = world.obstacles.length - 1; i >= 0; i--) {
    if (world.obstacles[i].id.startsWith(DOOR_GATE_ID_PREFIX)) {
      world.obstacles.splice(i, 1);
    }
  }

  dungeon.connections.forEach((conn, connectionIndex) => {
    const runtimeA = world.roomRuntimes.get(conn.roomAId);
    const door = runtimeA?.doors.find((d) => d.connectionIndex === connectionIndex);
    if (!door || door.open) return;
    world.obstacles.push({
      id: `${DOOR_GATE_ID_PREFIX}${connectionIndex}${conn.requiresKey ? '-key' : ''}`,
      aabb: doorGateAabb(conn.center, conn.sideOnA),
    });
  });

  world.wallVersion += 1;
}

/**
 * Construye el estado vivo de una mazmorra multi-sala completa. Determinista:
 * toda la aleatoriedad (HP variable de Trail/Shooter) usa un único RNG con
 * semilla derivada de `dungeon.seed`, consumido en el mismo orden de salas
 * que produjo `generateDungeon`.
 */
export function createDungeonWorld(dungeon: DungeonMap, seed: number = dungeon.seed): World {
  const rng = createRng(seed);

  const obstacles: Obstacle[] = [];
  const hazards: HazardRuntime[] = [];
  const barrels: Barrel[] = [];
  const enemies: Enemy[] = [];
  const items: Item[] = [];
  const roomRuntimes = new Map<string, RoomRuntime>();

  // Conexiones → puertas por sala (una entrada en `doors` por cada lado que
  // participa en una conexión; ambas salas de la conexión reciben su puerta).
  const doorsByRoom = new Map<string, RoomDoorRuntime[]>();
  dungeon.connections.forEach((conn, connectionIndex) => {
    if (!doorsByRoom.has(conn.roomAId)) doorsByRoom.set(conn.roomAId, []);
    if (!doorsByRoom.has(conn.roomBId)) doorsByRoom.set(conn.roomBId, []);
    doorsByRoom.get(conn.roomAId)!.push({
      connectionIndex,
      side: conn.sideOnA,
      center: conn.center,
      requiresKey: conn.requiresKey,
      open: false,
    });
    doorsByRoom.get(conn.roomBId)!.push({
      connectionIndex,
      side: OPPOSITE_SIDE[conn.sideOnA],
      center: conn.center,
      requiresKey: conn.requiresKey,
      open: false,
    });
  });

  for (const placed of dungeon.rooms) {
    const bundle = buildRoomEntities(placed.room, placed.origin, placed.bounds, rng, placed.room.id);
    obstacles.push(...bundle.obstacles);
    hazards.push(...bundle.hazards);
    barrels.push(...bundle.barrels);
    enemies.push(...bundle.enemies);
    items.push(...bundle.items);

    const doors = doorsByRoom.get(placed.room.id) ?? [];
    const cleared = isRoomInitiallyCleared(bundle.enemies.length);

    roomRuntimes.set(placed.room.id, {
      id: placed.room.id,
      name: placed.room.name,
      tags: placed.room.tags,
      origin: placed.origin,
      bounds: placed.bounds,
      visited: placed.room.id === dungeon.startRoomId,
      cleared,
      enemyIds: bundle.enemies.map((e) => e.id),
      doors,
    });

    // Muros ESTÁTICOS: hueco recortado en cada lado con conexión (abierta o
    // cerrada: el cierre lo pone el portón, no el muro).
    const gaps = doors.map((d) => ({ side: d.side, offset: doorOffsetFor(placed.origin, d.side, d.center) }));
    const segments = buildRoomWallSegments(placed.room, placed.origin, gaps);
    for (const seg of segments) {
      obstacles.push({ id: seg.id, aabb: seg.aabb, roomId: placed.room.id });
    }
  }

  const startRuntime = roomRuntimes.get(dungeon.startRoomId)!;
  const startRoom = dungeon.rooms.find((r) => r.room.id === dungeon.startRoomId)!;
  const playerStart: Vec2 = {
    x: startRoom.room.playerStart.x + startRoom.origin.x,
    y: startRoom.room.playerStart.y + startRoom.origin.y,
  };

  const world: World = {
    room: startRoom.room,
    bounds: startRuntime.bounds,
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
    dungeon,
    roomRuntimes,
    currentRoomId: dungeon.startRoomId,
    wallVersion: 0,
    lockedNoticeCooldownUntil: 0,
    isFinalDungeon: true,
    shopGreeterArmed: true,
    godMode: false,
  };

  // Salas limpiadas de entrada (sin enemigos): sus conexiones sin llave nacen
  // abiertas (ambos lados). Después, materializa los portones de las cerradas.
  for (const runtime of roomRuntimes.values()) {
    if (!runtime.cleared) continue;
    for (const door of runtime.doors) {
      if (door.requiresKey) continue;
      for (const rt of roomRuntimes.values()) {
        for (const d of rt.doors) {
          if (d.connectionIndex === door.connectionIndex) d.open = true;
        }
      }
    }
  }
  syncDoorGates(world);
  world.wallVersion = 0;

  return world;
}
