/**
 * Parse/validación del formato de sala serializable (GDD §13, contrato en
 * world.ts::RoomData). Es la puerta de entrada de cualquier JSON externo
 * (editor, pool de niveles, import de usuario): nunca se confía en un JSON
 * sin pasar por aquí primero.
 *
 * SIN imports de React ni three.js.
 */

import { DOOR_WIDTH, ROOM_MIN_SIZE } from '@/game/world/constants';
import { BOSS_DEFS } from '@/game/features/bosses/registry';
import type { BossId, DoorSide, DoorSlot, EnemyKind, EnemySpawn, HazardKind, HazardSpawn, ItemKind, ItemSpawn, RoomData, RoomTag } from '@/game/world/types';
import type { Vec2 } from '@/engine/geometry';

export interface RoomParseResult {
  valid: boolean;
  errors: string[];
  room: RoomData | null;
}

const ROOM_TAGS: readonly RoomTag[] = ['inicio', 'combate', 'llave', 'recompensa', 'jefe', 'tienda'];
const DOOR_SIDES: readonly DoorSide[] = ['north', 'south', 'east', 'west'];
const ENEMY_KINDS: readonly EnemyKind[] = ['dummy', 'chaser', 'spike', 'trail', 'shooter', 'boss'];
const HAZARD_KINDS: readonly HazardKind[] = ['pit', 'spikes', 'barrel', 'rock'];
const ITEM_KINDS: readonly ItemKind[] = ['coin', 'potion', 'key', 'shopkeeper'];
const BOSS_IDS: readonly BossId[] = Object.keys(BOSS_DEFS) as BossId[];

function isVec2(value: unknown): value is Vec2 {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Vec2).x === 'number' &&
    typeof (value as Vec2).y === 'number' &&
    Number.isFinite((value as Vec2).x) &&
    Number.isFinite((value as Vec2).y)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Valida y normaliza un JSON arbitrario como `RoomData`. Devuelve errores
 * legibles en vez de lanzar: el llamador (editor/importador) decide si
 * bloquea el guardado o solo avisa.
 */
