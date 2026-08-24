// ── Chaser (GDD §7.2) ──────────────────────────────────────────────────────

import { canAggro, moveToward, stepPatrol } from '@/game/features/enemies/steering';
import { CHASER_SPEED, CHASER_SPEED_WHILE_AIMING } from './constants';
import type { Enemy, World } from '@/game/world/types';

export function stepChaser(world: World, enemy: Enemy, dt: number): void {
  // Fuera de su sala (o sala no visitada): patrulla como cualquier otro
  // arquetipo en vez de perseguir la posición absoluta del héroe (punto 7 de
  // playtest ronda 3) — evita que se quede "pegado" contra su propio muro
  // agrediendo a través de él, que además dejaba su blob shadow visible
  // moviéndose en la sala vecina sin cuerpo encima (punto 2, misma causa).
  if (!canAggro(world, enemy)) {
    stepPatrol(world, enemy, CHASER_SPEED, dt);
    return;
  }
  // Apuntar lo FRENA (~57,5 %), no lo acelera: sigue viniendo, pero deja hueco
  // para cargar el tiro. Sin rampa ni timer — al soltar, CHASER_SPEED ya en este tick.
  const speed = world.heroAiming ? CHASER_SPEED_WHILE_AIMING : CHASER_SPEED;
  moveToward(world, enemy, world.hero.position.x, world.hero.position.y, speed, dt);
}
