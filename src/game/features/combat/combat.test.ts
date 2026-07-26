/**
 * Tests de combate (GDD §5-6): fórmula de embestida, i-frames, cooldown de
 * contacto, escudo, pierce de flecha, rebote de hechizo y muerte del héroe.
 */

import { describe, expect, it } from 'vitest';
import { ARROW_DAMAGE, ARROW_PIERCE_COUNT, CONTACT_DAMAGE_COOLDOWN, ENEMY_KNOCKBACK_SPEED, HERO_IFRAME_DURATION, PROJECTILE_FAN_ANGLE_STEP, RAM_SPEED_THRESHOLD, SHIELD_IFRAME_DURATION, SPELL_WALL_BOUNCES } from './constants';
import { MAX_SPEED } from '@/engine/physics';
import { applyDamageToEnemy, applyDamageToHero, applyKnockbackToHero, fireEnemyProjectile, fireProjectile, isSpikeContactDangerous, ramDamage, stepHeroEnemyContacts, stepProjectiles } from './combat';
import { createEventQueue, drainEvents, type GameEvent } from '@/engine/events';
import { createWorld } from '@/game/world/create';
import type { EnemySpawn, RoomData, World } from '@/game/world/types';

function makeRoom(partial: Partial<RoomData> = {}): RoomData {
  return {
    version: 1,
    id: 'combat-room',
    name: 'Combat',
    width: 30,
    height: 30,
    playerStart: { x: 0, y: 0 },
    tags: ['combate'],
    doorSlots: [],
    enemies: [],
    hazards: [],
    items: [],
    ...partial,
  };
}

function makeWorld(enemies: EnemySpawn[] = []): World {
  return createWorld(makeRoom({ enemies }));
}

const FIXED_DT = 1 / 60;

describe('ramDamage (fórmula de embestida)', () => {
  it('no daña por debajo del umbral de 2.5 u/s', () => {
    expect(ramDamage(0, 0)).toBe(0);
    expect(ramDamage(2.49, 0)).toBe(0);
  });

  it('daño = 1 + floor(vel × 0.32) a partir del umbral', () => {
    expect(ramDamage(RAM_SPEED_THRESHOLD, 0)).toBe(1); // 1 + floor(0.8) = 1
    expect(ramDamage(7.5, 0)).toBe(3); // 1 + floor(2.4) = 3
    expect(ramDamage(MAX_SPEED, 0)).toBe(5); // 1 + floor(4.32) = 5
  });

  it('escala con el bono de Impacto Pesado y nunca baja de 1', () => {
    expect(ramDamage(2.5, 2)).toBe(3);
    expect(ramDamage(2.5, -5)).toBe(1); // clamp mínimo
  });
});

describe('i-frames del héroe', () => {
  it('bloquea daño durante 0.7 s tras un golpe', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    expect(applyDamageToHero(world, 1, events)).toBe(false);
    expect(world.hero.hp).toBe(4);
    expect(world.hero.invulnerableUntil).toBeCloseTo(world.time + HERO_IFRAME_DURATION, 9);

    // Segundo golpe inmediato: sin efecto.
    applyDamageToHero(world, 1, events);
    expect(world.hero.hp).toBe(4);

    // Tras expirar los i-frames vuelve a recibir daño.
    world.time += HERO_IFRAME_DURATION + 0.01;
    applyDamageToHero(world, 1, events);
    expect(world.hero.hp).toBe(3);
  });

  it('a 0 HP pasa a fase game-over y emite player-died', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    world.hero.hp = 1;
    expect(applyDamageToHero(world, 1, events)).toBe(true);
    expect(world.hero.hp).toBe(0);
    expect(world.phase).toBe('game-over');

    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).toContain('player-died');
  });
});

