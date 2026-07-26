/**
 * Mazmorra procedural (GDD §10.2): función pura y testeable que combina salas
 * de un pool en un mapa conectado por huecos de puerta alineados.
 *
 * SIN imports de React ni three.js. Determinista: toda aleatoriedad viene del
 * `Rng` creado a partir de la semilla (mulberry32, ver rng.ts).
 *
 * Estrategia de layout: en vez de "packing" espacial libre (que puede fallar
 * por solape entre salas de tamaños arbitrarios), el generador construye
 * primero una TOPOLOGÍA de grafo sobre una rejilla de celdas (una sala por
 * celda, aristas = puertas), garantizando por construcción:
 *   - conectividad total,
 *   - al menos un ciclo (bucle de 4 celdas),
 *   - el jefe como hoja terminal colgada del bucle,
 *   - la llave en una celda del bucle (nunca en la rama del jefe).
 * Después, cada sala se posiciona en el mundo alineando su hueco de puerta
 * exactamente con el de la sala vecina (se traduce la sala para que ambos
 * centros de puerta coincidan), lo que evita el solape sin necesidad de
 * "packing" iterativo. Si por alguna razón el pool no tiene salas suficientes
 * o compatibles, se cae a un `FALLBACK_LAYOUT` fijo y siempre válido.
 */

import { DOOR_WIDTH, ROOMS_PER_RUN, WALL_THICKNESS } from '@/game/world/constants';
import { type Rng, createRng } from '@/engine/rng';
import type { AABB, Vec2 } from '@/engine/geometry';
import type { BossId, DoorSide, DoorSlot, ItemSpawn, RoomData, RoomTag } from '@/game/world/types';

/** Hueco entre salas contiguas (además del grosor de muro de cada una). */
export const ROOM_GAP = WALL_THICKNESS;

/** Sala ya posicionada en coordenadas continuas de mundo. */
export interface PlacedRoom {
  /** Sala original (coordenadas locales, sin modificar). */
  room: RoomData;
  /** Desplazamiento sumado a toda coordenada local de la sala para obtener mundo. */
  origin: Vec2;
  /** AABB del interior jugable en coordenadas de MUNDO. */
  bounds: AABB;
  /** Índice de celda de la rejilla topológica (depuración/tests). */
  cell: { cx: number; cy: number };
}

/** Puerta entre dos salas contiguas: hueco físico + si requiere llave. */
export interface DoorConnection {
  roomAId: string;
  roomBId: string;
  /** Lado de A por el que se sale hacia B (el lado de B es el opuesto). */
  sideOnA: DoorSide;
  /** Centro del hueco de puerta en coordenadas de MUNDO. */
  center: Vec2;
  /** true si esta puerta es la de la sala del jefe (requiere llave para abrir). */
  requiresKey: boolean;
}

export interface DungeonMap {
  seed: number;
  rooms: PlacedRoom[];
  connections: DoorConnection[];
  startRoomId: string;
  bossRoomId: string;
  keyRoomId: string;
}

const OPPOSITE: Record<DoorSide, DoorSide> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const DIR_OFFSET: Record<DoorSide, { dx: number; dy: number }> = {
  // +y en la sim = "sur" (ver world.ts); north = -y, south = +y.
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

// ── Topología de grafo sobre rejilla ──────────────────────────────────────

/** Nodo de la topología: celda de rejilla + papel narrativo (inicio/llave/jefe/combate). */
interface TopologyNode {
  cx: number;
  cy: number;
  role: RoomTag;
}

interface TopologyEdge {
  a: number; // índice en nodes
  b: number;
  side: DoorSide; // lado de `a` por el que sale hacia `b`
}

interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  startIndex: number;
  bossIndex: number;
  keyIndex: number;
}

/**
 * Los 4 nodos del bucle viven SIEMPRE en el mismo cuadrado físico (mismas
 * `cx,cy` y mismas aristas: 0→1 este, 1→2 sur, 2→3 oeste, 3→0 norte — un
 * camino cerrado que vuelve exactamente al origen, ver `buildTopology`). Lo
 * que varía por semilla es qué ROL narrativo cae en cada nodo y por qué lado
 * libre cuelgan la cola y la tienda (ver `LOOP_FREE_SIDES`).
 *
 * Bucle (vista desde arriba, +y = sur):
 *   nodo0 (0,0) -- nodo1 (1,0)
 *     |                |
 *   nodo3 (0,1) -- nodo2 (1,1)
 */
