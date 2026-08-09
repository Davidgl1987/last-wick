// ── Shooter (GDD §7.5) ─────────────────────────────────────────────────────

import { canAggro, moveToward, stepPatrol } from '@/game/features/enemies/steering';
import { SHOOTER_CHARGE_DURATION, SHOOTER_CHASE_DURATION, SHOOTER_CHASE_SPEED, SHOOTER_PROJECTILE_DAMAGE, SHOOTER_PROJECTILE_RADIUS, SHOOTER_PROJECTILE_SPEED } from './constants';
import { fireEnemyProjectile } from '@/game/features/combat/combat';
import { pushEvent, type EventQueue } from '@/engine/events';
import type { Enemy, World } from '@/game/world/types';

/**
 * `events` opcional al final (encargo de audio, `enemy-shot`, ver
 * engine/events.ts): `stepEnemyAi(world, dt)` no pasaba cola de eventos
 * hasta ahora — opcional-al-final mantiene compilando sin tocar los tests
 * existentes que llaman a `stepEnemyAi`/`stepShooter` con la firma antigua.
 */
export function stepShooter(world: World, enemy: Enemy, dt: number, events: EventQueue | null = null): void {
  // Sin aggro (punto 7): patrulla como cualquier otro arquetipo, con el
  // ciclo persigue/carga/dispara congelado (nunca telegrafía ni dispara a
  // través de su propio muro) hasta que el héroe vuelva a su sala.
  if (!canAggro(world, enemy)) {
    stepPatrol(world, enemy, SHOOTER_CHASE_SPEED, dt);
    return;
  }

  enemy.shooterPhaseTimer -= dt;

  if (enemy.shooterPhase === 'chase') {
    moveToward(world, enemy, world.hero.position.x, world.hero.position.y, SHOOTER_CHASE_SPEED, dt);
  } else {
    // Fase de carga: se detiene y telegrafía el disparo (render dibuja el aviso).
    enemy.velocity.x = 0;
    enemy.velocity.y = 0;
  }

  if (enemy.shooterPhaseTimer <= 0) {
    if (enemy.shooterPhase === 'chase') {
      enemy.shooterPhase = 'charge';
      enemy.shooterPhaseTimer = SHOOTER_CHARGE_DURATION;
    } else {
      // Fin de la carga: dispara hacia el héroe y vuelve a perseguir.
      const dx = world.hero.position.x - enemy.position.x;
      const dy = world.hero.position.y - enemy.position.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      fireEnemyProjectile(
        world,
        enemy.position.x,
        enemy.position.y,
        dx / len,
        dy / len,
        SHOOTER_PROJECTILE_SPEED,
        SHOOTER_PROJECTILE_DAMAGE,
        SHOOTER_PROJECTILE_RADIUS,
      );
      if (events) {
        pushEvent(events, 'enemy-shot', enemy.position.x, enemy.position.y, SHOOTER_PROJECTILE_SPEED);
      }
      enemy.shooterPhase = 'chase';
      enemy.shooterPhaseTimer = SHOOTER_CHASE_DURATION;
    }
  }
}
