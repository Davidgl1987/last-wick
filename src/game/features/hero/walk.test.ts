/**
 * Tests del paseo WASD/flechas (GDD §3, solo escritorio): ayuda de
 * recolocación, nunca un sustituto del lanzamiento corporal ni una forma de
 * combatir. Mismo estilo que launch.test.ts: sala grande y vacía salvo lo
 * que cada test necesite, `createWorld`/`stepWorld` end-to-end.
 */

import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '@/engine/physics';
import { createEventQueue, drainEvents, type EventQueue, type GameEvent } from '@/engine/events';
import { RAM_SPEED_THRESHOLD } from '@/game/features/combat/constants';
import { HERO_WALK_SPEED } from './constants';
import { launchHero } from './launch';
import { heroWalkFactor, stepHeroWalk } from './walk';
import { stepWorld } from '@/game/world/step';
import { createWorld } from '@/game/world/create';
import type { GamePhase, RoomData, World } from '@/game/world/types';

function makeRoom(): RoomData {
  return {
    version: 1,
    id: 'walk-room',
    name: 'Walk',
    width: 30,
    height: 30,
    playerStart: { x: 0, y: 0 },
    tags: ['combate'],
    doorSlots: [],
    enemies: [],
    hazards: [],
    items: [],
  };
}