const LOOP_CELLS: readonly { cx: number; cy: number }[] = [
  { cx: 0, cy: 0 },
  { cx: 1, cy: 0 },
  { cx: 1, cy: 1 },
  { cx: 0, cy: 1 },
];
const LOOP_EDGES: readonly { a: number; b: number; side: DoorSide }[] = [
  { a: 0, b: 1, side: 'east' },
  { a: 1, b: 2, side: 'south' },
  { a: 2, b: 3, side: 'west' },
  { a: 3, b: 0, side: 'north' },
];
/**
 * Lados de cada nodo del bucle NO usados por sus dos aristas del ciclo — por
 * construcción apuntan siempre hacia FUERA del cuadrado 2×2, así que colgar
 * la cola o la tienda desde cualquiera de ellos nunca reinvade una celda ya
 * ocupada del bucle (mismo índice que `LOOP_CELLS`/`LOOP_EDGES`).
 */
const LOOP_FREE_SIDES: readonly DoorSide[][] = [
  ['north', 'west'],
  ['north', 'east'],
  ['south', 'east'],
  ['south', 'west'],
];

function pickFrom<T>(options: readonly T[], rng: Rng): T {
  return options[Math.floor(rng() * options.length)];
}

/**
 * Construye una topología DEPENDIENTE de `rng` (bug playtest 2026-07-14: la
 * 2ª mazmorra de una run se veía casi igual que la 1ª porque inicio/llave/
 * jefe/tienda solo tenían un candidato fijo en el pool — con esto la FORMA
 * del grafo también varía por semilla, no solo qué sala rellena cada rol):
 * un bucle de 4 celdas (garantiza el ciclo exigido por el GDD, forma fija,
 * ver `LOOP_CELLS`/`LOOP_EDGES`) con:
 *  - Inicio: rotado aleatoriamente a cualquiera de las 4 celdas del bucle.
 *  - Llave: en cualquiera de las 3 celdas restantes (opuesta o adyacente al
 *    inicio) — nunca en el propio inicio, así que rodear el bucle sigue
 *    siendo obligatorio para alcanzarla (invariante del GDD).
 *  - Cola (combate…+jefe, jefe como hoja terminal): cuelga de una celda del
 *    bucle que no sea la de inicio, por uno de sus 2 lados libres (nunca
 *    hacia dentro del bucle, ver `LOOP_FREE_SIDES`).
 *  - Tienda (docs/plans/ECONOMY_PLAN.md F4): nodo ADICIONAL (no cuenta para
 *    `roomCount`), callejón sin salida colgado de una celda del bucle que no
 *    sea ni la de inicio ni la de la cola, por un lado libre.
 */
function buildTopology(roomCount: number, rng: Rng): Topology {
  const startIndex = Math.floor(rng() * LOOP_CELLS.length);
  const keyIndex = pickFrom(
    [0, 1, 2, 3].filter((i) => i !== startIndex),
    rng,
  );

  const nodes: TopologyNode[] = LOOP_CELLS.map((cell, i) => ({
    cx: cell.cx,
    cy: cell.cy,
    role: i === startIndex ? 'inicio' : i === keyIndex ? 'llave' : 'combate',
  }));
  const edges: TopologyEdge[] = LOOP_EDGES.map((e) => ({ ...e }));
  const occupied = new Set(LOOP_CELLS.map((c) => `${c.cx},${c.cy}`));

  // Cola de combate + jefe: cuelga de una celda del bucle distinta del
  // inicio, por uno de sus lados libres.
  const tailCellIndex = pickFrom(
    [0, 1, 2, 3].filter((i) => i !== startIndex),
    rng,
  );
  const tailDir = pickFrom(LOOP_FREE_SIDES[tailCellIndex], rng);
  const tailOffset = DIR_OFFSET[tailDir];

  const tailLength = Math.max(1, roomCount - nodes.length);
  let prevIndex = tailCellIndex;
  let cx = LOOP_CELLS[tailCellIndex].cx + tailOffset.dx;
  let cy = LOOP_CELLS[tailCellIndex].cy + tailOffset.dy;
  for (let i = 0; i < tailLength; i++) {
    const isLast = i === tailLength - 1;
    const nodeIndex = nodes.length;
    nodes.push({ cx, cy, role: isLast ? 'jefe' : 'combate' });
    edges.push({ a: prevIndex, b: nodeIndex, side: tailDir });
    occupied.add(`${cx},${cy}`);
    prevIndex = nodeIndex;
    cx += tailOffset.dx;
    cy += tailOffset.dy;
  }

  // Tienda: callejón sin salida colgado de una celda del bucle que no sea ni
  // el inicio ni la de la cola, por un lado libre (evitando, si es posible,
  // el lado que ya pisa una celda ocupada por la cola).
  const shopCellIndex = pickFrom(
    [0, 1, 2, 3].filter((i) => i !== startIndex && i !== tailCellIndex),
    rng,
  );
  const shopFreeSides = LOOP_FREE_SIDES[shopCellIndex].filter((side) => {
    const off = DIR_OFFSET[side];
    const cell = `${LOOP_CELLS[shopCellIndex].cx + off.dx},${LOOP_CELLS[shopCellIndex].cy + off.dy}`;
    return !occupied.has(cell);
  });
  const shopDir = pickFrom(shopFreeSides.length > 0 ? shopFreeSides : LOOP_FREE_SIDES[shopCellIndex], rng);
  const shopOffset = DIR_OFFSET[shopDir];
  const shopIndex = nodes.length;
  nodes.push({
    cx: LOOP_CELLS[shopCellIndex].cx + shopOffset.dx,
    cy: LOOP_CELLS[shopCellIndex].cy + shopOffset.dy,
    role: 'tienda',
  });
  edges.push({ a: shopCellIndex, b: shopIndex, side: shopDir });

  const bossIndex = nodes.findIndex((n) => n.role === 'jefe');
  return { nodes, edges, startIndex, bossIndex, keyIndex };
}

