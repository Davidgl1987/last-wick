/**
 * Trail: squash de babosa (aplastamiento rítmico) + gotas de baba goteando.
 *
 * Lacrimera: silueta de gota (esfera + `unitCone` con su apex por defecto
 * hacia +Y, sin rotación — así la base ancha se funde con el cuerpo y la
 * punta queda arriba, forma de lágrima).
 * El cono es SIBLING del cuerpo (no hijo de `bodyRef`: ese mesh vive en
 * `../EnemyViews.tsx`, no aquí), así que su squash de babosa se replica a
 * mano cada frame con la misma fórmula que el cuerpo. Dos ojos oscuros
 * (reutiliza `eyePupilMaterial`, ya suficientemente oscuro) — el brillo
 * interior violeta pálido vive en el `emissive` de `trailMaterial`
 * (assets.ts), no aquí.
 *
 * Ojos visibles (playtest 2026-07-20, David: "al trail le faltan ojos, quizá
 * los has puesto arriba"): el `group` padre (`../EnemyViews.tsx`) ya orienta
 * su eje +Z local hacia la dirección de movimiento (`orientationYaw`, mismo
 * criterio que la linterna de ojos: "dummy/trail no giran nada extra"), así
 * que los ojos ya vivían en el frente — el problema real era la ALTURA:
 * apenas por encima del ecuador (0.05×radio) quedaban casi al mismo nivel
 * que el centro de la gota, demasiado bajos para que la cámara cenital
 * (~40° desde el sur) los alcance salvo que la Lacrimera avance justo hacia
 * ella. Fix: se suben claramente hacia la mitad superior del cuerpo
 * (`TRAIL_EYE_HEIGHT_FACTOR`, por debajo de la base del cono/lágrima en
 * 0.85×radio para no solaparse) — más "levantados" hacia la cámara sea cual
 * sea el rumbo de patrulla. (Nota: NO se usa una rotación del grupo para
 * esto — los dos ojos viven simétricos sobre el eje X local del propio
 * `eyeGroup`, así que rotarlo en X los dejaría invariantes; solo la
 * POSICIÓN del pivote los sube.)
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { RefObject } from 'react';
import type { Group, Mesh } from 'three';
import type { GameSession } from '@/game/session/session';
import type { Enemy } from '@/game/world/types';
import {
  eyePupilMaterial,
  smallDotGeometry,
  trailDripMaterial,
  trailMaterial,
  unitCone,
} from '@/game/render/assets';

/**
 * Radio visual del cuerpo: igual que ENEMY_RADIUS_RENDER en
 * `../EnemyViews.tsx` (el Trail nunca es jefe/larva, así que su radio visual
 * es siempre este fijo; se duplica aquí para no crear un import circular con
 * el dispatcher).
 */
const TRAIL_BODY_RADIUS = 0.4;
/** Nº de gotas de baba del Trail. */
const TRAIL_DRIP_COUNT = 2;
/** Altura de los ojos (× TRAIL_BODY_RADIUS), medida desde el centro del cuerpo: por debajo de la base del cono/lágrima (0.85×radio) pero claramente en la mitad superior, no en el ecuador. */
const TRAIL_EYE_HEIGHT_FACTOR = 0.38;
/** Adelanto de los ojos (× TRAIL_BODY_RADIUS) hacia el frente (dirección de movimiento, +Z local del `group` padre). */
const TRAIL_EYE_FORWARD_FACTOR = 0.68;

export function TrailMesh({
  session,
  enemyId,
  bodyRef,
}: {
  session: GameSession;
  enemyId: string;
  bodyRef: RefObject<Mesh | null>;
}) {
  const trailDripRefs = useRef<(Mesh | null)[]>([]);
  // Lacrimera: punta de la gota + ojos oscuros, siblings del cuerpo (mismo
  // espacio local que las gotas de arriba, no hijos de `bodyRef` — así se
  // les aplica a mano el mismo squash/widen del cuerpo, ver comentario de
  // cabecera).
  const teardropRef = useRef<Mesh>(null);
  const eyeGroupRef = useRef<Group>(null);

  useFrame(() => {
    const world = session.world;
    const enemy = world.enemies.find((e: Enemy) => e.id === enemyId);
    if (!enemy || enemy.hp <= 0) return;

    // Squash de babosa: aplastamiento rítmico vertical, compensado en XZ
    // para conservar volumen aproximado (mismo patrón que el héroe).
    const squash = 1 + Math.sin(world.time * 4.2 + enemy.position.y) * 0.09;
    const widen = 1 / Math.sqrt(squash);

    const body = bodyRef.current;
    if (body) {
      body.scale.set(TRAIL_BODY_RADIUS * widen, TRAIL_BODY_RADIUS * squash, TRAIL_BODY_RADIUS * widen);
    }
    const teardrop = teardropRef.current;
    if (teardrop) {
      teardrop.position.set(0, TRAIL_BODY_RADIUS * squash * 0.85, 0);
      teardrop.scale.set(TRAIL_BODY_RADIUS * 0.55 * widen, TRAIL_BODY_RADIUS * 0.75 * squash, TRAIL_BODY_RADIUS * 0.55 * widen);
    }
    const eyeGroup = eyeGroupRef.current;
    if (eyeGroup) {
      eyeGroup.position.set(
        0,
        TRAIL_BODY_RADIUS * TRAIL_EYE_HEIGHT_FACTOR * squash,
        TRAIL_BODY_RADIUS * TRAIL_EYE_FORWARD_FACTOR * widen,
      );
    }
    for (let i = 0; i < TRAIL_DRIP_COUNT; i++) {
      const drip = trailDripRefs.current[i];
      if (!drip) continue;
      const phase = (world.time * 0.9 + i / TRAIL_DRIP_COUNT) % 1;
      const angle = (i / TRAIL_DRIP_COUNT) * Math.PI * 2;
      const r = TRAIL_BODY_RADIUS * 0.75;
      drip.position.set(
        Math.sin(angle) * r,
        -phase * 0.3,
        Math.cos(angle) * r * 0.6 - TRAIL_BODY_RADIUS * 0.15,
      );
      drip.scale.setScalar(0.06 * (1 - phase * 0.5));
      drip.visible = true;
    }
  });

  return (
    <>
      {Array.from({ length: TRAIL_DRIP_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            trailDripRefs.current[i] = el;
          }}
          geometry={smallDotGeometry}
          material={trailDripMaterial}
          visible={false}
        />
      ))}
      {/* Punta de la gota (cono apex-arriba, base fundida con el cuerpo):
          mismo material MUTABLE que el cuerpo (trailMaterial, ya
          oscurecido/translúcido en assets.ts) para que tono y opacidad
          coincidan exactamente. */}
      <mesh ref={teardropRef} geometry={unitCone} material={trailMaterial} />
      {/* Dos ojos oscuros simples; la posición del pivote (dinámica, squash)
          se fija en useFrame. */}
      <group ref={eyeGroupRef}>
        <mesh geometry={smallDotGeometry} material={eyePupilMaterial} position={[-0.1, 0, 0]} scale={0.045} />
        <mesh geometry={smallDotGeometry} material={eyePupilMaterial} position={[0.1, 0, 0]} scale={0.045} />
      </group>
    </>
  );
}
