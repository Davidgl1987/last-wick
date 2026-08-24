/**
 * Chaser: ojos rasgados emisivos orientados al héroe + tell de acecho
 * mientras el héroe apunta (heroAiming, misma señal que ya usa su IA):
 * la cara encoge y late despacio, a juego con su frenada.
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
/**
 * Recalibrado (playtest 2026-07-26, David: "agranda los ojos de todos... el
 * Acechador son los más finos de todos, crece ×2"): agrandar el ojo
 * ×2 (`CHASER_EYE_SCALE`, más abajo) hace crecer también su semi-grosor en Z
 * (0.03→0.06). Manteniendo el radio del pivote fijo, el FRENTE del ojo
 * (`CHASER_FACE_RADIUS + semi-grosor`) se adelantaría 0.03 más de lo que
 * estaba, así que se retrasa el pivote esa misma cantidad para que el frente
 * quede exactamente en la misma profundidad absoluta que antes de agrandar
 * (ni más flotando ni más hundido de lo que ya estaba): 0.34−0.03=0.31.
 */
const CHASER_FACE_RADIUS = 0.31;
const CHASER_FACE_HEIGHT = 0.1;
/**
 * Ojos rasgados agrandados ×2 UNIFORME (mismo factor en los 3 ejes, para
 * "mantener la proporción alto/ancho" que pide el playtest — un ranurado que
 * crece más en un eje que en otro dejaría de leerse "rasgado"): antes
 * [0.045, 0.12, 0.03], el más fino de los 4 arquetipos (~3px en pantalla a la
 * distancia de cámara del juego, incluso peor que el Vigía).
 */
const CHASER_EYE_SCALE: readonly [number, number, number] = [0.09, 0.24, 0.06];
/**
 * Separación horizontal de cada ojo respecto al pivote de la cara (antes
 * 0.13): con el ojo al doble de ancho Y la inclinación `rotation-z=±0.35`
 * (que mezcla el semieje Y, mucho más largo, hacia X), el hueco efectivo
 * entre ambos ranurados se estrecha a solo ~0.024 si no se toca este valor
 * — visualmente casi pegados. Sube a 0.19 para conservar el mismo hueco
 * efectivo (~0.14) que había antes de agrandar los ojos.
 */
const CHASER_EYE_X = 0.19;
/**
 * Tell de puntería (2026-08-24, invertido junto con la IA): mientras apuntas
 * la cara ENCOGE y late DESPACIO. Antes crecía a 1.12 latiendo a 16 rad/s
 * (~2.5 Hz), que leía "se revoluciona" — cierto cuando apuntar lo aceleraba,
 * contradictorio ahora que apuntar lo FRENA (CHASER_SPEED_WHILE_AIMING).
 * 6 rad/s ≈ 1 latido por segundo: respiración de bicho al acecho, no de bicho
 * lanzado. La escala oscila en [0.86, 0.94], siempre por debajo del 1 en
 * reposo para que el encogimiento se lea en todo momento del ciclo.
 */
const CHASER_AIM_FACE_SCALE = 0.9;
const CHASER_AIM_FACE_WOBBLE = 0.04;
const CHASER_AIM_FACE_PULSE_SPEED = 6;

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
      // Tell de puntería: la cara encoge y late lento mientras apuntas (heroAiming
      // es la misma señal que su IA usa para CHASER_SPEED_WHILE_AIMING, su frenada).
      const pulse = world.heroAiming
        ? CHASER_AIM_FACE_SCALE +
          CHASER_AIM_FACE_WOBBLE * Math.sin(world.time * CHASER_AIM_FACE_PULSE_SPEED)
        : 1;
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
        position={[-CHASER_EYE_X, -0.02, 0]}
        rotation-z={0.35}
        scale={CHASER_EYE_SCALE}
      />
      <mesh
        geometry={smallDotGeometry}
        material={chaserEyeGlowMaterial}
        position={[CHASER_EYE_X, -0.02, 0]}
        rotation-z={-0.35}
        scale={CHASER_EYE_SCALE}
      />
    </group>
  );
}