/**
 * Topología FIJA original (sin `rng`): inicio en (0,0), llave en (1,1)
 * (diagonalmente opuesta), cola colgando al este de (1,0), tienda colgando al
 * sur de (0,1). Usada solo por `buildFallbackDungeon` — el layout de
 * emergencia puede seguir fijo (siempre válido por construcción con las
 * salas fabricadas de `makeFallbackRoom`).
 */
function buildFixedTopology(roomCount: number): Topology {
  const nodes: TopologyNode[] = [
    { cx: 0, cy: 0, role: 'inicio' },
    { cx: 1, cy: 0, role: 'combate' },
    { cx: 1, cy: 1, role: 'llave' },
    { cx: 0, cy: 1, role: 'combate' },
  ];
  const edges: TopologyEdge[] = LOOP_EDGES.map((e) => ({ ...e }));

  const tailLength = Math.max(1, roomCount - nodes.length);
  let prevIndex = 1;
  let cx = 2;
  for (let i = 0; i < tailLength; i++) {
    const isLast = i === tailLength - 1;
    const nodeIndex = nodes.length;
    nodes.push({ cx, cy: 0, role: isLast ? 'jefe' : 'combate' });
    edges.push({ a: prevIndex, b: nodeIndex, side: 'east' });
    prevIndex = nodeIndex;
    cx += 1;
  }

  const shopIndex = nodes.length;
  nodes.push({ cx: 0, cy: 2, role: 'tienda' });
  edges.push({ a: 3, b: shopIndex, side: 'south' });

  const bossIndex = nodes.findIndex((n) => n.role === 'jefe');
  const keyIndex = nodes.findIndex((n) => n.role === 'llave');
  return { nodes, edges, startIndex: 0, bossIndex, keyIndex };
}

// ── Selección de salas del pool ────────────────────────────────────────────

function pickRoomForRole(
  pool: readonly RoomData[],
  role: RoomTag,
  used: Set<string>,
  rng: Rng,
  bossId?: BossId,
): RoomData | null {
  let candidates = pool.filter((r) => r.tags.includes(role) && !used.has(r.id));
  if (role === 'jefe') {
    if (bossId !== undefined) {
      // Run multi-mazmorra (GDD §10): esta mazmorra es la del jefe `bossId`
      // concreto (uno por stage de la secuencia, ver session.ts) — solo cuenta
      // la sala que lo referencia, nunca otra.
      candidates = candidates.filter((r) => r.boss === bossId);
    } else {
      // GDD §15.1 punto 9: un pool de jefes, uno por partida — solo salas con
      // `boss` (framework de Fase B0) cuentan como sala de jefe "de verdad".
      // Si el pool aún no tiene ninguna (solo B0 implementado, sin B1-B4), cae
      // a cualquier sala 'jefe' sin `boss` (boss-den.json, sala de combate
      // duro heredada) para no romper la generación de mazmorras existente.
      const withBoss = candidates.filter((r) => r.boss !== undefined);
      candidates = withBoss.length > 0 ? withBoss : candidates;
    }
  }
  if (candidates.length === 0) return null;
  const index = Math.floor(rng() * candidates.length);
  return candidates[index];
}

/**
 * Sala de emergencia 9×9 sin hazards, con doorSlots en los 4 lados centrados:
 * siempre válida. Rol 'tienda' (docs/plans/ECONOMY_PLAN.md F4): incluye un
 * tendero placeholder para que el layout de emergencia también ofrezca
 * tienda, sin enemigos (se abre igual que la sala de inicio, ver dungeon-world.ts).
 */
