/**
 * Tests headless de la física (sin React ni three.js).
 */

import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_SPEED, RESTITUTION, collideCircleAabb, collideInnerBounds, stepEnemyCollisions } from './physics';
import { HERO_RADIUS, LAUNCH_SPEED_MAX, LAUNCH_SPEED_MIN } from '@/game/features/hero/constants';
import { WALL_THICKNESS } from '@/game/world/constants';
import { createEventQueue, drainEvents, type GameEvent } from './events';
import { stepWorld } from '@/game/world/step';
import { createWorld } from '@/game/world/create';
import type { EnemySpawn, HazardSpawn, RoomData, World } from '@/game/world/types';

/** Sala sintética grande y vacía para tests (paredes lejos del área de prueba). */
function makeRoom(hazards: HazardSpawn[] = [], width = 30, height = 30, enemies: EnemySpawn[] = []): RoomData {
  return {
    version: 1,
    id: 'test-room',
    name: 'Test',
    width,
    height,
    playerStart: { x: 0, y: 0 },
    tags: ['combate'],
    doorSlots: [],
    enemies,
    hazards,
    items: [],
  };
}

function makeWorld(hazards: HazardSpawn[] = [], enemies: EnemySpawn[] = []): World {
  return createWorld(makeRoom(hazards, 30, 30, enemies));
}

describe('rebote círculo-vs-AABB', () => {
  it('refleja la componente normal con restitución 0.86 y conserva la tangencial', () => {
    const events = createEventQueue(8);
    const box = { minX: 0, maxX: 2, minY: -5, maxY: 5 };
    // Círculo penetrando la cara izquierda, moviéndose en diagonal hacia ella
    // (a medio radio de la cara, así siempre solapa sea cual sea HERO_RADIUS).
    const position = { x: -HERO_RADIUS / 2, y: 0 };
    const velocity = { x: 5, y: 2 };
    const hit = collideCircleAabb(position, velocity, HERO_RADIUS, box, events);

    expect(hit).toBe(true);
    expect(velocity.x).toBeCloseTo(-RESTITUTION * 5, 9); // normal reflejada
    expect(velocity.y).toBeCloseTo(2, 9); // tangencial intacta
    expect(position.x).toBeCloseTo(-HERO_RADIUS, 9); // push-out hasta contacto

    const collected: GameEvent[] = [];
    drainEvents(events, (e) => collected.push({ ...e }));
    expect(collected).toHaveLength(1);
    expect(collected[0].type).toBe('wall-bounce');
    expect(collected[0].intensity).toBeCloseTo(5, 9);
  });

  it('refleja contra las paredes interiores de la sala con restitución 0.86', () => {
    const bounds = { minX: -4.5, maxX: 4.5, minY: -6.5, maxY: 6.5 };
    const position = { x: 4.4, y: 1 };
    const velocity = { x: 3, y: -1 };
    const hit = collideInnerBounds(position, velocity, HERO_RADIUS, bounds, null);

    expect(hit).toBe(true);
    expect(velocity.x).toBeCloseTo(-RESTITUTION * 3, 9);
    expect(velocity.y).toBeCloseTo(-1, 9);
    expect(position.x).toBeCloseTo(4.5 - HERO_RADIUS, 9);
  });

  it('en una esquina la normal es diagonal y el rebote aleja al círculo', () => {
    const box = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    // Círculo solapando la esquina (0,0) desde fuera, en diagonal hacia ella:
    // distancia a la esquina = HERO_RADIUS/√2 < HERO_RADIUS, así siempre solapa.
    const position = { x: -HERO_RADIUS / 2, y: -HERO_RADIUS / 2 };
    const velocity = { x: 4, y: 4 };
    const hit = collideCircleAabb(position, velocity, HERO_RADIUS, box, null);

    expect(hit).toBe(true);
    // Tras reflejar, la velocidad debe apuntar lejos de la esquina.
    expect(velocity.x).toBeLessThan(0);
    expect(velocity.y).toBeLessThan(0);
    // Y el círculo queda fuera de la caja (sin penetración).
    const nearestX = Math.max(box.minX, Math.min(position.x, box.maxX));
    const nearestY = Math.max(box.minY, Math.min(position.y, box.maxY));
    const dist = Math.hypot(position.x - nearestX, position.y - nearestY);
    expect(dist).toBeGreaterThanOrEqual(HERO_RADIUS - 1e-9);
  });
});

