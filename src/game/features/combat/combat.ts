/**
 * Combate (GDD §5-6): disparo de proyectiles, daño por embestida, daño por
 * contacto recibido, i-frames, escudo y knockback a enemigos.
 *
 * Contrato de rendimiento: cero asignaciones en el hot path. Los proyectiles
 * viven en un pool preasignado (world.projectiles); disparar solo activa un
 * slot libre y lo muta.
 */

import { ARROW_COOLDOWN, ARROW_DAMAGE, ARROW_PIERCE_COUNT, ARROW_SPEED, CONTACT_DAMAGE, CONTACT_DAMAGE_COOLDOWN, ENEMY_HIT_FLASH_DURATION, ENEMY_KNOCKBACK_OFFSET, ENEMY_KNOCKBACK_SPEED, HERO_IFRAME_DURATION, PROJECTILE_FAN_ANGLE_STEP, PROJECTILE_FORCE_SPEED_MAX, PROJECTILE_FORCE_SPEED_MIN, PROJECTILE_LIFETIME, PROJECTILE_RADIUS, PROJECTILE_RECOIL, RAM_DAMAGE_BASE, RAM_DAMAGE_PER_SPEED, RAM_SPEED_THRESHOLD, SHIELD_IFRAME_DURATION, SPELL_BOUNCE_FACTOR, SPELL_COOLDOWN, SPELL_DAMAGE, SPELL_RADIUS_UPGRADED, SPELL_SPEED, SPELL_WALL_BOUNCES, SPIKE_DANGEROUS_DOT_THRESHOLD } from './constants';
import { BODY_LAUNCH_COOLDOWN } from '@/game/features/hero/constants';
import { collideCircleAabb, collideInnerBounds } from '@/engine/physics';
import { pushEvent, type EventQueue } from '@/engine/events';
import type { Enemy, Hero, Projectile, ProjectileOwner, World } from '@/game/world/types';

// ── Disparo de proyectiles ────────────────────────────────────────────────

/** Busca el primer slot libre del pool; null si está lleno (descarta el disparo). */
function acquireProjectile(world: World): Projectile | null {
  const pool = world.projectiles;
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].active) return pool[i];
  }
  return null;
}

/**
 * Dispara flecha o hechizo desde el héroe: velocidad = dir × velocidadBase ×
 * (0.7 + fuerza × 0.5), con retroceso al héroe. Respeta el cooldown propio de
 * cada arma; rechazar fuerzas por debajo del mínimo lo hace el llamador
 * (mismo umbral que el lanzamiento corporal).
 *
 * Multidisparo en ángulo (Bandada/Coro Arcano, docs/plans/ECONOMY_PLAN.md F2):
 * `1 + arrowCountBonus`/`1 + spellCountBonus` proyectiles en abanico simétrico
 * centrado en (dirX,dirY), separados PROJECTILE_FAN_ANGLE_STEP entre
 * adyacentes. Un solo cooldown, un solo retroceso y un solo evento 'launch'
 * por disparo (no por proyectil); si el pool se queda sin slots libres a
 * mitad del abanico, se disparan los que quepan sin error.
 */