describe('stepHeroWalk (paseo WASD)', () => {
  it('mueve la posición en escritorio a HERO_WALK_SPEED, sin tocar nunca la velocidad', () => {
    const world = createWorld(makeRoom());
    const events = createEventQueue(8);
    world.heroMove.x = 1;
    world.heroMove.y = 0;
    const start = { x: world.hero.position.x, y: world.hero.position.y };

    const N = 30;
    for (let i = 0; i < N; i++) stepWorld(world, events);

    const expectedDist = HERO_WALK_SPEED * N * FIXED_DT;
    expect(world.hero.position.x).toBeCloseTo(start.x + expectedDist, 9);
    expect(world.hero.position.y).toBeCloseTo(start.y, 9);
    expect(world.hero.velocity.x).toBe(0);
    expect(world.hero.velocity.y).toBe(0);
  });

  it('no camina mientras se apunta, y retoma el paso sin re-pulsar la tecla al dejar de apuntar', () => {
    const world = createWorld(makeRoom());
    const events = createEventQueue(8);
    world.heroMove.x = 1;

    // Apuntando desde el principio: la posición no cambia ni un epsilon.
    world.heroAiming = true;
    const start = { x: world.hero.position.x, y: world.hero.position.y };
    for (let i = 0; i < 10; i++) stepWorld(world, events);
    expect(world.hero.position.x).toBe(start.x);
    expect(world.hero.position.y).toBe(start.y);

    // Deja de apuntar: camina con normalidad.
    world.heroAiming = false;
    for (let i = 0; i < 10; i++) stepWorld(world, events);
    const walking = { x: world.hero.position.x, y: world.hero.position.y };
    expect(walking.x).toBeGreaterThan(start.x);

    // Empieza a apuntar CON LA TECLA YA PULSADA (heroMove sigue en {1,0}, no
    // se re-escribe): parada inmediata, misma posición tick a tick.
    world.heroAiming = true;
    for (let i = 0; i < 5; i++) {
      stepWorld(world, events);
      expect(world.hero.position.x).toBe(walking.x);
      expect(world.hero.position.y).toBe(walking.y);
    }

    // Suelta la puntería sin volver a pulsar nada: retoma el paso solo.
    world.heroAiming = false;
    stepWorld(world, events);
    expect(world.hero.position.x).toBeGreaterThan(walking.x);
  });

  it('CAMBIO DELIBERADO (tarea 2, fix de la costura): ya no mantiene paridad exacta durante TODO el lanzamiento, solo mientras la velocidad del deslizamiento sea ≥ HERO_WALK_SPEED; diverge en cuanto el paseo empieza a mezclarse, no solo al pararse del todo', () => {
    // Antes (puerta binaria) la paridad con el mundo gemelo se sostenía hasta
    // que `hero.velocity` llegaba a exactamente {0,0}; ESE salto de "nada" a
    // "HERO_WALK_SPEED de golpe" era justo la costura que David sentía (ver
    // cabecera de walk.ts). Con el factor continuo, `heroWalkFactor` deja de
    // ser 0 en cuanto la velocidad física baja de HERO_WALK_SPEED — antes de
    // llegar a pararse del todo — así que la paridad con el mundo gemelo
    // (que nunca camina) se rompe ahí, no en STOP_THRESHOLD.
    //
    // Dos direcciones de paseo distintas: perpendicular y opuesta al lanzamiento.
    const moves: Array<{ x: number; y: number }> = [
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    for (const move of moves) {
      const seed = 7;
      const worldStill = createWorld(makeRoom(), seed);
      const worldWalk = createWorld(makeRoom(), seed);
      const eventsStill = createEventQueue(16);
      const eventsWalk = createEventQueue(16);

      expect(launchHero(worldStill, 1, 0, 1, eventsStill)).toBe(true);
      expect(launchHero(worldWalk, 1, 0, 1, eventsWalk)).toBe(true);
      worldWalk.heroMove.x = move.x;
      worldWalk.heroMove.y = move.y;

      let crossed = false;
      let ticks = 0;
      const MAX_SLIDE_TICKS = 300; // margen amplio: el deslizamiento real dura muy por debajo de 5 s
      while (!crossed && ticks < MAX_SLIDE_TICKS) {
        // Velocidad de ENTRADA a este tick: la que `heroWalkFactor` va a leer
        // dentro de `stepWorld(worldWalk, ...)` un instante después
        // (`stepHeroWalk` corre ANTES de que la física actualice la
        // velocidad, ver world/step.ts). Hasta este punto worldWalk y
        // worldStill tienen velocidades bit-idénticas (sala vacía, sin
        // colisiones que las hagan divergir), así que leer de worldWalk es
        // exactamente lo que hará este tick.
        const speedBefore = Math.hypot(worldWalk.hero.velocity.x, worldWalk.hero.velocity.y);
        const stillAboveWalkSpeed = speedBefore >= HERO_WALK_SPEED;

        stepWorld(worldStill, eventsStill);
        stepWorld(worldWalk, eventsWalk);
        ticks++;

        if (stillAboveWalkSpeed) {
          // Lanzamiento de verdad (más rápido que el propio paseo):
          // `heroWalkFactor` valía 0 este tick, paridad exacta con el mundo gemelo.
          expect(worldWalk.hero.position.x).toBeCloseTo(worldStill.hero.position.x, 12);
          expect(worldWalk.hero.position.y).toBeCloseTo(worldStill.hero.position.y, 12);
          expect(worldWalk.hero.velocity.x).toBeCloseTo(worldStill.hero.velocity.x, 12);
          expect(worldWalk.hero.velocity.y).toBeCloseTo(worldStill.hero.velocity.y, 12);
        } else {
          crossed = true;
        }
      }
      expect(crossed).toBe(true); // el escenario fue significativo: sí llegó a cruzar el umbral

      // Unos ticks más: AHORA sí diverge (el paseo se mezcla en la cola del
      // tiro, muy antes de que worldStill llegue a pararse del todo).
      for (let i = 0; i < 10; i++) {
        stepWorld(worldStill, eventsStill);
        stepWorld(worldWalk, eventsWalk);
      }
      const dist = Math.hypot(
        worldWalk.hero.position.x - worldStill.hero.position.x,
        worldWalk.hero.position.y - worldStill.hero.position.y,
      );
      expect(dist).toBeGreaterThan(1e-6);
    }
  });

  it('WASD no introduce ninguna discontinuidad nueva sobre las que la física ya tenía (test de continuidad, cubre directamente la queja de David: "hay un pequeño salto entre que termina el lanzamiento y sigue moviéndose con wasd")', () => {
    const seed = 42;
    const worldWalk = createWorld(makeRoom(), seed);
    const worldNoWalk = createWorld(makeRoom(), seed);
    const eventsWalk = createEventQueue(16);
    const eventsNoWalk = createEventQueue(16);
    worldWalk.heroMove.x = 1;
    worldWalk.heroMove.y = 0; // paseo ALINEADO con la dirección del lanzamiento
    expect(launchHero(worldWalk, 1, 0, 1, eventsWalk)).toBe(true);
    expect(launchHero(worldNoWalk, 1, 0, 1, eventsNoWalk)).toBe(true);
    // worldNoWalk.heroMove se queda en {0,0} (valor inicial de createWorld):
    // el MISMO lanzamiento, sin paseo — la referencia de "discontinuidades
    // que la física ya tenía" antes de que WASD existiera (el camino táctil
    // real, ver el test de abajo "en táctil...").

    function recordDisplacements(world: World, events: EventQueue, n: number): number[] {
      const disp: number[] = [];
      let prevX = world.hero.position.x;
      let prevY = world.hero.position.y;
      for (let i = 0; i < n; i++) {
        stepWorld(world, events);
        disp.push(Math.hypot(world.hero.position.x - prevX, world.hero.position.y - prevY));
        prevX = world.hero.position.x;
        prevY = world.hero.position.y;
      }
      return disp;
    }

    // De sobra para recorrer todo el deslizamiento y quedarse un buen rato
    // parado/caminando después (el deslizamiento real dura muy por debajo de
    // los 200 ticks ≈ 3.3 s).
    const N = 200;
    const dispWalk = recordDisplacements(worldWalk, eventsWalk, N);
    const dispNoWalk = recordDisplacements(worldNoWalk, eventsNoWalk, N);

    function maxConsecutiveJump(disp: number[]): number {
      let max = 0;
      for (let i = 1; i < disp.length; i++) {
        const jump = Math.abs(disp[i] - disp[i - 1]);
        if (jump > max) max = jump;
      }
      return max;
    }

    const jumpWalk = maxConsecutiveJump(dispWalk);
    const jumpNoWalk = maxConsecutiveJump(dispNoWalk);
    const MARGIN = 1e-4; // margen pequeño, solo para absorber ruido de punto flotante
    expect(jumpWalk).toBeLessThanOrEqual(jumpNoWalk + MARGIN);
  });

  it('caso alineado: tras la toma de control del paseo, la velocidad total sobre el suelo es HERO_WALK_SPEED exacta, sin baches', () => {
    const world = createWorld(makeRoom(), 99);
    const events = createEventQueue(16);
    world.heroMove.x = 1;
    world.heroMove.y = 0;
    expect(launchHero(world, 1, 0, 1, events)).toBe(true);

    // Avanza hasta que el deslizamiento baje de HERO_WALK_SPEED (el paseo ya
    // se está mezclando: heroWalkFactor > 0 a partir de aquí).
    let ticks = 0;
    while (Math.hypot(world.hero.velocity.x, world.hero.velocity.y) >= HERO_WALK_SPEED && ticks < 300) {
      stepWorld(world, events);
      ticks++;
    }
    expect(ticks).toBeLessThan(300); // el escenario fue significativo: sí cruzó el umbral

    // A partir de aquí, cada tick (mezcla Y reposo total tras pararse)
    // recorre exactamente HERO_WALK_SPEED*FIXED_DT — la velocidad total
    // sobre el suelo no da ni un bache al cruzar STOP_THRESHOLD.
    let prev = { x: world.hero.position.x, y: world.hero.position.y };
    for (let i = 0; i < 60; i++) {
      stepWorld(world, events);
      const cur = { x: world.hero.position.x, y: world.hero.position.y };
      const groundSpeed = Math.hypot(cur.x - prev.x, cur.y - prev.y) / FIXED_DT;
      expect(groundSpeed).toBeCloseTo(HERO_WALK_SPEED, 9);
      prev = cur;
    }
  });

  it('nunca hace daño por contacto (ni embestida) contra un enemigo, aunque camine sostenidamente contra él', () => {
    const room = makeRoom();
    const spikePos = { x: 0.5, y: 0 };
    room.enemies.push({
      id: 'spike-1',
      kind: 'spike',
      position: spikePos,
      // patrolTarget === position ⇒ patrolFrom === patrolTo: stepPatrol se ve
      // "ya llegado" en el primer tick y nunca vuelve a llamar a moveToward,
      // así que el spike queda perfectamente ESTÁTICO (velocity siempre
      // {0,0}) — sin esto, la IA (o incluso el impulso de stepBodySeparation
      // si el enemigo tuviera velocidad propia) podría mover al enemigo por
      // su cuenta, contaminando la aserción de abajo sobre hero.velocity.
      patrolTarget: spikePos,
      // Mira hacia el héroe (que llega por -x): el contacto cae en la rama
      // normal de stepHeroEnemyContacts, no en el arco trasero invertido del
      // Spike (GDD §7.3) — de todas formas ninguna de las dos ramas daña al
      // enemigo mientras hero.velocity sea 0, esto es solo por claridad.
      facing: { x: -1, y: 0 },
    });
    const world = createWorld(room);
    // El contacto normal (preexistente, ajeno a WASD) SÍ daña al héroe con
    // normalidad — godMode solo evita que un game-over a mitad de los 60
    // ticks trunque el escenario que queremos observar completo.
    world.godMode = true;
    const events = createEventQueue(64);
    const enemy = world.enemies[0];
    const initialHp = enemy.hp;

    // Ya solapado desde el tick 0 (radios 0.24+0.4=0.64 > 0.5 de distancia) y
    // caminando HACIA el enemigo: el escenario más agresivo posible.
    world.heroMove.x = 1;

    // Tick 0: nada ha podido tocar `hero.velocity` todavía (nace en {0,0} y
    // ni stepHeroWalk ni stepHeroPhysics la alteran) — el primer contacto se
    // evalúa con velocidad EXACTAMENTE 0, la garantía fuerte de la puerta 4
    // de stepHeroWalk.
    stepWorld(world, events);
    expect(world.hero.velocity.x).toBe(0);
    expect(world.hero.velocity.y).toBe(0);

    const collected: GameEvent[] = [];
    drainEvents(events, (e) => collected.push({ ...e }));
    let sawContact =
      Math.hypot(enemy.position.x - world.hero.position.x, enemy.position.y - world.hero.position.y) <=
      enemy.radius + world.hero.radius;

    // Ticks siguientes: en cuanto el empuje sostenido del héroe aleja al
    // spike más de PATROL_ARRIVE_EPS de su punto de patrulla (fijo en su
    // posición de spawn), stepPatrol deja de verlo "ya llegado" e intenta
    // volver — la IA le da algo de velocidad propia. Eso es lo que dispara
    // el siguiente matiz, AJENO a WASD: `collideCircleCircle`
    // (stepBodySeparation, engine/physics.ts) reparte un impulso entre dos
    // cuerpos que se acercan, así que `hero.velocity` puede terminar un tick
    // con un residuo pequeño (observado: ~0.43 u/s) — el mismo mecanismo que
    // ya existía para CUALQUIER par de cuerpos que colisionan, no algo que
    // stepHeroWalk introduzca. La garantía que sí se sostiene siempre, y es
    // la que de verdad importa para el objetivo de diseño, es que ese
    // residuo nunca se acerca ni de lejos a RAM_SPEED_THRESHOLD (2.5 u/s):
    // `ramDamage` sigue devolviendo 0 en todos los ticks.
    const ticks = 59; // hasta completar ~1 s de sim junto al tick 0 de arriba
    for (let i = 0; i < ticks; i++) {
      stepWorld(world, events);
      drainEvents(events, (e) => collected.push({ ...e }));
      const heroSpeed = Math.hypot(world.hero.velocity.x, world.hero.velocity.y);
      expect(heroSpeed).toBeLessThan(RAM_SPEED_THRESHOLD);
      const dist = Math.hypot(enemy.position.x - world.hero.position.x, enemy.position.y - world.hero.position.y);
      if (dist <= enemy.radius + world.hero.radius) sawContact = true;
    }

    expect(sawContact).toBe(true); // el escenario fue significativo: sí hubo contacto real
    expect(enemy.hp).toBe(initialHp);
    const damageToEnemyTypes: GameEvent['type'][] = ['enemy-hit', 'boss-hit', 'enemy-died'];
    expect(collected.some((e) => damageToEnemyTypes.includes(e.type))).toBe(false);
  });

  it('elegir flecha o hechizo no bloquea el paseo; solo empezar a apuntar lo hace', () => {
    for (const mode of ['arrow', 'spell'] as const) {
      const world = createWorld(makeRoom());
      const events = createEventQueue(8);
      world.hero.weaponMode = mode;
      world.heroMove.y = 1;
      const start = { x: world.hero.position.x, y: world.hero.position.y };
      const N = 10;
      for (let i = 0; i < N; i++) stepWorld(world, events);
      expect(world.hero.position.y).toBeCloseTo(start.y + HERO_WALK_SPEED * N * FIXED_DT, 9);
    }
  });

  it('en táctil (heroMove siempre {0,0}) un tramo de lanzamiento + fricción hasta pararse es idéntico, bit a bit, entre dos mundos gemelos', () => {
    const seed = 123;
    const worldA = createWorld(makeRoom(), seed);
    const worldB = createWorld(makeRoom(), seed);
    const eventsA = createEventQueue(16);
    const eventsB = createEventQueue(16);
    // heroMove nace en {0,0} en ambos (createWorld) y NINGUNO de los dos lo
    // toca en ningún momento: es exactamente el camino táctil real
    // (KeyboardMoveInput nunca registra un listener ahí, session.move —y por
    // tanto world.heroMove— se queda siempre en su valor inicial).
    expect(launchHero(worldA, 0.6, -0.8, 0.9, eventsA)).toBe(true);
    expect(launchHero(worldB, 0.6, -0.8, 0.9, eventsB)).toBe(true);

    let stopped = false;
    for (let i = 0; i < 300 && !stopped; i++) {
      stepWorld(worldA, eventsA);
      stepWorld(worldB, eventsB);
      expect(worldB.hero.position.x).toBe(worldA.hero.position.x);
      expect(worldB.hero.position.y).toBe(worldA.hero.position.y);
      expect(worldB.hero.velocity.x).toBe(worldA.hero.velocity.x);
      expect(worldB.hero.velocity.y).toBe(worldA.hero.velocity.y);
      if (worldA.hero.velocity.x === 0 && worldA.hero.velocity.y === 0) stopped = true;
    }
    expect(stopped).toBe(true);

    // Y ya parado, unos ticks más: sigue coincidiendo (nada reactiva el movimiento).
    for (let i = 0; i < 10; i++) {
      stepWorld(worldA, eventsA);
      stepWorld(worldB, eventsB);
    }
    expect(worldB.hero.position.x).toBe(worldA.hero.position.x);
    expect(worldB.hero.position.y).toBe(worldA.hero.position.y);
  });

  it('fuera de la fase playing no mueve al héroe, ni vía stepWorld ni llamando a stepHeroWalk directamente', () => {
    const phases: GamePhase[] = ['paused', 'shopping', 'boss-reward', 'game-over', 'victory', 'dungeon-cleared'];
    for (const phase of phases) {
      const world = createWorld(makeRoom());
      const events = createEventQueue(8);
      world.phase = phase;
      world.heroMove.x = 1;
      world.heroMove.y = 1;
      const start = { x: world.hero.position.x, y: world.hero.position.y };

      stepHeroWalk(world);
      expect(world.hero.position.x).toBe(start.x);
      expect(world.hero.position.y).toBe(start.y);

      stepWorld(world, events);
      expect(world.hero.position.x).toBe(start.x);
      expect(world.hero.position.y).toBe(start.y);
    }
  });

  it('la diagonal recorre la misma distancia por tick que un solo eje (normalización correcta)', () => {
    const worldAxis = createWorld(makeRoom());
    const worldDiag = createWorld(makeRoom());
    const eventsAxis = createEventQueue(4);
    const eventsDiag = createEventQueue(4);
    worldAxis.heroMove.x = 1;
    worldDiag.heroMove.x = 1;
    worldDiag.heroMove.y = 1;

    stepWorld(worldAxis, eventsAxis);
    stepWorld(worldDiag, eventsDiag);

    const distAxis = Math.hypot(worldAxis.hero.position.x, worldAxis.hero.position.y);
    const distDiag = Math.hypot(worldDiag.hero.position.x, worldDiag.hero.position.y);
    expect(distDiag).toBeCloseTo(distAxis, 12);
    expect(distAxis).toBeCloseTo(HERO_WALK_SPEED * FIXED_DT, 12);
  });

  it('se detiene contra un muro/roca sin atravesarlo y sin emitir wall-bounce', () => {
    const room = makeRoom();
    room.hazards.push({ id: 'rock-1', kind: 'rock', position: { x: 2, y: 0 }, width: 1, height: 1 });
    const world = createWorld(room);
    const events = createEventQueue(64);
    world.heroMove.x = 1; // camina en línea recta hacia la roca

    const collected: GameEvent[] = [];
    for (let i = 0; i < 200; i++) {
      stepWorld(world, events);
      drainEvents(events, (e) => collected.push({ ...e }));
    }

    const rockMinX = 2 - 1 / 2; // borde izquierdo de la roca (position.x - width/2)
    const stopX = rockMinX - world.hero.radius;
    expect(world.hero.position.x).toBeLessThanOrEqual(stopX + 1e-9); // nunca atraviesa
    expect(world.hero.position.x).toBeCloseTo(stopX, 6); // y se queda pegado justo ahí, no antes
    expect(collected.some((e) => e.type === 'wall-bounce')).toBe(false);
  });

  it('con fallingUntil > 0 (cayendo a un foso) no se mueve', () => {
    const world = createWorld(makeRoom());
    const events = createEventQueue(8);
    world.heroMove.x = 1;
    world.fallingUntil = world.time + 10;
    const start = { x: world.hero.position.x, y: world.hero.position.y };

    stepHeroWalk(world);
    expect(world.hero.position.x).toBe(start.x);
    expect(world.hero.position.y).toBe(start.y);

    for (let i = 0; i < 10; i++) stepWorld(world, events);
    expect(world.hero.position.x).toBe(start.x);
    expect(world.hero.position.y).toBe(start.y);
  });
});

describe('heroWalkFactor (tarea 2: cuánto manda el paseo este tick, en [0,1])', () => {
  /** Mundo en fase 'playing', sin apuntar ni caer, con una tecla de movimiento pulsada. */
  function playingWorldWithMove(): World {
    const world = createWorld(makeRoom());
    world.heroMove.x = 1;
    world.heroMove.y = 0;
    return world;
  }

  it('vale 1 con el héroe en reposo (velocidad 0) y una tecla de movimiento pulsada', () => {
    const world = playingWorldWithMove();
    expect(world.hero.velocity.x).toBe(0);
    expect(world.hero.velocity.y).toBe(0);
    expect(heroWalkFactor(world)).toBe(1);
  });

  it('vale 0 en cuanto la velocidad física iguala o supera HERO_WALK_SPEED (lanzamiento en curso: intocable)', () => {
    const world = playingWorldWithMove();
    world.hero.velocity.x = HERO_WALK_SPEED; // exactamente en el umbral
    expect(heroWalkFactor(world)).toBe(0);

    world.hero.velocity.x = HERO_WALK_SPEED + 5; // muy por encima
    expect(heroWalkFactor(world)).toBe(0);
  });

  it('interpola linealmente entre 1 (en reposo) y 0 (a HERO_WALK_SPEED)', () => {
    const world = playingWorldWithMove();

    world.hero.velocity.x = HERO_WALK_SPEED * 0.5;
    expect(heroWalkFactor(world)).toBeCloseTo(0.5, 12);

    world.hero.velocity.x = HERO_WALK_SPEED * 0.25;
    expect(heroWalkFactor(world)).toBeCloseTo(0.75, 12);

    // También con la velocidad repartida en ambos ejes: el factor depende
    // del MÓDULO de hero.velocity, no de un eje suelto.
    world.hero.velocity.x = 0;
    world.hero.velocity.y = HERO_WALK_SPEED * 0.9;
    expect(heroWalkFactor(world)).toBeCloseTo(0.1, 12);
  });

  it('vale 0 fuera de la fase playing, aunque el héroe esté en reposo', () => {
    const world = playingWorldWithMove();
    world.phase = 'paused';
    expect(heroWalkFactor(world)).toBe(0);
  });

  it('vale 0 mientras se apunta, aunque el héroe esté en reposo', () => {
    const world = playingWorldWithMove();
    world.heroAiming = true;
    expect(heroWalkFactor(world)).toBe(0);
  });

  it('vale 0 cayendo a un foso, aunque el héroe esté en reposo', () => {
    const world = playingWorldWithMove();
    world.fallingUntil = world.time + 10;
    expect(heroWalkFactor(world)).toBe(0);
  });

  it('vale 0 con el vector de movimiento nulo, aunque el héroe esté en reposo', () => {
    const world = createWorld(makeRoom()); // heroMove nace en {0,0}
    expect(heroWalkFactor(world)).toBe(0);
  });
});