describe('fricción exponencial', () => {
  it('detiene la bola por completo (umbral 0.17 → velocidad 0 exacta)', () => {
    const world = makeWorld();
    const events = createEventQueue(8);
    world.hero.velocity.x = 5;

    const maxTicks = 600; // 10 s de sim: límite duro para no colgar el test
    let ticks = 0;
    while (ticks < maxTicks && (world.hero.velocity.x !== 0 || world.hero.velocity.y !== 0)) {
      stepWorld(world, events);
      drainEvents(events, () => {});
      ticks++;
    }

    expect(world.hero.velocity.x).toBe(0);
    expect(world.hero.velocity.y).toBe(0);
    expect(ticks).toBeLessThan(maxTicks); // se paró antes del límite
    expect(ticks).toBeGreaterThan(30); // pero no de forma instantánea (decae suave)
  });

  it('la velocidad decae de forma monótona mientras desliza', () => {
    const world = makeWorld();
    const events = createEventQueue(8);
    world.hero.velocity.x = 7.5;
    let previous = 7.5;
    for (let i = 0; i < 60; i++) {
      stepWorld(world, events);
      drainEvents(events, () => {});
      const speed = Math.hypot(world.hero.velocity.x, world.hero.velocity.y);
      expect(speed).toBeLessThan(previous);
      previous = speed;
    }
  });
});

describe('clamp de velocidad', () => {
  it('limita la magnitud a 13.5 u/s', () => {
    const world = makeWorld();
    const events = createEventQueue(8);
    world.hero.velocity.x = 40;
    world.hero.velocity.y = 30;
    stepWorld(world, events);
    const speed = Math.hypot(world.hero.velocity.x, world.hero.velocity.y);
    expect(speed).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
    // No debe haberla anulado: sigue siendo un cañonazo (solo fricción de 1 tick).
    expect(speed).toBeGreaterThan(MAX_SPEED * 0.9);
  });
});

describe('anti-tunneling', () => {
  it('a velocidad máxima no atraviesa una pared de 0.42 u de grosor', () => {
    // Muro fino vertical delante del héroe, dentro de una sala grande.
    const wall: HazardSpawn = {
      id: 'thin-wall',
      kind: 'rock',
      position: { x: WALL_THICKNESS / 2, y: 0 },
      width: WALL_THICKNESS,
      height: 10,
    };
    const world = makeWorld([wall]);
    const events = createEventQueue(64);
    // Justo tocando el borde exterior del muro, empujando hacia él a v máx.
    world.hero.position.x = -HERO_RADIUS - 0.001;
    world.hero.velocity.x = MAX_SPEED;

    // Desplazamiento por tick a v máx: 13.5/60 = 0.225 u < 0.42 u de muro.
    expect((MAX_SPEED * FIXED_DT)).toBeLessThan(WALL_THICKNESS);

    for (let i = 0; i < 240; i++) {
      stepWorld(world, events);
      drainEvents(events, () => {});
      // El centro nunca cruza la cara cercana del muro (x=0), y menos aún el muro entero.
      expect(world.hero.position.x).toBeLessThanOrEqual(1e-9);
    }
    // Además rebotó: acabó alejándose o parado, nunca dentro/detrás del muro.
    expect(world.hero.velocity.x).toBeLessThanOrEqual(0);
  });

  it('no atraviesa la esquina de una roca a velocidad máxima', () => {
    const rock: HazardSpawn = {
      id: 'corner-rock',
      kind: 'rock',
      position: { x: 0, y: 0 },
      width: 1,
      height: 1,
    };
    const world = makeWorld([rock]);
    const events = createEventQueue(64);
    const box = world.obstacles[0].aabb;
    // Disparo diagonal a máxima velocidad apuntando a la esquina (-0.5, -0.5).
    world.hero.position.x = -2.5;
    world.hero.position.y = -2.5;
    const diag = MAX_SPEED / Math.SQRT2;
    world.hero.velocity.x = diag;
    world.hero.velocity.y = diag;

    for (let i = 0; i < 240; i++) {
      stepWorld(world, events);
      drainEvents(events, () => {});
      const p = world.hero.position;
      const nearestX = Math.max(box.minX, Math.min(p.x, box.maxX));
      const nearestY = Math.max(box.minY, Math.min(p.y, box.maxY));
      const dist = Math.hypot(p.x - nearestX, p.y - nearestY);
      // Tras cada tick resuelto, el círculo nunca queda penetrando la roca.
      expect(dist).toBeGreaterThanOrEqual(HERO_RADIUS - 1e-6);
    }
  });
});