function makeFallbackRoom(id: string, name: string, tags: RoomTag[]): RoomData {
  const items: ItemSpawn[] = tags.includes('tienda')
    ? [{ id: 'shopkeeper', kind: 'shopkeeper', position: { x: 0, y: 0 } }]
    : [];
  return {
    version: 1,
    id,
    name,
    width: 9,
    height: 9,
    playerStart: { x: 0, y: 0 },
    tags,
    doorSlots: [
      { side: 'north', offset: 0 },
      { side: 'south', offset: 0 },
      { side: 'east', offset: 0 },
      { side: 'west', offset: 0 },
    ],
    enemies: [],
    hazards: [],
    items,
  };
}

function findDoorSlot(room: RoomData, side: DoorSide): DoorSlot | null {
  const slots = room.doorSlots.filter((s) => s.side === side);
  if (slots.length === 0) return null;
  return slots[0];
}

/** Centro (en el eje del lado) de un hueco de puerta en coordenadas LOCALES de la sala. */
function doorSlotLocalCenter(room: RoomData, slot: DoorSlot): Vec2 {
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

function roomAabbAt(room: RoomData, origin: Vec2): AABB {
  const halfW = room.width / 2;
  const halfH = room.height / 2;
  return {
    minX: origin.x - halfW,
    maxX: origin.x + halfW,
    minY: origin.y - halfH,
    maxY: origin.y + halfH,
  };
}

function aabbOverlaps(a: AABB, b: AABB, margin: number): boolean {
  return (
    a.minX - margin < b.maxX &&
    a.maxX + margin > b.minX &&
    a.minY - margin < b.maxY &&
    a.maxY + margin > b.minY
  );
}

/**
 * Intenta materializar la topología con salas reales del pool. Devuelve null
 * si no se pudo (pool insuficiente o solape irresoluble): el llamador
 * reintenta con otra selección o cae al fallback.
 */
function tryMaterialize(
  pool: readonly RoomData[],
  topology: Topology,
  rng: Rng,
  bossId?: BossId,
): DungeonMap | null {
  const used = new Set<string>();
  const chosen: (RoomData | null)[] = topology.nodes.map((node) => {
    const picked =
      pickRoomForRole(pool, node.role, used, rng, bossId) ?? pickRoomForRole(pool, 'combate', used, rng);
    if (picked) used.add(picked.id);
    return picked;
  });

  if (chosen.some((r) => r === null)) return null;
  const rooms = chosen as RoomData[];

  // Todas las salas deben tener al menos un doorSlot en cada lado que la
  // topología va a usar; si falta, esta combinación no es materializable.
  const usesSide = new Map<number, Set<DoorSide>>();
  for (const edge of topology.edges) {
    if (!usesSide.has(edge.a)) usesSide.set(edge.a, new Set());
    if (!usesSide.has(edge.b)) usesSide.set(edge.b, new Set());
    usesSide.get(edge.a)!.add(edge.side);
    usesSide.get(edge.b)!.add(OPPOSITE[edge.side]);
  }
  for (const [nodeIndex, sides] of usesSide) {
    const room = rooms[nodeIndex];
    for (const side of sides) {
      if (!findDoorSlot(room, side)) return null;
    }
  }

  // BFS de colocación: parte del nodo de inicio en origen (0,0) y coloca cada
  // vecino traduciéndolo para que su hueco de puerta coincida exactamente con
  // el de la sala ya colocada (evita solape sistemáticamente).
  const origins: (Vec2 | null)[] = new Array(topology.nodes.length).fill(null);
  const adjacency = new Map<number, { neighbor: number; side: DoorSide }[]>();
  for (const edge of topology.edges) {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a)!.push({ neighbor: edge.b, side: edge.side });
    adjacency.get(edge.b)!.push({ neighbor: edge.a, side: OPPOSITE[edge.side] });
  }

  origins[topology.startIndex] = { x: 0, y: 0 };
  const queue: number[] = [topology.startIndex];
  const visited = new Set<number>([topology.startIndex]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentOrigin = origins[current]!;
    const currentRoom = rooms[current];
    for (const { neighbor, side } of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);

      const neighborRoom = rooms[neighbor];
      const slotOnCurrent = findDoorSlot(currentRoom, side)!;
      const slotOnNeighbor = findDoorSlot(neighborRoom, OPPOSITE[side])!;

      const doorWorldOnCurrent = {
        x: currentOrigin.x + doorSlotLocalCenter(currentRoom, slotOnCurrent).x,
        y: currentOrigin.y + doorSlotLocalCenter(currentRoom, slotOnCurrent).y,
      };
      const localDoorOnNeighbor = doorSlotLocalCenter(neighborRoom, slotOnNeighbor);

      // Traduce el vecino: su hueco de puerta debe caer exactamente en
      // doorWorldOnCurrent, además del hueco de separación entre salas a lo
      // largo del eje perpendicular al lado compartido.
      const dir = DIR_OFFSET[side];
      const gapAlongAxis = ROOM_GAP;
      const neighborOrigin: Vec2 = {
        x: doorWorldOnCurrent.x - localDoorOnNeighbor.x + dir.dx * gapAlongAxis,
        y: doorWorldOnCurrent.y - localDoorOnNeighbor.y + dir.dy * gapAlongAxis,
      };

      origins[neighbor] = neighborOrigin;
      queue.push(neighbor);
    }
  }

  if (origins.some((o) => o === null)) return null;

  // Verifica que TODA arista de la topología sitúa a su vecino donde ya está
  // colocado — no solo las usadas por el BFS de arriba. El bucle de 4 salas
  // tiene un ciclo por construcción (LOOP_EDGES): el BFS lo recorre como
  // árbol de expansión y una de sus 4 aristas siempre "cierra" el ciclo con
  // los dos extremos ya visitados (`visited.has(neighbor)` la salta para
  // colocar, ver arriba) — pero esa arista SÍ genera puerta/hueco de muro más
  // abajo. Si las 4 salas del bucle tienen el mismo ancho/alto (pool
  // histórico), el ciclo cierra solo y la arista sobrante coincide gratis;
  // con salas de tamaños dispares (12 salas nuevas, f5c4e5a) puede no cerrar
  // en el espacio continuo aunque cierre en la rejilla topológica — la sala
  // vecina real (colocada por la OTRA arista del ciclo) queda a metros de
  // donde esta arista cree que está. El portón de esta conexión (un único
  // obstáculo, ver `doorGateAabb` en dungeon-world.ts) se planta en la
  // posición que calcula ESTA arista, así que sí tapa el hueco de muro del
  // lado A, pero el hueco de muro del lado B (recortado según la posición
  // REAL de esa sala) se queda sin nada que lo tape: agujero de colisión
  // atravesable (bug playtest 2026-07-25/26, "hueco entre salas").
  // Recalcula aquí el origen que le tocaría al vecino de cada arista, con la
  // misma fórmula del BFS, y lo compara contra el ya asignado: si no
  // coinciden, esta combinación de salas no es materializable con este
  // bucle — el llamador reintenta con otra selección/topología.
  for (const edge of topology.edges) {
    const roomAtA = rooms[edge.a];
    const roomAtB = rooms[edge.b];
    const originAtA = origins[edge.a]!;
    const slotAtA = findDoorSlot(roomAtA, edge.side)!;
    const slotAtB = findDoorSlot(roomAtB, OPPOSITE[edge.side])!;
    const doorWorldAtA = {
      x: originAtA.x + doorSlotLocalCenter(roomAtA, slotAtA).x,
      y: originAtA.y + doorSlotLocalCenter(roomAtA, slotAtA).y,
    };
    const localDoorAtB = doorSlotLocalCenter(roomAtB, slotAtB);
    const dir = DIR_OFFSET[edge.side];
    const expectedOriginB = {
      x: doorWorldAtA.x - localDoorAtB.x + dir.dx * ROOM_GAP,
      y: doorWorldAtA.y - localDoorAtB.y + dir.dy * ROOM_GAP,
    };
    const actualOriginB = origins[edge.b]!;
    if (
      Math.abs(expectedOriginB.x - actualOriginB.x) > 1e-6 ||
      Math.abs(expectedOriginB.y - actualOriginB.y) > 1e-6
    ) {
      return null;
    }
  }

  const placedRooms: PlacedRoom[] = rooms.map((room, i) => {
    const origin = origins[i]!;
    return {
      room,
      origin,
      bounds: roomAabbAt(room, origin),
      cell: { cx: topology.nodes[i].cx, cy: topology.nodes[i].cy },
    };
  });

  // Validación de solape: ninguna sala (excepto vecinas directas, que se
  // tocan por diseño en el hueco de puerta) debe solaparse con otra.
  const neighborPairs = new Set<string>();
  for (const edge of topology.edges) {
    neighborPairs.add(`${edge.a}-${edge.b}`);
    neighborPairs.add(`${edge.b}-${edge.a}`);
  }
  for (let i = 0; i < placedRooms.length; i++) {
    for (let j = i + 1; j < placedRooms.length; j++) {
      if (neighborPairs.has(`${i}-${j}`)) continue;
      // Salas no vecinas: no deben solaparse (margen pequeño de tolerancia numérica).
      if (aabbOverlaps(placedRooms[i].bounds, placedRooms[j].bounds, -1e-6)) {
        return null;
      }
    }
  }
  // Salas vecinas: deben estar separadas exactamente por el hueco (sin solape del interior).
  for (const edge of topology.edges) {
    if (aabbOverlaps(placedRooms[edge.a].bounds, placedRooms[edge.b].bounds, -1e-6)) {
      return null;
    }
  }

  const connections: DoorConnection[] = topology.edges.map((edge) => {
    const currentRoom = rooms[edge.a];
    const slotOnCurrent = findDoorSlot(currentRoom, edge.side)!;
    const origin = origins[edge.a]!;
    const local = doorSlotLocalCenter(currentRoom, slotOnCurrent);
    return {
      roomAId: currentRoom.id,
      roomBId: rooms[edge.b].id,
      sideOnA: edge.side,
      center: { x: origin.x + local.x, y: origin.y + local.y },
      requiresKey: rooms[edge.b].tags.includes('jefe') || rooms[edge.a].tags.includes('jefe'),
    };
  });

  return {
    seed: 0, // el llamador rellena la semilla real
    rooms: placedRooms,
    connections,
    startRoomId: rooms[topology.startIndex].id,
    bossRoomId: rooms[topology.bossIndex].id,
    keyRoomId: rooms[topology.keyIndex].id,
  };
}

