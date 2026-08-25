/**
 * Tests de navegación compartida (GDD §7): evitación de hazards/barriles en
 * el steering local, y contención de aggro por sala.
 */

import { describe, expect, it } from 'vitest';
import { stepEnemyAi } from './ai';
import { PATROL_HALF_TURN_DURATION, PATROL_TURN_RATE } from './constants';
import { SPIKE_PATROL_SPEED } from './spike/constants';
import { generateDungeon } from '@/game/features/dungeon/dungeon';
import { createDungeonWorld } from '@/game/features/dungeon/dungeon-world';
import { createEventQueue, drainEvents } from '@/engine/events';
import { stepWorld } from '@/game/world/step';
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

describe('navegación: evitación de hazards', () => {
  it('un Chaser rodea un foso interpuesto sin caer en él', () => {
    // Foso entre el chaser y el héroe.
    const pit: HazardSpawn = {
      id: 'pit-1',
      kind: 'pit',
      position: { x: 0, y: 4 },
      width: 2.5,
      height: 2.5,
    };
    const world = makeWorld([{ id: 'c1', kind: 'chaser', position: { x: 0, y: 8 } }], [pit]);
    world.hero.position.x = 0;
    world.hero.position.y = 0;

    const box = {
      minX: pit.position.x - pit.width / 2,
      maxX: pit.position.x + pit.width / 2,
      minY: pit.position.y - pit.height / 2,
      maxY: pit.position.y + pit.height / 2,
    };
    // 6 s de persecución: en ningún tick el centro del chaser entra en el foso.
    for (let i = 0; i < 360; i++) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
      const c = world.enemies[0];
      const inside =
        c.position.x >= box.minX &&
        c.position.x <= box.maxX &&
        c.position.y >= box.minY &&
        c.position.y <= box.maxY;
      expect(inside).toBe(false);
    }
    // Y aún así progresa hacia el héroe (rodeó el foso).
    const c = world.enemies[0];
    expect(Math.hypot(c.position.x - 0, c.position.y - 0)).toBeLessThan(4);
  });
});

describe('evitación de barriles (regresión: chaser inmolándose)', () => {
  it('un chaser con barriles entre él y el héroe los rodea sin detonarlos', () => {
    // Reproduce la sala de pruebas: héroe arriba, chaser abajo, dos barriles
    // en la ruta directa. Sin este guard, el chaser detonaba un barril al
    // pasar y moría solo en <2 s (visto en preview, 2026-07-03).
    const world = makeWorld([
      { id: 'c1', kind: 'chaser', position: { x: 2.5, y: -4.5 } },
    ], [
      { id: 'b1', kind: 'barrel', position: { x: 2, y: -2 }, width: 0.8, height: 0.8 },
      { id: 'b2', kind: 'barrel', position: { x: 3.2, y: -2.4 }, width: 0.8, height: 0.8 },
    ]);
    world.hero.position.x = 0;
    world.hero.position.y = 6;
    const events = createEventQueue(64);
    for (let i = 0; i < 300; i++) {
      stepWorld(world, events);
      drainEvents(events, () => undefined);
    }
    const chaser = world.enemies[0];
    expect(chaser.hp).toBe(chaser.maxHp);
    expect(world.barrels.every((b) => !b.exploded)).toBe(true);
    // Y progresó hacia el héroe (no se quedó atascado tras los barriles).
    expect(Math.hypot(chaser.position.x - 0, chaser.position.y - 6)).toBeLessThan(3);
  });
});