describe('modo dios de playtest (world.godMode, ?godmode)', () => {
  it('a 0 hp revive a maxHp, NO pasa a game-over y emite godmode-revive', () => {
    const world = makeWorld();
    world.godMode = true;
    const events = createEventQueue(16);
    world.hero.hp = 1;

    expect(applyDamageToHero(world, 1, events)).toBe(false); // no se resuelve como muerte
    expect(world.hero.hp).toBe(world.hero.maxHp);
    expect(world.phase).not.toBe('game-over');
    expect(world.phase).toBe('playing');

    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).toContain('godmode-revive');
    expect(types).not.toContain('player-died');
  });

  it('con el flag apagado (por defecto) el mismo golpe letal sigue siendo game-over', () => {
    const world = makeWorld();
    expect(world.godMode).toBe(false);
    const events = createEventQueue(16);
    world.hero.hp = 1;

    expect(applyDamageToHero(world, 1, events)).toBe(true);
    expect(world.hero.hp).toBe(0);
    expect(world.phase).toBe('game-over');
  });

  it('daño no letal se aplica exactamente igual con el flag activo (feedback intacto)', () => {
    const world = makeWorld();
    world.godMode = true;
    const events = createEventQueue(16);

    expect(applyDamageToHero(world, 2, events)).toBe(false);
    expect(world.hero.hp).toBe(world.hero.maxHp - 2);
    expect(world.phase).toBe('playing');
  });
});

describe('escudo (cargas)', () => {
  it('bloquea el golpe por completo, consume una carga y da i-frames cortos', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    world.hero.modifiers.shieldCharges = 1;

    applyDamageToHero(world, 3, events);
    expect(world.hero.hp).toBe(5); // sin daño
    expect(world.hero.modifiers.shieldCharges).toBe(0);
    expect(world.hero.invulnerableUntil).toBeCloseTo(world.time + SHIELD_IFRAME_DURATION, 9);

    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).toContain('shield-block');
  });
});

describe('contacto héroe↔enemigo', () => {
  it('embestida por encima del umbral daña al enemigo con knockback y flash', () => {
    const world = makeWorld([{ id: 'e1', kind: 'chaser', position: { x: 0.5, y: 0 } }]);
    const events = createEventQueue(16);
    const enemy = world.enemies[0];
    const hpBefore = enemy.hp;
    world.hero.velocity.x = 7.5;

    stepHeroEnemyContacts(world, world.contactDamageCooldowns, events);

    expect(enemy.hp).toBe(hpBefore - 3); // ramDamage(7.5) = 3
    expect(enemy.velocity.x).toBeCloseTo(ENEMY_KNOCKBACK_SPEED, 6); // empujado en +x
    expect(enemy.hitFlashUntil).toBeGreaterThan(world.time);
    expect(world.hero.hp).toBe(5); // el héroe no recibe daño al embestir
  });

  it('contacto lento daña al héroe con cooldown de 0.42 s por enemigo', () => {
    const world = makeWorld([{ id: 'e1', kind: 'dummy', position: { x: 0.5, y: 0 } }]);
    const events = createEventQueue(16);
    // Quieto: velocidad 0 < umbral de embestida.
    stepHeroEnemyContacts(world, world.contactDamageCooldowns, events);
    expect(world.hero.hp).toBe(4);

    // Anulamos los i-frames para aislar el cooldown por enemigo.
    world.hero.invulnerableUntil = 0;
    world.time += CONTACT_DAMAGE_COOLDOWN / 2;
    stepHeroEnemyContacts(world, world.contactDamageCooldowns, events);
    expect(world.hero.hp).toBe(4); // dentro del cooldown: sin tick de daño

    world.time += CONTACT_DAMAGE_COOLDOWN;
    stepHeroEnemyContacts(world, world.contactDamageCooldowns, events);
    expect(world.hero.hp).toBe(3);
  });
});

