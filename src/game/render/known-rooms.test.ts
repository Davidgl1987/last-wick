/**
 * `computeKnownRoomIds` (known-rooms.ts): sala conocida = sala de arranque,
 * o visitada, o con alguna conexión ya abierta. Encargo de playtest
 * (David, 2026-08-06): ocultar salas a las que el héroe no puede llegar
 * todavía, con dos matices que estos tests fijan como regresión — una sala
 * vista se queda vista, y cerrar una puerta detrás no la re-oculta.
 */

import { describe, expect, it } from 'vitest';
import { computeKnownRoomIds } from './known-rooms';
import { generateDungeon } from '@/game/features/dungeon/dungeon';
import { closeConnection, createDungeonWorld, openConnection } from '@/game/features/dungeon/dungeon-world';
import { seriesRooms } from '@/game/features/dungeon/rooms';
import { createGameSession } from '@/game/session/session';
import type { RoomData } from '@/game/world/types';

function buildWorld(seed: number) {
  const dungeon = generateDungeon(seed, seriesRooms);
  return { dungeon, world: createDungeonWorld(dungeon, seed) };
}

/**
 * Busca una conexión cuya puerta siga CERRADA en el mundo recién creado y
 * cuyo extremo lejano todavía no sea conocido por ningún otro camino — las
 * salas 'inicio' del pool real suelen nacer sin enemigos (`cleared` de
 * fábrica, ver `createDungeonWorld`), así que alguna de sus conexiones ya
 * nace ABIERTA; no vale asumir a ciegas "la primera conexión de la sala de
 * inicio está cerrada", hay que comprobarlo.
 */
function findHiddenConnection(
  dungeon: ReturnType<typeof generateDungeon>,
  world: ReturnType<typeof createDungeonWorld>,
): { connectionIndex: number; neighborId: string } {
  for (let i = 0; i < dungeon.connections.length; i++) {
    const conn = dungeon.connections[i];
    const runtimeA = world.roomRuntimes.get(conn.roomAId)!;
    const doorA = runtimeA.doors.find((d) => d.connectionIndex === i)!;
    if (doorA.open) continue;
    const known = computeKnownRoomIds(world);
    const neighborId = known.has(conn.roomAId) ? conn.roomBId : conn.roomAId;
    if (!known.has(neighborId)) return { connectionIndex: i, neighborId };
  }
  throw new Error('no se encontró ninguna conexión cerrada con extremo desconocido (revisar la semilla del test)');
}

describe('computeKnownRoomIds', () => {
  it('modo sala única (sin mazmorra): Set vacío, nunca lanza', () => {
    const room: RoomData = {
      version: 1,
      id: 'sala-suelta',
      name: 'Sala suelta',
      width: 9,
      height: 9,
      playerStart: { x: 0, y: 0 },
      tags: ['inicio'],
      doorSlots: [],
      enemies: [],
      hazards: [],
      items: [],
    };
    const session = createGameSession(room, false);
    expect(computeKnownRoomIds(session.world).size).toBe(0);
  });

  it('la sala de arranque es conocida desde el frame 0, antes de cualquier step', () => {
    const { dungeon, world } = buildWorld(1);
    const known = computeKnownRoomIds(world);
    expect(known.has(dungeon.startRoomId)).toBe(true);
  });

  it('una sala no visitada con todas sus conexiones cerradas NO es conocida', () => {
    const { dungeon, world } = buildWorld(1);
    const known = computeKnownRoomIds(world);
    for (const placed of dungeon.rooms) {
      if (placed.room.id === dungeon.startRoomId) continue;
      const runtime = world.roomRuntimes.get(placed.room.id)!;
      if (runtime.doors.every((d) => !d.open)) {
        expect(known.has(placed.room.id)).toBe(false);
      }
    }
  });

  it('abrir una conexión revela la sala vecina aunque el héroe no haya entrado (sin marcar visited)', () => {
    const { dungeon, world } = buildWorld(2);
    const { connectionIndex, neighborId } = findHiddenConnection(dungeon, world);
    expect(computeKnownRoomIds(world).has(neighborId)).toBe(false);

    openConnection(world, connectionIndex);

    expect(computeKnownRoomIds(world).has(neighborId)).toBe(true);
  });

  it('una sala visitada se queda conocida aunque se cierre la puerta por la que se entró (no se re-oculta)', () => {
    const { dungeon, world } = buildWorld(3);
    const { connectionIndex, neighborId } = findHiddenConnection(dungeon, world);

    // Visita real (no solo puerta abierta): el héroe entró de verdad.
    const runtime = world.roomRuntimes.get(neighborId)!;
    runtime.visited = true;
    openConnection(world, connectionIndex);
    expect(computeKnownRoomIds(world).has(neighborId)).toBe(true);

    // Cerrar la puerta detrás (p. ej. sellado de sala de jefe) NO re-oculta
    // la sala ya vista: `visited` no se toca al cerrar la conexión.
    closeConnection(world, connectionIndex);
    expect(computeKnownRoomIds(world).has(neighborId)).toBe(true);
  });
});