describe('fricción extra a baja velocidad (feedback de playtest, punto 8)', () => {
  /** Simula desde una velocidad inicial en línea recta (sala vacía) hasta parar del todo; devuelve tiempo (s) y distancia recorrida (u). */
  function simulateSlide(world: World, events: ReturnType<typeof createEventQueue>, v0: number) {
    world.hero.velocity.x = v0;
    world.hero.velocity.y = 0;
    let t = 0;
    let dist = 0;
    const maxTicks = 1200; // 20 s: límite duro para no colgar el test
    for (let i = 0; i < maxTicks; i++) {
      const before = { x: world.hero.position.x, y: world.hero.position.y };
      stepWorld(world, events);
      drainEvents(events, () => {});
      dist += Math.hypot(world.hero.position.x - before.x, world.hero.position.y - before.y);
      t += FIXED_DT;
      if (world.hero.velocity.x === 0 && world.hero.velocity.y === 0) break;
    }
    return { t, dist };
  }

  it('un tiro flojo (fuerza mínima) se detiene rápido y recorre poco', () => {
    const world = makeWorld();
    const events = createEventQueue(8);
    const { t, dist } = simulateSlide(world, events, LAUNCH_SPEED_MIN);
    expect(t).toBeLessThan(1.5); // se para en menos de 1.5 s
    expect(dist).toBeLessThan(2.2); // recorrido corto: "poco impulso, poco recorrido"
  });

  it('un tiro fuerte (fuerza máxima) sigue deslizando un buen tramo (feel de cañonazo intacto)', () => {
    const world = makeWorld();
    const events = createEventQueue(8);
    const { dist } = simulateSlide(world, events, LAUNCH_SPEED_MAX);
    expect(dist).toBeGreaterThanOrEqual(4.5); // el tiro fuerte sigue recorriendo mucho más que el flojo
  });

  it('a velocidad máxima (cañonazo) el recorrido total apenas cambia frente a la fricción pura', () => {
    const world = makeWorld();
    const events = createEventQueue(8);
    const { dist } = simulateSlide(world, events, MAX_SPEED);
    expect(dist).toBeGreaterThanOrEqual(8.5); // el cañonazo conserva su alcance largo
  });
});

describe('stepEnemyCollisions vs barril (fix playtest de David: ya no detona por contacto de enemigo, ver hazards.ts::stepBarrels)', () => {
  it('un enemigo empujado contra un barril sin explotar no lo atraviesa (mismo push-out que una roca)', () => {
    const barrels: HazardSpawn[] = [{ id: 'b1', kind: 'barrel', position: { x: 0, y: 0 }, width: 0.8, height: 0.8 }];
    const world = makeWorld(barrels, [{ id: 'e1', kind: 'chaser', position: { x: 0, y: 0 } }]);
    const enemy = world.enemies[0];
    // Centros coincidentes: solape máximo posible (radios 0.4 + 0.4 = 0.8 de separación esperada).
    stepEnemyCollisions(world);

    const dist = Math.hypot(enemy.position.x - world.barrels[0].position.x, enemy.position.y - world.barrels[0].position.y);
    expect(dist).toBeGreaterThanOrEqual(enemy.radius + world.barrels[0].radius - 1e-6);
    expect(world.barrels[0].exploded).toBe(false); // el push-out no lo detona
    expect(world.barrels[0].position).toEqual({ x: 0, y: 0 }); // el barril es inmóvil
  });

  it('un barril ya explotado no colisiona (cascarón inerte, el enemigo pasa libre)', () => {
    const barrels: HazardSpawn[] = [{ id: 'b1', kind: 'barrel', position: { x: 0, y: 0 }, width: 0.8, height: 0.8 }];
    const world = makeWorld(barrels, [{ id: 'e1', kind: 'chaser', position: { x: 0, y: 0 } }]);
    world.barrels[0].exploded = true;
    const enemy = world.enemies[0];
    stepEnemyCollisions(world);
    // Sin colisión: la posición no se corrige (solo actúa la fricción sobre la velocidad, no la posición).
    expect(enemy.position).toEqual({ x: 0, y: 0 });
  });
});
