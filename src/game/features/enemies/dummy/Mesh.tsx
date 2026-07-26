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

/**
 * Ojos del Vigía, agrandados (playtest 2026-07-26, David: "agranda los ojos
 * de todos"): a la distancia de cámara del juego, el ojo ORIGINAL (0.07 de
 * ancho) medía ~5px en pantalla — el Bloom es proporcional al ÁREA de
 * píxeles por encima del umbral, así que un emisor de 5px produce un halo
 * inapreciable por mucha `emissiveIntensity` que tenga (ver
 * `BLOOM_EMISSIVE_INTENSITY`, assets-dark.ts). Vigía es uno de los DOS
 * arquetipos más pequeños (junto al Acechador), así que crece ×2 (el máximo
 * del criterio: "los más pequeños crecen más").
 *
 * Separación horizontal (`DUMMY_EYE_X`, antes 0.12 hardcoded en cada mesh):
 * si solo se agranda `scale` sin tocar la posición, los dos óvalos —ahora al
 * doble de anchos— se solapan en el centro (radio 0.14 > separación 0.12).
 * Se sube a 0.19 para conservar el MISMO hueco absoluto entre ambos ojos que
 * había antes de agrandarlos (hueco = 2·(offset−radio) = 0.10 en ambos casos),
 * no un factor arbitrario.
 *
 * Profundidad (`DUMMY_EYE_Z`, la Z del group, antes 0.34): el cuerpo del
 * Vigía es un elipsoide (`bodyScaleForKind('dummy')` en EnemyViews.tsx,
 * radio 0.432 en XZ / 0.328 en Y), y el ojo asoma en Z con su propio
 * semi-grosor (`scale[2]`). Para que agrandar el ojo no lo saque flotando de
 * la superficie (semi-grosor pasa de 0.04 a 0.08, +0.04), se retrasa el
 * group esa misma cantidad (0.34−0.04=0.30): el FRENTE del ojo (group.z +
 * semi-grosor) queda exactamente en la misma profundidad absoluta que antes
 * de agrandarlo, ni más hundido ni más flotando de lo que ya estaba.
 */
const DUMMY_EYE_SCALE: readonly [number, number, number] = [0.14, 0.2, 0.08];
const DUMMY_EYE_X = 0.19;
const DUMMY_EYE_Z = 0.3;

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
      <group ref={dummyEyesRef} position={[0, 0.08, DUMMY_EYE_Z]}>
        <mesh geometry={smallDotGeometry} material={dummyEyeGlowMaterial} position={[-DUMMY_EYE_X, 0, 0]} scale={DUMMY_EYE_SCALE} />
        <mesh geometry={smallDotGeometry} material={dummyEyeGlowMaterial} position={[DUMMY_EYE_X, 0, 0]} scale={DUMMY_EYE_SCALE} />
      </group>
      {/* Falda cónica de la campana (estática: no rota con la mirada). */}
      <mesh geometry={unitCone} material={dummySkirtMaterial} position={[0, -0.16, 0]} scale={[0.34, 0.24, 0.34]} />
    </>
  );
}
