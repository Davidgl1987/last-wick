/**
 * IA de enemigos (GDD §7): dispatcher de los 5 arquetipos, determinista (usa
 * world.rng cuando hace falta aleatoriedad en cada stepX).
 */

import { stepChaser } from '@/game/features/enemies/chaser/ai';
import { stepDummy } from '@/game/features/enemies/dummy/ai';
import { stepShooter } from '@/game/features/enemies/shooter/ai';
import { stepSpike } from '@/game/features/enemies/spike/ai';
import { stepTrail } from '@/game/features/enemies/trail/ai';
import type { EventQueue } from '@/engine/events';
import type { World } from '@/game/world/types';

// ── Orquestador ────────────────────────────────────────────────────────────

/** `events` opcional al final (encargo de audio, ver shooter/ai.ts): solo el arquetipo shooter lo necesita hoy (dispara 'enemy-shot'). */
export function stepEnemyAi(world: World, dt: number, events: EventQueue | null = null): void {
  const enemies = world.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (enemy.hp <= 0) continue;
    // Mazmorra multi-sala (punto 7 de playtest ronda 3): los enemigos de
    // TODAS las salas patrullan con normalidad en cuanto existen, se hayan
    // visitado o no (se les ve vivos a través de los huecos de puerta); lo
    // que sigue restringido por `canAggro` (dentro de cada stepXxx) es la
    // AGRESIÓN — perseguir, cargar o disparar al héroe — que solo se activa
    // cuando el héroe está físicamente en la misma sala que el enemigo. GDD
    // §10.2: la contención dura (nunca salir de su sala) ya la impone
    // stepEnemyCollisions/isBlocked vía roomRuntimes.get(enemy.roomId).bounds,
    // sin relación con `visited`.
    // Mientras dura el knockback, la física (stepEnemyCollisions) gobierna la
    // velocidad; la IA no la sobreescribe para que el empuje se note.
    if (world.time < enemy.knockbackUntil) continue;
    switch (enemy.kind) {
      case 'dummy':
        stepDummy(world, enemy, dt);
        break;
      case 'chaser':
        stepChaser(world, enemy, dt);
        break;
      case 'spike':
        stepSpike(world, enemy, dt);
        break;
      case 'trail':
        stepTrail(world, enemy, dt);
        break;
      case 'shooter':
        stepShooter(world, enemy, dt, events);
        break;
    }
  }
}