// ── Validaciones (GDD §10.2) ──────────────────────────────────────────────

function buildAdjacencyById(map: DungeonMap): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const room of map.rooms) adjacency.set(room.room.id, []);
  for (const conn of map.connections) {
    adjacency.get(conn.roomAId)!.push(conn.roomBId);
    adjacency.get(conn.roomBId)!.push(conn.roomAId);
  }
  return adjacency;
}

function bfsReachable(map: DungeonMap, startId: string, blockedId?: string): Set<string> {
  const adjacency = buildAdjacencyById(map);
  const visited = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (next === blockedId) continue;
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

export interface DungeonValidation {
  valid: boolean;
  errors: string[];
}

/** Aplica las validaciones del GDD §10.2 sobre un mapa ya construido. */
export function validateDungeon(map: DungeonMap): DungeonValidation {
  const errors: string[] = [];

  // Todo alcanzable desde el inicio (sin restricción de llave: puertas
  // cerradas por "sala sin limpiar" se abren jugando; solo la del jefe exige
  // llave, y aun así cuenta como alcanzable topológicamente).
  const reachableAll = bfsReachable(map, map.startRoomId);
  for (const room of map.rooms) {
    if (!reachableAll.has(room.room.id)) {
      errors.push(`Sala inalcanzable: ${room.room.id}`);
    }
  }

  // El jefe solo debe ser alcanzable a través de la conexión marcada
  // requiresKey (no debe haber una ruta alternativa sin llave).
  const reachableWithoutBossDoor = bfsReachableExcludingKeyDoors(map, map.startRoomId);
  if (reachableWithoutBossDoor.has(map.bossRoomId)) {
    errors.push('El jefe es alcanzable sin cruzar la puerta que requiere llave.');
  }

  // La llave debe ser alcanzable sin pasar por el jefe.
  const reachableWithoutBoss = bfsReachable(map, map.startRoomId, map.bossRoomId);
  if (!reachableWithoutBoss.has(map.keyRoomId)) {
    errors.push('La llave no es alcanzable sin pasar por el jefe.');
  }

  // Sin solapes de salas no vecinas.
  const neighborPairs = new Set<string>();
  for (const conn of map.connections) {
    neighborPairs.add(`${conn.roomAId}-${conn.roomBId}`);
    neighborPairs.add(`${conn.roomBId}-${conn.roomAId}`);
  }
  for (let i = 0; i < map.rooms.length; i++) {
    for (let j = i + 1; j < map.rooms.length; j++) {
      const a = map.rooms[i];
      const b = map.rooms[j];
      const key = `${a.room.id}-${b.room.id}`;
      if (neighborPairs.has(key)) continue;
      if (aabbOverlaps(a.bounds, b.bounds, -1e-6)) {
        errors.push(`Solape entre salas: ${a.room.id} y ${b.room.id}`);
      }
    }
  }

  // Al menos un ciclo: aristas >= nodos (grafo conexo con ciclo).
  if (map.connections.length < map.rooms.length) {
    errors.push('El mapa no contiene ningún ciclo.');
  }

  return { valid: errors.length === 0, errors };
}

function bfsReachableExcludingKeyDoors(map: DungeonMap, startId: string): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const room of map.rooms) adjacency.set(room.room.id, []);
  for (const conn of map.connections) {
    if (conn.requiresKey) continue;
    adjacency.get(conn.roomAId)!.push(conn.roomBId);
    adjacency.get(conn.roomBId)!.push(conn.roomAId);
  }
  const visited = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