describe('Spike: púa direccional en contacto (mecánica invertida 2026-07-20: pincha por detrás, solo se daña por delante)', () => {
  it('isSpikeContactDangerous distingue espalda (dot < -0.25, peligrosa) de frente/flancos (vulnerables)', () => {
    // Púa/ojo apuntando a +y; origen del contacto al norte del spike (lado de
    // la púa, `facing`) → YA NO peligroso (ahora es el lado vulnerable).
    expect(isSpikeContactDangerous(0, 1, 0, 0, 0, 1)).toBe(false);
    // Origen al sur (arco trasero, opuesto a `facing`) → peligroso.
    expect(isSpikeContactDangerous(0, -1, 0, 0, 0, 1)).toBe(true);
    // Flanco exacto (dot = 0) → no peligroso, igual que antes.
    expect(isSpikeContactDangerous(1, 0, 0, 0, 0, 1)).toBe(false);
  });

  it('embestir de frente (lado de la púa/ojo) daña al Spike y no al héroe', () => {
    const world = makeWorld([
      { id: 's1', kind: 'spike', position: { x: 0, y: -0.5 }, facing: { x: 0, y: 1 } },
    ]);
    const events = createEventQueue(16);
    const spike = world.enemies[0];
    const hpBefore = spike.hp;
    world.hero.velocity.y = -7.5; // embiste hacia el norte, contra la cara de la púa (delante)

    stepHeroEnemyContacts(world, world.contactDamageCooldowns, events);

    expect(spike.hp).toBe(hpBefore - 3); // ramDamage(7.5) = 3
    expect(world.hero.hp).toBe(5); // el héroe no recibe daño por delante
  });

  it('embestir por la espalda (arco trasero) pincha al héroe y no daña al Spike', () => {
    const world = makeWorld([
      { id: 's1', kind: 'spike', position: { x: 0, y: 0.5 }, facing: { x: 0, y: 1 } },
    ]);
    const events = createEventQueue(16);
    const spike = world.enemies[0];
    const hpBefore = spike.hp;
    world.hero.velocity.y = 7.5; // llega desde el norte, contra el arco trasero (espalda)

    stepHeroEnemyContacts(world, world.contactDamageCooldowns, events);

    expect(world.hero.hp).toBe(4); // el héroe recibe 1 al pincharse por detrás
    expect(spike.hp).toBe(hpBefore); // el spike es inmune por la espalda
  });
});

describe('Spike: los proyectiles dañan desde cualquier ángulo (playtest 2026-07-26)', () => {
  it('una flecha que impacta por delante (lado de la púa/ojo) daña al Spike con normalidad', () => {
    const world = makeWorld([
      { id: 's1', kind: 'spike', position: { x: 0, y: -0.5 }, facing: { x: 0, y: 1 } },
    ]);
    const events = createEventQueue(32);
    const spike = world.enemies[0];
    const hpBefore = spike.hp;

    expect(fireProjectile(world, 'arrow', 0, -1, 1, events)).toBe(true);
    const arrow = world.projectiles.find((p) => p.active);
    expect(arrow).toBeDefined();
    for (let i = 0; i < 120 && arrow!.active; i++) {
      stepProjectiles(world, FIXED_DT, events);
    }

    expect(spike.hp).toBe(hpBefore - ARROW_DAMAGE);
  });

  it('una flecha que impacta por la espalda (arco trasero) SÍ daña al Spike (revierte la inmunidad de 2026-07-20: "no le afectan los proyectiles por la espalda y debería")', () => {
    const world = makeWorld([
      { id: 's1', kind: 'spike', position: { x: 0, y: 0.5 }, facing: { x: 0, y: 1 } },
    ]);
    const events = createEventQueue(32);
    const spike = world.enemies[0];
    const hpBefore = spike.hp;

    expect(fireProjectile(world, 'arrow', 0, 1, 1, events)).toBe(true);
    const arrow = world.projectiles.find((p) => p.active);
    expect(arrow).toBeDefined();
    for (let i = 0; i < 120 && arrow!.active; i++) {
      stepProjectiles(world, FIXED_DT, events);
    }

    expect(spike.hp).toBe(hpBefore - ARROW_DAMAGE); // ya no es inmune por la espalda: el proyectil premia la buena posición
  });

  it('el contacto cuerpo a cuerpo por detrás SIGUE pinchando al héroe (esta parte de la mecánica no cambia)', () => {
    const world = makeWorld([
      { id: 's1', kind: 'spike', position: { x: 0, y: 0.5 }, facing: { x: 0, y: 1 } },
    ]);
    const events = createEventQueue(16);
    const spike = world.enemies[0];
    const hpBefore = spike.hp;
    world.hero.velocity.y = 7.5; // llega desde el norte, contra el arco trasero (espalda)

    stepHeroEnemyContacts(world, world.contactDamageCooldowns, events);

    expect(world.hero.hp).toBe(4); // el héroe recibe 1 al pincharse por detrás
    expect(spike.hp).toBe(hpBefore); // el contacto cuerpo a cuerpo sigue siendo inofensivo por la espalda
  });
});

