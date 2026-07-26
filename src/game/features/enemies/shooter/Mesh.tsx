/**
 * Shooter: "cañón" orientado siempre al héroe, que se ilumina (cambia de
 * material apagado a material de carga) mientras `shooterPhase==='charge'` —
 * y (desde 2026-07-26) un OJO propio, siempre encendido, construido igual
 * que el resto de arquetipos.
 *
 * Aguaboca: el cañón es una boca-tubo (cilindro corto horizontal,
 * `unitCylinder` reutilizado con rotación local) — mismo criterio de
 * intercambio de material al cargar/descargar, piedra oscura ↔ azul
 * brillante. ESTE es el telegraph real (reposo vs. carga) y no se toca.
 *
 * Ojo (petición de David en vivo, 2026-07-26: "ponle al shooter también su
 * ojo del mismo tipo que los demás"): hasta ahora el Aguaboca era el único
 * arquetipo sin un ojo emissive de verdad tipo `smallDotGeometry` (su "ojo"
 * era el propio tubo). Se añade un óvalo `shooterEyeGlowMaterial` (mismo
 * patrón que dummy/chaser/spike, ver assets-dark.ts) en la cara frontal,
 * POR ENCIMA del tubo (nunca solapado con él) y SIEMPRE encendido — el tubo
 * sigue siendo el ÚNICO elemento que cambia entre reposo/carga.
 *
 * Riesgo de señal (mismo tono `#7cc7ff` en ojo y tubo cargando, ver
 * assets-dark.ts): se mitiga por tamaño y posición, no por color — el ojo se
 * deja deliberadamente MÁS PEQUEÑO que el tubo (que además cambia de un
 * gris apagado a brillante, un contraste binario en una forma grande) y
 * claramente separado en altura, así el tubo sigue siendo el elemento
 * "que grita" al cargar.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { RefObject } from 'react';
import type { Group, Mesh } from 'three';
import type { GameSession } from '@/game/session/session';
import type { Enemy } from '@/game/world/types';
import { shooterTelegraphMaterial, smallDotGeometry, unitCircle, unitCylinder } from '@/game/render/assets';
import { shooterEyeGlowMaterial, shooterTubeGlowMaterial, shooterTubeRestMaterial } from '@/game/render/assets-dark';

/**
 * Ojo del Aguaboca (playtest 2026-07-26): tamaño en el mismo rango que los
 * arquetipos ya agrandados (Vigía [0.14,0.2,0.08], Acechador [0.09,0.24,0.06])
 * pero en el extremo MÁS PEQUEÑO de ese rango a propósito — el tubo, no el
 * ojo, debe seguir siendo la señal dominante de "cargando" (ver comentario de
 * cabecera).
 *
 * Posición: cuerpo del Aguaboca es una esfera UNIFORME de radio
 * ENEMY_RADIUS_RENDER=0.4 (`bodyScaleForKind` no tiene caso especial para
 * 'shooter', EnemyViews.tsx). Verificado con Box3 (three.js) que el TUBO ya
 * ocupa un volumen bastante más alto de lo que sugiere su nombre "cilindro
 * horizontal": tras `rotation-x=PI/2` sobre `scale=[0.22,0.22,0.42]`, su
 * semi-alto real es 0.21 (no 0.11 — la rotación intercambia qué escala cae en
 * qué eje) y su semi-profundidad real es solo 0.11. Con el grupo del tubo en
 * y=0.05, eso dan un rango vertical absoluto de y=[-0.16, 0.26] — mucho más
 * alto de lo que parece a simple vista. El ojo se coloca POR ENCIMA de ese
 * rango, en y=0.34 (casquete esférico ahí: radio XZ = √(0.4²−0.34²) ≈ 0.211),
 * con semi-alto propio 0.07 ⇒ su borde inferior (0.27) queda ya por encima
 * del techo del tubo (0.26): volúmenes verificados sin solape (Box3 de ambos,
 * ver script de verificación en el informe). Profundidad (Z) por el mismo
 * criterio "justo fuera de la superficie" que el resto de la casa (102% del
 * radio del casquete, menos el semi-grosor del propio ojo): 0.211·1.02−0.07 ≈
 * 0.145.
 */
const SHOOTER_EYE_SCALE: readonly [number, number, number] = [0.1, 0.07, 0.07];
const SHOOTER_EYE_Y = 0.34;
const SHOOTER_EYE_Z = 0.145;

export function ShooterMesh({
  session,
  enemyId,
  groupRef,
}: {
  session: GameSession;
  enemyId: string;
  groupRef: RefObject<Group | null>;
}) {
  const telegraphRef = useRef<Mesh>(null);
  const shooterTubeGroupRef = useRef<Group>(null);
  const shooterTubeMeshRef = useRef<Mesh>(null);
  // Ojo nuevo (siempre encendido): vive en su PROPIO pivote anclado a la
  // superficie, independiente del pivote del tubo, pero rota exactamente el
  // mismo ángulo hacia el héroe cada frame (mismo cálculo, dos refs).
  const shooterEyeGroupRef = useRef<Group>(null);

  useFrame(() => {
    const world = session.world;
    const enemy = world.enemies.find((e: Enemy) => e.id === enemyId);
    const group = groupRef.current;
    if (!enemy || !group || enemy.hp <= 0) return;

    const charging = enemy.shooterPhase === 'charge';
    if (telegraphRef.current) {
      telegraphRef.current.visible = charging;
      if (charging) {
        telegraphRef.current.scale.setScalar(0.85 + 0.25 * Math.sin(world.time * 14));
      }
    }
    // Cañón/ojo: ambos pivotes siempre orientados hacia el héroe (compensando
    // la rotación del grupo, que sigue la velocidad, no la mirada).
    const dx = world.hero.position.x - enemy.position.x;
    const dy = world.hero.position.y - enemy.position.y;
    const faceAngle = Math.atan2(dx, dy) - group.rotation.y;
    if (shooterTubeGroupRef.current) shooterTubeGroupRef.current.rotation.y = faceAngle;
    if (shooterEyeGroupRef.current) shooterEyeGroupRef.current.rotation.y = faceAngle;
    // Asignación directa cada frame (barata: un solo property write, sin
    // allocation) en vez de solo en la transición de `charging`. El ojo NO
    // participa de este intercambio (ver comentario de cabecera): se queda
    // fijo en `shooterEyeGlowMaterial` siempre.
    const tube = shooterTubeMeshRef.current;
    if (tube) tube.material = charging ? shooterTubeGlowMaterial : shooterTubeRestMaterial;
  });

  return (
    <>
      <group ref={shooterTubeGroupRef} position={[0, 0.05, 0.36]}>
        <mesh
          ref={shooterTubeMeshRef}
          geometry={unitCylinder}
          material={shooterTubeRestMaterial}
          rotation-x={Math.PI / 2}
          scale={[0.22, 0.22, 0.42]}
        />
      </group>
      <group ref={shooterEyeGroupRef} position={[0, SHOOTER_EYE_Y, SHOOTER_EYE_Z]}>
        <mesh geometry={smallDotGeometry} material={shooterEyeGlowMaterial} scale={SHOOTER_EYE_SCALE} />
      </group>
      <mesh
        ref={telegraphRef}
        geometry={unitCircle}
        material={shooterTelegraphMaterial}
        rotation-x={-Math.PI / 2}
        position={[0, -0.35, 0]}
        scale={0.75}
        visible={false}
      />
    </>
  );
}