// ── Fallback seguro ────────────────────────────────────────────────────────

/** Layout de emergencia: mismo bucle+cola pero con salas fabricadas al vuelo, siempre válido. */
function buildFallbackDungeon(seed: number, roomCount: number): DungeonMap {
  const topology = buildFixedTopology(roomCount);
  const fallbackRooms = topology.nodes.map((node, i) =>
    makeFallbackRoom(`fallback-${i}`, `Sala ${i + 1}`, [node.role]),
  );
  const rng = createRng(seed);
  const map = tryMaterialize(fallbackRooms, topology, rng);
  if (!map) {
    // No debería ocurrir nunca (el fallback siempre es compatible): si pasa,
    // es un error de programación, no un caso de runtime a silenciar.
    throw new Error('El layout de emergencia de la mazmorra no es materializable (bug de generateDungeon).');
  }
  map.seed = seed;
  return map;
}

// ── Punto de entrada público ───────────────────────────────────────────────

/**
 * Subida de 24 a 150 junto con la validación de cierre de ciclo en
 * `tryMaterialize` (bug playtest 2026-07-25/26, "hueco entre salas"): rechazar
 * combinaciones cuyo bucle de 4 salas no cierra en el espacio continuo (ver
 * comentario en `tryMaterialize`) hace fallar mucho más a menudo la
 * materialización con las 12 salas nuevas de tamaño dispar (f5c4e5a) — con
 * 24 intentos, ~22% de las semillas caía al layout de emergencia (medido
 * sobre 1000 semillas). 150 intentos cuesta ~0.15ms/mazmorra de media (una
 * vez por carga, no por frame) y deja el fallback en 0/1000 semillas.
 */
