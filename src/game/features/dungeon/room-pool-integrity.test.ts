/**
 * Validación integral del pool de salas de serie (GDD §13, §10.2 y §10.3).
 *
 * A diferencia de `rooms.test.ts` (que comprueba que el POOL COMPLETO produce
 * mazmorras válidas), este fichero recorre SALA POR SALA todo
 * `src/game/features/dungeon/levels/*.json` con el mismo `import.meta.glob`
 * que usa `rooms.ts` — así que cubre automáticamente cualquier sala que se
 * añada en el futuro, incluidas las que el editor del juego guarde ahí
 * directamente desde `/api/editor/rooms` (ver vite.config.ts). El objetivo es
 * que guardar una sala rota desde el editor falle aquí, con un mensaje que
 * diga exactamente qué sala y qué está mal, no en mitad de una partida.
 *
 * Nota: `boss-test.json` también se valida aquí (aparece en el glob igual que
 * cualquier otra sala) aunque `rooms.ts` lo excluya del pool fuera de
 * dev/tests — es una sala real y debe ser una sala VÁLIDA, solo que no se usa
 * en producción.
 */

import { describe, expect, it } from 'vitest';
import { parseRoomData } from './room-format';
import { DOOR_WIDTH } from '@/game/world/constants';
import type { DoorSlot, RoomData, RoomTag } from '@/game/world/types';

// ── Descubrimiento de ficheros (mismo glob que rooms.ts) ──────────────────

const LEVEL_JSON_MODULES = import.meta.glob('./levels/*.json', { eager: true, import: 'default' }) as Record<
  string,
  unknown
>;

const LEVEL_FILES = Object.keys(LEVEL_JSON_MODULES)
  .sort()
  .map((path) => ({
    filename: path.slice(path.lastIndexOf('/') + 1),
    json: LEVEL_JSON_MODULES[path],
  }));

// ── Geometría: márgenes e interior jugable ─────────────────────────────────

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Tolerancia para que un contacto EXACTO con un límite (borde a borde) no cuente como invasión. */
const EPS = 1e-6;

/**
 * Margen mínimo de cualquier entidad contra CUALQUIER muro. Con este margen,
 * el interior jugable (donde puede caer una entidad) va de -(width-1)/2 a
 * +(width-1)/2 en X y análogo en Y (encargo): width/2 - WALL_MARGIN ==
 * (width-1)/2, el margen ya viene incorporado en esa resta de 1.
 */
const WALL_MARGIN = 0.5;

function interiorMargin(room: RoomData): { marginX: number; marginY: number } {
  return { marginX: (room.width - 1) / 2, marginY: (room.height - 1) / 2 };
}

/** true si el punto cae dentro del interior jugable con margen (enemigos/items/playerStart). */
function pointWithinMargin(room: RoomData, p: Point): boolean {
  const { marginX, marginY } = interiorMargin(room);
  return Math.abs(p.x) <= marginX + EPS && Math.abs(p.y) <= marginY + EPS;
}

/** true si el RECTÁNGULO completo (ancho/alto) cae dentro del interior jugable con margen (hazards). */
function rectWithinMargin(room: RoomData, p: Point, width: number, height: number): boolean {
  const { marginX, marginY } = interiorMargin(room);
  const hw = width / 2;
  const hh = height / 2;
  return (
    p.x - hw >= -marginX - EPS &&
    p.x + hw <= marginX + EPS &&
    p.y - hh >= -marginY - EPS &&
    p.y + hh <= marginY + EPS
  );
}

// ── Geometría: huecos de puerta ────────────────────────────────────────────

/** Centro (en coordenadas LOCALES de la sala) de un hueco de puerta. Espejo de dungeon.ts::doorSlotLocalCenter. */
function doorSlotCenter(room: RoomData, slot: DoorSlot): Point {
  const halfW = room.width / 2;
  const halfH = room.height / 2;
  switch (slot.side) {
    case 'north':
      return { x: slot.offset, y: -halfH };
    case 'south':
      return { x: slot.offset, y: halfH };
    case 'east':
      return { x: halfW, y: slot.offset };
    case 'west':
      return { x: -halfW, y: slot.offset };
  }
}

/**
 * Zona de exclusión de un hueco de puerta: un cuadrado de lado 2*DOOR_BAND_HALF
 * pegado al muro correspondiente, centrado en el hueco.
 *
 * DOOR_BAND_HALF = DOOR_WIDTH/2 + WALL_MARGIN (el mismo margen que usa el
 * resto del fichero): la puerta mide DOOR_WIDTH centrada en su lado, y a cada
 * lado se exige el mismo colchón WALL_MARGIN que ya se exige contra
 * cualquier muro. Se aplica ese mismo valor también en PROFUNDIDAD (hacia el
 * interior) en vez de solo en anchura: un hazard/enemigo justo pegado al
 * hueco pero un poco más adentro seguiría bloqueando el paso igual. Este
 * criterio se validó contra las 21 salas de serie ya existentes antes de
 * añadirlo: encajaba exactamente (colchón de 1.5 u, a menudo justo al
 * límite) en todas salvo dos hazards de `combat-arena.json` y dos de
 * `combat-spikefield.json`, que sí invadían el hueco por un margen pequeño
 * — casos reales que este test corrige (ver informe de la tarea).
 */
