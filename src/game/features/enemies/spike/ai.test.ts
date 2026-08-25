/**
 * Test del Spike (GDD §7.3, playtest 2026-07-05): la cara peligrosa sigue a
 * la marcha.
 */

import { describe, expect, it } from 'vitest';
import { stepEnemyAi } from '@/game/features/enemies/ai';
import { createWorld } from '@/game/world/create';
import type { EnemySpawn, HazardSpawn, RoomData, World } from '@/game/world/types';

const FIXED_DT = 1 / 60;

function makeRoom(partial: Partial<RoomData> = {}): RoomData {
  return {
    version: 1,
    id: 'ai-room',
    name: 'AI',
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

function makeWorld(enemies: EnemySpawn[], hazards: HazardSpawn[] = []): World {
  return createWorld(makeRoom({ enemies, hazards }));
}

function runAi(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    stepEnemyAi(world, FIXED_DT);
    world.time += FIXED_DT;
  }
}

describe('Spike: la cara peligrosa sigue a la marcha (playtest 2026-07-05)', () => {
  it('al patrullar, facing apunta hacia donde se mueve; parado conserva la última', () => {
    const world = makeWorld([
      {
        id: 's1',
        kind: 'spike',
        position: { x: 0, y: 0 },
        facing: { x: 0, y: 1 },
        patrolTarget: { x: 3, y: 0 },
      },
    ]);
    world.hero.position.x = 12;
    world.hero.position.y = 12;
    runAi(world, 30);
    const spike = world.enemies[0];
    const speed = Math.hypot(spike.velocity.x, spike.velocity.y);
    expect(speed).toBeGreaterThan(0.1);
    // Se mueve hacia +x → facing debe ser ~(±1, 0) según el sentido del tramo.
    expect(Math.abs(spike.facing.x)).toBeGreaterThan(0.9);
    expect(Math.abs(spike.facing.y)).toBeLessThan(0.3);
  });

  it('al girar en un extremo, facing NO se invierte de golpe: pasa por una dirección intermedia y converge al final de la ventana', () => {
    // Mismo escenario que el test de arriba (tramo recto de 3 u en +x), pero
    // dejado correr hasta que el Spike LLEGA al extremo y gira. Mecanismo
    // ACTUAL (corrección 2026-08-25): quien gira `facing` en el extremo ya
    // NO es este `stepSpike` (su damping por velocidad solo actúa en MARCHA,
    // ver su cabecera) sino `stepPatrol` (steering.ts), a velocidad angular
    // CONSTANTE mientras el Spike está parado en seco (velocity {0,0}) — el
    // guard `speed > 0.05` de más abajo en stepSpike no entra durante todo
    // el giro, así que este test en realidad está confirmando el
    // comportamiento de `stepPatrol`, no el de `stepSpike`; se mantiene aquí
    // porque sigue siendo la garantía que le importa a este arquetipo en
    // concreto: el ojo/púas nunca saltan 180° de golpe, pasan por una
    // dirección intermedia legible.
    const world = makeWorld([
      {
        id: 's1',
        kind: 'spike',
        position: { x: 0, y: 0 },
        facing: { x: 0, y: 1 },
        patrolTarget: { x: 3, y: 0 },
      },
    ]);
    world.hero.position.x = 12;
    world.hero.position.y = 12;
    const spike = world.enemies[0];

    // Llega al extremo: por el camino (~189 ticks a SPIKE_PATROL_SPEED sobre
    // 3 u) el facing converge de sobra a la marcha (+x), igual que en el
    // test de arriba con solo 30 ticks. Margen amplio (400) hasta que se
    // arma la ventana de giro; `facingXBeforeArrival` guarda el valor de
    // JUSTO antes de esa llamada (el propio tick que arma la ventana ya
    // sobrescribe facing con el rumbo de llegada, ver stepPatrol, así que
    // hay que capturarlo ANTES).
    let facingXBeforeArrival = 0;
    let armed = false;
    for (let i = 0; i < 400; i++) {
      const preTick = spike.facing.x;
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
      if (spike.patrolTurnUntil > world.time) {
        facingXBeforeArrival = preTick;
        armed = true;
        break;
      }
    }
    expect(armed).toBe(true);
    // Justo antes de llegar: totalmente convergido a la marcha (+x).
    expect(facingXBeforeArrival).toBeGreaterThan(0.9);

    // A mitad de la ventana de giro (no "un par de ticks": a velocidad
    // angular CONSTANTE —a diferencia del damping exponencial viejo, que
    // daba su paso más grande al principio— los primeros ticks apenas mueven
    // `facing.x` porque el giro arranca justo en el pico de la curva del
    // seno, donde un cambio de ángulo pequeño mueve sobre todo la componente
    // Y; hace falta llegar a la mitad del arco para que X se aleje de
    // verdad de +1). El giro es de 180° (3 u en línea recta, igual que el
    // tramo de 2 u de steering.test.ts): ni se ha quedado en el rumbo viejo
    // (+x) ni ha saltado ya al nuevo (-x) — apunta a algo intermedio.
    const totalTicks = Math.round((spike.patrolTurnUntil - world.time) / FIXED_DT);
    for (let i = 0; i < Math.floor(totalTicks / 2); i++) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
    }
    expect(Math.abs(spike.facing.x)).toBeLessThan(0.5);

    // Al terminar la ventana (y unos cuantos ticks más, ya en marcha normal
    // con el damping de stepSpike operando sobre un facing que arranca ya
    // prácticamente encarado): converge al nuevo rumbo (-x).
    while (world.time < spike.patrolTurnUntil) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
    }
    for (let i = 0; i < 10; i++) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
    }
    expect(spike.facing.x).toBeLessThan(-0.9);
  });
});