const MAX_GENERATION_ATTEMPTS = 150;

/**
 * Genera una mazmorra determinista de `roomCount` salas (por defecto
 * ROOMS_PER_RUN) a partir de un `seed` y un `pool` de salas candidatas.
 * Garantiza las validaciones del GDD §10.2; si el pool no permite
 * materializar la topología tras varios intentos, cae al layout de
 * emergencia (siempre válido).
 *
 * `bossId` (run multi-mazmorra, GDD §10): si se da, la sala de jefe se elige
 * solo entre las salas 'jefe' cuyo `boss === bossId` (ver `pickRoomForRole`).
 * Sin él, se conserva el comportamiento histórico (sortea entre todas las
 * salas 'jefe' con `boss` definido).
 */
export function generateDungeon(
  seed: number,
  pool: readonly RoomData[],
  roomCount: number = ROOMS_PER_RUN,
  bossId?: BossId,
): DungeonMap {
  const rng = createRng(seed);

  // Cada intento sortea una topología NUEVA (no solo qué sala rellena cada
  // celda, ver `buildTopology`): con roles/candidatos casi fijos por rol
  // (inicio/llave/tienda/jefe suelen tener un único candidato en el pool de
  // serie), una única forma de grafo por seed dejaría la materialización
  // atada a si ESA forma concreta encaja con esos tamaños de sala fijos —
  // rejugar solo la selección de combate no lo arregla. Rejugar la forma
  // también multiplica las combinaciones que MAX_GENERATION_ATTEMPTS puede
  // probar, y sigue siendo determinista (mismo rng con semilla, mismo orden
  // de sorteos).
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const topology = buildTopology(roomCount, rng);
    const map = tryMaterialize(pool, topology, rng, bossId);
    if (map) {
      map.seed = seed;
      const validation = validateDungeon(map);
      if (validation.valid) return map;
    }
  }

  return buildFallbackDungeon(seed, roomCount);
}

/** Ancho de puerta usado al construir los huecos de muro (GDD §10.2). */
export { DOOR_WIDTH };

// ── Muros con huecos de puerta (obstáculos de colisión) ───────────────────

/** Segmento de muro sólido (obstáculo de colisión) con un identificador estable. */
export interface WallSegment {
  id: string;
  aabb: AABB;
}

/**
 * Construye los segmentos de muro sólidos de una sala colocada, dejando un
 * hueco de `DOOR_WIDTH` centrado en cada posición de `openGapCenters` (huecos
 * de puerta abiertos: ni siquiera colisionan mientras estén abiertos) y
 * huecos de puerta CERRADOS representados como muro sólido normal (se tratan
 * como el resto del lado, sin hueco) — el llamador decide qué huecos pasar
 * como abiertos según el estado de juego (sala limpiada / llave).
 *
 * Un lado con un hueco abierto se parte en hasta 2 segmentos (izquierda y
 * derecha del hueco); con dos huecos abiertos, hasta 3 segmentos.
 */
