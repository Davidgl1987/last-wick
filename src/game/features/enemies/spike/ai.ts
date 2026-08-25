// ── Spike (GDD §7.3) ───────────────────────────────────────────────────────

import { dampAngleTowards } from '@/engine/geometry';
import { ENEMY_ORIENTATION_DAMP_LAMBDA } from '@/game/features/enemies/constants';
import { stepPatrol } from '@/game/features/enemies/steering';
import { SPIKE_PATROL_SPEED } from './constants';
import type { Enemy, World } from '@/game/world/types';

export function stepSpike(world: World, enemy: Enemy, dt: number): void {
  stepPatrol(world, enemy, SPIKE_PATROL_SPEED, dt);
  // La cara peligrosa mira hacia donde se mueve (playtest 2026-07-05):
  // embiste con las púas por delante. Parado conserva la última dirección
  // (o el spikeDir inicial de la sala), así que sigue siendo legible.
  //
  // En MARCHA normal (velocity≠0) amortigua `facing` hacia el rumbo de la
  // velocidad con `dampAngleTowards`, para que ojo/púas giren en sincronía
  // suave con el cuerpo (mismo λ, ENEMY_ORIENTATION_DAMP_LAMBDA, que usa
  // EnemyViews.tsx) en vez de hacer snap instantáneo.
  //
  // Durante el GIRO en un extremo de la ruta (`stepPatrol` ya puesto
  // `velocity` a {0,0} este mismo tick, ver steering.ts) el guard de abajo
  // (`speed > 0.05`) no entra, así que este bloque NO toca `facing` — y con
  // razón: en ese tramo `facing` YA ES la orientación que gobierna la sim
  // (stepPatrol la rota a velocidad angular constante, PATROL_TURN_RATE), no
  // una caché derivada de la velocidad. Si este código la sobrescribiera
  // también, pisaría ese giro gobernado por la sim con el último rumbo de
  // marcha (congelado, porque velocity=0), y el ojo dejaría de girar durante
  // toda la ventana. Cero asignaciones nuevas por tick: solo escalares.
  const speed = Math.hypot(enemy.velocity.x, enemy.velocity.y);
  if (speed > 0.05) {
    const current = Math.atan2(enemy.facing.x, enemy.facing.y);
    const target = Math.atan2(enemy.velocity.x / speed, enemy.velocity.y / speed);
    const next = dampAngleTowards(current, target, ENEMY_ORIENTATION_DAMP_LAMBDA, dt);
    enemy.facing.x = Math.sin(next);
    enemy.facing.y = Math.cos(next);
  }
}
