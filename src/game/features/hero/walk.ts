/**
 * Paseo WASD/flechas (GDD §3): ayuda de recolocación para escritorio, NUNCA
 * un sustituto del lanzamiento corporal ni una forma de combatir.
 *
 * Decisión de diseño clave: caminar es CINEMÁTICO (mueve `hero.position`
 * directamente), nunca añade velocidad. De ahí salen casi todas las garantías
 * gratis:
 * - `hero.velocity` sigue siendo la única fuente de verdad de "el héroe se
 *   está desplazando por física" (lanzamiento, embestida, knockback,
 *   fricción). WASD nunca la toca, así que caminar nunca dispara `ramDamage`
 *   (exige velocidad ≥ RAM_SPEED_THRESHOLD, combat.ts) — ver HERO_WALK_SPEED
 *   en constants.ts para el porqué exacto de esa garantía.
 * - Al mover `hero.position` ANTES de `stepHeroPhysics` (ver el orden en
 *   world/step.ts), el push-out de `collideInnerBounds`/`collideCircleAabb`
 *   contra muros/rocas se hereda gratis: con velocidad exactamente 0 la
 *   componente normal de rebote (`velAlongNormal < 0`) nunca se cumple, así
 *   que caminar contra un muro se detiene en él sin generar 'wall-bounce' ni
 *   reflejar nada — cero líneas de colisión duplicadas.
 * - Sin imports de React ni three.js: sim pura, testeable con `createWorld`.
 *
 * FACTOR CONTINUO, no puerta binaria (fix playtest, David: "si estás
 * moviéndote con wasd y lanzas, hay un pequeño salto entre que termina el
 * lanzamiento y sigue moviéndose con wasd"). Causa raíz, medida ANTES de
 * tocar este fichero (mundo con lanzamiento a fuerza 1 y WASD sostenido en
 * la misma dirección desde el tick 0; HERO_WALK_SPEED ya en 2.0): la puerta
 * anterior era `if (hero.velocity !== 0) return`. Un lanzamiento frena por
 * fricción exponencial (engine/physics.ts) hasta cruzar STOP_THRESHOLD
 * (0.35 u/s), momento en que la física redondea la velocidad a 0 EXACTO. Se
 * midió: en el tick 98 la velocidad se redondeó a 0 con un desplazamiento de
 * physics de 0.006181 u ese tick (arrastre residual a ~0.37 u/s); como en
 * ESE tick WASD todavía veía velocidad no-nula (la de ANTES de que physics
 * la recortara) seguía bloqueado, y en el tick 99 veía ya velocidad 0 y
 * entraba de golpe a HERO_WALK_SPEED/60 = 0.033333 u — un salto de 0.027152
 * u/tick en un solo tick, la costura que David sentía.
 *
 * Solución: `heroWalkFactor` devuelve cuánto manda el paseo este tick, en
 * [0,1], como función CONTINUA de la velocidad física (no un booleano): 1 en
 * reposo, decayendo LINEALMENTE a 0 según la velocidad del deslizamiento se
 * acerca a HERO_WALK_SPEED (y 0 franco por encima: un lanzamiento de verdad
 * es intocable). En el caso alineado (paseo en la misma dirección que el
 * deslizamiento) la velocidad total sobre el suelo es EXACTAMENTE constante
 * durante toda la transición:
 *
 *   speed + HERO_WALK_SPEED·(1 − speed/HERO_WALK_SPEED) = HERO_WALK_SPEED
 *
 * así que el escalón de STOP_THRESHOLD (que sigue existiendo dentro de la
 * física; esta fórmula no lo elimina, lo ABSORBE) queda invisible en el
 * desplazamiento total: justo antes del corte el paseo ya aportaba
 * (1 − 0.35/2.0) = 82.5% de HERO_WALK_SPEED sobre el 0.35 u/s físico
 * restante, y justo después aporta el 100% sobre 0 físico — la suma no se
 * mueve. En direcciones perpendicular/opuesta la aportación del paseo crece
 * igual de continua desde 0 según decae la velocidad física, así que
 * tampoco hay tirón ahí (solo dejan de sumar exactamente a una constante,
 * pero sin salto).
 *
 * Lo que esto CAMBIA respecto al diseño original: el lanzamiento ya NO es
 * intocable en TODO su recorrido, solo mientras va a velocidad ≥
 * HERO_WALK_SPEED. Como el lanzamiento más flojo sale a LAUNCH_SPEED_MIN
 * (3.6 u/s, muy por encima de HERO_WALK_SPEED=2.0), todo lanzamiento real es
 * intocable durante la mayor parte de su vuelo; el paseo solo se mezcla en
 * la cola final — justo donde antes estaba el salto. Sin exploit posible: la
 * aportación del paseo nunca supera HERO_WALK_SPEED, la misma velocidad que
 * se consigue caminando sin haber lanzado nunca.
 *
 * Contrato de rendimiento: cero asignaciones por tick (solo escalares),
 * igual que engine/physics.ts.
 */