export function buildRoomWallSegments(
  room: RoomData,
  origin: Vec2,
  openGapCenters: { side: DoorSide; offset: number }[],
): WallSegment[] {
  const halfW = room.width / 2;
  const halfH = room.height / 2;
  const t = WALL_THICKNESS;
  const halfDoor = DOOR_WIDTH / 2;
  const segments: WallSegment[] = [];

  const sides: { side: DoorSide; axisLen: number; center: Vec2; horizontal: boolean }[] = [
    { side: 'north', axisLen: room.width, center: { x: 0, y: -(halfH + t / 2) }, horizontal: true },
    { side: 'south', axisLen: room.width, center: { x: 0, y: halfH + t / 2 }, horizontal: true },
    { side: 'west', axisLen: room.height, center: { x: -(halfW + t / 2), y: 0 }, horizontal: false },
    { side: 'east', axisLen: room.height, center: { x: halfW + t / 2, y: 0 }, horizontal: false },
  ];

  for (const sideDef of sides) {
    const gaps = openGapCenters
      .filter((g) => g.side === sideDef.side)
      .map((g) => g.offset)
      .sort((a, b) => a - b);

    // Sin huecos abiertos en este lado: un único segmento sólido de punta a punta.
    if (gaps.length === 0) {
      segments.push(makeWallSegment(room.id, sideDef.side, 0, sideDef, halfW, halfH, t, origin));
      continue;
    }

    // Con huecos: recorre el eje del lado partiendo en segmentos sólidos
    // entre el borde/huecos anteriores, saltando el ancho de puerta en cada hueco.
    // El recorrido arranca/termina `t` MÁS ALLÁ de las esquinas, igual que el
    // lado sin huecos (`makeWallSegment` cubre halfW*2 + 2t): sin esa
    // extensión, si dos lados adyacentes tienen puerta, la esquina t×t que
    // comparten no la cubre ningún segmento — muesca visible al vacío y
    // agujero de colisión real (bug playtest móvil 2026-07-15).
    const axisHalf = sideDef.axisLen / 2;
    let cursor = -axisHalf - t;
    let segIndex = 0;
    for (const gapOffset of gaps) {
      const gapStart = gapOffset - halfDoor;
      const gapEnd = gapOffset + halfDoor;
      if (gapStart > cursor + 1e-9) {
        segments.push(
          makeWallSegmentRange(room.id, sideDef.side, segIndex++, sideDef, cursor, gapStart, t, origin),
        );
      }
      cursor = Math.max(cursor, gapEnd);
    }
    if (cursor < axisHalf + t - 1e-9) {
      segments.push(
        makeWallSegmentRange(room.id, sideDef.side, segIndex++, sideDef, cursor, axisHalf + t, t, origin),
      );
    }
  }

  return segments;
}

function makeWallSegment(
  roomId: string,
  side: DoorSide,
  index: number,
  sideDef: { center: Vec2; horizontal: boolean },
  halfW: number,
  halfH: number,
  t: number,
  origin: Vec2,
): WallSegment {
  const width = sideDef.horizontal ? halfW * 2 + 2 * t : t;
  const height = sideDef.horizontal ? t : halfH * 2 + 2 * t;
  return {
    id: `${roomId}-wall-${side}-${index}`,
    aabb: {
      minX: origin.x + sideDef.center.x - width / 2,
      maxX: origin.x + sideDef.center.x + width / 2,
      minY: origin.y + sideDef.center.y - height / 2,
      maxY: origin.y + sideDef.center.y + height / 2,
    },
  };
}

/** Segmento de muro entre dos posiciones a lo largo del eje del lado (para lados partidos por un hueco). */
function makeWallSegmentRange(
  roomId: string,
  side: DoorSide,
  index: number,
  sideDef: { center: Vec2; horizontal: boolean },
  axisStart: number,
  axisEnd: number,
  t: number,
  origin: Vec2,
): WallSegment {
  if (sideDef.horizontal) {
    return {
      id: `${roomId}-wall-${side}-${index}`,
      aabb: {
        minX: origin.x + sideDef.center.x + axisStart,
        maxX: origin.x + sideDef.center.x + axisEnd,
        minY: origin.y + sideDef.center.y - t / 2,
        maxY: origin.y + sideDef.center.y + t / 2,
      },
    };
  }
  return {
    id: `${roomId}-wall-${side}-${index}`,
    aabb: {
      minX: origin.x + sideDef.center.x - t / 2,
      maxX: origin.x + sideDef.center.x + t / 2,
      minY: origin.y + sideDef.center.y + axisStart,
      maxY: origin.y + sideDef.center.y + axisEnd,
    },
  };
}