describe('flecha: pierce', () => {
  it('atraviesa 1 enemigo y se detiene en el segundo; el tercero queda intacto', () => {
    const world = makeWorld([
      { id: 'e1', kind: 'chaser', position: { x: 2, y: 0 } },
      { id: 'e2', kind: 'chaser', position: { x: 4, y: 0 } },
      { id: 'e3', kind: 'chaser', position: { x: 6, y: 0 } },
    ]);
    const events = createEventQueue(64);
    expect(ARROW_PIERCE_COUNT).toBe(1);

    expect(fireProjectile(world, 'arrow', 1, 0, 1, events)).toBe(true);
    const arrow = world.projectiles.find((p) => p.active);
    expect(arrow).toBeDefined();

    for (let i = 0; i < 120 && arrow!.active; i++) {
      stepProjectiles(world, FIXED_DT, events);
    }

    expect(world.enemies[0].hp).toBe(2); // 3 − 1
    expect(world.enemies[1].hp).toBe(2); // 3 − 1 (se detiene aquí)
    expect(world.enemies[2].hp).toBe(3); // intacto
    expect(arrow!.active).toBe(false);
  });
});

describe('hechizo: rebote en pared', () => {
  it('rebota una vez perdiendo fuerza y acortando vida; el segundo choque lo apaga', () => {
    const world = createWorld(makeRoom({ width: 10, height: 10 }));
    const events = createEventQueue(64);
    expect(SPELL_WALL_BOUNCES).toBe(1);

    expect(fireProjectile(world, 'spell', 1, 0, 1, events)).toBe(true);
    const spell = world.projectiles.find((p) => p.active);
    expect(spell).toBeDefined();
    const speedBefore = Math.abs(spell!.velocity.x);
    const ttlBefore = spell!.ttl;

    // Avanza hasta el primer rebote contra la pared este.
    let bounced = false;
    for (let i = 0; i < 300 && !bounced; i++) {
      stepProjectiles(world, FIXED_DT, events);
      if (spell!.active && spell!.velocity.x < 0) bounced = true;
    }

    expect(bounced).toBe(true);
    expect(spell!.active).toBe(true);
    expect(spell!.bouncesLeft).toBe(0);
    expect(Math.abs(spell!.velocity.x)).toBeLessThan(speedBefore); // pierde fuerza
    expect(spell!.ttl).toBeLessThan(ttlBefore - 0.3); // vida acortada por el rebote

    // Playtest 2026-07-16: el primer rebote ya emite 'projectile-wall' (arma =
    // hechizo), no solo el 'wall-bounce' genérico.
    const firstBounceTypes: string[] = [];
    const firstBounceLabels: string[] = [];
    drainEvents(events, (e: GameEvent) => {
      firstBounceTypes.push(e.type);
      if (e.type === 'projectile-wall') firstBounceLabels.push(e.label);
    });
    expect(firstBounceTypes).toContain('projectile-wall');
    expect(firstBounceLabels).toContain('spell');

    // Segundo choque contra la pared oeste: desaparece, y también emite
    // 'projectile-wall' (antes este último impacto no tenía NINGÚN feedback).
    for (let i = 0; i < 600 && spell!.active; i++) {
      stepProjectiles(world, FIXED_DT, events);
    }
    expect(spell!.active).toBe(false);
    const secondBounceTypes: string[] = [];
    drainEvents(events, (e: GameEvent) => secondBounceTypes.push(e.type));
    expect(secondBounceTypes).toContain('projectile-wall');
  });
});

