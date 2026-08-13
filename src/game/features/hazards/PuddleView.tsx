/**
 * Charcos del Trail (GDD §7.4) — y del rastro reciclado por Guardián/Reina
 * (mismo pool `world.puddles`, ver `Puddle` en `world/types.ts` y los
 * comentarios de reuso en `bosses/guardian/constants.ts`/`bosses/queen/constants.ts`):
 * InstancedMesh (pool ~32 × cúmulo, ver `PUDDLE_CLUSTER_MAX_BLOBS` abajo).
 * Los charcos inactivos se escalan a 0 en vez de eliminarse (cero
 * asignaciones, cero cambios de conteo de instancias).
 *
 * ── Cúmulo de discos, no un círculo perfecto (feedback de David 2026-08-12:
 * "el enemigo que deja rastro debería dejar el rastro como la cera, círculos
 * aleatorios") ──────────────────────────────────────────────────────────
 * Antes, cada charco activo era UN círculo perfecto escalado exactamente a
 * `puddle.radius`. Ahora cada charco se pinta como un CÚMULO de 2-3 discos
 * más pequeños, de tamaño y desplazamiento lateral distintos — mismo
 * lenguaje visual que la cera del héroe (`WaxPool.emit()`,
 * `features/effects/wax.ts`). Los charcos NO viven en `WaxPool`: son un
 * hazard MECÁNICO (daño de contacto / ralentización — `stepPuddles` en
 * `features/hazards/hazards.ts`) con su propio pool `world.puddles`, vida
 * corta por `ttl` y compartido con Guardián/Reina — reenrutar el depósito a
 * `WaxPool` lo haría persistir para siempre y rompería ese `ttl` mecánico.
 * En vez de eso, este fichero REPLICA la misma fórmula de cúmulo que
 * `WaxPool.emit()` (mismas constantes, `PUDDLE_CLUSTER_*` abajo, calcadas de
 * `WAX_CLUSTER_*` en `wax.ts`) en vez de escribir una nueva — `wax.ts` NO se
 * toca (la cera está validada por David).
 *
 * El radio MECÁNICO real (`puddle.radius`, el que usa `stepPuddles` para el
 * contacto) no cambia un ápice: el cúmulo se genera SIEMPRE alrededor de ese
 * radio (factor de tamaño 0.6-1.1×, desplazamiento lateral hasta 0.5×), así
 * que el conjunto sigue ocupando aproximadamente el mismo área que el
 * círculo mecánico de siempre — la promesa visual-mecánico de AGENTS.md se
 * mantiene (mismo orden de magnitud, no una lectura de peligro distinta).
 * Sin rotación por disco (a diferencia de la escarcha de `WaxView`): un
 * `unitCircle` liso se ve igual a cualquier ángulo, girar no aportaría nada.
 *
 * Los 2-3 offsets/tamaños de cada charco se sortean UNA vez, al detectar que
 * el slot pasa de inactivo a activo (un depósito nuevo real — mismo momento
 * en que `WaxPool.emit()` sortearía uno) y se guardan en `useRef` hasta la
 * próxima activación de ese slot. Si se sortearan cada frame el cúmulo
 * "temblaría" en vez de quedarse fijo en el suelo; `Math.random()` en ese
 * punto no asigna memoria (solo en la transición, no cada frame) y respeta
 * el presupuesto de cero-asignaciones-por-frame de todos modos.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { GameSession } from '@/game/session/session';
import { puddleMaterial, unitCircle } from '@/game/render/assets';

const scratchMatrix = new THREE.Matrix4();
const scratchScale = new THREE.Vector3();
const scratchPos = new THREE.Vector3();
const FLAT_ROTATION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/** Nº máximo de discos por cúmulo — fija cuántas instancias reserva cada slot de `world.puddles` (mismo valor que `WAX_CLUSTER_MAX_BLOBS`, wax.ts). */
const PUDDLE_CLUSTER_MAX_BLOBS = 3;
const PUDDLE_CLUSTER_MIN_BLOBS = 2;
/** Rango del factor de tamaño de cada disco respecto a `puddle.radius` (calca `WAX_CLUSTER_SIZE_FACTOR_*`, wax.ts): [0.6, 1.1). */
const PUDDLE_CLUSTER_SIZE_FACTOR_MIN = 0.6;
const PUDDLE_CLUSTER_SIZE_FACTOR_RANGE = 0.5;
/** Desplazamiento lateral máximo de un disco respecto al centro del charco, como fracción de `puddle.radius` (calca `WAX_CLUSTER_OFFSET_FACTOR`, wax.ts). */
const PUDDLE_CLUSTER_OFFSET_FACTOR = 0.5;

