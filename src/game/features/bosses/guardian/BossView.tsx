/**
 * Guardián de Canto (GDD §15.2, Fase B1, `bossId==='guardian'`): extraído de
 * `EnemyViews.tsx` en la pasada pre-release. Sustituye el cuerpo genérico por
 * uno propio (esfera pétrea grande + 2 "cuernos" cónicos de hombro, escalados
 * con `enemy.radius` como cualquier jefe), brillo+vibración durante el
 * telegraph (material ámbar intercambiado + jitter de posición, más intenso
 * que el aro genérico), y estado aturdido INCONFUNDIBLE: tambaleo (oscilación
 * de rotación en Z) + 3 estrellitas doradas orbitando sobre la cabeza — todo
 * con geometrías/materiales compartidos de assets.ts, encima (no en
 * sustitución) de los anillos genéricos de telegraph/vulnerabilidad ya
 * heredados.
 *
 * `applyGuardianBossFrame` se llama desde el ÚNICO `useFrame` de `EnemyMesh`
 * (EnemyViews.tsx), en el mismo punto exacto donde vivía este bloque antes de
 * la extracción — los refs los sigue poseyendo `EnemyMesh` (se pasan aquí por
 * parámetro) para no alterar el orden de mutación dentro del frame.
 */

import type { RefObject } from 'react';
import type { Group, Mesh } from 'three';
import {
  guardianBodyMaterial,
  guardianHornGeometry,
  guardianHornMaterial,
  guardianStunStarGeometry,
  guardianStunStarMaterial,
  guardianTelegraphGlowMaterial,
} from '@/game/render/assets';
import { makeSilhouetteMaterial } from '@/game/render/occlusion-silhouette';
import type { Enemy, World } from '@/game/world/types';

/**
 * Silueta de oclusión del Guardián (occlusion-silhouette.ts): NO clona
 * `guardianBodyMaterial.color` (mismo bug de fondo que en EnemyViews.tsx,
 * ver su comentario extenso) — `assets-dark.ts` oscurece el cuerpo pétreo a
 * `#242229`, casi negro, así que una silueta de ese color sería invisible
 * sobre un muro oscuro. Lo que de verdad identifica al Guardián en la
 * oscuridad hoy es el ACENTO dorado de sus cuernos (`guardianHornMaterial`,
 * `emissive: '#d9a531'`, ver assets-dark.ts) — se clona ESE color en su
 * lugar. Fija: el brillo ámbar del telegraph (`guardianTelegraphGlowMaterial`)
 * es un aviso TEMPORAL que ya cubre el anillo genérico de telegraph, no hace
 * falta que la silueta también lo siga — mismo criterio de alcance que
 * HeroView (que tampoco replica el parpadeo de i-frames en el color, solo en
 * visibilidad, heredada gratis del padre).
 */
export const guardianSilhouetteMaterial = makeSilhouetteMaterial(guardianHornMaterial.emissive.clone());

export function applyGuardianBossFrame(params: {
  enemy: Enemy;
  world: World;
  flashing: boolean;
  bodyRadius: number;
  bodyRef: RefObject<Mesh | null>;
  groupRef: RefObject<Group | null>;
  guardianStunGroupRef: RefObject<Group | null>;
  guardianStunStarRefs: RefObject<(Mesh | null)[]>;
  wasGuardianTelegraphing: { current: boolean };
}): void {
  const { enemy, world, flashing, bodyRadius, bodyRef, groupRef, guardianStunGroupRef, guardianStunStarRefs, wasGuardianTelegraphing } =
    params;
  // Vibración + brillo del telegraph (GDD §15.2 "brilla y vibra ~0.8s"): MÁS
  // intenso que el aro genérico ya dibujado — jitter de posición del propio
  // cuerpo (no de un anillo aparte) + material ámbar intercambiado, para que
  // sea inconfundible el aviso de un jefe que va a embestir en línea recta.
  const telegraphing = world.time < enemy.bossTelegraphUntil && !flashing;
  if (telegraphing !== wasGuardianTelegraphing.current) {
    wasGuardianTelegraphing.current = telegraphing;
    const body = bodyRef.current;
    if (body && !flashing) body.material = telegraphing ? guardianTelegraphGlowMaterial : guardianBodyMaterial;
  }
  const body = bodyRef.current;
  if (body) {
    const jitter = telegraphing ? Math.sin(world.time * 40) * 0.05 : 0;
    body.position.x = jitter;
  }

  // Tambaleo del aturdimiento (estado INCONFUNDIBLE, entregable 3):
  // oscilación de rotación en Z (se "balancea" como grogui) + 3 estrellitas
  // doradas orbitando sobre la cabeza. Nunca se confunde con el telegraph:
  // distinto eje de movimiento (bamboleo lateral vs jitter de posición) y
  // color (dorado vs ámbar).
  if (groupRef.current) {
    groupRef.current.rotation.z = enemy.bossVulnerable ? Math.sin(world.time * 6) * 0.18 : 0;
  }
  if (guardianStunGroupRef.current) {
    guardianStunGroupRef.current.visible = enemy.bossVulnerable;
    if (enemy.bossVulnerable) {
      for (let i = 0; i < guardianStunStarRefs.current.length; i++) {
        const star = guardianStunStarRefs.current[i];
        if (!star) continue;
        const angle = world.time * 3 + (i / guardianStunStarRefs.current.length) * Math.PI * 2;
        const orbitRadius = bodyRadius * 0.7;
        star.position.set(Math.cos(angle) * orbitRadius, bodyRadius * 1.3, Math.sin(angle) * orbitRadius);
        star.rotation.y = angle * 2;
      }
    }
  }
}

/**
 * JSX específico del Guardián: 2 cuernos estáticos (silueta de embestida) +
 * el grupo de 3 estrellitas del aturdimiento (posición real recalculada en
 * `applyGuardianBossFrame`). Vive dentro del `<group ref={groupRef}>` del
 * padre (EnemyViews.tsx), como el resto de composición específica de jefe.
 */
export function GuardianBossExtras({
  guardianStunGroupRef,
  guardianStunStarRefs,
}: {
  guardianStunGroupRef: RefObject<Group | null>;
  guardianStunStarRefs: RefObject<(Mesh | null)[]>;
}) {
  return (
    <>
      {/* Cuerpo grande y pesado con "hombros"/cuernos (GDD §15.2): 2 conos
          cortos y anchos anclados a los lados de la esfera pétrea,
          orientados hacia fuera — silueta reconocible de embestida antes de
          que empiece a moverse. Escala fija en local (ya vive dentro del
          `group` que escala con `enemy.radius` vía bodyRef del padre). */}
      <mesh
        geometry={guardianHornGeometry}
        material={guardianHornMaterial}
        position={[-0.45, 0.15, 0.15]}
        rotation-z={Math.PI / 2.4}
        rotation-y={-0.4}
      />
      <mesh
        geometry={guardianHornGeometry}
        material={guardianHornMaterial}
        position={[0.45, 0.15, 0.15]}
        rotation-z={-Math.PI / 2.4}
        rotation-y={0.4}
      />

      {/* Estado aturdido INCONFUNDIBLE (entregable 3): 3 estrellitas doradas
          orbitando sobre la cabeza mientras `bossVulnerable`; posición real
          recalculada en `applyGuardianBossFrame` (órbita). */}
      <group ref={guardianStunGroupRef} visible={false}>
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            ref={(el) => {
              guardianStunStarRefs.current[i] = el;
            }}
            geometry={guardianStunStarGeometry}
            material={guardianStunStarMaterial}
            scale={0.1}
          />
        ))}
      </group>
    </>
  );
}