import { FIXED_DT } from '@/engine/physics';
import { HERO_WALK_SPEED } from './constants';
import type { World } from '@/game/world/types';

/**
 * Cuánto manda el paseo este tick, en [0,1]. 1 = héroe en reposo (paseo
 * pleno); 0 = hay un deslizamiento tan rápido o más que la propia velocidad
 * de paseo (un lanzamiento de verdad: intocable). Usado también por
 * `HeroView.tsx` para decidir la mirada (única fuente de verdad de "el
 * paseo manda ahora mismo": la vista no reimplementa estas puertas).
 *
 * Puertas duras (devuelven 0 sin más cálculo; las mismas de siempre, ninguna
 * añade un flag nuevo):
 * 1) Fuera de 'playing': redundante con la puerta de `stepWorld`, pero deja
 *    la función honesta y testeable por sí sola (llamable directamente).
 * 2) Apuntando (`heroAiming`): apuntar y caminar a la vez confundiría la
 *    lectura del gesto de tirachinas — parada INMEDIATA, sin decaimiento
 *    (no es un deslizamiento físico, no hay nada que desvanecer).
 * 3) Cayendo a un foso (`fallingUntil > 0`, ver hazards.ts): el héroe está
 *    congelado durante la animación de caída.
 * 4) Vector de input ~nulo: nada que caminar.
 *
 * Pasadas las puertas: factor lineal según la velocidad FÍSICA actual
 * (`hero.velocity`, la del deslizamiento/lanzamiento) frente a
 * HERO_WALK_SPEED — ver la cabecera del fichero para la garantía de
 * continuidad que esto produce.
 */
export function heroWalkFactor(world: World): number {
  if (world.phase !== 'playing') return 0;
  if (world.heroAiming) return 0;
  if (world.fallingUntil > 0) return 0;

  const move = world.heroMove;
  if (move.x * move.x + move.y * move.y < 1e-12) return 0;

  const velocity = world.hero.velocity;
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed >= HERO_WALK_SPEED) return 0;
  return 1 - speed / HERO_WALK_SPEED;
}

/**
 * Un tick de paseo WASD (FIXED_DT). Lee `world.heroMove` (vector crudo, sin
 * normalizar, escrito por KeyboardMoveInput.tsx vía session.move) y desplaza
 * `hero.position` en línea recta a `HERO_WALK_SPEED * heroWalkFactor(world)`
 * u/s. No toca `hero.velocity` bajo ninguna circunstancia.
 */
export function stepHeroWalk(world: World): void {
  const factor = heroWalkFactor(world);
  if (factor <= 0) return;

  const move = world.heroMove;
  const lenSq = move.x * move.x + move.y * move.y;
  if (lenSq < 1e-12) return; // ya cubierto por heroWalkFactor; se deja para que la función siga siendo honesta sola

  const hero = world.hero;
  const invLen = 1 / Math.sqrt(lenSq);
  const step = HERO_WALK_SPEED * factor * FIXED_DT;
  hero.position.x += move.x * invLen * step;
  hero.position.y += move.y * invLen * step;
}
