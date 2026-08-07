/**
 * Tests de hazards (GDD §8): foso con margen de perdón 0.18 y respawn en
 * posición segura, enemigos que caen y mueren, pinchos y barriles en cadena.
 */

import { describe, expect, it } from 'vitest';
import { BARREL_DAMAGE, PIT_FALL_DURATION, PIT_FORGIVENESS_MARGIN, SPIKES_ENEMY_DAMAGE_INTERVAL, SPIKES_PUSH_SPEED } from './constants';
import { HERO_IFRAME_DURATION } from '@/game/features/combat/constants';
import { QUEEN_TRAIL_CROSS_SPEED, QUEEN_TRAIL_DOT_GRACE, QUEEN_TRAIL_SLOW_FACTOR } from '@/game/features/bosses/queen/constants';
import { createEventQueue, drainEvents, type GameEvent } from '@/engine/events';
import { stepBarrels, stepEnemyHazards, stepHeroHazards, stepPuddles } from './hazards';
import { stepWorld } from '@/game/world/step';
import { createWorld } from '@/game/world/create';
import type { EnemySpawn, HazardSpawn, ItemSpawn, RoomData, World } from '@/game/world/types';

const FIXED_DT = 1 / 60;

function makeRoom(partial: Partial<RoomData> = {}): RoomData {
  return {
    version: 1,
    id: 'hazard-room',
    name: 'Hazards',
    width: 30,
    height: 30,
    playerStart: { x: 10, y: 10 },
    tags: ['combate'],
    doorSlots: [],
    enemies: [],
    hazards: [],
    items: [],
    ...partial,
  };
}

function makeWorld(
  hazards: HazardSpawn[] = [],
  enemies: EnemySpawn[] = [],
  items: ItemSpawn[] = [],
): World {
  return createWorld(makeRoom({ hazards, enemies, items }));
}

// Foso 2×2 centrado en el origen: borde visual en ±1, trigger en ±(1−0.18).
const PIT: HazardSpawn = { id: 'pit', kind: 'pit', position: { x: 0, y: 0 }, width: 2, height: 2 };

describe('foso: margen de perdón (0.18, decisión de diseño validada)', () => {
  it('el centro dentro del borde visual pero dentro del margen NO cae', () => {
    const world = makeWorld([PIT]);
    const events = createEventQueue(16);
    // A 0.9 del centro: dentro del foso visual (±1) pero fuera del trigger (±0.82).
    world.hero.position.x = 1 - PIT_FORGIVENESS_MARGIN / 2;
    world.hero.position.y = 0;
    stepHeroHazards(world, events);
    expect(world.fallingUntil).toBe(0);
    expect(world.hero.hp).toBe(5);
  });

  it('el centro más adentro del margen cae: 1 daño y animación de caída', () => {
    const world = makeWorld([PIT]);
    const events = createEventQueue(16);
    world.hero.position.x = 1 - PIT_FORGIVENESS_MARGIN - 0.05;
    world.hero.position.y = 0;
    stepHeroHazards(world, events);
    expect(world.fallingUntil).toBeCloseTo(world.time + PIT_FALL_DURATION, 9);
    expect(world.hero.hp).toBe(4);

    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).toContain('pit-fall');
  });

  it('con world.godMode y 1 hp: el foso revive a maxHp en vez de game-over (misma ruta que cualquier daño, vía applyDamageToHero)', () => {
    const world = makeWorld([PIT]);
    world.godMode = true;
    world.hero.hp = 1;
    const events = createEventQueue(16);
    world.hero.position.x = 1 - PIT_FORGIVENESS_MARGIN - 0.05;
    world.hero.position.y = 0;
    stepHeroHazards(world, events);

    expect(world.hero.hp).toBe(world.hero.maxHp);
    expect(world.phase).toBe('playing');
    // La caída (fallingUntil) sigue intacta: godMode solo evita el
    // game-over/muerte, no desactiva la animación/respawn del foso.
    expect(world.fallingUntil).toBeCloseTo(world.time + PIT_FALL_DURATION, 9);

    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).toContain('pit-fall');
    expect(types).toContain('godmode-revive');
    expect(types).not.toContain('player-died');
  });
});