export function fireProjectile(
  world: World,
  mode: 'arrow' | 'spell',
  dirX: number,
  dirY: number,
  force: number,
  events: EventQueue,
): boolean {
  const hero = world.hero;
  if (mode === 'arrow') {
    if (world.time - hero.lastArrowTime < ARROW_COOLDOWN) return false;
  } else {
    if (world.time - hero.lastSpellTime < SPELL_COOLDOWN) return false;
  }

  const countBonus = mode === 'arrow' ? hero.modifiers.arrowCountBonus : hero.modifiers.spellCountBonus;
  const count = 1 + Math.max(0, countBonus);

  const baseSpeed = mode === 'arrow' ? ARROW_SPEED : SPELL_SPEED;
  const speedScale =
    PROJECTILE_FORCE_SPEED_MIN + (PROJECTILE_FORCE_SPEED_MAX - PROJECTILE_FORCE_SPEED_MIN) * force;
  const speed = baseSpeed * speedScale;

  let fired = 0;
  for (let i = 0; i < count; i++) {
    const slot = acquireProjectile(world);
    if (!slot) break; // pool lleno: se dispara lo que quepa del abanico

    // Ángulo simétrico respecto al centro del abanico (p.ej. 3 proyectiles → -12°/0°/+12°).
    const angle = (i - (count - 1) / 2) * PROJECTILE_FAN_ANGLE_STEP;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rDirX = dirX * cos - dirY * sin;
    const rDirY = dirX * sin + dirY * cos;

    slot.active = true;
    slot.kind = mode;
    slot.owner = 'hero';
    slot.position.x = hero.position.x;
    slot.position.y = hero.position.y;
    slot.velocity.x = rDirX * speed;
    slot.velocity.y = rDirY * speed;
    slot.ttl = PROJECTILE_LIFETIME;
    slot.hitEnemyIds.length = 0;
    // Siempre clásico: el slot puede venir reciclado de un disparo enemigo
    // con colorTag relleno (Prisma/Tormenta) — sin esto un proyectil del
    // héroe podría heredar el tinte de la bala enemiga que ocupaba antes ese
    // mismo slot del pool.
    slot.colorTag = '';

    if (mode === 'arrow') {
      slot.radius = PROJECTILE_RADIUS;
      slot.damage = ARROW_DAMAGE + hero.modifiers.arrowDamageBonus;
      slot.bouncesLeft = 0;
      slot.pierceLeft = ARROW_PIERCE_COUNT + hero.modifiers.arrowPierceBonus;
    } else {
      slot.radius =
        hero.modifiers.spellRadiusBonus > 0 ? SPELL_RADIUS_UPGRADED : PROJECTILE_RADIUS;
      slot.damage = SPELL_DAMAGE + hero.modifiers.spellDamageBonus;
      slot.bouncesLeft = SPELL_WALL_BOUNCES + hero.modifiers.spellBounceBonus;
      slot.pierceLeft = 0;
    }
    fired++;
  }

  if (fired === 0) return false;

  if (mode === 'arrow') {
    hero.lastArrowTime = world.time;
  } else {
    hero.lastSpellTime = world.time;
  }

  // Retroceso: empuja al héroe hacia atrás (dirección opuesta al disparo).
  // Uno solo por disparo, independientemente de cuántos proyectiles salieron.
  const recoil = PROJECTILE_RECOIL * (0.75 + force * 0.35);
  hero.velocity.x -= dirX * recoil;
  hero.velocity.y -= dirY * recoil;

  pushEvent(events, 'launch', hero.position.x, hero.position.y, force);
  return true;
}

/**
 * Dispara un proyectil hostil (Shooter, El Prisma, La Tormenta) hacia una
 * dirección unitaria dada. `bouncesLeft` (El Prisma, GDD §15.4, modo Sombra:
 * "arcos lentos que rebotan en las paredes"): por defecto 0 (comportamiento
 * intacto del Shooter, que nunca rebota); ver `stepEnemyProjectileCollision`
 * para el mecanismo de rebote en sí (mismo que el hechizo del héroe).
 * `colorTag` (rama `estilo-oscuro`, feedback playtest 2026-07-17): por
 * defecto '' (color clásico rojo, comportamiento intacto del Shooter, que no
 * rellena este campo); el Prisma/la Tormenta pasan la etiqueta de su ataque
 * activo — ver `Projectile.colorTag` (world/types.ts) para el contrato completo.
 */
export function fireEnemyProjectile(
  world: World,
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  speed: number,
  damage: number,
  radius: number,
  bouncesLeft = 0,
  colorTag = '',
): boolean {
  const slot = acquireProjectile(world);
  if (!slot) return false;
  slot.active = true;
  slot.kind = 'enemy';
  slot.owner = 'enemy';
  slot.position.x = originX;
  slot.position.y = originY;
  slot.velocity.x = dirX * speed;
  slot.velocity.y = dirY * speed;
  slot.radius = radius;
  slot.damage = damage;
  slot.ttl = PROJECTILE_LIFETIME;
  slot.bouncesLeft = bouncesLeft;
  slot.pierceLeft = 0;
  slot.hitEnemyIds.length = 0;
  slot.colorTag = colorTag;
  return true;
}

function deactivateProjectile(p: Projectile): void {
  p.active = false;
  p.velocity.x = 0;
  p.velocity.y = 0;
}

/**
 * Integra y resuelve todos los proyectiles activos un tick: movimiento, vida,
 * rebote de hechizo en pared/roca, colisión con enemigos (héroe) o con el
 * héroe (enemigo), y pierce de flecha.
 */
