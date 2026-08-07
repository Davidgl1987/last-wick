/**
 * Sala "conocida": único sitio que decide si una sala de la mazmorra debe
 * pintarse. Encargo de playtest (David, 2026-08-06): "quizá sea más fácil
 * ocultar las salas que no están disponibles en lugar de la niebla" — hoy
 * `DungeonStructureView` (RoomView.tsx) monta las 6-7 salas de la mazmorra
 * ENTERAS desde el frame 0 (suelo, muros, postes, rocas, atrezzo, enemigos,
 * items de TODAS, aunque el héroe no haya llegado ni de lejos). Este fichero
 * es el ÚNICO sitio que calcula "¿se pinta esta sala?" — todo lo demás
 * (RoomView.tsx, RoomPropsView.tsx, EnemyViews.tsx, ItemView.tsx,
 * HazardView.tsx) importa `useKnownRoomIds` y filtra su propia lista con el
 * resultado, en vez de repetir la condición.
 *
 * Regla acordada con David (dos matices explícitos):
 * - una sala vista una vez se queda vista para siempre: NO se puede "reocultar"
 *   al salir de ella. Por eso la condición mira `RoomRuntime.visited`, que ya
 *   es un flag que solo pasa de false→true y nunca vuelve atrás
 *   (`stepRoomTransition`, world/step.ts) — no hace falta un flag nuevo.
 * - una puerta que se cierra detrás no oculta la sala de atrás: por eso NO
 *   comprobamos "¿la puerta está abierta AHORA?" para decidir si se sigue
 *   pintando una sala ya visitada — el `visited` de arriba ya cubre ese caso
 *   por sí solo (se puso a `true` al entrar y no se borra al cerrar la
 *   puerta). La comprobación de puerta abierta de aquí abajo es SOLO para
 *   revelar una sala en la que el héroe AÚN no ha puesto un pie (p. ej. al
 *   limpiar una sala se abren sus puertas y el vecino se vuelve visible antes
 *   de cruzar el umbral).
 * - la sala de arranque es conocida siempre, sin excepción ni siquiera en el
 *   primer frame: `createDungeonWorld` (dungeon-world.ts) ya inicializa su
 *   `visited=true` de fábrica, pero se comprueba aquí TAMBIÉN de forma
 *   explícita como red de seguridad — es la única regla del encargo que no
 *   puede fallar ni un frame, así que no se deja colgando de que otro fichero
 *   mantenga esa inicialización correcta para siempre.
 *
 * Nada de esto duplica estado: se lee directamente de `world.dungeon` +
 * `world.roomRuntimes` (ya viven en la sim, ver world/types.ts), nunca de un
 * store aparte.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import type { World } from '@/game/world/types';

/**
 * Subconjunto de `World` que hace falta para decidir salas conocidas —
 * mismo criterio de "tipo mínimo" que ya usa `HazardView.tsx::HazardViews`
 * (ver su comentario): quien llame con un `World` completo (el caso normal,
 * `session.world`) lo satisface sin más, y un test podría construir un mundo
 * parcial sin tener que rellenar campos que esta función no toca.
 */
export type KnownRoomsWorld = Pick<World, 'dungeon' | 'roomRuntimes' | 'wallVersion' | 'currentRoomId'>;

/**
 * ¿Cae este punto del mundo en una sala CONOCIDA?
 *
 * Existe para el atrezzo que NO sabe a qué sala pertenece: las antorchas de
 * muro y la luz del tendero se calculan como una lista plana de posiciones
 * (`collectTorchEmitters`, sin `roomId` — ver su cabecera) y las columnas de la
 * Reina viven en el estado del jefe, no en una sala. Sin esta consulta se
 * quedaban dibujadas flotando en el vacío mientras su sala estaba oculta, que
 * es peor que no ocultar nada: delata dónde está la sala del jefe antes de
 * tiempo.
 *
 * Fuera de la mazmorra (modo sala única del editor) devuelve `true`: ahí no hay
 * salas que ocultar y todo se ve siempre.
 */
export function isPointInKnownRoom(world: KnownRoomsWorld, known: ReadonlySet<string>, x: number, z: number): boolean {
  const dungeon = world.dungeon;
  if (!dungeon) return true;
  const sala = dungeon.rooms.find(
    (r) => x >= r.bounds.minX && x <= r.bounds.maxX && z >= r.bounds.minY && z <= r.bounds.maxY,
  );
  // Un punto que no cae DENTRO de ninguna sala (una antorcha justo sobre el
  // muro, por ejemplo) se resuelve por la sala más cercana en vez de
  // descartarlo: si no, las antorchas de pared —que es donde viven— nunca se
  // dibujarían.
  if (sala) return known.has(sala.room.id);
  let mejor: string | undefined;
  let mejorDist = Infinity;
  for (const r of dungeon.rooms) {
    const dx = Math.max(r.bounds.minX - x, 0, x - r.bounds.maxX);
    const dz = Math.max(r.bounds.minY - z, 0, z - r.bounds.maxY);
    const dist = dx * dx + dz * dz;
    if (dist < mejorDist) {
      mejorDist = dist;
      mejor = r.room.id;
    }
  }
  return mejor === undefined || known.has(mejor);
}

/**
 * Calcula el conjunto de ids de sala CONOCIDAS ahora mismo. Pura — sin
 * React, sin three.js, testeable a pelo. Coste O(salas × puertas por sala),
 * ~6×4 en una mazmorra típica: barato, pero de todos modos solo se llama
 * cuando `useKnownRoomIds` detecta que algo cambió (ver más abajo), nunca en
 * cada frame.
 */
export function computeKnownRoomIds(world: KnownRoomsWorld): Set<string> {
  const known = new Set<string>();
  const dungeon = world.dungeon;
  if (!dungeon) return known;

  known.add(dungeon.startRoomId);

  for (const runtime of world.roomRuntimes.values()) {
    if (runtime.visited) {
      known.add(runtime.id);
      continue;
    }
    // Puerta abierta ⇔ sin Obstacle de portón (syncDoorGates los mantiene en
    // lockstep siempre, dungeon-world.ts): una conexión abierta revela la
    // sala vecina aunque el héroe todavía no haya cruzado el umbral.
    if (runtime.doors.some((door) => door.open)) known.add(runtime.id);
  }

  return known;
}

/**
 * Hook de React: mismo Set que `computeKnownRoomIds`, pero recalculado solo
 * cuando de verdad puede haber cambiado — nunca en cada frame (cero
 * asignaciones en el caso estable).
 *
 * El conjunto de salas conocidas solo puede CRECER, y solo en dos momentos:
 * cruzar a una sala nueva (`stepRoomTransition` marca `visited=true`, lo que
 * cambia `world.currentRoomId`) o abrir/cerrar una puerta (`syncDoorGates`
 * incrementa `world.wallVersion` — mismo sondeo barato que ya usa
 * `DoorStructures` en RoomView.tsx para reconstruir la hoja de puerta).
 * Sondear dos primitivos (`string`/`number`) por frame no asigna memoria; el
 * `Set` solo se reconstruye en el render que sigue a un cambio real.
 */
export function useKnownRoomIds(world: KnownRoomsWorld): ReadonlySet<string> {
  const [wallVersion, setWallVersion] = useState(world.wallVersion);
  const [roomId, setRoomId] = useState(world.currentRoomId);
  useFrame(() => {
    if (world.wallVersion !== wallVersion) setWallVersion(world.wallVersion);
    if (world.currentRoomId !== roomId) setRoomId(world.currentRoomId);
  });
  return useMemo(() => computeKnownRoomIds(world), [world, wallVersion, roomId]);
}