export function PuddleViews({ session }: { session: GameSession }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const puddleCount = session.world.puddles.length;
  const instanceCount = puddleCount * PUDDLE_CLUSTER_MAX_BLOBS;

  // Cúmulo por slot: sorteado una vez por activación (detectada en useFrame
  // por la transición inactivo→activo), no cada frame (ver cabecera). Arrays
  // planos indexados `slot * PUDDLE_CLUSTER_MAX_BLOBS + blob`, creados una
  // sola vez al montar — cero asignaciones nuevas por frame.
  const cluster = useMemo(
    () => ({
      dx: new Float32Array(instanceCount),
      dz: new Float32Array(instanceCount),
      sizeFactor: new Float32Array(instanceCount),
      blobCount: new Uint8Array(puddleCount),
      wasActive: new Uint8Array(puddleCount),
    }),
    [puddleCount, instanceCount],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const puddles = session.world.puddles;
    const { dx, dz, sizeFactor, blobCount, wasActive } = cluster;

    for (let i = 0; i < puddles.length; i++) {
      const puddle = puddles[i];

      if (puddle.active && !wasActive[i]) {
        // Depósito nuevo detectado: sortea un cúmulo fresco de 2-3 discos
        // (mismo criterio que WaxPool.emit, ver cabecera del fichero).
        const freshCount = Math.random() < 0.5 ? PUDDLE_CLUSTER_MIN_BLOBS : PUDDLE_CLUSTER_MAX_BLOBS;
        blobCount[i] = freshCount;
        const offsetRange = puddle.radius * PUDDLE_CLUSTER_OFFSET_FACTOR;
        for (let b = 0; b < freshCount; b++) {
          const idx = i * PUDDLE_CLUSTER_MAX_BLOBS + b;
          dx[idx] = (Math.random() * 2 - 1) * offsetRange;
          dz[idx] = (Math.random() * 2 - 1) * offsetRange;
          sizeFactor[idx] = PUDDLE_CLUSTER_SIZE_FACTOR_MIN + Math.random() * PUDDLE_CLUSTER_SIZE_FACTOR_RANGE;
        }
      }
      wasActive[i] = puddle.active ? 1 : 0;

      const activeBlobs = puddle.active ? blobCount[i] : 0;
      for (let b = 0; b < PUDDLE_CLUSTER_MAX_BLOBS; b++) {
        const instanceIdx = i * PUDDLE_CLUSTER_MAX_BLOBS + b;
        if (b < activeBlobs) {
          const scale = puddle.radius * sizeFactor[instanceIdx];
          scratchPos.set(puddle.position.x + dx[instanceIdx], 0.015, puddle.position.y + dz[instanceIdx]);
          scratchScale.set(scale, scale, scale);
        } else {
          scratchPos.set(0, 0, 0);
          scratchScale.set(0, 0, 0);
        }
        scratchMatrix.compose(scratchPos, FLAT_ROTATION, scratchScale);
        mesh.setMatrixAt(instanceIdx, scratchMatrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[unitCircle, puddleMaterial, instanceCount]} frustumCulled={false} />
  );
}