describe('foso: respawn en última posición segura', () => {
  it('tras ~1.05 s reaparece donde pisó suelo firme por última vez, parado', () => {
    const world = makeWorld([PIT]);
    const events = createEventQueue(64);
    // El héroe empieza en (10,10): suelo firme. Un tick para fijar safePosition.
    stepWorld(world, events);
    expect(world.safePosition.x).toBeCloseTo(10, 6);

    // Cae al foso.
    world.hero.position.x = 0;
    world.hero.position.y = 0;
    stepWorld(world, events);
    expect(world.fallingUntil).toBeGreaterThan(0);

    // Avanza la caída completa.
    const ticks = Math.ceil(PIT_FALL_DURATION * 60) + 2;
    for (let i = 0; i < ticks; i++) {
      stepWorld(world, events);
    }
    expect(world.fallingUntil).toBe(0);
    expect(world.hero.position.x).toBeCloseTo(10, 6);
    expect(world.hero.position.y).toBeCloseTo(10, 6);
    expect(world.hero.velocity.x).toBe(0);
    expect(world.hero.velocity.y).toBe(0);
  });

  it('la posición segura NO se actualiza mientras pisa un hazard', () => {
    const world = makeWorld([PIT]);
    const events = createEventQueue(64);
    stepWorld(world, events); // safePosition = (10,10)

    // Sobre el borde perdonado del foso (no cae, pero es zona de hazard visual…
    // el margen de perdón cuenta como suelo firme: fuera del trigger).
    world.hero.position.x = 3;
    world.hero.position.y = 3;
    stepWorld(world, events);
    expect(world.safePosition.x).toBeCloseTo(3, 4);
  });
});

describe('foso: enemigos', () => {
  it('un enemigo cuyo centro entra en el trigger muere al instante y suelta moneda', () => {
    const world = makeWorld([PIT], [{ id: 'e1', kind: 'chaser', position: { x: 20, y: 20 } }]);
    const events = createEventQueue(64);
    // Lo teletransportamos al centro del foso (p. ej. knockback lo empujó).
    world.enemies[0].position.x = 0;
    world.enemies[0].position.y = 0;
    stepWorld(world, events);
    expect(world.enemies[0].hp).toBeLessThanOrEqual(0);
    // Moneda soltada en su posición.
    const coin = world.items.find((i) => i.kind === 'coin' && i.active);
    expect(coin).toBeDefined();
  });
});

describe('pinchos', () => {
  const SPIKES: HazardSpawn = {
    id: 'spk',
    kind: 'spikes',
    position: { x: 0, y: 0 },
    width: 1.5,
    height: 1.5,
  };

  it('dañan al héroe 1 y lo empujan fuerte hacia fuera', () => {
    const world = makeWorld([SPIKES]);
    const events = createEventQueue(16);
    world.hero.position.x = 0.5;
    world.hero.position.y = 0;
    stepHeroHazards(world, events);
    expect(world.hero.hp).toBe(4);
    expect(world.hero.velocity.x).toBeCloseTo(SPIKES_PUSH_SPEED, 5); // empuje +x (alejándose)
  });

  it('Canto Rodado (knockbackTakenMultiplier=0.8): el empujón de los pinchos es el 80%', () => {
    const world = makeWorld([SPIKES]);
    const events = createEventQueue(16);
    world.hero.position.x = 0.5;
    world.hero.position.y = 0;
    world.hero.modifiers.knockbackTakenMultiplier = 0.8;
    stepHeroHazards(world, events);
    expect(world.hero.velocity.x).toBeCloseTo(SPIKES_PUSH_SPEED * 0.8, 5);
  });

  it('dañan a los enemigos de forma periódica (cada 0.5 s)', () => {
    const world = makeWorld([SPIKES], [{ id: 'e1', kind: 'chaser', position: { x: 0.4, y: 0 } }]);
    const events = createEventQueue(16);
    const enemy = world.enemies[0];
    const hp0 = enemy.hp;

    stepEnemyHazards(world, world.spikeDamageCooldowns, events);
    expect(enemy.hp).toBe(hp0 - 1);

    // Inmediatamente después: aún en cooldown.
    world.time += SPIKES_ENEMY_DAMAGE_INTERVAL / 2;
    stepEnemyHazards(world, world.spikeDamageCooldowns, events);
    expect(enemy.hp).toBe(hp0 - 1);

    world.time += SPIKES_ENEMY_DAMAGE_INTERVAL;
    stepEnemyHazards(world, world.spikeDamageCooldowns, events);
    expect(enemy.hp).toBe(hp0 - 2);
  });
});

describe('charcos del Trail', () => {
  it('dañan al héroe que los pisa y caducan a los 3.2 s', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    const puddle = world.puddles[0];
    puddle.active = true;
    puddle.position.x = 0;
    puddle.position.y = 0;
    puddle.radius = 0.45;
    puddle.ttl = 3.2;

    world.hero.position.x = 0;
    world.hero.position.y = 0;
    stepPuddles(world, FIXED_DT, events);
    expect(world.hero.hp).toBe(4);

    // Caduca al agotar la vida.
    puddle.ttl = 0.01;
    stepPuddles(world, FIXED_DT, events);
    expect(puddle.active).toBe(false);
  });
});