const DOOR_BAND_HALF = DOOR_WIDTH / 2 + WALL_MARGIN;

function doorZone(room: RoomData, slot: DoorSlot): Rect {
  const halfW = room.width / 2;
  const halfH = room.height / 2;
  switch (slot.side) {
    case 'north':
      return { x0: slot.offset - DOOR_BAND_HALF, x1: slot.offset + DOOR_BAND_HALF, y0: -halfH, y1: -halfH + DOOR_BAND_HALF };
    case 'south':
      return { x0: slot.offset - DOOR_BAND_HALF, x1: slot.offset + DOOR_BAND_HALF, y0: halfH - DOOR_BAND_HALF, y1: halfH };
    case 'east':
      return { x0: halfW - DOOR_BAND_HALF, x1: halfW, y0: slot.offset - DOOR_BAND_HALF, y1: slot.offset + DOOR_BAND_HALF };
    case 'west':
      return { x0: -halfW, x1: -halfW + DOOR_BAND_HALF, y0: slot.offset - DOOR_BAND_HALF, y1: slot.offset + DOOR_BAND_HALF };
  }
}

function rectOverlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.y0 < b.y1 - EPS && a.y1 > b.y0 + EPS;
}

/** Lado de la puerta que invade esta entidad (rectángulo, o punto con w=h=0), o null si no invade ninguna. */
function invadesDoorSlot(room: RoomData, p: Point, width: number, height: number): DoorSlot['side'] | null {
  const hw = width / 2;
  const hh = height / 2;
  const rect: Rect = { x0: p.x - hw, x1: p.x + hw, y0: p.y - hh, y1: p.y + hh };
  for (const slot of room.doorSlots) {
    if (rectOverlaps(rect, doorZone(room, slot))) return slot.side;
  }
  return null;
}

// ── Atravesabilidad: flood-fill sobre rejilla fina, pits intransitables ────

const GRID_STEP = 0.25;

function buildReachability(room: RoomData): { reaches(p: Point): boolean } {
  const halfW = room.width / 2;
  const halfH = room.height / 2;
  const nx = Math.round(room.width / GRID_STEP) + 1;
  const ny = Math.round(room.height / GRID_STEP) + 1;
  const idxToX = (i: number) => -halfW + i * GRID_STEP;
  const idxToY = (j: number) => -halfH + j * GRID_STEP;
  const toIndex = (v: number, half: number) => Math.round((v + half) / GRID_STEP);
  const inBounds = (i: number, j: number) => i >= 0 && i < nx && j >= 0 && j < ny;
  const cell = (i: number, j: number) => j * nx + i;

  const pits = room.hazards.filter((h) => h.kind === 'pit');
  const blocked = (i: number, j: number): boolean => {
    const x = idxToX(i);
    const y = idxToY(j);
    return pits.some((p) => {
      const hw = p.width / 2;
      const hh = p.height / 2;
      return x > p.position.x - hw && x < p.position.x + hw && y > p.position.y - hh && y < p.position.y + hh;
    });
  };

  const visited = new Uint8Array(nx * ny);
  const startI = toIndex(room.playerStart.x, halfW);
  const startJ = toIndex(room.playerStart.y, halfH);
  if (inBounds(startI, startJ) && !blocked(startI, startJ)) {
    visited[cell(startI, startJ)] = 1;
    const queue: Array<[number, number]> = [[startI, startJ]];
    let head = 0;
    while (head < queue.length) {
      const [i, j] = queue[head++]!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di;
        const nj = j + dj;
        if (!inBounds(ni, nj) || visited[cell(ni, nj)] || blocked(ni, nj)) continue;
        visited[cell(ni, nj)] = 1;
        queue.push([ni, nj]);
      }
    }
  }

  return {
    reaches(p: Point) {
      const i = toIndex(p.x, halfW);
      const j = toIndex(p.y, halfH);
      return inBounds(i, j) && visited[cell(i, j)] === 1;
    },
  };
}

// ── Comprobaciones por sala ─────────────────────────────────────────────────

