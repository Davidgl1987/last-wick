/**
 * Larvas de la Reina del Enjambre (GDD §15.3, simplificación 2026-08-31):
 * único rol — perseguir al héroe. NO son un `BossDef` ni un `EnemyKind`
 * nuevo — son `Enemy` normales de `kind:'dummy'` con `hp`/`radius` propios,
 * viviendo como slots PREASIGNADOS al final de `world.enemies` (ver
 * `queen/pattern.ts::queenOnInit`), igual pool preasignado que
 * proyectiles/charcos.
 */

import { pushEvent, type EventQueue } from '@/engine/events';
import type { Enemy, World } from '@/game/world/types';
import type { QueenColumn } from './columns';
import { QUEEN_LARVA_CHASE_SPEED_PHASE2, QUEEN_LARVA_CHASE_SPEED_PHASE3, QUEEN_LARVA_HP, QUEEN_LARVA_ID_PREFIX, QUEEN_LARVA_RADIUS, QUEEN_LARVA_SPEED } from './constants';

export function isQueenLarva(enemy: Enemy): boolean {
  return enemy.id.startsWith(QUEEN_LARVA_ID_PREFIX);
}

/**
 * Activa un slot de larva libre como PERSEGUIDORA nacida de la columna `col`
 * (simplificación 2026-08-31, sustituye a la antigua `queenActivateGuardian`
 * — mismo cuerpo de "buscar un slot libre en el pool preasignado", pero el
 * único rol que queda es perseguir). Nace en el BORDE del AABB de la columna,
 * en la dirección hacia el héroe (nunca en su centro — "debe salir
 * claramente de la columna"): raycast desde el centro de `col` hacia el
 * héroe, el eje (X o Y) que satura antes fija la distancia exacta al borde,
 * más `QUEEN_LARVA_RADIUS` para que el CUERPO de la larva quede fuera del
 * volumen de la columna, no solo su centro tangente al borde. Devuelve true
 * si había un slot libre.
 */
export function queenSpawnLarvaFromColumn(world: World, boss: Enemy, col: QueenColumn, events: EventQueue): boolean {
  const enemies = world.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const larva = enemies[i];
    if (!isQueenLarva(larva) || larva.roomId !== boss.roomId || larva.hp > 0) continue;

    const dx = world.hero.position.x - col.position.x;
    const dy = world.hero.position.y - col.position.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len;
    const dirY = dy / len;
    const edgeDist =
      Math.min(
        Math.abs(dirX) > 1e-6 ? col.halfW / Math.abs(dirX) : Infinity,
        Math.abs(dirY) > 1e-6 ? col.halfH / Math.abs(dirY) : Infinity,
      ) + QUEEN_LARVA_RADIUS;

    larva.hp = QUEEN_LARVA_HP;
    larva.maxHp = QUEEN_LARVA_HP;
    larva.position.x = col.position.x + dirX * edgeDist;
    larva.position.y = col.position.y + dirY * edgeDist;
    larva.velocity.x = 0;
    larva.velocity.y = 0;
    larva.hitFlashUntil = 0;
    larva.knockbackUntil = 0;
    larva.chasing = true; // único rol: perseguidora
    larva.facing.x = dirX;
    larva.facing.y = dirY;

    // Temblor visual de la columna al parir (encargo de feedback visual
    // 2026-08-31: "el spawn debe ser visible: la columna reacciona/tiembla").
    // Mismo campo y misma duración (0.35s) que usa `stepQueenColumns` al
    // recibir un impacto de embestida (`columns.ts`) — el render
    // (QueenColumnsView.tsx) no distingue el motivo del temblor, solo cuánto
    // falta para `shakeUntil`. Sin esta línea el campo se quedaba a 0 para
    // siempre en el caso de parto, pese a que su propio JSDoc (columns.ts) y
    // el comentario de abajo ya prometían el temblor en el spawn.
    col.shakeUntil = world.time + 0.35;

    // Dos eventos en la posición de la COLUMNA (no del boss): el genérico ya
    // existente ('boss-wave-spawn', intensity=1, sin cambios de contrato) y
    // el nuevo específico de columna ('boss-column-spawn': ceniza/polvo +
    // temblor de la columna, ver `engine/events.ts`).
    pushEvent(events, 'boss-wave-spawn', col.position.x, col.position.y, 1);
    pushEvent(events, 'boss-column-spawn', col.position.x, col.position.y, 1);
    return true;
  }
  return false;
}

/**
 * Movimiento de las larvas vivas (simplificación 2026-08-31: único rol,
 * perseguir — antes bifurcaba por `chasing` entre perseguidora y guardiana en
 * órbita): recalcula rumbo al héroe cada tick, más rápida por fase. No pasan
 * por `stepEnemyAi` (sin detección ni correa).
 */
export function queenStepLarvae(world: World, boss: Enemy, dt: number): void {
  const chaseSpeed =
    boss.bossPhase >= 3 ? QUEEN_LARVA_CHASE_SPEED_PHASE3 : boss.bossPhase === 2 ? QUEEN_LARVA_CHASE_SPEED_PHASE2 : QUEEN_LARVA_SPEED;

  const enemies = world.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const larva = enemies[i];
    if (!isQueenLarva(larva) || larva.roomId !== boss.roomId || larva.hp <= 0) continue;

    const dx = world.hero.position.x - larva.position.x;
    const dy = world.hero.position.y - larva.position.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len;
    const dirY = dy / len;

    larva.facing.x = dirX;
    larva.facing.y = dirY;
    larva.position.x += dirX * chaseSpeed * dt;
    larva.position.y += dirY * chaseSpeed * dt;
    larva.velocity.x = dirX * chaseSpeed;
    larva.velocity.y = dirY * chaseSpeed;
  }
}