export function stepProjectiles(world: World, dt: number, events: EventQueue): void {
  const pool = world.projectiles;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    if (!p.active) continue;

    p.position.x += p.velocity.x * dt;
    p.position.y += p.velocity.y * dt;
    p.ttl -= dt;
    if (p.ttl <= 0) {
      deactivateProjectile(p);
      continue;
    }

    if (p.owner === 'hero') {
      if (!stepHeroProjectileCollisions(world, p, events)) continue;
    } else {
      if (!stepEnemyProjectileCollision(world, p, events)) continue;
    }
  }
}

/** Devuelve false si el proyectil se desactivó dentro de esta función. */
function stepHeroProjectileCollisions(world: World, p: Projectile, events: EventQueue): boolean {
  // Paredes/rocas: la flecha se detiene, el hechizo rebota (con presupuesto de rebotes).
  // Mazmorra multi-sala: los muros ya son obstáculos AABB (con hueco de puerta
  // abierta); `world.bounds` (sala actual) se omite para no frenar el
  // proyectil al cruzar un hueco hacia la sala contigua.
  const hitBounds = world.dungeon === null && collideInnerBounds(p.position, p.velocity, p.radius, world.bounds, null);
  let hitObstacle = false;
  const obstacles = world.obstacles;
  for (let j = 0; j < obstacles.length; j++) {
    if (collideCircleAabb(p.position, p.velocity, p.radius, obstacles[j].aabb, null)) {
      hitObstacle = true;
      break;
    }
  }

  if (hitBounds || hitObstacle) {
    // Playtest 2026-07-16 ("las flechas no tienen efecto al chocar con las
    // paredes"): un único punto de emisión para AMBAS armas, se rebote o se
    // apague — antes solo el hechizo emitía 'wall-bounce' (y solo mientras le
    // quedaba presupuesto de rebote), así que la flecha no tenía feedback
    // alguno y el último rebote del hechizo (el que agota `bouncesLeft`)
    // tampoco. label = arma, para colorear el burst en reactToEvent.ts.
    pushEvent(events, 'projectile-wall', p.position.x, p.position.y, 1, p.kind);
    if (p.kind === 'spell' && p.bouncesLeft > 0) {
      p.bouncesLeft--;
      p.velocity.x *= SPELL_BOUNCE_FACTOR;
      p.velocity.y *= SPELL_BOUNCE_FACTOR;
      p.ttl -= 0.4;
    } else {
      deactivateProjectile(p);
      return false;
    }
  }

  // Colisión contra enemigos.
  const enemies = world.enemies;
  for (let j = 0; j < enemies.length; j++) {
    const enemy = enemies[j];
    if (enemy.hp <= 0) continue;
    if (p.hitEnemyIds.indexOf(enemy.id) !== -1) continue;
    const dx = enemy.position.x - p.position.x;
    const dy = enemy.position.y - p.position.y;
    const rr = enemy.radius + p.radius;
    if (dx * dx + dy * dy > rr * rr) continue;

    // Spike (GDD §7.3): las púas del Penitente protegen del CONTACTO CUERPO A
    // CUERPO (embestir su arco trasero sigue dañando al héroe, ver
    // `isSpikeContactDangerous` en `stepHeroEnemyContacts`), pero no detienen
    // un proyectil. Playtest 2026-07-26 (David: "no le afectan los
    // proyectiles por la espalda y debería") revierte la extensión del
    // 2026-07-20 que también inmunizaba al spike frente a flecha/hechizo por
    // detrás: un disparo por la espalda es un premio a la buena posición del
    // jugador, no algo que castigar. Daño siempre, desde cualquier ángulo.
    applyDamageToEnemy(world, enemy, p.damage, p.velocity.x, p.velocity.y, events, false, p.kind === 'arrow' ? 'arrow' : 'spell');
    p.hitEnemyIds.push(enemy.id);

    if (p.kind === 'arrow') {
      if (p.pierceLeft > 0) {
        p.pierceLeft--;
      } else {
        deactivateProjectile(p);
        return false;
      }
    } else {
      deactivateProjectile(p);
      return false;
    }
  }
  return true;
}