describe.each(LEVEL_FILES)('sala $filename', ({ filename, json }) => {
  const result = parseRoomData(json);

  it('pasa parseRoomData sin errores', () => {
    expect(result.valid, `${filename}: ${result.errors.join('; ')}`).toBe(true);
  });

  // El resto de comprobaciones de ESTA sala necesitan una RoomData ya parseada;
  // si el parseo falló, el `it` anterior ya reporta el detalle y no hay nada más que mirar.
  if (!result.valid || !result.room) return;
  const room = result.room;

  it('el id coincide con el nombre de fichero (convención del editor, ver vite.config.ts)', () => {
    expect(room.id).toBe(filename.replace(/\.json$/, ''));
  });

  it('toda entidad cae dentro del interior jugable (>= 0.5 u de margen contra cualquier muro)', () => {
    const violations: string[] = [];

    if (!pointWithinMargin(room, room.playerStart)) {
      violations.push(`playerStart (${room.playerStart.x}, ${room.playerStart.y})`);
    }
    for (const e of room.enemies) {
      if (!pointWithinMargin(room, e.position)) violations.push(`enemigo "${e.id}" (${e.position.x}, ${e.position.y})`);
    }
    for (const it2 of room.items) {
      if (!pointWithinMargin(room, it2.position)) violations.push(`item "${it2.id}" (${it2.position.x}, ${it2.position.y})`);
    }
    for (const h of room.hazards) {
      if (!rectWithinMargin(room, h.position, h.width, h.height)) {
        violations.push(`hazard "${h.id}" (${h.position.x}, ${h.position.y}, ${h.width}x${h.height})`);
      }
    }

    expect(violations, `sala "${room.id}": entidades fuera del interior jugable: ${violations.join(' | ')}`).toEqual([]);
  });

  it('ningún hazard ni enemigo invade un hueco de puerta (banda de DOOR_WIDTH/2 + 0.5 u pegada al muro)', () => {
    const violations: string[] = [];

    for (const e of room.enemies) {
      const side = invadesDoorSlot(room, e.position, 0, 0);
      if (side) violations.push(`enemigo "${e.id}" invade la puerta ${side}`);
    }
    for (const h of room.hazards) {
      const side = invadesDoorSlot(room, h.position, h.width, h.height);
      if (side) violations.push(`hazard "${h.id}" invade la puerta ${side}`);
    }

    expect(violations, `sala "${room.id}": ${violations.join(' | ')}`).toEqual([]);
  });

  it('tag "tienda" implica item shopkeeper; tag "llave" implica item key', () => {
    if (room.tags.includes('tienda')) {
      expect(
        room.items.some((i) => i.kind === 'shopkeeper'),
        `sala "${room.id}" tiene tag "tienda" pero ningún item kind:"shopkeeper"`,
      ).toBe(true);
    }
    if (room.tags.includes('llave')) {
      expect(
        room.items.some((i) => i.kind === 'key'),
        `sala "${room.id}" tiene tag "llave" pero ningún item kind:"key"`,
      ).toBe(true);
    }
  });

  it('desde playerStart se alcanzan los 4 huecos de puerta y (si existen) la llave y el tendero, tratando los pits como intransitables', () => {
    const { reaches } = buildReachability(room);
    const violations: string[] = [];

    for (const slot of room.doorSlots) {
      if (!reaches(doorSlotCenter(room, slot))) {
        violations.push(`puerta ${slot.side}@${slot.offset} inalcanzable desde playerStart`);
      }
    }
    const key = room.items.find((i) => i.kind === 'key');
    if (key && !reaches(key.position)) violations.push(`llave "${key.id}" inalcanzable desde playerStart`);
    const shopkeeper = room.items.find((i) => i.kind === 'shopkeeper');
    if (shopkeeper && !reaches(shopkeeper.position)) {
      violations.push(`tendero "${shopkeeper.id}" inalcanzable desde playerStart`);
    }

    expect(violations, `sala "${room.id}": ${violations.join(' | ')}`).toEqual([]);
  });
});

// ── Variedad del pool: candidatas por rol (GDD §10.2) ──────────────────────

describe('variedad del pool de serie', () => {
  const parsedRooms: RoomData[] = LEVEL_FILES.flatMap(({ json }) => {
    const result = parseRoomData(json);
    return result.valid && result.room ? [result.room] : [];
  });

  /**
   * Cada mazmorra (ROOMS_PER_RUN=6) consume EXACTAMENTE 1 sala 'inicio', 1
   * 'llave', 3 'combate' y 1 'jefe', más 1 'tienda' aparte (docs/plans/
   * ECONOMY_PLAN.md F4) — ver dungeon.ts::buildFixedTopology/generateDungeon.
   * Si el pool solo tiene esas cantidades exactas por rol, `pickRoomForRole`
   * no tiene ENTRE QUÉ elegir: cada partida sortearía siempre las mismas
   * salas. Por eso se exige un colchón >= 3 candidatas por rol (>= el propio
   * consumo de 'combate', el rol que más salas gasta de golpe) — es lo que
   * garantiza que las mazmorras varíen de una partida a otra. Quien rompa
   * este test añadiendo/quitando salas del pool debe reponer el colchón, no
   * relajar el número.
   */
  const MIN_CANDIDATES_PER_ROLE = 3;

  it.each([['combate'], ['inicio'], ['llave'], ['tienda']] as const)(
    `al menos ${MIN_CANDIDATES_PER_ROLE} salas candidatas con tag "%s"`,
    (role: RoomTag) => {
      const candidates = parsedRooms.filter((r) => r.tags.includes(role));
      expect(
        candidates.length,
        `solo ${candidates.length} sala(s) con tag "${role}" en el pool (candidatas: ${candidates.map((r) => r.id).join(', ') || 'ninguna'}); se necesitan >= ${MIN_CANDIDATES_PER_ROLE} para que las mazmorras varíen entre partidas`,
      ).toBeGreaterThanOrEqual(MIN_CANDIDATES_PER_ROLE);
    },
  );
});
