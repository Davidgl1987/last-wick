/**
 * Chaser: ojos rasgados emisivos orientados al héroe + pulso de escala al
 * acelerar (heroAiming, misma señal que ya usa su IA para correr más).
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { RefObject } from 'react';
import type { Group } from 'three';
import type { GameSession } from '@/game/session/session';
import type { Enemy } from '@/game/world/types';
import { smallDotGeometry } from '@/game/render/assets';
import { chaserEyeGlowMaterial } from '@/game/render/assets-dark';

/**
 * Radio/altura del pivote de la cara del Chaser sobre la superficie de su
 * esfera (punto 8 de playtest ronda 3): ligeramente menor que
 * ENEMY_RADIUS_RENDER para que los ojos queden asentados EN la superficie
 * visible, nunca flotando fuera de ella ni hundidos dentro.
 */
const CHASER_FACE_RADIUS = 0.34;
const CHASER_FACE_HEIGHT = 0.1;

export function ChaserMesh({
  session,
  enemyId,
  groupRef,
}: {
  session: GameSession;
  enemyId: string;
  groupRef: RefObject<Group | null>;
}) {
  // `chaserFaceAngle` conserva el último ángulo válido hacia el héroe (mundo)
  // para no degenerar cuando coincide con el centro del enemigo (distancia ~0).
  const chaserFaceRef = useRef<Group>(null);
  const chaserFaceAngle = useRef(0);

  useFrame(() => {
    const world = session.world;
    const enemy = world.enemies.find((e: Enemy) => e.id === enemyId);
    const group = groupRef.current;
    if (!enemy || !group || enemy.hp <= 0) return;

    if (chaserFaceRef.current) {
      // Punto 8 de playtest ronda 3 ("los ojos se meten dentro de la
      // esfera"): la causa era anclar la cara a una POSICIÓN LOCAL fija
      // (delante del cuerpo) y solo rotarla — al compensar la rotación del
      // grupo padre para mirar al héroe, el pivote de la cara nunca seguía la
      // curvatura de la esfera, solo giraba sobre sí mismo en torno a un
      // punto que seguía "al frente"; para ángulos grandes eso proyecta los
      // ojos hacia dentro en vez de sobre la superficie visible. Fix: se
      // RECALCULA la posición del pivote cada frame como una proyección real
      // sobre el ecuador de la esfera (radio fijo CHASER_FACE_RADIUS) en la
      // dirección absoluta hacia el héroe, así que siempre queda sobre la
      // superficie mirando a cámara, sin hundirse ni cuando el héroe está muy
      // cerca (dirección degenerada: mantiene el último ángulo válido).
      const dx = world.hero.position.x - enemy.position.x;
      const dy = world.hero.position.y - enemy.position.y;
      const distToHero = Math.hypot(dx, dy);
      if (distToHero > 1e-4) {
        chaserFaceAngle.current = Math.atan2(dx, dy);
      }
      const worldAngle = chaserFaceAngle.current;
      const localAngle = worldAngle - group.rotation.y;
      const face = chaserFaceRef.current;
      face.position.set(
        Math.sin(localAngle) * CHASER_FACE_RADIUS,
        CHASER_FACE_HEIGHT,
        Math.cos(localAngle) * CHASER_FACE_RADIUS,
      );
      face.rotation.y = localAngle;
      // Pulso de velocidad: se agranda ligeramente mientras corre acelerado
      // (heroAiming es la misma señal que su IA usa para CHASER_SPEED_WHILE_AIMING).
      const pulse = world.heroAiming ? 1.12 + 0.05 * Math.sin(world.time * 16) : 1;
      face.scale.setScalar(pulse);
    }
  });

  return (
    // Posición/rotación reales del pivote se escriben cada frame en
    // useFrame (proyección sobre la superficie esférica); el valor JSX
    // es solo el estado inicial antes del primer frame.
    <group ref={chaserFaceRef} position={[0, CHASER_FACE_HEIGHT, CHASER_FACE_RADIUS]}>
      {/* Acechador del Umbral: ojos rasgados violeta emisivos (concept art). */}
      <mesh
        geometry={smallDotGeometry}
        material={chaserEyeGlowMaterial}
        position={[-0.13, -0.02, 0]}
        rotation-z={0.35}
        scale={[0.045, 0.12, 0.03]}
      />
      <mesh
        geometry={smallDotGeometry}
        material={chaserEyeGlowMaterial}
        position={[0.13, -0.02, 0]}
        rotation-z={-0.35}
        scale={[0.045, 0.12, 0.03]}
      />
    </group>
  );
}