function stepEnemyProjectileCollision(world: World, p: Projectile, events: EventQueue): boolean {
  const hero = world.hero;
  const dx = hero.position.x - p.position.x;
  const dy = hero.position.y - p.position.y;
  const rr = hero.radius + p.radius;
  if (dx * dx + dy * dy <= rr * rr) {
    applyDamageToHero(world, p.damage, events);
    deactivateProjectile(p);
    return false;
  }
  // Paredes/rocas: la mayoría de proyectiles enemigos desaparecen sin rebote
  // (Shooter, comportamiento intacto), salvo que traigan `bouncesLeft > 0`
  // (El Prisma, GDD §15.4, modo Sombra: "arcos lentos que rebotan en las
  // paredes") — mismo mecanismo que el hechizo del héroe en
  // `stepHeroProjectileCollisions` (reflexión ya resuelta por
  // collideInnerBounds/collideCircleAabb, más el amortiguado extra de
  // SPELL_BOUNCE_FACTOR). Ver nota de multi-sala en stepHeroProjectileCollisions.
  const hitBounds = world.dungeon === null && collideInnerBounds(p.position, p.velocity, p.radius, world.bounds, null);
  let hitObstacle = false;
  const obstacles = world.obstacles;
  for (let j = 0; j < obstacles.length; j++) {
    if (collideCircleAabb(p.position, p.velocity, p.radius, obstacles[j].aabb, null)) {
      hitObstacle = true;
      break;
    }
  }
  if (hitBounds || hitObstacle) {
    if (p.bouncesLeft > 0) {
      p.bouncesLeft--;
      p.velocity.x *= SPELL_BOUNCE_FACTOR;
      p.velocity.y *= SPELL_BOUNCE_FACTOR;
      p.ttl -= 0.4;
      pushEvent(events, 'wall-bounce', p.position.x, p.position.y, 1);
    } else {
      deactivateProjectile(p);
      return false;
    }
  }
  return true;
}

// ── Daño y knockback ───────────────────────────────────────────────────────

/**
 * Arma/fuente que causó el daño (El Prisma, GDD §15.4, Fase B3): 'other' cubre
 * cualquier daño que no sea un arma del héroe (barriles, pinchos, fosos...) —
 * esas fuentes NO son gateables por color, ver `applyDamageToEnemy`. Tipo
 * plano en `features/combat/combat.ts` a propósito (no en `features/bosses/`):
 * mantiene el combate ajeno a la tabla de jefes, mismo criterio que
 * `bossDamageOutsideWindowFactor`.
 */
export type DamageSource = 'ram' | 'arrow' | 'spell' | 'other';

/**
 * Aplica daño a un enemigo, knockback en la dirección del impacto y flash.
 * Marca muerte con hp<=0.
 *
 * Regla de ventana de jefe (GDD §15.1 punto 4, Fase B0): si `enemy.kind ===
 * 'boss'` y no está en su ventana de vulnerabilidad (`bossVulnerable`), el
 * daño recibido se escala por `bossDamageOutsideWindowFactor` (0 = inmune),
 * leído como escalar plano del propio Enemy — mantiene esta función y todo
 * `features/combat/combat.ts` ajenos a `features/bosses/registry.ts` (evita un ciclo de imports;
 * ver nota de diseño en `features/bosses/lifecycle.ts`).
 *
 * Gate de color (El Prisma, GDD §15.4, Fase B3): si `enemy.bossWeaponGateA`
 * no es '', solo el arma de ese color (o de `bossWeaponGateB`, el solape de
 * fase 3) hace daño de verdad — cualquier otra ARMA (nunca 'other': un barril
 * no es un arma y pasa el gate igual que siempre) rebota sin efecto y emite
 * 'boss-immune-hit' en vez de bajar HP. Acertar cualquiera de los dos colores
 * del solape de fase 3 hace daño NORMAL (el ×2 se retiró en playtest
 * 2026-07-17: "siempre con el daño normal"). Se comprueba ANTES que la
 * ventana de vulnerabilidad: un gate equivocado nunca debería "colarse" solo
 * por pillar al jefe fuera de ventana.
 *
 * `ignoreVulnerabilityWindow` (GDD §15.2, playtest 2026-07-06): el Guardián
 * arrollando su propio barril rodante es "su castigo" por cargar a ciegas —
 * el daño se aplica SIEMPRE, incluso fuera de ventana. Únicamente
 * `features/bosses/guardian/pattern.ts::guardianStepPattern` lo usa; por defecto false
 * (comportamiento existente intacto para el resto de llamadores).
 *
 * Guardián (playtest 2026-07-10): su `bossDamageOutsideWindowFactor` es 0.2
 * (no 0 como Reina/test), así que fuera de ventana recibe el 20% del daño del
 * ARMA — apenas hace daño, pero las mejoras de arma siguen escalando. El
 * escalado NO se redondea (ver abajo) para no anular armas diminutas.
 */