describe('contención de aggro por sala (punto 7 de playtest ronda 3)', () => {
  it('un enemigo de sala NO visitada patrulla con normalidad pero no persigue aunque el héroe esté cerca al otro lado del muro', () => {
    // Mismo patrón de pool que dungeon-world.test.ts (6 salas: el generador
    // exige ROOMS_PER_RUN para materializar la topología). El chaser vive en
    // 'combat-1' con un tramo de patrulla conocido.
    const pool: RoomData[] = [
      {
        version: 1,
        id: 'start-1',
        name: 'Sala start-1',
        width: 9,
        height: 9,
        playerStart: { x: 0, y: 0 },
        tags: ['inicio'],
        doorSlots: [
          { side: 'north', offset: 0 },
          { side: 'south', offset: 0 },
          { side: 'east', offset: 0 },
          { side: 'west', offset: 0 },
        ],
        enemies: [],
        hazards: [],
        items: [],
      },
      {
        version: 1,
        id: 'combat-1',
        name: 'Sala combat-1',
        width: 9,
        height: 9,
        playerStart: { x: 0, y: 0 },
        tags: ['combate'],
        doorSlots: [
          { side: 'north', offset: 0 },
          { side: 'south', offset: 0 },
          { side: 'east', offset: 0 },
          { side: 'west', offset: 0 },
        ],
        enemies: [
          { id: 'chaser-1', kind: 'chaser', position: { x: -3.5, y: 0 }, patrolTarget: { x: -1.5, y: 0 } },
        ],
        hazards: [],
        items: [],
      },
      {
        version: 1,
        id: 'combat-2',
        name: 'Sala combat-2',
        width: 9,
        height: 9,
        playerStart: { x: 0, y: 0 },
        tags: ['combate'],
        doorSlots: [
          { side: 'north', offset: 0 },
          { side: 'south', offset: 0 },
          { side: 'east', offset: 0 },
          { side: 'west', offset: 0 },
        ],
        enemies: [{ id: 'd2', kind: 'dummy', position: { x: 2, y: 2 } }],
        hazards: [],
        items: [],
      },
      {
        version: 1,
        id: 'combat-3',
        name: 'Sala combat-3',
        width: 9,
        height: 9,
        playerStart: { x: 0, y: 0 },
        tags: ['combate'],
        doorSlots: [
          { side: 'north', offset: 0 },
          { side: 'south', offset: 0 },
          { side: 'east', offset: 0 },
          { side: 'west', offset: 0 },
        ],
        enemies: [{ id: 'd3', kind: 'dummy', position: { x: 2, y: 2 } }],
        hazards: [],
        items: [],
      },
      {
        version: 1,
        id: 'key-1',
        name: 'Sala key-1',
        width: 9,
        height: 9,
        playerStart: { x: 0, y: 0 },
        tags: ['llave'],
        doorSlots: [
          { side: 'north', offset: 0 },
          { side: 'south', offset: 0 },
          { side: 'east', offset: 0 },
          { side: 'west', offset: 0 },
        ],
        enemies: [{ id: 'd4', kind: 'dummy', position: { x: 2, y: 2 } }],
        hazards: [],
        items: [{ id: 'key-item', kind: 'key', position: { x: 0, y: 0 } }],
      },
      {
        version: 1,
        id: 'boss-1',
        name: 'Sala boss-1',
        width: 9,
        height: 9,
        playerStart: { x: 0, y: 0 },
        tags: ['jefe'],
        doorSlots: [
          { side: 'north', offset: 0 },
          { side: 'south', offset: 0 },
          { side: 'east', offset: 0 },
          { side: 'west', offset: 0 },
        ],
        enemies: [{ id: 'boss-enemy', kind: 'dummy', position: { x: 0, y: 0 } }],
        hazards: [],
        items: [],
      },
      {
        version: 1,
        id: 'shop-1',
        name: 'Sala shop-1',
        width: 9,
        height: 9,
        playerStart: { x: 0, y: 0 },
        tags: ['tienda'],
        doorSlots: [
          { side: 'north', offset: 0 },
          { side: 'south', offset: 0 },
          { side: 'east', offset: 0 },
          { side: 'west', offset: 0 },
        ],
        enemies: [],
        hazards: [],
        items: [{ id: 'shopkeeper', kind: 'shopkeeper', position: { x: 0, y: 0 } }],
      },
    ];

    const dungeon = generateDungeon(10, pool);
    const world = createDungeonWorld(dungeon, 10);
    const events = createEventQueue(64);

    const combatRuntime = world.roomRuntimes.get('combat-1')!;
    const chaser = world.enemies.find((e) => e.roomId === 'combat-1' && e.kind === 'chaser')!;
    expect(chaser).toBeDefined();

    // Con esta semilla, 'combat-1' no es la sala de inicio: sigue sin
    // visitar mientras el héroe no entre en ella.
    expect(combatRuntime.visited).toBe(false);
    expect(world.currentRoomId).not.toBe('combat-1');

    // Sitúa al héroe pegado al borde de SU sala actual más cercano al centro
    // de la sala del chaser (en línea recta hacia él, "al otro lado del
    // muro" en el sentido del punto 7: cerca en distancia absoluta, pero sin
    // cruzar nunca a su sala), y lo deja quieto ahí.
    const heroRuntime = world.roomRuntimes.get(world.currentRoomId)!;
    const towardX = combatRuntime.bounds.minX + (combatRuntime.bounds.maxX - combatRuntime.bounds.minX) / 2;
    const towardY = combatRuntime.bounds.minY + (combatRuntime.bounds.maxY - combatRuntime.bounds.minY) / 2;
    world.hero.position.x = Math.min(Math.max(towardX, heroRuntime.bounds.minX + 0.3), heroRuntime.bounds.maxX - 0.3);
    world.hero.position.y = Math.min(Math.max(towardY, heroRuntime.bounds.minY + 0.3), heroRuntime.bounds.maxY - 0.3);
    world.hero.velocity.x = 0;
    world.hero.velocity.y = 0;

    // 3 s de simulación: suficiente para varias idas/vueltas de patrulla.
    for (let i = 0; i < 180; i++) {
      stepWorld(world, events);
      drainEvents(events, () => undefined);
      // El héroe nunca debe haber cruzado a la sala del chaser en este test.
      expect(world.currentRoomId).not.toBe('combat-1');
    }

    // La sala del chaser sigue sin visitar (el héroe no ha entrado).
    expect(combatRuntime.visited).toBe(false);
    // Nunca activa persecución...
    expect(chaser.chasing).toBe(false);
    // ...y se ha movido dentro de su tramo de patrulla, en coordenadas de
    // MUNDO (patrolFrom/patrolTo ya incluyen el origin de la sala): sigue
    // vivo, no está congelado, pero tampoco se ha acercado a la posición
    // absoluta del héroe más allá de su tramo asignado.
    const patrolMinX = Math.min(chaser.patrolFrom.x, chaser.patrolTo.x) - 0.1;
    const patrolMaxX = Math.max(chaser.patrolFrom.x, chaser.patrolTo.x) + 0.1;
    expect(chaser.position.x).toBeGreaterThanOrEqual(patrolMinX);
    expect(chaser.position.x).toBeLessThanOrEqual(patrolMaxX);
  });
});