describe('rastro de la Reina (charcos con slows=true, rediseño 2026-07-10)', () => {
  function makeQueenPuddle(world: World): World['puddles'][number] {
    const puddle = world.puddles[0];
    puddle.active = true;
    puddle.slows = true;
    puddle.position.x = 0;
    puddle.position.y = 0;
    puddle.radius = 0.85;
    puddle.ttl = 6.5;
    return puddle;
  }

  it('ralentiza al héroe LENTO que se queda encima', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    makeQueenPuddle(world);
    world.hero.position.x = 0;
    world.hero.position.y = 0;
    world.hero.velocity.x = 1; // por debajo de QUEEN_TRAIL_CROSS_SPEED
    world.hero.velocity.y = 0;
    stepPuddles(world, FIXED_DT, events);
    expect(world.hero.velocity.x).toBeCloseTo(1 * QUEEN_TRAIL_SLOW_FACTOR, 9);
  });

  it('un héroe RÁPIDO (embestida, velocidad > QUEEN_TRAIL_CROSS_SPEED) cruza sin frenar', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    makeQueenPuddle(world);
    world.hero.position.x = 0;
    world.hero.position.y = 0;
    world.hero.velocity.x = QUEEN_TRAIL_CROSS_SPEED + 1;
    world.hero.velocity.y = 0;
    stepPuddles(world, FIXED_DT, events);
    expect(world.hero.velocity.x).toBeCloseTo(QUEEN_TRAIL_CROSS_SPEED + 1, 9);
    expect(world.hero.trailDwell).toBe(0);
  });

  it('DoT con gracia: no hace daño antes de QUEEN_TRAIL_DOT_GRACE; pasada la gracia, sí', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    makeQueenPuddle(world);
    world.hero.position.x = 0;
    world.hero.position.y = 0;
    world.hero.velocity.x = 1;
    world.hero.velocity.y = 0;

    // Avanza claramente por debajo de la gracia (2 ticks de margen anti-flakiness
    // por redondeo de coma flotante): sin daño todavía.
    const ticksSafelyBeforeGrace = Math.floor(QUEEN_TRAIL_DOT_GRACE / FIXED_DT) - 2;
    for (let i = 0; i < ticksSafelyBeforeGrace; i++) {
      world.time += FIXED_DT;
      stepPuddles(world, FIXED_DT, events);
    }
    expect(world.hero.hp).toBe(world.hero.maxHp);
    expect(world.hero.trailDwell).toBeLessThan(QUEEN_TRAIL_DOT_GRACE);

    // Sigue avanzando hasta cruzar claramente la gracia (mismo margen): DoT.
    for (let i = 0; i < 4; i++) {
      world.time += FIXED_DT;
      stepPuddles(world, FIXED_DT, events);
    }
    expect(world.hero.trailDwell).toBeGreaterThanOrEqual(QUEEN_TRAIL_DOT_GRACE);
    expect(world.hero.hp).toBe(world.hero.maxHp - 1);

    // Los i-frames (0.7s) espacian el siguiente tick de daño: sigue igual hasta que expiren.
    world.time += FIXED_DT;
    stepPuddles(world, FIXED_DT, events);
    expect(world.hero.hp).toBe(world.hero.maxHp - 1);

    // Avanza más allá de los i-frames: vuelve a hacer daño mientras siga sobre el rastro.
    world.time += HERO_IFRAME_DURATION + FIXED_DT;
    stepPuddles(world, FIXED_DT, events);
    expect(world.hero.hp).toBe(world.hero.maxHp - 2);
  });

  it('al salir del rastro, trailDwell se resetea a 0', () => {
    const world = makeWorld();
    const events = createEventQueue(16);
    makeQueenPuddle(world);
    world.hero.position.x = 0;
    world.hero.position.y = 0;
    world.hero.velocity.x = 1;
    world.hero.velocity.y = 0;

    world.time += FIXED_DT;
    stepPuddles(world, FIXED_DT, events);
    expect(world.hero.trailDwell).toBeGreaterThan(0);

    // Se aleja del charco.
    world.hero.position.x = 50;
    world.time += FIXED_DT;
    stepPuddles(world, FIXED_DT, events);
    expect(world.hero.trailDwell).toBe(0);
  });
});