export function applyDamageToEnemy(
  world: World,
  enemy: Enemy,
  damage: number,
  impulseX: number,
  impulseY: number,
  events: EventQueue,
  ignoreVulnerabilityWindow = false,
  source: DamageSource = 'other',
): void {
  if (enemy.hp <= 0) return;
  if (enemy.kind === 'boss' && enemy.roomId !== undefined && world.currentRoomId !== enemy.roomId) {
    // Contención por sala (bug playtest 2026-07-14): la IA del jefe ya no
    // actúa si el héroe no está en su sala (`bosses/lifecycle.ts::stepBosses`),
    // pero el daño SÍ entraba igual con la puerta abierta — se podía disparar
    // flecha/hechizo/embestida o hacer estallar un barril desde la sala
    // contigua sin cruzar la puerta. Punto único de daño boss-aware: bloquea
    // CUALQUIER fuente aquí para cubrir los cuatro casos de una vez. No afecta
    // a enemigos normales ni a mundos de un sola sala (roomId sin definir).
    return;
  }
  if (enemy.kind === 'boss' && enemy.bossWeaponGateA !== '') {
    const matchesGate = source === enemy.bossWeaponGateA || source === enemy.bossWeaponGateB;
    if (source !== 'other' && !matchesGate) {
      pushEvent(events, 'boss-immune-hit', enemy.position.x, enemy.position.y, 1);
      return;
    }
    // Sin bonus por solape de fase 3 (playtest 2026-07-17: "solo le afectan
    // los ataques de su color, pero SIEMPRE con el daño normal"): acertar
    // cualquiera de los dos colores válidos hace daño normal, nunca doble.
  }
  if (enemy.kind === 'boss' && !enemy.bossVulnerable && !ignoreVulnerabilityWindow) {
    // Fuera de ventana el daño del ARMA se escala por el factor del jefe. Sin
    // Math.floor a propósito (Guardián, playtest 2026-07-10: factor 0.2 sobre
    // armas diminutas —flecha=1, hechizo=2— redondearía a 0 y lo haría parecer
    // inmune; el chip fraccionario "apenas hace daño pero se nota si mejoras el
    // arma"). Reina/test usan factor 0 → sigue siendo inmune fuera de ventana.
    damage = damage * enemy.bossDamageOutsideWindowFactor;
    if (damage <= 0) return;
  }
  enemy.hp -= damage;
  world.stats.damageDealt += damage;
  world.stats.score += damage;
  enemy.hitFlashUntil = world.time + ENEMY_HIT_FLASH_DURATION;

  const impulseLen = Math.sqrt(impulseX * impulseX + impulseY * impulseY);
  if (impulseLen > 1e-6) {
    const nx = impulseX / impulseLen;
    const ny = impulseY / impulseLen;
    enemy.velocity.x = nx * ENEMY_KNOCKBACK_SPEED;
    enemy.velocity.y = ny * ENEMY_KNOCKBACK_SPEED;
    enemy.position.x += nx * ENEMY_KNOCKBACK_OFFSET;
    enemy.position.y += ny * ENEMY_KNOCKBACK_OFFSET;
    // Breve ventana en la que el knockback controla el movimiento (la IA no lo sobreescribe).
    enemy.knockbackUntil = world.time + 0.15;
  }

  pushEvent(events, enemy.kind === 'boss' ? 'boss-hit' : 'enemy-hit', enemy.position.x, enemy.position.y, damage);

  if (enemy.hp <= 0) {
    pushEvent(events, 'enemy-died', enemy.position.x, enemy.position.y, 1);
  }
}

/**
 * Punto centralizado del retroceso RECIBIDO por el héroe al ser dañado
 * (contacto de enemigo, golpes de jefe, hazards que empujan —
 * docs/plans/ECONOMY_PLAN.md F2, Canto Rodado): fija la velocidad del héroe
 * al vector (vx,vy) escalado por `knockbackTakenMultiplier` (1 = normal, más
 * bajo = menos empuje). NO es para el retroceso de disparar (`fireProjectile`
 * empuja al propio héroe hacia atrás por su propia acción, no por daño
 * recibido, y no pasa por aquí).
 */
export function applyKnockbackToHero(world: World, vx: number, vy: number): void {
  const hero = world.hero;
  const mult = hero.modifiers.knockbackTakenMultiplier;
  hero.velocity.x = vx * mult;
  hero.velocity.y = vy * mult;
}

