/**
 * Hazards del escenario (GDD §8): foso, pinchos, barril, barro, acelerador.
 * Las rocas ya se resuelven como obstáculos sólidos en physics.ts/world.ts.
 *
 * Contrato de rendimiento: cero asignaciones por tick; recorre los arrays ya
 * existentes del mundo (hazards estáticos, barrels vivos).
 */

import { BARREL_BLAST_RADIUS, BARREL_DAMAGE, BOOST_ACCELERATION, BOOST_MIN_SPEED, MUD_SLOW_FACTOR_PER_TICK, PIT_DAMAGE, PIT_FALL_DURATION, PIT_FORGIVENESS_MARGIN, SPIKES_ENEMY_DAMAGE_INTERVAL, SPIKES_DAMAGE, SPIKES_PUSH_SPEED } from './constants';
import { QUEEN_TRAIL_CROSS_SPEED, QUEEN_TRAIL_DOT_GRACE, QUEEN_TRAIL_SLOW_FACTOR } from '@/game/features/bosses/queen/constants';
import { applyDamageToEnemy, applyDamageToHero, applyKnockbackToHero } from '@/game/features/combat/combat';
import { pushEvent, type EventQueue } from '@/engine/events';
import { barrelInAir, type Barrel, type HazardSpawn, type World } from '@/game/world/types';

/**
 * Geometría solo con escalares (cero asignaciones por tick): rect del hazard
 * centrado en su posición, con `inset` positivo encogiéndolo (margen de
 * perdón del foso) o 0 para el borde visual exacto.
 */
function pointInHazardRect(hazard: HazardSpawn, x: number, y: number, inset: number): boolean {
  const hw = hazard.width / 2 - inset;
  const hh = hazard.height / 2 - inset;
  if (hw <= 0 || hh <= 0) return false;
  return (
    x >= hazard.position.x - hw &&
    x <= hazard.position.x + hw &&
    y >= hazard.position.y - hh &&
    y <= hazard.position.y + hh
  );
}

