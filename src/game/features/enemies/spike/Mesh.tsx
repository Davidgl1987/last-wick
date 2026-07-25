/**
 * Spike: mecánica invertida (playtest 2026-07-20, David: "que si le atacas
 * por detrás te pinche; solo se le podrá hacer daño por delante"): `facing`
 * (donde vive el ojo, más abajo) es el lado VULNERABLE — el lado peligroso
 * (el que te pincha a TI) es el arco trasero, ver `isSpikeContactDangerous`
 * en combat.ts.
 *
 * Penitente de Púas (punto 5 de playtest ronda 4: "no queda claro por qué
 * lado pincha... que por delante tenga el ojo, y por la espalda los
 * pinchos"): el frente se lee por el OJO (grande, dentro del grupo que sigue
 * `facing`), no por conos. Las púas DECORATIVAS (silueta de erizo del
 * concept) se restringen al ARCO TRASERO (±SPIKE_DECOR_REAR_HALF_ARC
 * alrededor de -facing) y viven DENTRO del mismo grupo que sigue `facing`
 * (no estáticas en el grupo exterior que rota con el movimiento) — así el
 * arco trasero decorativo se mantiene siempre alineado con la cara
 * peligrosa REAL de la sim.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { RefObject } from 'react';
import type { Group } from 'three';
import type { GameSession } from '@/game/session/session';
import type { Enemy } from '@/game/world/types';
import { smallDotGeometry, spikeConeMaterial, unitSpike } from '@/game/render/assets';
import { spikeEyeGlowMaterial } from '@/game/render/assets-dark';

/** Nº de púas decorativas en el arco TRASERO del erizo (puramente estéticas). */
const SPIKE_DECOR_RING_COUNT = 6;
/**
 * Semiancho angular del arco trasero (punto 5 de playtest ronda 4: "conos
 * decorativos SOLO en el arco trasero, ±120° alrededor de -facing"): dentro
 * del grupo que sigue `facing` (ángulo local 0 = +Z local = `facing`), el
 * arco trasero cae centrado en π (= -facing).
 */
const SPIKE_DECOR_REAR_HALF_ARC = (120 * Math.PI) / 180;
/** Tamaño del ojo grande del Penitente de Púas (punto 5: "el OJO grande centrado en facing"): único indicador visual del frente. */
const SPIKE_EYE_SCALE: readonly [number, number, number] = [0.19, 0.22, 0.09];

export function SpikeMesh({
  session,
  enemyId,
  groupRef,
}: {
  session: GameSession;
  enemyId: string;
  groupRef: RefObject<Group | null>;
}) {
  const spikeSecondaryGroupRef = useRef<Group>(null);

  useFrame(() => {
    const world = session.world;
    const enemy = world.enemies.find((e: Enemy) => e.id === enemyId);
    const group = groupRef.current;
    if (!enemy || !group || enemy.hp <= 0) return;

    if (spikeSecondaryGroupRef.current) {
      // Punto 9 de playtest ronda 3 ("Spike por detrás no debe tener
      // pinchos, ponle 3 en la parte delantera"): las 3 púas viven en un
      // único grupo anclado a la dirección `facing` fija del mundo (la cara
      // VULNERABLE desde 2026-07-20, misma normal que usa
      // isSpikeContactDangerous en combat.ts) — nunca rotan libremente ni
      // aparecen en la cara trasera (la cara peligrosa REAL ahora).
      // Compensa la rotación del grupo padre (que sigue la velocidad al
      // patrullar) para que el abanico quede fijo en coordenadas de mundo.
      spikeSecondaryGroupRef.current.rotation.y = Math.atan2(enemy.facing.x, enemy.facing.y) - group.rotation.y;
    }
  });

  return (
    <>
      {/* Polos decorativos (arriba/abajo, puramente estéticos): en el eje Y
          no hay "delante" ni "detrás" (invariantes a la rotación en Y), así
          que se quedan en el grupo exterior sin necesitar seguir a
          `facing`. */}
      <mesh geometry={unitSpike} material={spikeConeMaterial} position={[0, 0.4, 0]} scale={[0.24, 0.22, 0.24]} />
      <mesh
        geometry={unitSpike}
        material={spikeConeMaterial}
        position={[0, -0.4, 0]}
        rotation-x={Math.PI}
        scale={[0.24, 0.22, 0.24]}
      />
      {/* El frente (VULNERABLE desde 2026-07-20) se lee por el OJO, no por
          conos — nada en la cara trasera (la peligrosa REAL). El grupo
          entero es lo que rota en useFrame para seguir SIEMPRE la dirección
          real de `facing`, independiente de hacia dónde patrulle el
          cuerpo. */}
      <group ref={spikeSecondaryGroupRef}>
        {/* Púas decorativas del erizo (puramente estéticas): SOLO en el arco
            TRASERO (±SPIKE_DECOR_REAR_HALF_ARC alrededor de -facing, ángulo
            local π) — nunca delante, para no competir con el ojo. Al vivir
            dentro de este mismo grupo (que sigue `facing`), el arco trasero
            se mantiene siempre opuesto a la cara peligrosa real. Orientación
            (playtest 2026-07-20, David: "no lleva bien puestos los pinchos,
            apuntan hacia dentro"): `unitSpike` (ConeGeometry) tiene su ápice
            en +Y local por defecto. La punta yace EXACTAMENTE sobre el eje
            de rotación-Y, así que `rotation-y={angle}` sería un no-op sobre
            la punta: el eje Euler por defecto ('XYZ') aplica la rotación en
            Y ANTES que la de X al transformar un vector, y un punto sobre el
            eje de rotación no se mueve por esa rotación — así que la punta
            quedaba SIEMPRE fija en +Z local (independiente de `angle`), en
            vez de seguir la posición radial de cada púa. Para el arco
            trasero, con ±120°, eso es visible a ojo: en el centro exacto del
            arco (`angle` = π) la punta terminaba apuntando a +Z, justo hacia
            el CENTRO del cuerpo (dirección opuesta a su propia posición, que
            está en -Z) — hacia dentro. Fix: usar `rotation-z={-angle}` en su
            lugar (verificado numéricamente con Object3D.matrixWorld: con
            rotation-x=π/2 y rotation-z=-angle, la punta SÍ sigue la
            dirección radial (sin(angle), 0, cos(angle)) para cualquier
            `angle`, dot=1 con la posición). */}
        {Array.from({ length: SPIKE_DECOR_RING_COUNT }, (_, i) => {
          const t = SPIKE_DECOR_RING_COUNT > 1 ? i / (SPIKE_DECOR_RING_COUNT - 1) : 0.5;
          const angle = Math.PI + (t - 0.5) * 2 * SPIKE_DECOR_REAR_HALF_ARC;
          return (
            <mesh
              key={`rear-${i}`}
              geometry={unitSpike}
              material={spikeConeMaterial}
              position={[Math.sin(angle) * 0.38, 0.03, Math.cos(angle) * 0.38]}
              rotation-x={Math.PI / 2}
              rotation-z={-angle}
              scale={[0.26, 0.24, 0.26]}
            />
          );
        })}
        {/* Penitente de Púas: un único ojo cálido GRANDE, siempre centrado en
            `facing` (punto 5 de playtest ronda 4: "por delante tenga el
            ojo"). */}
        <mesh geometry={smallDotGeometry} material={spikeEyeGlowMaterial} position={[0, 0.06, 0.42]} scale={SPIKE_EYE_SCALE} />
      </group>
    </>
  );
}