describe('flecha: impacto contra muro (playtest 2026-07-16)', () => {
  it('al chocar con la pared se apaga y emite projectile-wall con label "arrow"', () => {
    const world = createWorld(makeRoom({ width: 10, height: 10 }));
    const events = createEventQueue(64);

    expect(fireProjectile(world, 'arrow', 1, 0, 1, events)).toBe(true);
    const arrow = world.projectiles.find((p) => p.active);
    expect(arrow).toBeDefined();
    drainEvents(events, () => {}); // descarta el evento 'launch' del disparo

    for (let i = 0; i < 300 && arrow!.active; i++) {
      stepProjectiles(world, FIXED_DT, events);
    }
    expect(arrow!.active).toBe(false); // la flecha nunca rebota, se apaga contra la pared

    const types: string[] = [];
    const labels: string[] = [];
    drainEvents(events, (e: GameEvent) => {
      types.push(e.type);
      if (e.type === 'projectile-wall') labels.push(e.label);
    });
    expect(types).toContain('projectile-wall');
    expect(labels).toEqual(['arrow']);
  });
});

describe('retroceso de proyectil', () => {
  it('disparar empuja al héroe hacia atrás', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    fireProjectile(world, 'arrow', 1, 0, 1, events);
    expect(world.hero.velocity.x).toBeLessThan(0); // dispara a +x, retrocede a −x
  });
});

describe('cooldowns de armas', () => {
  it('respeta el cooldown de la flecha (0.5 s)', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    expect(fireProjectile(world, 'arrow', 1, 0, 1, events)).toBe(true);
    expect(fireProjectile(world, 'arrow', 1, 0, 1, events)).toBe(false);

    world.time += 0.51;
    expect(fireProjectile(world, 'arrow', 1, 0, 1, events)).toBe(true);
  });

  it('respeta el cooldown del hechizo (1.0 s)', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    expect(fireProjectile(world, 'spell', 1, 0, 1, events)).toBe(true);
    expect(fireProjectile(world, 'spell', 1, 0, 1, events)).toBe(false);

    world.time += 1.01;
    expect(fireProjectile(world, 'spell', 1, 0, 1, events)).toBe(true);
  });
});

describe('multidisparo en ángulo (Bandada/Coro Arcano, docs/plans/ECONOMY_PLAN.md F2)', () => {
  it('arrowCountBonus=2 dispara 3 flechas en abanico simétrico (-12/0/+12) con un solo cooldown', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    world.hero.modifiers.arrowCountBonus = 2;

    expect(fireProjectile(world, 'arrow', 1, 0, 1, events)).toBe(true);
    const active = world.projectiles.filter((p) => p.active);
    expect(active).toHaveLength(3);

    const angles = active.map((p) => Math.atan2(p.velocity.y, p.velocity.x)).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(-PROJECTILE_FAN_ANGLE_STEP, 5);
    expect(angles[1]).toBeCloseTo(0, 5);
    expect(angles[2]).toBeCloseTo(PROJECTILE_FAN_ANGLE_STEP, 5);

    // Un solo cooldown consumido: el siguiente disparo inmediato se rechaza.
    expect(fireProjectile(world, 'arrow', 1, 0, 1, events)).toBe(false);

    // Un solo evento 'launch' por disparo, no uno por proyectil.
    const launches: string[] = [];
    drainEvents(events, (e: GameEvent) => launches.push(e.type));
    expect(launches.filter((t) => t === 'launch')).toHaveLength(1);
  });

  it('spellCountBonus=1 dispara 2 hechizos separados ±6°', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    world.hero.modifiers.spellCountBonus = 1;

    expect(fireProjectile(world, 'spell', 1, 0, 1, events)).toBe(true);
    const active = world.projectiles.filter((p) => p.active);
    expect(active).toHaveLength(2);

    const angles = active.map((p) => Math.atan2(p.velocity.y, p.velocity.x)).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(-PROJECTILE_FAN_ANGLE_STEP / 2, 5);
    expect(angles[1]).toBeCloseTo(PROJECTILE_FAN_ANGLE_STEP / 2, 5);
  });

  it('mismo daño y velocidad por proyectil del abanico', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    world.hero.modifiers.arrowCountBonus = 2;
    fireProjectile(world, 'arrow', 1, 0, 1, events);
    const active = world.projectiles.filter((p) => p.active);
    const damages = new Set(active.map((p) => p.damage));
    const speeds = new Set(active.map((p) => Math.hypot(p.velocity.x, p.velocity.y).toFixed(6)));
    expect(damages.size).toBe(1);
    expect(speeds.size).toBe(1);
  });

  it('pool casi lleno: dispara solo los proyectiles del abanico que caben, sin lanzar error', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    world.hero.modifiers.arrowCountBonus = 2; // pediría 3
    // Deja un único slot libre en el pool.
    for (let i = 0; i < world.projectiles.length - 1; i++) world.projectiles[i].active = true;

    expect(() => fireProjectile(world, 'arrow', 1, 0, 1, events)).not.toThrow();
    expect(world.projectiles.filter((p) => p.active)).toHaveLength(world.projectiles.length);
  });
});

