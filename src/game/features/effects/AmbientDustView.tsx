/**
 * Motas ambientales puramente visuales, ancladas en coordenadas de mundo.
 * La cámara y Lumora las atraviesan y las dejan atrás, igual que en el título.
 * Todo el almacenamiento se reserva al montar; useFrame solo muta buffers.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Points } from 'three';
import {
  GAME_DUST_CAPACITY,
  gameDustGeometry,
  gameDustMaterial,
} from '@/game/render/assets-dark';
import { usePostSettings } from '@/game/render/postSettings';
import type { GameSession } from '@/game/session/session';

const POINTS_PER_ROOM = 24;
const MIN_HEIGHT = 0.25;
const VOLUME_HEIGHT = 4.25;

export function AmbientDustView({ session }: { session: GameSession }) {
  const enabled = usePostSettings().ambientDust;
  const pointsRef = useRef<Points>(null);
  const motion = useMemo(() => {
    const position = gameDustGeometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = position.array as Float32Array;
    const dungeonRooms = session.world.dungeon?.rooms;
    const rooms = dungeonRooms ?? [{ room: session.world.room, origin: { x: 0, y: 0 } }];
    const count = Math.min(GAME_DUST_CAPACITY, rooms.length * POINTS_PER_ROOM);
    const anchorX = new Float32Array(count);
    const anchorZ = new Float32Array(count);
    const phase = new Float32Array(count);
    const rise = new Float32Array(count);
    let seed = (session.world.dungeon?.seed ?? 0xd057a11) ^ 0x6d2b79f5;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let i = 0; i < count; i += 1) {
      const placed = rooms[Math.floor(i / POINTS_PER_ROOM) % rooms.length];
      const offset = i * 3;
      const marginX = Math.min(0.45, placed.room.width * 0.08);
      const marginZ = Math.min(0.45, placed.room.height * 0.08);
      anchorX[i] = placed.origin.x + (random() - 0.5) * (placed.room.width - marginX * 2);
      anchorZ[i] = placed.origin.y + (random() - 0.5) * (placed.room.height - marginZ * 2);
      positions[offset] = anchorX[i];
      positions[offset + 1] = MIN_HEIGHT + random() * VOLUME_HEIGHT;
      positions[offset + 2] = anchorZ[i];
      phase[i] = (i * 2.399963) % (Math.PI * 2);
      rise[i] = 0.12 + (i % 8) * 0.016;
    }
    position.needsUpdate = true;
    gameDustGeometry.setDrawRange(0, count);
    gameDustGeometry.computeBoundingSphere();
    return { position, anchorX, anchorZ, phase, rise, count };
  }, [session]);

  useFrame((state, delta) => {
    const points = pointsRef.current;
    if (!enabled || !points) return;

    const time = state.clock.elapsedTime;
    const positions = motion.position.array as Float32Array;
    for (let i = 0; i < motion.count; i += 1) {
      const offset = i * 3;
      const phase = motion.phase[i];
      positions[offset] = motion.anchorX[i] + Math.sin(time * 0.52 + phase) * 0.09;
      positions[offset + 1] += motion.rise[i] * delta;
      positions[offset + 2] = motion.anchorZ[i] + Math.cos(time * 0.43 + phase * 1.21) * 0.07;
      if (positions[offset + 1] > MIN_HEIGHT + VOLUME_HEIGHT) positions[offset + 1] -= VOLUME_HEIGHT;
    }
    motion.position.needsUpdate = true;
  });

  return enabled ? (
    <points
      ref={pointsRef}
      geometry={gameDustGeometry}
      material={gameDustMaterial}
      frustumCulled={false}
      renderOrder={1}
    />
  ) : null;
}