/**
 * Aplica daño al héroe respetando escudo e i-frames. Si el escudo tiene
 * cargas, bloquea el golpe por completo y consume una carga (con i-frames
 * cortos propios); si no, resta HP y activa i-frames largos.
 * Devuelve true si el golpe se resolvió como muerte (hp llega a 0).
 *
 * Modo dios de playtest (`world.godMode`, ?godmode): el daño se aplica
 * SIEMPRE igual que en modo normal (hp baja, i-frames, evento
 * 'player-damaged' — el objetivo es ver cuánto quita cada ataque). Solo
 * cambia la resolución de "hp llega a 0": en vez de fijar hp en 0 y pasar a
 * 'game-over', revive a maxHp y la partida sigue (nunca se resuelve como
 * muerte, devuelve false igual que un golpe no letal — así el knockback del
 * llamador, ej. embestidas de jefe, se sigue aplicando con normalidad).
 */
export function applyDamageToHero(world: World, damage: number, events: EventQueue): boolean {
  const hero = world.hero;
  if (world.time < hero.invulnerableUntil) return false;

  if (hero.modifiers.shieldCharges > 0) {
    hero.modifiers.shieldCharges--;
    hero.invulnerableUntil = world.time + SHIELD_IFRAME_DURATION;
    pushEvent(events, 'shield-block', hero.position.x, hero.position.y, 1);
    return false;
  }

  hero.hp -= damage;
  hero.invulnerableUntil = world.time + HERO_IFRAME_DURATION;
  pushEvent(events, 'player-damaged', hero.position.x, hero.position.y, damage);

  if (hero.hp <= 0) {
    if (world.godMode) {
      hero.hp = hero.maxHp;
      pushEvent(events, 'godmode-revive', hero.position.x, hero.position.y, 1);
      return false;
    }
    hero.hp = 0;
    world.phase = 'game-over';
    pushEvent(events, 'player-died', hero.position.x, hero.position.y, 1);
    return true;
  }
  return false;
}

/**
 * Daño por embestida del héroe contra un enemigo (GDD §6): solo si la
 * velocidad de impacto supera el umbral; daño = base + bono·velocidad
 * (mínimo 1). Devuelve el daño aplicado (0 si no embistió).
 */
export function ramDamage(speed: number, ramDamageBonus: number): number {
  if (speed < RAM_SPEED_THRESHOLD) return 0;
  const raw = RAM_DAMAGE_BASE + ramDamageBonus + Math.floor(speed * RAM_DAMAGE_PER_SPEED);
  return Math.max(1, raw);
}

/**
 * Resuelve embestidas del héroe contra todos los enemigos con los que
 * solape este tick. Aplica daño por velocidad y, si no embistió, daño de
 * contacto recibido con su propio cooldown por enemigo.
 */