describe('perforación y rebotes: presupuesto base + bono (docs/plans/ECONOMY_PLAN.md F2)', () => {
  it('Aguja Fantasma: la flecha nace con pierceLeft = ARROW_PIERCE_COUNT + arrowPierceBonus', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    world.hero.modifiers.arrowPierceBonus = 2;
    fireProjectile(world, 'arrow', 1, 0, 1, events);
    const arrow = world.projectiles.find((p) => p.active);
    expect(arrow!.pierceLeft).toBe(ARROW_PIERCE_COUNT + 2);
  });

  it('Eco Errante: el hechizo nace con bouncesLeft = SPELL_WALL_BOUNCES + spellBounceBonus', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    world.hero.modifiers.spellBounceBonus = 2;
    fireProjectile(world, 'spell', 1, 0, 1, events);
    const spell = world.projectiles.find((p) => p.active);
    expect(spell!.bouncesLeft).toBe(SPELL_WALL_BOUNCES + 2);
  });

  it('sin bono, los presupuestos base existentes siguen intactos', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    fireProjectile(world, 'arrow', 1, 0, 1, events);
    expect(world.projectiles.find((p) => p.active)!.pierceLeft).toBe(ARROW_PIERCE_COUNT);
  });
});

describe('applyKnockbackToHero (Canto Rodado, docs/plans/ECONOMY_PLAN.md F2)', () => {
  it('con knockbackTakenMultiplier=0.8, el empujón recibido es el 80%', () => {
    const world = makeWorld();
    world.hero.modifiers.knockbackTakenMultiplier = 0.8;
    applyKnockbackToHero(world, 10, 0);
    expect(world.hero.velocity.x).toBeCloseTo(8, 9);
    expect(world.hero.velocity.y).toBeCloseTo(0, 9);
  });

  it('con multiplier neutro (1), el empuje no cambia', () => {
    const world = makeWorld();
    applyKnockbackToHero(world, 3, 4);
    expect(world.hero.velocity.x).toBeCloseTo(3, 9);
    expect(world.hero.velocity.y).toBeCloseTo(4, 9);
  });

  it('el retroceso de disparar (recoil) NO pasa por el multiplicador de knockback recibido', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    world.hero.modifiers.knockbackTakenMultiplier = 0.1; // casi anulado, si aplicara aquí el recoil sería ínfimo
    fireProjectile(world, 'arrow', 1, 0, 1, events);
    expect(world.hero.velocity.x).toBeLessThan(-1); // recoil normal, sin reducir
  });
});

describe('applyDamageToEnemy', () => {
  it('emite enemy-died al llegar a 0 HP', () => {
    const world = makeWorld([{ id: 'e1', kind: 'dummy', position: { x: 1, y: 0 } }]);
    const events = createEventQueue(16);
    const enemy = world.enemies[0];
    applyDamageToEnemy(world, enemy, 99, 1, 0, events);
    expect(enemy.hp).toBeLessThanOrEqual(0);

    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).toContain('enemy-died');
  });
});