/**
 * Encargo de playtest (corrección 2026-08-25 sobre un primer intento del
 * 2026-08-24 que hacía "derivar" al enemigo durante el giro en vez de
 * pararlo del todo): al llegar a un extremo de su ruta, un enemigo en
 * patrulla se PARA EN SECO —misma x,y exacta— y, una vez quieto, gira sobre
 * sí mismo a velocidad angular CONSTANTE (PATROL_TURN_RATE) hasta encarar el
 * nuevo waypoint; solo entonces reanuda la marcha. El giro es estado de la
 * SIM (`enemy.facing`), no un efecto del damping del render: la sim sabe con
 * certeza cuándo el giro ha terminado y nunca arranca a moverse mientras el
 * cuerpo todavía está girando. Escenario ÚNICO para los 5 puntos: un Spike
 * patrullando SOLO en un tramo recto de 2 u en el eje x (0,0)→(2,0), sin
 * hazards — el Spike no tiene rama de aggro (GDD §7.3, `stepSpike` llama a
 * `stepPatrol` incondicionalmente), así que es el arquetipo más limpio para
 * aislar `stepPatrol` sin depender de la distancia al héroe; el héroe se
 * deja lejos de todos modos (dentro de los límites de la sala, ver nota más
 * abajo) por higiene, para que `stepWorld` (test 5) no genere
 * contacto/separación espurios.
 */