export function stepHeroEnemyContacts(
  world: World,
  contactCooldowns: Map<string, number>,
  events: EventQueue,
): void {
  const hero = world.hero;
  const speed = Math.hypot(hero.velocity.x, hero.velocity.y);
  const dmg = ramDamage(speed, hero.modifiers.ramDamageBonus);

  for (let i = 0; i < world.enemies.length; i++) {
    const enemy = world.enemies[i];
    if (enemy.hp <= 0) continue;
    const dx = enemy.position.x - hero.position.x;
    const dy = enemy.position.y - hero.position.y;
    const rr = enemy.radius + hero.radius;
    const distSq = dx * dx + dy * dy;
    if (distSq > rr * rr) continue;

    // Spike (GDD §7.3, mecánica invertida 2026-07-20 — David: "que si le
    // atacas por detrás te pinche; solo se le podrá hacer daño por delante"):
    // tocar su ARCO TRASERO (espalda, opuesto al ojo/`facing`) daña al HÉROE
    // aunque llegue embistiendo; delante o por los flancos recibe daño con
    // normalidad (cae al bloque `dmg > 0` de abajo, igual que cualquier otro
    // enemigo). `isSpikeContactDangerous` ya encapsula el umbral invertido.
    if (
      enemy.kind === 'spike' &&
      isSpikeContactDangerous(
        hero.position.x,
        hero.position.y,
        enemy.position.x,
        enemy.position.y,
        enemy.facing.x,
        enemy.facing.y,
      )
    ) {
      const lastSpike = contactCooldowns.get(enemy.id) ?? -Infinity;
      if (world.time - lastSpike >= CONTACT_DAMAGE_COOLDOWN) {
        contactCooldowns.set(enemy.id, world.time);
        applyDamageToHero(world, CONTACT_DAMAGE, events);
      }
      // Rebote del héroe contra la púa (empuje hacia fuera). Es una reflexión
      // de la velocidad actual, no un vector de knockback fijo, así que no
      // pasa por `applyKnockbackToHero` (pensado para asignación absoluta);
      // aun así respeta `knockbackTakenMultiplier` escalando el empuje añadido.
      const dist = Math.sqrt(distSq) || 1;
      const nx = dx / dist;
      const ny = dy / dist;
      const vn = hero.velocity.x * nx + hero.velocity.y * ny;
      if (vn > 0) {
        const mult = hero.modifiers.knockbackTakenMultiplier;
        hero.velocity.x -= 1.6 * vn * nx * mult;
        hero.velocity.y -= 1.6 * vn * ny * mult;
      }
      continue;
    }

    if (dmg > 0) {
      applyDamageToEnemy(world, enemy, dmg, dx, dy, events, false, 'ram');
      // Rebote suave del héroe al embestir (conserva parte de la tangencial vía physics ya aplicado
      // en pared; aquí solo invertimos la componente normal como un choque elástico ligero).
      const dist = Math.sqrt(distSq) || 1;
      const nx = dx / dist;
      const ny = dy / dist;
      const vn = hero.velocity.x * nx + hero.velocity.y * ny;
      if (vn > 0) {
        hero.velocity.x -= vn * nx;
        hero.velocity.y -= vn * ny;
      }
    } else {
      const lastTick = contactCooldowns.get(enemy.id) ?? -Infinity;
      if (world.time - lastTick >= CONTACT_DAMAGE_COOLDOWN) {
        contactCooldowns.set(enemy.id, world.time);
        applyDamageToHero(world, CONTACT_DAMAGE, events);
      }
    }
  }
}

/**
 * Spike (GDD §7.3, mecánica invertida 2026-07-20 — ver comentario en
 * `stepHeroEnemyContacts`): determina si un contacto (o un impacto de
 * proyectil, ver `stepHeroProjectileCollisions`) es "peligroso" — ahora la
 * cara peligrosa es la ESPALDA (arco trasero, opuesto al ojo/`facing`), no
 * la púa — usando el producto escalar entre la dirección spike→origen del
 * contacto y la normal `facing` del enemigo. Trasero (peligroso) si
 * dot < -umbral; delante y flancos (incluido el propio umbral, dot=0) no lo
 * son. Mismo umbral angular que antes (`SPIKE_DANGEROUS_DOT_THRESHOLD`),
 * solo se invierte el signo de la comparación.
 */
export function isSpikeContactDangerous(
  originX: number,
  originY: number,
  spikeX: number,
  spikeY: number,
  facingX: number,
  facingY: number,
): boolean {
  const dx = originX - spikeX;
  const dy = originY - spikeY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return false;
  const dot = (dx / len) * facingX + (dy / len) * facingY;
  return dot < -SPIKE_DANGEROUS_DOT_THRESHOLD;
}

// ── Selección de modo de arma / disparo genérico ──────────────────────────

/** Cambia el modo de arma activo del héroe (selector del GDD §5). */
export function setWeaponMode(hero: Hero, mode: Hero['weaponMode']): void {
  hero.weaponMode = mode;
}

/**
 * Punto de entrada único de "soltar el gesto de tirachinas": según el modo
 * activo, lanza el cuerpo (BODY_LAUNCH_COOLDOWN vía launchHero, importado por
 * el llamador) o dispara un proyectil. Esta función solo cubre el caso
 * proyectil; el cuerpo se resuelve con features/hero/launch.ts (ya existente).
 */
export function resolveWeaponRelease(
  world: World,
  dirX: number,
  dirY: number,
  force: number,
  events: EventQueue,
): boolean {
  const mode = world.hero.weaponMode;
  if (mode === 'arrow' || mode === 'spell') {
    return fireProjectile(world, mode, dirX, dirY, force, events);
  }
  return false;
}

/** Reexportado por conveniencia para quien solo necesite el cooldown corporal. */
export const BODY_COOLDOWN = BODY_LAUNCH_COOLDOWN;
export type { ProjectileOwner };