describe('El Prisma (GDD §15.4, Fase B3): gate de color en applyDamageToEnemy', () => {
  function makeBossWorld(): World {
    return makeWorld([{ id: 'boss-1', kind: 'boss', bossId: 'prisma', position: { x: 0, y: 0 } }]);
  }

  it('arma que NO coincide con el color activo: hp intacto + evento boss-immune-hit (ni en ventana)', () => {
    const world = makeBossWorld();
    const events = createEventQueue(16);
    const boss = world.enemies[0];
    boss.bossWeaponGateA = 'ram';
    boss.bossVulnerable = true; // el gate manda ANTES que la ventana
    const hpBefore = boss.hp;

    applyDamageToEnemy(world, boss, 10, 1, 0, events, false, 'arrow');

    expect(boss.hp).toBe(hpBefore);
    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).toEqual(['boss-immune-hit']);
  });

  it('arma que coincide con el color activo: daño normal, respetando la ventana de vulnerabilidad', () => {
    const world = makeBossWorld();
    const events = createEventQueue(16);
    const boss = world.enemies[0];
    boss.bossWeaponGateA = 'arrow';

    // Fuera de ventana: bossDamageOutsideWindowFactor por defecto (0) → inmune, pero SIN evento boss-immune-hit (color correcto).
    boss.bossVulnerable = false;
    const hpBefore1 = boss.hp;
    applyDamageToEnemy(world, boss, 10, 1, 0, events, false, 'arrow');
    expect(boss.hp).toBe(hpBefore1);
    const typesOutside: string[] = [];
    drainEvents(events, (e: GameEvent) => typesOutside.push(e.type));
    expect(typesOutside).not.toContain('boss-immune-hit');

    // Dentro de ventana: daño completo.
    boss.bossVulnerable = true;
    const hpBefore2 = boss.hp;
    applyDamageToEnemy(world, boss, 10, 1, 0, events, false, 'arrow');
    expect(boss.hp).toBe(hpBefore2 - 10);
  });

  it("daño 'other' (barril, pinchos...) pasa el gate sin importar el color activo (no es un arma)", () => {
    const world = makeBossWorld();
    const events = createEventQueue(16);
    const boss = world.enemies[0];
    boss.bossWeaponGateA = 'ram';
    boss.bossVulnerable = true;
    const hpBefore = boss.hp;

    applyDamageToEnemy(world, boss, 4, 1, 0, events, true, 'other');

    expect(boss.hp).toBe(hpBefore - 4);
    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).not.toContain('boss-immune-hit');
  });

  it('solape de fase 3 (bossWeaponGateB): cualquiera de los dos colores hace daño NORMAL (el ×2 se retiró en playtest 2026-07-17: "siempre con el daño normal")', () => {
    const world = makeBossWorld();
    const events = createEventQueue(16);
    const boss = world.enemies[0];
    // HP amplio (el placeholder de createEnemy es 1): applyDamageToEnemy
    // corta en seco si hp<=0, y este test encadena dos golpes.
    boss.hp = 100;
    boss.maxHp = 100;
    boss.bossWeaponGateA = 'spell';
    boss.bossWeaponGateB = 'arrow';
    boss.bossVulnerable = true;

    const hpBefore = boss.hp;
    applyDamageToEnemy(world, boss, 5, 1, 0, events, false, 'arrow');
    expect(boss.hp).toBe(hpBefore - 5); // daño normal, acierta por el gate B

    const hpBefore2 = boss.hp;
    applyDamageToEnemy(world, boss, 5, 1, 0, events, false, 'spell');
    expect(boss.hp).toBe(hpBefore2 - 5); // daño normal, acierta por el gate A
  });

  it('sin gate activo (bossWeaponGateA === ""): comportamiento normal de cualquier otro jefe/enemigo', () => {
    const world = makeBossWorld();
    const events = createEventQueue(16);
    const boss = world.enemies[0];
    expect(boss.bossWeaponGateA).toBe('');
    boss.bossVulnerable = true;

    const hpBefore = boss.hp;
    applyDamageToEnemy(world, boss, 3, 1, 0, events, false, 'ram');
    expect(boss.hp).toBe(hpBefore - 3);
  });
});