function circleOverlapsHazardRect(hazard: HazardSpawn, x: number, y: number, radius: number): boolean {
  const minX = hazard.position.x - hazard.width / 2;
  const maxX = hazard.position.x + hazard.width / 2;
  const minY = hazard.position.y - hazard.height / 2;
  const maxY = hazard.position.y + hazard.height / 2;
  const nearestX = x < minX ? minX : x > maxX ? maxX : x;
  const nearestY = y < minY ? minY : y > maxY ? maxY : y;
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

// ── Héroe vs hazards ───────────────────────────────────────────────────────

/**
 * Resuelve los hazards estáticos contra el héroe: foso (trigger por el
 * centro, con margen de perdón), pinchos (daño + empuje), barro (frenado),
 * acelerador (impulso). Actualiza `safePosition` cuando el héroe pisa suelo
 * firme y controlable (fuera de cualquier hazard, sin estar cayendo).
 */
export function stepHeroHazards(world: World, dt: number, events: EventQueue): void {
  const hero = world.hero;

  // Animación de caída en curso: el héroe queda "congelado" (no se mueve por
  // física normal) hasta que expira; el respawn ocurre al final del tick.
  if (world.fallingUntil > 0) {
    if (world.time >= world.fallingUntil) {
      world.fallingUntil = 0;
      hero.position.x = world.safePosition.x;
      hero.position.y = world.safePosition.y;
      hero.velocity.x = 0;
      hero.velocity.y = 0;
      pushEvent(events, 'pit-respawn', hero.position.x, hero.position.y, 1);
    }
    return;
  }

  let onHazard = false;
  const hazards = world.hazards;
  for (let i = 0; i < hazards.length; i++) {
    const hazard = hazards[i];
    switch (hazard.kind) {
      case 'pit': {
        if (pointInHazardRect(hazard, hero.position.x, hero.position.y, PIT_FORGIVENESS_MARGIN)) {
          onHazard = true;
          world.fallingUntil = world.time + PIT_FALL_DURATION;
          hero.velocity.x = 0;
          hero.velocity.y = 0;
          applyDamageToHero(world, PIT_DAMAGE, events);
          pushEvent(events, 'pit-fall', hero.position.x, hero.position.y, 1);
        }
        break;
      }
      case 'spikes': {
        if (circleOverlapsHazardRect(hazard, hero.position.x, hero.position.y, hero.radius)) {
          onHazard = true;
          const dx = hero.position.x - hazard.position.x;
          const dy = hero.position.y - hazard.position.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = dx / len;
          const ny = dy / len;
          const wasHit = applyDamageToHero(world, SPIKES_DAMAGE, events);
          if (!wasHit) {
            applyKnockbackToHero(world, nx * SPIKES_PUSH_SPEED, ny * SPIKES_PUSH_SPEED);
            pushEvent(events, 'spikes-hit', hero.position.x, hero.position.y, SPIKES_DAMAGE);
          }
        }
        break;
      }
      case 'slow': {
        if (pointInHazardRect(hazard, hero.position.x, hero.position.y, 0)) {
          hero.velocity.x *= MUD_SLOW_FACTOR_PER_TICK;
          hero.velocity.y *= MUD_SLOW_FACTOR_PER_TICK;
        }
        break;
      }
      case 'boost': {
        if (pointInHazardRect(hazard, hero.position.x, hero.position.y, 0)) {
          const speed = Math.hypot(hero.velocity.x, hero.velocity.y);
          if (speed > BOOST_MIN_SPEED) {
            const dirX = hazard.direction?.x ?? hero.velocity.x / speed;
            const dirY = hazard.direction?.y ?? hero.velocity.y / speed;
            const dirLen = Math.hypot(dirX, dirY) || 1;
            hero.velocity.x += (dirX / dirLen) * BOOST_ACCELERATION * dt;
            hero.velocity.y += (dirY / dirLen) * BOOST_ACCELERATION * dt;
          }
        }
        break;
      }
    }
  }

  if (!onHazard && world.fallingUntil === 0) {
    world.safePosition.x = hero.position.x;
    world.safePosition.y = hero.position.y;
  }
}

// ── Enemigos vs hazards ────────────────────────────────────────────────────

/**
 * Resuelve hazards contra enemigos: caen en fosos y mueren al instante;
 * reciben daño periódico de pinchos; el barro les afecta igual que al héroe.
 * Usa un Map de cooldowns (id → world.time del último tick de pinchos) que
 * posee el llamador para no asignar memoria aquí.
 */
export function stepEnemyHazards(
  world: World,
  spikeCooldowns: Map<string, number>,
  events: EventQueue,
): void {
  const hazards = world.hazards;
  const enemies = world.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (enemy.hp <= 0) continue;
    for (let j = 0; j < hazards.length; j++) {
      const hazard = hazards[j];
      if (hazard.kind === 'pit') {
        if (pointInHazardRect(hazard, enemy.position.x, enemy.position.y, PIT_FORGIVENESS_MARGIN)) {
          applyDamageToEnemy(world, enemy, enemy.hp, 0, 0, events);
          pushEvent(events, 'pit-fall', enemy.position.x, enemy.position.y, 1);
        }
      } else if (hazard.kind === 'spikes') {
        if (circleOverlapsHazardRect(hazard, enemy.position.x, enemy.position.y, enemy.radius)) {
          const last = spikeCooldowns.get(enemy.id) ?? -Infinity;
          if (world.time - last >= SPIKES_ENEMY_DAMAGE_INTERVAL) {
            spikeCooldowns.set(enemy.id, world.time);
            applyDamageToEnemy(world, enemy, SPIKES_DAMAGE, 0, 0, events);
          }
        }
      } else if (hazard.kind === 'slow') {
        if (pointInHazardRect(hazard, enemy.position.x, enemy.position.y, 0)) {
          enemy.velocity.x *= MUD_SLOW_FACTOR_PER_TICK;
          enemy.velocity.y *= MUD_SLOW_FACTOR_PER_TICK;
        }
      }
    }
  }
}

