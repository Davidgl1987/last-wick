/**
 * Velo de revelado: cuando una sala pasa de "oculta" a "conocida"
 * (`known-rooms.ts`), en vez de aparecer de golpe se descubre bajo un plano
 * oscuro que se desvanece en menos de un segundo — encargo de playtest
 * (David, 2026-08-06): "que las salas a las que todavía no se puede llegar
 * no se vean, y que al abrirse la puerta aparezcan con una transición, no de
 * golpe".
 *
 * A propósito NO es un sistema de niebla permanente: el velo de una sala
 * existe solo mientras dura su transición y luego desaparece del todo (mesh
 * oculto, `visible=false`) — nunca vuelve a aparecer sobre esa sala (ni al
 * volver a entrar, ni al cerrar una puerta detrás, ver known-rooms.ts).
 *
 * Patrón: POOL FIJO preasignado (mismo criterio que Puddle/Projectile/
 * Particle en el resto del juego, `world/types.ts`) en vez de montar/
 * desmontar un `<mesh>` por revelado — `REVEAL_POOL_SIZE` huecos reutilizados
 * por índice, cada uno con su propio material (necesita opacidad
 * INDEPENDIENTE por hueco: dos salas pueden revelarse a la vez si el jugador
 * abre varias puertas seguidas, y cada una debe desvanecerse a su propio
 * ritmo sin pisar la opacidad de la otra — de ahí que no valga un único
 * material compartido). Los materiales se crean UNA vez a nivel de módulo
 * (política de `assets.ts`: prohibido crear materiales dentro de
 * componentes), igual que `doorKeyLeafMaterial` en RoomView.tsx.
 *
 * Todo el trabajo por frame vive en un único `useFrame`: cero `setState`,
 * cero asignaciones cuando no hay huecos activos (el caso normal, la
 * inmensa mayoría de frames de una run).
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { WALL_THICKNESS } from '@/game/world/constants';
import type { World } from '@/game/world/types';
import { unitPlane } from '@/game/render/assets';
import { useKnownRoomIds } from './known-rooms';

/** Huecos simultáneos del pool. Generoso a propósito: una mazmorra tiene 6-7 salas en total, así que ni limpiando la sala más conectada de golpe se agotaría. */
const REVEAL_POOL_SIZE = 8;

/** Duración del desvanecido — "menos de un segundo", encargo literal. */
const VEIL_FADE_DURATION = 0.85;

/** Altura del velo: por encima del muro completo (`wall`, 3.36 u a KIT_SCALE — ver kit.ts) para que tape también los postes de esquina y el atrezzo colgado en pared, no solo el suelo. */
const VEIL_HEIGHT = 3.9;

/** Mismo tono que el fondo de la escena (`<color attach="background">`, GameRoot.tsx) y el fog: el velo se lee como "la oscuridad de fuera de la sala todavía cubriéndola", no como una superficie ajena. */
const VEIL_COLOR = '#050508';

/**
 * Materiales del pool, uno por hueco (nunca compartidos: cada uno anima su
 * propia opacidad de forma independiente). `depthWrite: false` — igual que
 * `blobShadowMaterial`/`aimDotMaterial` en assets.ts — para no ensuciar el
 * depth buffer de cara a el resto de superficies transparentes de la escena.
 */
const veilMaterials: THREE.MeshBasicMaterial[] = Array.from(
  { length: REVEAL_POOL_SIZE },
  () => new THREE.MeshBasicMaterial({ color: VEIL_COLOR, transparent: true, depthWrite: false, opacity: 0 }),
);

/** Estado mutable de un hueco del pool — nunca objetos nuevos por frame, solo se mutan estos campos in situ. */
interface RevealSlot {
  active: boolean;
  roomId: string;
  /** `state.clock.elapsedTime` en el que este hueco arrancó su desvanecido. */
  startTime: number;
}

/**
 * Curva de desvanecido suave (`smoothstep`, derivada nula en t=0 y en t=1):
 * ni salta al arrancar (empieza exactamente en opacidad 1, igual que la sala
 * recién oculta) ni salta al terminar (llega exactamente a 0 antes de que el
 * hueco se libere, así que ocultarlo con `visible=false` justo después no se
 * nota) — encargo explícito: "que no dé un salto de opacidad al empezar ni
 * al terminar".
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function RoomRevealView({ world }: { world: World }) {
  const dungeon = world.dungeon;
  const knownRoomIds = useKnownRoomIds(world);
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const slots = useRef<RevealSlot[]>(
    Array.from({ length: REVEAL_POOL_SIZE }, () => ({ active: false, roomId: '', startTime: 0 })),
  ).current;
  // Último Set de salas conocidas ya procesado — comparado por REFERENCIA
  // (useKnownRoomIds solo devuelve un Set nuevo cuando de verdad cambió algo,
  // ver su comentario), así que esta comparación no asigna memoria en el
  // caso estable. `null` = "aún no se ha procesado el primer cálculo": las
  // salas ya conocidas EN EL MONTAJE (sala inicial + vecinas ya abiertas de
  // fábrica) no llevan velo, se ven desde el frame 0 — solo se anima lo que
  // se vuelve conocido DESPUÉS.
  const prevKnownRef = useRef<ReadonlySet<string> | null>(null);

  useFrame((state) => {
    const prevKnown = prevKnownRef.current;
    if (prevKnown !== knownRoomIds) {
      if (prevKnown !== null) {
        for (const id of knownRoomIds) {
          if (prevKnown.has(id)) continue;
          const slot = slots.find((s) => !s.active);
          if (!slot) continue; // pool agotado (no debería pasar, ver REVEAL_POOL_SIZE): esa sala aparece sin transición, mejor que perder un revelado
          slot.active = true;
          slot.roomId = id;
          slot.startTime = state.clock.elapsedTime;
        }
      }
      prevKnownRef.current = knownRoomIds;
    }

    if (!dungeon) return;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      if (!slot.active) {
        mesh.visible = false;
        continue;
      }
      const placed = dungeon.rooms.find((p) => p.room.id === slot.roomId);
      const t = (state.clock.elapsedTime - slot.startTime) / VEIL_FADE_DURATION;
      if (!placed || t >= 1) {
        // Transición terminada (o sala ya no localizable, defensivo): libera
        // el hueco para el próximo revelado.
        slot.active = false;
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(placed.origin.x, VEIL_HEIGHT, placed.origin.y);
      mesh.scale.set(placed.room.width + 2 * WALL_THICKNESS, placed.room.height + 2 * WALL_THICKNESS, 1);
      veilMaterials[i].opacity = 1 - smoothstep(t);
    }
  });

  if (!dungeon) return null;

  return (
    <>
      {veilMaterials.map((material, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshRefs.current[i] = m;
          }}
          geometry={unitPlane}
          material={material}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        />
      ))}
    </>
  );
}