describe('barriles: explosión en cadena', () => {
  it('explota al contacto del héroe, daña 3 en radio 2 y encadena con el barril vecino', () => {
    const barrels: HazardSpawn[] = [
      { id: 'b1', kind: 'barrel', position: { x: 0.5, y: 0 }, width: 0.8, height: 0.8 },
      { id: 'b2', kind: 'barrel', position: { x: 1.8, y: 0 }, width: 0.8, height: 0.8 },
    ];
    // Enemigo lejos del barril 1 (>2) pero cerca del 2 (<2): solo lo alcanza la cadena.
    const world = makeWorld(barrels, [{ id: 'e1', kind: 'chaser', position: { x: 3.4, y: 0 } }]);
    const events = createEventQueue(64);
    const enemy = world.enemies[0];
    const hp0 = enemy.hp;

    // El héroe toca el primer barril.
    world.hero.position.x = 0;
    world.hero.position.y = 0;
    stepBarrels(world, events);

    expect(world.barrels[0].exploded).toBe(true);
    expect(world.barrels[1].exploded).toBe(true); // cadena
    expect(world.hero.hp).toBe(5 - BARREL_DAMAGE); // 3 de daño (el 2º lo bloquean los i-frames)
    expect(enemy.hp).toBe(hp0 - BARREL_DAMAGE); // dañado solo por la cadena

    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types.filter((t) => t === 'barrel-explosion')).toHaveLength(2);
  });

  it('un proyectil también detona el barril', () => {
    const barrels: HazardSpawn[] = [
      { id: 'b1', kind: 'barrel', position: { x: 5, y: 5 }, width: 0.8, height: 0.8 },
    ];
    const world = makeWorld(barrels);
    const events = createEventQueue(16);
    const p = world.projectiles[0];
    p.active = true;
    p.kind = 'arrow';
    p.owner = 'hero';
    p.position.x = 5;
    p.position.y = 5;

    stepBarrels(world, events);
    expect(world.barrels[0].exploded).toBe(true);
    expect(p.active).toBe(false); // el proyectil se consume
  });

  it('el contacto de un enemigo NO detona el barril (fix playtest de David: antes cualquier enemigo que lo tocara lo hacía estallar solo)', () => {
    const barrels: HazardSpawn[] = [{ id: 'b1', kind: 'barrel', position: { x: 0, y: 0 }, width: 0.8, height: 0.8 }];
    // Enemigo pegado al barril (centros coincidentes: solape máximo posible).
    const world = makeWorld(barrels, [{ id: 'e1', kind: 'chaser', position: { x: 0, y: 0 } }]);
    const events = createEventQueue(16);
    const enemy = world.enemies[0];
    const hp0 = enemy.hp;

    // 60 ticks (1s) de contacto sostenido: ni el barril ni el enemigo deben
    // inmutarse por la sola presencia del enemigo encima.
    for (let i = 0; i < 60; i++) {
      stepBarrels(world, events);
    }

    expect(world.barrels[0].exploded).toBe(false);
    expect(enemy.hp).toBe(hp0);
    expect(world.hero.hp).toBe(world.hero.maxHp); // el héroe, lejos, tampoco se ve afectado

    const types: string[] = [];
    drainEvents(events, (e: GameEvent) => types.push(e.type));
    expect(types).not.toContain('barrel-explosion');
  });

  it('proyectil ENEMIGO no detona el barril (mismo criterio: solo héroe/cadena)', () => {
    const barrels: HazardSpawn[] = [{ id: 'b1', kind: 'barrel', position: { x: 5, y: 5 }, width: 0.8, height: 0.8 }];
    const world = makeWorld(barrels);
    const events = createEventQueue(16);
    const p = world.projectiles[0];
    p.active = true;
    p.kind = 'enemy';
    p.owner = 'enemy';
    p.position.x = 5;
    p.position.y = 5;

    stepBarrels(world, events);
    expect(world.barrels[0].exploded).toBe(false);
    expect(p.active).toBe(true); // atraviesa el barril, no se consume
  });

  it('la explosión de un barril daña a un enemigo en su radio (táctica legítima: atraerlo y detonarlo)', () => {
    const barrels: HazardSpawn[] = [{ id: 'b1', kind: 'barrel', position: { x: 0, y: 0 }, width: 0.8, height: 0.8 }];
    // Enemigo dentro del radio de explosión (2) pero sin tocar el barril: solo llega por la onda expansiva.
    const world = makeWorld(barrels, [{ id: 'e1', kind: 'chaser', position: { x: 1.5, y: 0 } }]);
    const events = createEventQueue(16);
    const enemy = world.enemies[0];
    const hp0 = enemy.hp;

    world.hero.position.x = 0;
    world.hero.position.y = 0;
    stepBarrels(world, events); // contacto del héroe: detona

    expect(world.barrels[0].exploded).toBe(true);
    expect(enemy.hp).toBe(hp0 - BARREL_DAMAGE);
  });
});