describe('El Prisma (GDD §15.4): atribución de fuente de daño desde los llamadores reales', () => {
  it('una flecha del héroe (stepHeroProjectileCollisions) pasa source="arrow": rebota sin efecto contra un gate distinto y daña con el gate correcto', () => {
    const world = makeWorld([{ id: 'boss-1', kind: 'boss', bossId: 'prisma', position: { x: 3, y: 0 } }]);
    const boss = world.enemies[0];
    boss.bossVulnerable = true;
    const events = createEventQueue(32);

    boss.bossWeaponGateA = 'ram';
    fireProjectile(world, 'arrow', 1, 0, 1, events);
    const hpBefore = boss.hp;
    for (let i = 0; i < 60; i++) stepProjectiles(world, FIXED_DT, events);
    expect(boss.hp).toBe(hpBefore); // gate equivocado: inmune

    world.time += 1; // libera el cooldown de la flecha
    boss.bossWeaponGateA = 'arrow';
    fireProjectile(world, 'arrow', 1, 0, 1, events);
    const hpBefore2 = boss.hp;
    for (let i = 0; i < 60; i++) stepProjectiles(world, FIXED_DT, events);
    expect(boss.hp).toBeLessThan(hpBefore2);
  });

  it('la embestida del héroe (stepHeroEnemyContacts) pasa source="ram": solo daña un Prisma con gate "ram"', () => {
    const world = makeWorld([{ id: 'boss-1', kind: 'boss', bossId: 'prisma', position: { x: 0.5, y: 0 } }]);
    const boss = world.enemies[0];
    boss.bossVulnerable = true;
    const events = createEventQueue(16);

    boss.bossWeaponGateA = 'arrow';
    world.hero.velocity.x = 5; // por encima de RAM_SPEED_THRESHOLD
    const hpBefore = boss.hp;
    stepHeroEnemyContacts(world, new Map(), events);
    expect(boss.hp).toBe(hpBefore); // gate equivocado: inmune

    boss.bossWeaponGateA = 'ram';
    world.hero.velocity.x = 5;
    const hpBefore2 = boss.hp;
    stepHeroEnemyContacts(world, new Map(), events);
    expect(boss.hp).toBeLessThan(hpBefore2);
  });
});

describe('proyectil enemigo con rebote (El Prisma, GDD §15.4, modo Sombra)', () => {
  it('con bouncesLeft > 0 rebota en la pared en vez de desaparecer, y se apaga al agotar los rebotes', () => {
    const world = createWorld(makeRoom({ width: 10, height: 10 }));
    const events = createEventQueue(64);
    world.hero.position.x = -100; // lejos: no lo intercepta el héroe
    world.hero.position.y = -100;

    expect(fireEnemyProjectile(world, 0, 0, 1, 0, 3, 1, 0.2, 1)).toBe(true);
    const p = world.projectiles.find((proj) => proj.active && proj.owner === 'enemy')!;
    expect(p).toBeDefined();
    expect(p.bouncesLeft).toBe(1);

    let bounced = false;
    for (let i = 0; i < 600 && !bounced; i++) {
      stepProjectiles(world, FIXED_DT, events);
      if (p.active && p.velocity.x < 0) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(p.active).toBe(true);
    expect(p.bouncesLeft).toBe(0);

    // Segundo choque (pared oeste): sin rebotes restantes, desaparece.
    for (let i = 0; i < 600 && p.active; i++) {
      stepProjectiles(world, FIXED_DT, events);
    }
    expect(p.active).toBe(false);
  });

  it('sin bouncesLeft (Shooter, comportamiento intacto): desaparece contra la pared sin rebotar', () => {
    const world = createWorld(makeRoom({ width: 10, height: 10 }));
    const events = createEventQueue(64);
    world.hero.position.x = -100;
    world.hero.position.y = -100;

    fireEnemyProjectile(world, 0, 0, 1, 0, 3, 1, 0.2);
    const p = world.projectiles.find((proj) => proj.active && proj.owner === 'enemy')!;
    expect(p.bouncesLeft).toBe(0);

    for (let i = 0; i < 600 && p.active; i++) {
      stepProjectiles(world, FIXED_DT, events);
    }
    expect(p.active).toBe(false);
  });
});