describe('patrulla: para en seco y gira en los extremos de la ruta', () => {
  // Mismo valor que PATROL_ARRIVE_EPS en steering.ts (no exportado: es un
  // detalle interno de "cuándo se considera llegado", no un contrato público).
  const PATROL_ARRIVE_EPS = 0.12;

  function makePatrolWorld(): World {
    const world = makeWorld([
      { id: 's1', kind: 'spike', position: { x: 0, y: 0 }, patrolTarget: { x: 2, y: 0 } },
    ]);
    // Lejos del tramo de patrulla pero DENTRO de los límites de la sala
    // (30×30 ⇒ bounds ±15): un héroe fuera de bounds haría que
    // collideInnerBounds lo empujase con fuerza cada tick en el test 5
    // (stepWorld), contaminando el escenario sin necesidad — el Spike no
    // reacciona a la distancia del héroe de todos modos.
    world.hero.position.x = 10;
    world.hero.position.y = 10;
    return world;
  }

  /**
   * Avanza con stepEnemyAi hasta el tick en que se arma la ventana de giro
   * (patrolTurnUntil pasa a valer más que world.time). 400 ticks de margen:
   * a SPIKE_PATROL_SPEED cubre el tramo de 2 u en ~126.
   */
  function runUntilTurnArmed(world: World): void {
    const enemy = world.enemies[0];
    for (let i = 0; i < 400; i++) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
      if (enemy.patrolTurnUntil > world.time) return;
    }
    throw new Error('la ventana de giro nunca se armó en 400 ticks (patrolTurnUntil se quedó en 0)');
  }

  it('1. llega al waypoint: la distancia al extremo baja de PATROL_ARRIVE_EPS y se arma la ventana', () => {
    const world = makePatrolWorld();
    const enemy = world.enemies[0];
    // Hay que capturar la posición de justo ANTES del tick que arma la
    // ventana: ese tick ya no llama a moveToward (parada en seco, ver
    // stepPatrol), pero por higiene seguimos midiendo con la posición que de
    // verdad cumplió `dist < PATROL_ARRIVE_EPS` dentro de la función, no una
    // posterior.
    let distAtArrival = Infinity;
    let armed = false;
    for (let i = 0; i < 400; i++) {
      const preX = enemy.position.x;
      const preY = enemy.position.y;
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
      if (enemy.patrolTurnUntil > world.time) {
        distAtArrival = Math.hypot(enemy.patrolTo.x - preX, enemy.patrolTo.y - preY);
        armed = true;
        break;
      }
    }
    expect(armed).toBe(true);
    expect(enemy.patrolTurnUntil).toBeGreaterThan(world.time);
    expect(distAtArrival).toBeLessThan(PATROL_ARRIVE_EPS);
  });

  it('2. parado de verdad: durante TODA la ventana, position es EXACTAMENTE la misma y velocity es exactamente {0,0}', () => {
    const world = makePatrolWorld();
    const enemy = world.enemies[0];
    runUntilTurnArmed(world);
    const frozenX = enemy.position.x;
    const frozenY = enemy.position.y;
    let turningTicks = 0;
    while (world.time < enemy.patrolTurnUntil) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
      // toBe (no toBeCloseTo): la parada tiene que ser EXACTA, ni un float de
      // deriva — es justo el fallo del primer intento (PATROL_TURN_DRIFT_SPEED,
      // ya eliminada) que este diseño corrige.
      expect(enemy.position.x).toBe(frozenX);
      expect(enemy.position.y).toBe(frozenY);
      expect(enemy.velocity.x).toBe(0);
      expect(enemy.velocity.y).toBe(0);
      turningTicks++;
    }
    // PATROL_HALF_TURN_DURATION / FIXED_DT = 18 ticks exactos en aritmética
    // real (giro de 180°, el caso típico de una ruta de ida y vuelta); el
    // margen ±1 cubre el redondeo de ir sumando FIXED_DT en coma flotante.
    const expectedTicks = Math.round(PATROL_HALF_TURN_DURATION / FIXED_DT);
    expect(turningTicks).toBeGreaterThanOrEqual(expectedTicks - 1);
    expect(turningTicks).toBeLessThanOrEqual(expectedTicks + 1);
  });

  it('3. gira encarando el nuevo waypoint: pasa por una dirección intermedia y aterriza con error angular ~0', () => {
    const world = makePatrolWorld();
    const enemy = world.enemies[0];
    runUntilTurnArmed(world);
    expect(enemy.patrolForward).toBe(false); // iba hacia patrolTo (+x); ahora vuelve hacia patrolFrom (-x).
    const oldDir = { x: 1, y: 0 }; // rumbo viejo: +x (hacia patrolTo, de donde viene).
    const newDir = { x: -1, y: 0 }; // rumbo nuevo: -x (hacia patrolFrom, a donde gira).
    // Recién armada la ventana, `facing` parte del rumbo de LLEGADA (ver
    // stepPatrol: se captura de la velocidad de entrada) y ya lleva aplicado
    // EXACTAMENTE un paso de giro — el tick de llegada para y empieza a girar
    // en el mismo tick, sin uno muerto en medio (ver test 6 para por qué ese
    // paso adelantado importa). Un paso a PATROL_TURN_RATE es
    // `PATROL_TURN_RATE * FIXED_DT` ≈ 0.1745 rad (10°), así que sigue
    // clarísimamente del lado del rumbo viejo, pero ya no exactamente en él.
    const oneStep = PATROL_TURN_RATE * FIXED_DT;
    const alignToOld = enemy.facing.x * oldDir.x + enemy.facing.y * oldDir.y;
    expect(alignToOld).toBeCloseTo(Math.cos(oneStep), 6);
    expect(alignToOld).toBeGreaterThan(0.9);
    // Duración de la ventana = ángulo a girar / PATROL_TURN_RATE: un giro de
    // 180° (π rad) da exactamente PATROL_HALF_TURN_DURATION — la fórmula de
    // diseño, no solo el conteo de ticks del test 2. Resta un FIXED_DT: al
    // volver, runUntilTurnArmed ya ha incrementado world.time UN tick más
    // allá del instante exacto en que se armó la ventana (su condición de
    // parada se comprueba DESPUÉS de ese incremento), así que lo que queda
    // por delante de world.time es la ventana total menos ese tick ya
    // consumido, no la ventana completa.
    expect(enemy.patrolTurnUntil - world.time).toBeCloseTo(Math.PI / PATROL_TURN_RATE - FIXED_DT, 6);

    const totalTicks = Math.round((enemy.patrolTurnUntil - world.time) / FIXED_DT);
    // ~180°, así que ronda los 18 ticks del test 2; a mitad de camino no debe
    // encarar ni el rumbo viejo ni el nuevo.
    for (let i = 0; i < Math.floor(totalTicks / 2); i++) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
    }
    // A mitad de camino: lejos de ambos extremos. Un giro de 180° es
    // simétrico — puede virar por cualquiera de los dos lados según el
    // signo del residuo de coma flotante con el que `facing` convergió
    // durante la marcha previa (ver stepSpike) — el test no asume cuál de
    // los dos, solo que a mitad de camino está lejos de ambos rumbos
    // extremos (perpendicular a la línea de patrulla, casi todo en Y).
    const dotOld = enemy.facing.x * oldDir.x + enemy.facing.y * oldDir.y;
    const dotNew = enemy.facing.x * newDir.x + enemy.facing.y * newDir.y;
    expect(dotOld).toBeLessThan(0.3);
    expect(dotNew).toBeLessThan(0.3);
    expect(Math.abs(enemy.facing.y)).toBeGreaterThan(0.9);

    while (world.time < enemy.patrolTurnUntil) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
    }
    // Al terminar la ventana: encara el nuevo waypoint con error angular ~0.
    const dotFinal = enemy.facing.x * newDir.x + enemy.facing.y * newDir.y;
    expect(dotFinal).toBeGreaterThan(0.999);
  });

  it('4. reanuda sin pausa extra Y ya encarado: primer tick tras la ventana, a velocidad de patrulla y en la dirección de facing', () => {
    const world = makePatrolWorld();
    const enemy = world.enemies[0];
    runUntilTurnArmed(world);
    while (world.time < enemy.patrolTurnUntil) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
    }
    const facingAtEnd = { x: enemy.facing.x, y: enemy.facing.y };
    // Primer tick tras vencer la ventana: sin tick intermedio a velocidad
    // reducida ni parado — ya a velocidad de patrulla completa, en el mismo
    // tick en que `world.time >= patrolTurnUntil`.
    stepEnemyAi(world, FIXED_DT);
    world.time += FIXED_DT;
    const speed = Math.hypot(enemy.velocity.x, enemy.velocity.y);
    expect(speed).toBeCloseTo(SPIKE_PATROL_SPEED, 5);
    // Y esa velocidad apunta en la dirección que `facing` ya tenía al
    // terminar el giro (ángulo entre ambos < ~2°): es la garantía de "no
    // arranca hasta haber girado lo necesario".
    const velDir = { x: enemy.velocity.x / speed, y: enemy.velocity.y / speed };
    const dot = velDir.x * facingAtEnd.x + velDir.y * facingAtEnd.y;
    expect(dot).toBeGreaterThan(Math.cos((2 * Math.PI) / 180)); // < ~2° de error.
    // ~0.5 s más: progresa claramente hacia el otro extremo (patrolFrom,
    // x=0) desde donde giró (x≈2).
    for (let i = 0; i < 30; i++) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
    }
    expect(enemy.position.x).toBeLessThan(1.7);
  });

  it('5. invariante de ciclo completo: la posición no cambia ni un ápice en ningún tick de giro, y aun así completa varios ciclos', () => {
    // stepWorld completo (no solo stepEnemyAi): confirma que ni la física
    // (fricción, separación de cuerpos) ni ningún otro sistema mueve al
    // enemigo mientras gira — la parada tiene que sostenerse con el
    // pipeline completo, no solo con la IA aislada.
    const world = makePatrolWorld();
    const enemy = world.enemies[0];
    const events = createEventQueue(64);
    let prevX = enemy.position.x;
    let prevY = enemy.position.y;
    let prevForward = enemy.patrolForward;
    let flips = 0;
    // ~10 s de simulación (stepWorld avanza world.time internamente a
    // FIXED_DT, no hace falta sumarlo aquí — a diferencia de los tests de
    // arriba con stepEnemyAi).
    for (let i = 0; i < 600; i++) {
      const wasTurning = world.time < enemy.patrolTurnUntil;
      stepWorld(world, events);
      drainEvents(events, () => undefined);
      if (wasTurning) {
        expect(enemy.position.x).toBe(prevX);
        expect(enemy.position.y).toBe(prevY);
      }
      prevX = enemy.position.x;
      prevY = enemy.position.y;
      if (enemy.patrolForward !== prevForward) {
        flips++;
        prevForward = enemy.patrolForward;
      }
    }
    // Cada tramo (~2 u a 0.95 u/s ≈ 2.1 s) + giro (0.3 s) ≈ 2.4 s; en ~10 s
    // caben de sobra varias idas/vueltas — la parada no lo deja atascado.
    expect(flips).toBeGreaterThanOrEqual(3);
  });

  it('6. el giro termina UN TICK ANTES de que venza la ventana, para que el render no llegue tarde', () => {
    // Regresión de un ajuste sutil (medido con una sonda sobre el pipeline
    // completo): el tick de LLEGADA da ya el primer paso de giro, así que
    // `facing` alcanza el rumbo nuevo antes del último tick de la ventana y
    // queda un tick de colchón. Sin ese colchón, el último paso caía justo en
    // el tick que cierra la ventana y el frame de render de ese instante ya
    // evalúa `world.time < patrolTurnUntil` como falso: EnemyViews saldría
    // del modo "sigue a la sim" con ~10° sin aplicar (un paso de un giro de
    // 180°), y ese resto se acabaría amortiguando con el enemigo YA en
    // marcha — exactamente el solapamiento giro/arranque que este encargo
    // elimina. Si alguien reordena `stepPatrol` y el tick de llegada deja de
    // girar, este test cae.
    const world = makePatrolWorld();
    const enemy = world.enemies[0];
    runUntilTurnArmed(world);
    // Recorre la ventana guardando el encaramiento (producto escalar de
    // `facing` con la dirección unitaria al nuevo waypoint) de cada tick.
    const alignmentPerTick: number[] = [];
    while (world.time < enemy.patrolTurnUntil) {
      stepEnemyAi(world, FIXED_DT);
      world.time += FIXED_DT;
      const dx = enemy.patrolFrom.x - enemy.position.x;
      const dy = enemy.patrolFrom.y - enemy.position.y;
      const len = Math.hypot(dx, dy);
      alignmentPerTick.push((enemy.facing.x * dx + enemy.facing.y * dy) / len);
    }
    // El ÚLTIMO tick de la ventana ya muestra el rumbo final exacto (no "casi"):
    // es el frame que el render aún dibuja en modo giro.
    expect(alignmentPerTick[alignmentPerTick.length - 1]).toBeGreaterThan(0.999999);
    // Y el penúltimo también: el colchón existe de verdad, el giro no se
    // completó en el último instante posible.
    expect(alignmentPerTick[alignmentPerTick.length - 2]).toBeGreaterThan(0.999999);
    // Pero a mitad de ventana todavía estaba girando (no es que no gire nada).
    expect(alignmentPerTick[Math.floor(alignmentPerTick.length / 2)]).toBeLessThan(0.9);
  });
});
