/**
 * Dummy: ojos simples que miran ligeramente hacia el héroe al perseguir
 * (más vivo), y quedan al frente en patrulla. El balanceo torpe de cabeceo
 * y el cuerpo/sombra compartidos viven en `../EnemyViews.tsx`.
 *
 * Vigía de hollín: campana/farolillo — la falda cónica oscura se añade bajo
 * el cuerpo (esfera ya achatada por `bodyScaleForKind` en EnemyViews.tsx) y
 * los ojos son óvalos cálidos autoiluminados (concept art).
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { RefObject } from 'react';
import type { Group } from 'three';
import type { GameSession } from '@/game/session/session';
import type { Enemy } from '@/game/world/types';
import { smallDotGeometry, unitCone } from '@/game/render/assets';
import { dummyEyeGlowMaterial, dummySkirtMaterial } from '@/game/render/assets-dark';

export function DummyMesh({
  session,
  enemyId,
  groupRef,
}: {
  session: GameSession;
  enemyId: string;
  groupRef: RefObject<Group | null>;
}) {
  const dummyEyesRef = useRef<Group>(null);

  useFrame(() => {
    const world = session.world;
    const enemy = world.enemies.find((e: Enemy) => e.id === enemyId);
    const group = groupRef.current;
    if (!enemy || !group || enemy.hp <= 0) return;

    if (dummyEyesRef.current) {
      // Los ojos miran ligeramente hacia el héroe cuando persigue (más vivo),
      // y quedan al frente en patrulla.
      if (enemy.chasing) {
        const dx = world.hero.position.x - enemy.position.x;
        const dy = world.hero.position.y - enemy.position.y;
        dummyEyesRef.current.rotation.y = Math.atan2(dx, dy) - group.rotation.y;
      } else {
        dummyEyesRef.current.rotation.y = 0;
      }
    }
  });

  return (
    <>
      <group ref={dummyEyesRef} position={[0, 0.08, 0.34]}>
        <mesh geometry={smallDotGeometry} material={dummyEyeGlowMaterial} position={[-0.12, 0, 0]} scale={[0.07, 0.1, 0.04]} />
        <mesh geometry={smallDotGeometry} material={dummyEyeGlowMaterial} position={[0.12, 0, 0]} scale={[0.07, 0.1, 0.04]} />
      </group>
      {/* Falda cónica de la campana (estática: no rota con la mirada). */}
      <mesh geometry={unitCone} material={dummySkirtMaterial} position={[0, -0.16, 0]} scale={[0.34, 0.24, 0.34]} />
    </>
  );
}