export function parseRoomData(input: unknown): RoomParseResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { valid: false, errors: ['El JSON de la sala no es un objeto.'], room: null };
  }

  if (input.version !== 1) {
    errors.push('Campo "version" ausente o no soportado (debe ser 1).');
  }
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    errors.push('Falta un identificador de sala válido ("id").');
  }
  if (typeof input.name !== 'string' || input.name.trim() === '') {
    errors.push('Falta un nombre de sala válido ("name").');
  }
  if (typeof input.width !== 'number' || input.width < ROOM_MIN_SIZE || input.width % 2 === 0) {
    errors.push(`"width" debe ser un número impar >= ${ROOM_MIN_SIZE}.`);
  }
  if (typeof input.height !== 'number' || input.height < ROOM_MIN_SIZE || input.height % 2 === 0) {
    errors.push(`"height" debe ser un número impar >= ${ROOM_MIN_SIZE}.`);
  }
  if (!isVec2(input.playerStart)) {
    errors.push('Falta "playerStart" (posición {x,y} válida).');
  }
  if (!Array.isArray(input.tags) || input.tags.length === 0) {
    errors.push('"tags" debe ser un array no vacío de etiquetas de sala.');
  } else if (!input.tags.every((t) => ROOM_TAGS.includes(t as RoomTag))) {
    errors.push(`"tags" contiene un valor no reconocido (válidos: ${ROOM_TAGS.join(', ')}).`);
  }

  const doorSlots: DoorSlot[] = [];
  if (!Array.isArray(input.doorSlots)) {
    errors.push('"doorSlots" debe ser un array.');
  } else {
    const perSide = new Map<DoorSide, number[]>();
    for (const raw of input.doorSlots) {
      if (
        !isRecord(raw) ||
        !DOOR_SIDES.includes(raw.side as DoorSide) ||
        typeof raw.offset !== 'number' ||
        !Number.isFinite(raw.offset)
      ) {
        errors.push('Hueco de puerta inválido en "doorSlots" (side/offset).');
        continue;
      }
      const side = raw.side as DoorSide;
      doorSlots.push({ side, offset: raw.offset });
      if (!perSide.has(side)) perSide.set(side, []);
      perSide.get(side)!.push(raw.offset);
    }
    for (const [side, offsets] of perSide) {
      if (offsets.length > 2) {
        errors.push(`El lado "${side}" tiene más de 2 huecos de puerta (máximo 2).`);
      }
      const sorted = offsets.slice().sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] < DOOR_WIDTH) {
          errors.push(`Huecos de puerta demasiado próximos en el lado "${side}" (separación mínima ${DOOR_WIDTH} u).`);
        }
      }
    }
  }

  const enemies: EnemySpawn[] = [];
  if (!Array.isArray(input.enemies)) {
    errors.push('"enemies" debe ser un array.');
  } else {
    const seenIds = new Set<string>();
    for (const raw of input.enemies) {
      if (
        !isRecord(raw) ||
        typeof raw.id !== 'string' ||
        !ENEMY_KINDS.includes(raw.kind as EnemyKind) ||
        !isVec2(raw.position)
      ) {
        errors.push('Enemigo inválido en "enemies" (id/kind/position).');
        continue;
      }
      if (seenIds.has(raw.id)) {
        errors.push(`Id de enemigo duplicado: "${raw.id}".`);
      }
      seenIds.add(raw.id);
      if (raw.kind === 'boss' && !BOSS_IDS.includes(raw.bossId as BossId)) {
        errors.push(`Enemigo "${raw.id}" es kind:"boss" pero "bossId" no es válido (válidos: ${BOSS_IDS.join(', ')}).`);
        continue;
      }
      const spawn: EnemySpawn = { id: raw.id, kind: raw.kind as EnemyKind, position: raw.position as Vec2 };
      if (isVec2(raw.patrolTarget)) spawn.patrolTarget = raw.patrolTarget;
      if (isVec2(raw.facing)) spawn.facing = raw.facing;
      if (typeof raw.hp === 'number' && Number.isFinite(raw.hp) && raw.hp > 0) spawn.hp = raw.hp;
      if (typeof raw.radius === 'number' && Number.isFinite(raw.radius) && raw.radius > 0) {
        spawn.radius = raw.radius;
      }
      if (raw.kind === 'boss') spawn.bossId = raw.bossId as BossId;
      enemies.push(spawn);
    }
  }

  const hazards: HazardSpawn[] = [];
  if (!Array.isArray(input.hazards)) {
    errors.push('"hazards" debe ser un array.');
  } else {
    const seenIds = new Set<string>();
    for (const raw of input.hazards) {
      if (
        !isRecord(raw) ||
        typeof raw.id !== 'string' ||
        !HAZARD_KINDS.includes(raw.kind as HazardKind) ||
        !isVec2(raw.position) ||
        typeof raw.width !== 'number' ||
        raw.width <= 0 ||
        typeof raw.height !== 'number' ||
        raw.height <= 0
      ) {
        errors.push('Hazard inválido en "hazards" (id/kind/position/width/height).');
        continue;
      }
      if (seenIds.has(raw.id)) {
        errors.push(`Id de hazard duplicado: "${raw.id}".`);
      }
      seenIds.add(raw.id);
      const hazard: HazardSpawn = {
        id: raw.id,
        kind: raw.kind as HazardKind,
        position: raw.position as Vec2,
        width: raw.width,
        height: raw.height,
      };
      hazards.push(hazard);
    }
  }

  const items: ItemSpawn[] = [];
  if (!Array.isArray(input.items)) {
    errors.push('"items" debe ser un array.');
  } else {
    const seenIds = new Set<string>();
    for (const raw of input.items) {
      if (!isRecord(raw) || typeof raw.id !== 'string' || !ITEM_KINDS.includes(raw.kind as ItemKind) || !isVec2(raw.position)) {
        errors.push('Objeto inválido en "items" (id/kind/position).');
        continue;
      }
      if (seenIds.has(raw.id)) {
        errors.push(`Id de item duplicado: "${raw.id}".`);
      }
      seenIds.add(raw.id);
      items.push({ id: raw.id, kind: raw.kind as ItemKind, position: raw.position as Vec2 });
    }
  }

  // Campo opcional "boss" (GDD §15): marca esta sala como la sala de jefe de
  // la run. Si está presente debe ser un BossId válido; el generador exige
  // exactamente 1 sala con `boss` por run (ver features/dungeon/dungeon.ts).
  let boss: BossId | undefined;
  if (input.boss !== undefined) {
    if (typeof input.boss !== 'string' || !BOSS_IDS.includes(input.boss as BossId)) {
      errors.push(`"boss" no es un id de jefe válido (válidos: ${BOSS_IDS.join(', ')}).`);
    } else {
      boss = input.boss as BossId;
    }
  }

  // Validación cruzada: el inicio del jugador no debe caer encima de un hazard rectangular.
  if (isVec2(input.playerStart)) {
    const start = input.playerStart;
    for (const hazard of hazards) {
      const hw = hazard.width / 2;
      const hh = hazard.height / 2;
      if (
        start.x >= hazard.position.x - hw &&
        start.x <= hazard.position.x + hw &&
        start.y >= hazard.position.y - hh &&
        start.y <= hazard.position.y + hh
      ) {
        errors.push(`El inicio del jugador cae encima del hazard "${hazard.id}".`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, room: null };
  }

  const room: RoomData = {
    version: 1,
    id: input.id as string,
    name: input.name as string,
    width: input.width as number,
    height: input.height as number,
    playerStart: input.playerStart as Vec2,
    tags: input.tags as RoomTag[],
    doorSlots,
    enemies,
    hazards,
    items,
    ...(boss !== undefined ? { boss } : {}),
  };
  return { valid: true, errors: [], room };
}

/** Azúcar: parsea una cadena JSON directamente (import de fichero/portapapeles). */
export function parseRoomDataFromJson(json: string): RoomParseResult {
  try {
    const parsed = JSON.parse(json);
    return parseRoomData(parsed);
  } catch {
    return { valid: false, errors: ['El texto no es JSON válido.'], room: null };
  }
}