// ── Charcos del Trail / rastro de la Reina ─────────────────────────────────

/**
 * Consume la vida de los charcos activos y resuelve su efecto sobre el héroe.
 * Dos comportamientos según `puddle.slows` (mismo pool, ver `Puddle` en
 * world.ts):
 *
 * - `slows === false` (Trail normal / esquirlas del Guardián): daño de
 *   contacto simple al solapar (sin cooldown propio: el hazard desaparece
 *   antes de repetir por los i-frames del héroe). Comportamiento INTACTO.
 * - `slows === true` (rastro de la Reina, rediseño 2026-07-10, GDD §15.3):
 *   "molesta de verdad" — si el héroe lo pisa yendo lento (velocidad ≤
 *   QUEEN_TRAIL_CROSS_SPEED) lo frena (QUEEN_TRAIL_SLOW_FACTOR/tick); una
 *   embestida por encima de esa velocidad lo cruza limpio, sin penalización
 *   (válvula: castiga quedarte parado, no pasar de largo). Mientras el héroe
 *   sigue lento y frenado, `hero.trailDwell` acumula tiempo continuo; pasada
 *   la gracia QUEEN_TRAIL_DOT_GRACE empieza el DoT (`applyDamageToHero`, 1
 *   punto — los i-frames de 0.7s espacian los ticks solos). Salir del rastro
 *   (o cruzarlo a embestida) resetea `trailDwell` a 0.
 */
export function stepPuddles(world: World, dt: number, events: EventQueue): void {
  const puddles = world.puddles;
  const hero = world.hero;
  let onSlowTrail = false;

  for (let i = 0; i < puddles.length; i++) {
    const puddle = puddles[i];
    if (!puddle.active) continue;
    puddle.ttl -= dt;
    if (puddle.ttl <= 0) {
      puddle.active = false;
      continue;
    }
    const dx = hero.position.x - puddle.position.x;
    const dy = hero.position.y - puddle.position.y;
    const rr = hero.radius + puddle.radius;
    if (dx * dx + dy * dy > rr * rr) continue;

    if (!puddle.slows) {
      applyDamageToHero(world, 1, events);
      continue;
    }

    const speed = Math.hypot(hero.velocity.x, hero.velocity.y);
    if (speed > QUEEN_TRAIL_CROSS_SPEED) continue; // embestida: cruza limpio, sin frenado ni DoT
    hero.velocity.x *= QUEEN_TRAIL_SLOW_FACTOR;
    hero.velocity.y *= QUEEN_TRAIL_SLOW_FACTOR;
    onSlowTrail = true;
  }

  if (onSlowTrail) {
    hero.trailDwell += dt;
    if (hero.trailDwell >= QUEEN_TRAIL_DOT_GRACE) {
      applyDamageToHero(world, 1, events);
    }
  } else {
    hero.trailDwell = 0;
  }
}

// ── Barriles ───────────────────────────────────────────────────────────────

/**
 * `ignoreBossWindow` (GDD §15.2, playtest 2026-07-06): cuando la carga a
 * ciegas de un jefe (Guardián) arrolla el barril, el daño a ESE jefe se
 * aplica siempre — "es su castigo" — sin el gating normal de ventana de
 * vulnerabilidad. No afecta al daño al héroe ni a otros enemigos/barriles en
 * la cadena. Por defecto false (comportamiento existente intacto para
 * cualquier otro disparador de la explosión).
 */
export function explodeBarrel(world: World, barrel: Barrel, events: EventQueue, ignoreBossWindow = false): void {
  if (barrel.exploded) return;
  barrel.exploded = true;
  pushEvent(events, 'barrel-explosion', barrel.position.x, barrel.position.y, BARREL_BLAST_RADIUS);

  const hero = world.hero;
  const dxHero = hero.position.x - barrel.position.x;
  const dyHero = hero.position.y - barrel.position.y;
  if (Math.hypot(dxHero, dyHero) <= BARREL_BLAST_RADIUS) {
    applyDamageToHero(world, BARREL_DAMAGE, events);
  }

  for (let i = 0; i < world.enemies.length; i++) {
    const enemy = world.enemies[i];
    if (enemy.hp <= 0) continue;
    const dx = enemy.position.x - barrel.position.x;
    const dy = enemy.position.y - barrel.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= BARREL_BLAST_RADIUS) {
      // Guardián (playtest 2026-07-10): un barril que explota en su radio le hace
      // su daño de barril (fracción de su vida máxima) EN CUALQUIER MOMENTO
      // —aturdido o no, lo detone quien lo detone—, no solo su propia carga.
      const guardianTarget = enemy.kind === 'boss' && enemy.bossBarrelDamage > 0;
      const dmg = guardianTarget ? enemy.bossBarrelDamage : BARREL_DAMAGE;
      const ignoreWindow = guardianTarget || (ignoreBossWindow && enemy.kind === 'boss');
      applyDamageToEnemy(world, enemy, dmg, dx || 1, dy, events, ignoreWindow);
    }
  }

  // Cadena: otros barriles dentro del radio de explosión también detonan.
  for (let i = 0; i < world.barrels.length; i++) {
    const other = world.barrels[i];
    if (other === barrel || other.exploded) continue;
    const dist = Math.hypot(other.position.x - barrel.position.x, other.position.y - barrel.position.y);
    if (dist <= BARREL_BLAST_RADIUS) {
      explodeBarrel(world, other, events, ignoreBossWindow);
    }
  }
}

function circleTouchesEntity(
  ex: number,
  ey: number,
  er: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ex - bx;
  const dy = ey - by;
  const rr = er + br;
  return dx * dx + dy * dy <= rr * rr;
}

/**
 * Detona barriles SOLO por acción del jugador (o cadena, ver `explodeBarrel`):
 * contacto del héroe o impacto de un proyectil DEL HÉROE. El contacto de un
 * enemigo NUNCA detona (fix playtest de David, "enemigos que mueren solos
 * yendo hacia barriles explosivos": antes cualquier enemigo que tocara un
 * barril lo hacía estallar, trivializando el combate — el barril para un
 * enemigo es ahora un sólido más, ver `stepEnemyCollisions` en physics.ts).
 * Los proyectiles ENEMIGOS (Shooter/Prisma/Storm) tampoco detonan: antes
 * cualquier proyectil, fuera de quien fuera, lo hacía — mismo criterio, solo
 * el jugador (directo o por proyectil) dispara la mecha; simplemente
 * atraviesan el barril sin interactuar con él, como ya hacían contra
 * cualquier otro hazard.
 */
export function stepBarrels(world: World, events: EventQueue): void {
  const barrels = world.barrels;
  for (let i = 0; i < barrels.length; i++) {
    const barrel = barrels[i];
    // Barril del Guardián aún cayendo del cielo (GDD §15.2): no explota por
    // contacto hasta que aterriza (world.time >= landingAt).
    if (barrel.exploded || barrelInAir(barrel, world.time)) continue;

    const hero = world.hero;
    if (circleTouchesEntity(hero.position.x, hero.position.y, hero.radius, barrel.position.x, barrel.position.y, barrel.radius)) {
      explodeBarrel(world, barrel, events);
      continue;
    }

    for (let j = 0; j < world.projectiles.length; j++) {
      const p = world.projectiles[j];
      if (!p.active || p.owner !== 'hero') continue;
      if (
        circleTouchesEntity(p.position.x, p.position.y, p.radius, barrel.position.x, barrel.position.y, barrel.radius)
      ) {
        p.active = false;
        explodeBarrel(world, barrel, events);
        break;
      }
    }
  }
}
