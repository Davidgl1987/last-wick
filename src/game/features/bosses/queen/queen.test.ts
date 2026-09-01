/**
 * Tests de la Reina del Enjambre (GDD §15.3, Fase B2 de docs/plans/BOSSES_PLAN.md,
 * simplificación 2026-08-31: columnas + minions + persecución, se elimina el
 * rol guardiana): cadencia de parto de minions POR COLUMNA + cap de vivas,
 * rastro que crece con la fase, vulnerabilidad permanente (sin ventana),
 * larvas de 1 HP con comportamiento por fase (recta en fase 1, persecución en
 * 2/3), columnas a 2 golpes (agrieta→rompe) con grito del jefe al romperse,
 * persecución del jefe con incrementos moderados por columna rota,
 * `boss-queen.json` válido contra room-format.ts, y que el generador
 * procedural puede producir tanto la sala de la Reina como la del Guardián
 * (sorteo entre salas 'jefe').
 */

import { describe, expect, it } from 'vitest';
import bossQueenJson from '@/game/features/dungeon/levels/boss-queen.json';
import { HERO_RADIUS, HERO_WALK_SPEED } from '@/game/features/hero/constants';
import { RAM_SPEED_THRESHOLD } from '@/game/features/combat/constants';
import { getRoomPool } from '@/game/features/dungeon/rooms';
import { applyDamageToEnemy, stepHeroEnemyContacts } from '@/game/features/combat/combat';
import { generateDungeon } from '@/game/features/dungeon/dungeon';
import { createEventQueue } from '@/engine/events';
import { parseRoomData } from '@/game/features/dungeon/room-format';
import type { EnemySpawn, RoomData, RoomTag } from '@/game/world/types';
import { createWorld } from '@/game/world/create';
import { initBossEnemies, stepBosses } from '@/game/features/bosses/lifecycle';
import { getBossDef } from '@/game/features/bosses/registry';
import { collectTypes } from '@/game/features/bosses/test-helpers';
import { queenState, stepQueenColumns } from './columns';
import { QUEEN_COLUMN_DAMAGE_FRACTION, QUEEN_COLUMN_HIT_COOLDOWN, QUEEN_COLUMN_HP, QUEEN_COLUMN_SPAWN_INTERVAL_BY_PHASE, QUEEN_COLUMN_STUN_DURATION, QUEEN_DAMAGE_OUTSIDE_WINDOW, QUEEN_HIT_DAMAGE_CAP_FRACTION, QUEEN_LARVA_HP, QUEEN_LARVA_MAX, QUEEN_MAX_HP, QUEEN_RADIUS, QUEEN_STALK_SPEED_BASE, QUEEN_STALK_SPEED_PER_COLUMN, QUEEN_TRAIL_DROP_INTERVAL, QUEEN_TRAIL_DROP_INTERVAL_PHASE2, QUEEN_TRAIL_PUDDLE_LIFETIME, QUEEN_TRAIL_PUDDLE_RADIUS } from './constants';

const FIXED_DT = 1 / 60;

function makeRoom(partial: Partial<RoomData> = {}): RoomData {
  return {
    version: 1,
    id: 'queen-room',
    name: 'Sala de la Reina',
    width: 15,
    height: 15,
    playerStart: { x: 0, y: 6 },
    tags: ['jefe'] as RoomTag[],
    doorSlots: [],
    enemies: [],
    hazards: [],
    items: [],
    ...partial,
  };
}

function makeQueenWorld(opts: { bossSpawn?: Partial<EnemySpawn> } = {}) {
  const spawn: EnemySpawn = {
    id: 'boss-1',
    kind: 'boss',
    bossId: 'queen',
    position: { x: 0, y: 0 },
    ...opts.bossSpawn,
  };
  const world = createWorld(makeRoom({ enemies: [spawn] }));
  initBossEnemies(world);
  return world;
}

function advance(world: ReturnType<typeof createWorld>, events: ReturnType<typeof createEventQueue>, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    stepBosses(world, FIXED_DT, events);
    world.time += FIXED_DT;
  }
}

function boss(world: ReturnType<typeof createWorld>) {
  return world.enemies.find((e) => e.id === 'boss-1')!;
}

function liveLarvae(world: ReturnType<typeof createWorld>) {
  return world.enemies.filter((e) => e.id.startsWith('queen-larva-') && e.hp > 0);
}

describe('Reina del Enjambre: definición', () => {
  it('tiene 55 HP, techo de daño 60/65/70%, y al cuerpo le entra daño REDUCIDO fuera de aturdimiento (rediseño 2026-07-10), GDD §15.6', () => {
    const def = getBossDef('queen');
    expect(def.maxHp).toBe(QUEEN_MAX_HP);
    expect(def.maxHp).toBe(55);
    expect(def.hitDamageCapFraction).toEqual(QUEEN_HIT_DAMAGE_CAP_FRACTION);
    // Rediseño 2026-07-10 (GDD §15.3): su vida está en las columnas, pero al
    // cuerpo SIEMPRE le entra daño; fuera de aturdimiento se escala por este
    // factor pequeño (no es inmune, ver describe de abajo).
    expect(def.damageOutsideWindow).toBe(QUEEN_DAMAGE_OUTSIDE_WINDOW);
    expect(QUEEN_DAMAGE_OUTSIDE_WINDOW).toBeGreaterThan(0);
    expect(QUEEN_DAMAGE_OUTSIDE_WINDOW).toBeLessThan(1);
  });
});

describe('Reina: accessor de estado vacío-seguro (queenState)', () => {
  it('en un mundo sin reina, queenState devuelve un estado con columns=[] (nunca null)', () => {
    // Sala sin jefe ni columnas: bossState arranca en null (world/create.ts).
    const world = createWorld(makeRoom());
    expect(world.bossState).toBeNull();
    const state = queenState(world);
    expect(state.columns).toEqual([]);
    // Los consumidores pueden leer .columns sin comprobar (QueenColumnsView
    // monta siempre, GameRoot lo monta incondicionalmente).
    expect(state.columns.length).toBe(0);
  });
});

describe('Reina: reserva de slots de larva al inicializarse (onInit)', () => {
  it('preasigna QUEEN_LARVA_MAX slots de larva inactivos (hp=0) desde el primer tick', () => {
    const world = makeQueenWorld();
    const larvaSlots = world.enemies.filter((e) => e.id.startsWith('queen-larva-'));
    expect(larvaSlots.length).toBe(QUEEN_LARVA_MAX);
    expect(larvaSlots.every((l) => l.hp <= 0)).toBe(true);
    expect(larvaSlots.every((l) => l.kind === 'dummy')).toBe(true);
  });

  it('el radio real de la Reina es QUEEN_RADIUS (colisión y render escalan con él)', () => {
    const world = makeQueenWorld();
    expect(boss(world).radius).toBeCloseTo(QUEEN_RADIUS, 6);
  });
});

describe('Reina: al cuerpo le entra daño REDUCIDO salvo aturdida (rediseño 2026-07-10, GDD §15.3: la vía real son las columnas)', () => {
  it('bossVulnerable es false mientras no rompas columnas (y se mantiene al avanzar la sim)', () => {
    const world = makeQueenWorld();
    const events = createEventQueue(64);
    expect(boss(world).bossVulnerable).toBe(false);
    advance(world, events, 600); // 10s, sin columnas que romper
    expect(boss(world).bossVulnerable).toBe(false);
  });

  it('un proyectil/arma normal (sin bypass) le hace daño REDUCIDO por QUEEN_DAMAGE_OUTSIDE_WINDOW: algo, ni cero ni completo', () => {
    const world = makeQueenWorld();
    const events = createEventQueue(64);
    const q = boss(world);
    const hpBefore = q.hp;
    applyDamageToEnemy(world, q, 10, 1, 0, events);
    expect(q.hp).toBeCloseTo(hpBefore - 10 * QUEEN_DAMAGE_OUTSIDE_WINDOW, 5);
    expect(q.hp).toBeLessThan(hpBefore); // le entra algo
    expect(q.hp).toBeGreaterThan(hpBefore - 10); // pero reducido, no completo
  });

  it('con bypass de ventana explícito (embestida/columna) SÍ recibe el daño pasado', () => {
    const world = makeQueenWorld();
    const events = createEventQueue(64);
    const q = boss(world);
    const hpBefore = q.hp;
    applyDamageToEnemy(world, q, 10, 1, 0, events, true);
    expect(q.hp).toBe(hpBefore - 10);
  });
});

// ── Simplificación 2026-08-31 (GDD §15.3, playtest: "eliminar el rol
// guardiana"): los minions nacen de las COLUMNAS, no del cuerpo del jefe.
// Sustituye la antigua oleada única sincronizada (`queenStepWaves`,
// `QUEEN_WAVE_INTERVAL`, `QUEEN_CHASER_PER_WAVE_BY_PHASE`) por un reloj POR
// COLUMNA (`QueenColumn.spawnTimer`, `QUEEN_COLUMN_SPAWN_INTERVAL_BY_PHASE`).

describe('Reina: cadencia de parto de minions desde las columnas (simplificación 2026-08-31)', () => {
  it('una columna viva pare un minion al vencer su spawnTimer, fuera de su propio cuerpo (distancia ≥ halfW) y con chasing=true', () => {
    const world = makeQueenWorldWithColumns(); // 2 columnas en (±3,0), offsets 0 y mitad del intervalo
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;

    expect(liveLarvae(world).length).toBe(0);

    // column-a (índice 0, offset=0 por ser la 1.ª) pare en el primer tick.
    advance(world, events, 1);
    const larvae = liveLarvae(world);
    expect(larvae.length).toBeGreaterThanOrEqual(1);

    const col = queenState(world).columns[0];
    const larva = larvae[0];
    expect(larva.chasing).toBe(true); // único rol: perseguidora
    const dist = Math.hypot(larva.position.x - col.position.x, larva.position.y - col.position.y);
    expect(dist).toBeGreaterThanOrEqual(col.halfW); // nace FUERA del cuerpo de la columna, no en su centro

    const types = collectTypes(events);
    expect(types).toContain('boss-wave-spawn'); // evento genérico, sin cambios de contrato
    expect(types).toContain('boss-column-spawn'); // evento nuevo: ceniza/polvo + temblor de la columna
  });

  it('cada larva nace con QUEEN_LARVA_HP (1 hp, GDD §15.6 "1 daño de contacto" implica 1 golpe basta)', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;
    advance(world, events, 1);

    const larvae = liveLarvae(world);
    expect(larvae.length).toBeGreaterThan(0);
    for (const larva of larvae) {
      expect(larva.hp).toBe(QUEEN_LARVA_HP);
      expect(larva.maxHp).toBe(QUEEN_LARVA_HP);
      expect(QUEEN_LARVA_HP).toBe(1);
    }
  });

  it('una columna ROTA deja de generar (se filtra por !broken)', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;
    queenState(world).columns[0].broken = true; // rompe la columna con offset=0 (parturienta del tick 1)

    advance(world, events, 1);
    expect(liveLarvae(world).length).toBe(0); // la columna rota no pare nada
  });

  it('con la mitad de las columnas rotas nacen aproximadamente la mitad de minions en la misma ventana de tiempo (menos fuentes → menos minions)', () => {
    // 2 columnas: offsets 0 e intervalo/2 (fase 1). Checkpoint pasado el 1.er
    // ciclo de AMBAS (la 2.ª pare a mitad de intervalo) pero antes de que
    // cualquiera pare por 2.ª vez (a partir de +intervalo desde su offset).
    const interval = QUEEN_COLUMN_SPAWN_INTERVAL_BY_PHASE[0]; // fase 1
    const checkpointSeconds = interval / 2 + 1;
    const larvaeAfterCheckpoint = (breakSecondColumn: boolean) => {
      const world = makeQueenWorldWithColumns();
      const events = createEventQueue(64);
      world.hero.position.x = 100;
      world.hero.position.y = 100;
      if (breakSecondColumn) queenState(world).columns[1].broken = true;
      advance(world, events, Math.round(checkpointSeconds / FIXED_DT));
      return liveLarvae(world).length;
    };

    const full = larvaeAfterCheckpoint(false);
    const half = larvaeAfterCheckpoint(true);
    expect(full).toBe(2); // las 2 columnas ya parieron su 1.ª larva
    expect(half).toBe(1); // solo la columna viva
    expect(half / full).toBeCloseTo(0.5, 5);
  });

  it('con TODAS las columnas rotas no nace ningún minion nuevo', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;
    for (const col of queenState(world).columns) col.broken = true;

    advance(world, events, Math.round(20 / FIXED_DT)); // tiempo de sobra para varios ciclos
    expect(liveLarvae(world).length).toBe(0);
    expect(collectTypes(events)).not.toContain('boss-column-spawn');
  });
});

describe('Reina: comportamiento de larvas por fase (GDD §15.3, playtest 2026-07-06: persiguen desde fase 1)', () => {
  it('fase 1: la larva YA persigue de verdad (recalcula dirección hacia la posición actual del héroe, no línea recta fija)', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue(64);
    world.hero.position.x = 20;
    world.hero.position.y = 0;
    advance(world, events, 1); // column-a (offset=0) pare su 1.ª larva en el primer tick
    expect(boss(world).bossPhase).toBe(1);

    const larva = liveLarvae(world)[0];
    expect(larva).toBeDefined();
    const facingBefore = { x: larva.facing.x, y: larva.facing.y };

    // El héroe se teletransporta lejos de esa dirección inicial; en fase 1 la
    // larva DEBE corregir su rumbo (playtest 2026-07-06: "en línea recta no
    // amenazaban; el reto llegaba tarde" — ya no hay modo línea recta fija).
    advance(world, events, 30);
    world.hero.position.x = 0;
    world.hero.position.y = -20;
    advance(world, events, 30);
    expect(larva.facing.x).not.toBeCloseTo(facingBefore.x, 1);
    const dx = world.hero.position.x - larva.position.x;
    const dy = world.hero.position.y - larva.position.y;
    const len = Math.hypot(dx, dy) || 1;
    expect(larva.facing.x).toBeCloseTo(dx / len, 1);
    expect(larva.facing.y).toBeCloseTo(dy / len, 1);
  });

  it('fase 2/3: la larva persigue igual (recalcula dirección hacia la posición actual del héroe), más rápido', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue(64);
    const q = boss(world);
    q.hp = Math.floor(q.maxHp * 0.6); // fuerza fase 2 en el próximo stepBosses
    world.hero.position.x = 20;
    world.hero.position.y = 0;
    advance(world, events, 1); // aplica el cambio de fase Y column-a pare su 1.ª larva (mismo tick)
    expect(q.bossPhase).toBe(2);

    const larva = liveLarvae(world)[0];
    expect(larva).toBeDefined();

    // Cambia la posición del héroe: en fase 2, la larva debe re-orientarse hacia la NUEVA posición.
    world.hero.position.x = 0;
    world.hero.position.y = -20;
    advance(world, events, 5);
    const dx = world.hero.position.x - larva.position.x;
    const dy = world.hero.position.y - larva.position.y;
    const len = Math.hypot(dx, dy) || 1;
    expect(larva.facing.x).toBeCloseTo(dx / len, 1);
    expect(larva.facing.y).toBeCloseTo(dy / len, 1);
  });
});

describe('Reina: el cap TOTAL de larvas vivas nunca se supera (simplificación 2026-08-31)', () => {
  it('en cualquier fase, con las 8 columnas activas (sala real), nunca hay más de QUEEN_LARVA_MAX larvas vivas', () => {
    for (const frac of [1.0, 0.6, 0.2]) {
      const room = parseRoomData(bossQueenJson).room!;
      const world = createWorld(room);
      initBossEnemies(world);
      const events = createEventQueue(64);
      world.hero.position.x = 100;
      world.hero.position.y = 100;
      const q = boss(world);
      q.hp = Math.floor(q.maxHp * frac);
      advance(world, events, 1);

      let maxLive = 0;
      const windowTicks = Math.round(30 / FIXED_DT); // 30s: de sobra para varios ciclos de las 8 columnas
      for (let i = 0; i < windowTicks; i++) {
        stepBosses(world, FIXED_DT, events);
        world.time += FIXED_DT;
        maxLive = Math.max(maxLive, liveLarvae(world).length);
      }
      expect(maxLive).toBeLessThanOrEqual(QUEEN_LARVA_MAX);
    }
  });
});

describe('Reina: rastro permanente que crece con la fase (GDD §15.3, "como el Trail pero más grande y duradero")', () => {
  it('deja charcos en world.puddles con radio/vida propios (mayores que los del Trail normal)', () => {
    const world = makeQueenWorld();
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;

    advance(world, events, Math.round(QUEEN_TRAIL_DROP_INTERVAL / FIXED_DT) + 5);
    const active = world.puddles.filter((p) => p.active);
    expect(active.length).toBeGreaterThan(0);
    for (const puddle of active) {
      expect(puddle.radius).toBeCloseTo(QUEEN_TRAIL_PUDDLE_RADIUS, 6);
      expect(puddle.ttl).toBeGreaterThan(0);
      expect(puddle.ttl).toBeLessThanOrEqual(QUEEN_TRAIL_PUDDLE_LIFETIME);
    }
    // Mayor que el charco del Trail normal (GDD §15.3: "más grande y duradero").
    expect(QUEEN_TRAIL_PUDDLE_RADIUS).toBeGreaterThan(0.45); // TRAIL_PUDDLE_RADIUS
    expect(QUEEN_TRAIL_PUDDLE_LIFETIME).toBeGreaterThan(3.2); // TRAIL_PUDDLE_LIFETIME
  });

  it('fase 2 (66%): el rastro se genera más rápido que en fase 1', () => {
    expect(QUEEN_TRAIL_DROP_INTERVAL_PHASE2).toBeLessThan(QUEEN_TRAIL_DROP_INTERVAL);

    const world = makeQueenWorld();
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;

    // Fase 1: cuenta charcos soltados en una ventana fija.
    const windowTicks = Math.round(3 / FIXED_DT); // 3s de ventana de medida
    advance(world, events, windowTicks);
    const countPhase1 = world.puddles.filter((p) => p.active).length;

    // Vacía el pool (desactiva todos) para medir limpio en fase 2.
    for (const p of world.puddles) p.active = false;

    const q = boss(world);
    q.hp = Math.floor(q.maxHp * 0.6);
    advance(world, events, 1);
    expect(q.bossPhase).toBe(2);
    q.bossCounter = 0; // reinicia el reloj de rastro para medir la ventana completa en fase 2

    advance(world, events, windowTicks);
    const countPhase2 = world.puddles.filter((p) => p.active).length;

    expect(countPhase2).toBeGreaterThan(countPhase1);
  });
});

describe('Reina: poción de recompensa al cambiar de fase (mismo criterio que el Guardián, GDD §15.2/§15.3)', () => {
  it('suelta 1 poción al cruzar a fase 2 y otra al cruzar a fase 3', () => {
    const world = makeQueenWorld();
    const events = createEventQueue(64);
    const q = boss(world);
    world.hero.position.x = 100;
    world.hero.position.y = 100;

    const activePotions = () => world.items.filter((i) => i.active && i.kind === 'potion');
    expect(activePotions().length).toBe(0);

    q.hp = Math.floor(q.maxHp * 0.6);
    advance(world, events, 1);
    expect(q.bossPhase).toBe(2);
    expect(activePotions().length).toBe(1);

    q.hp = Math.floor(q.maxHp * 0.2);
    advance(world, events, 1);
    expect(q.bossPhase).toBe(3);
    expect(activePotions().length).toBe(2);
  });
});

describe('Reina: movimiento lento, gestión de terreno (GDD §15.3: "no es persecución, se mueve poco")', () => {
  it('sin columnas rotas, su velocidad de persecución es QUEEN_STALK_SPEED_BASE (playtest 2026-07-10: acelera al romperle columnas)', () => {
    const world = makeQueenWorld(); // sin columnas → 0 rotas
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;

    let maxSpeed = 0;
    for (let i = 0; i < 600; i++) {
      stepBosses(world, FIXED_DT, events);
      world.time += FIXED_DT;
      const speed = Math.hypot(boss(world).velocity.x, boss(world).velocity.y);
      maxSpeed = Math.max(maxSpeed, speed);
    }
    expect(maxSpeed).toBeLessThanOrEqual(QUEEN_STALK_SPEED_BASE + 0.02);
  });
});

describe('Reina: acecho hacia el héroe (GDD §15.3, playtest 2026-07-06 "la Reina te acecha"; playtest 2026-07-10 "que llegue a tocar al jugador" + escalado por fase + persecución libre sin correa)', () => {
  it('con el héroe fijo lejos, la Reina reduce su distancia al héroe con el tiempo', () => {
    const world = makeQueenWorld();
    const events = createEventQueue(64);
    const q = boss(world);
    // Héroe fijo, lejos, en una esquina de la sala 15x15 (dentro de bounds
    // para que sea un objetivo de acecho real, no un punto arbitrario fuera
    // de la arena).
    world.hero.position.x = 6;
    world.hero.position.y = 6;

    const distAtStart = Math.hypot(world.hero.position.x - q.position.x, world.hero.position.y - q.position.y);

    advance(world, events, 600); // 10s: tiempo de sobra para que el acecho progrese
    const distAfter = Math.hypot(world.hero.position.x - q.position.x, world.hero.position.y - q.position.y);

    // Persigue libremente hacia el héroe, sin correa que la haga volver
    // (playtest 2026-07-10 "quitar la correa"): su distancia al héroe baja.
    expect(distAfter).toBeLessThan(distAtStart);
  });

  it('la velocidad de persecución CRECE con cada columna ROTA (playtest 2026-07-10: rompérselas la enfurece)', () => {
    expect(QUEEN_STALK_SPEED_BASE).toBeGreaterThan(0);
    expect(QUEEN_STALK_SPEED_PER_COLUMN).toBeGreaterThan(0);

    // Funcional: con columnas marcadas como rotas, su velocidad neta sube.
    const maxSpeedWith = (broken: number) => {
      const world = makeQueenWorldWithColumns();
      const events = createEventQueue(64);
      world.hero.position.x = 100; // lejos: persigue a tope
      world.hero.position.y = 100;
      for (let i = 0; i < broken && i < queenState(world).columns.length; i++) queenState(world).columns[i].broken = true;
      let m = 0;
      for (let i = 0; i < 120; i++) {
        stepBosses(world, FIXED_DT, events);
        world.time += FIXED_DT;
        m = Math.max(m, Math.hypot(boss(world).velocity.x, boss(world).velocity.y));
      }
      return m;
    };
    expect(maxSpeedWith(2)).toBeGreaterThan(maxSpeedWith(0));
  });

  it('la velocidad de persecución crece MONÓTONAMENTE con cada columna rota y, con las 8 rotas (sala real), vale QUEEN_STALK_SPEED_BASE + 8×QUEEN_STALK_SPEED_PER_COLUMN = 2.4 u/s (playtest 2026-08-31: "incrementos moderados, no extremos")', () => {
    const maxSpeedWithBroken = (broken: number) => {
      const room = parseRoomData(bossQueenJson).room!;
      const world = createWorld(room);
      initBossEnemies(world);
      const events = createEventQueue(64);
      world.hero.position.x = 100; // lejos: persigue a tope
      world.hero.position.y = 100;
      const columns = queenState(world).columns;
      for (let i = 0; i < broken; i++) columns[i].broken = true;
      let m = 0;
      for (let i = 0; i < 120; i++) {
        stepBosses(world, FIXED_DT, events);
        world.time += FIXED_DT;
        m = Math.max(m, Math.hypot(boss(world).velocity.x, boss(world).velocity.y));
      }
      return m;
    };

    let prev = maxSpeedWithBroken(0);
    expect(prev).toBeCloseTo(QUEEN_STALK_SPEED_BASE, 1);
    for (let broken = 1; broken <= 8; broken++) {
      const current = maxSpeedWithBroken(broken);
      expect(current).toBeGreaterThan(prev);
      prev = current;
    }
    // Con las 8 rotas: 1.2 + 8×0.15 = 2.4 u/s — apenas por encima del paseo
    // WASD del héroe (HERO_WALK_SPEED = 2.0) en vez de los ~4.24 anteriores
    // (0.38/columna), que dejaban al héroe sin margen de huida.
    expect(prev).toBeCloseTo(QUEEN_STALK_SPEED_BASE + 8 * QUEEN_STALK_SPEED_PER_COLUMN, 5);
    expect(prev).toBeCloseTo(2.4, 1);
    expect(prev).toBeGreaterThan(HERO_WALK_SPEED);
  });

  it('en la sala real (boss-queen.json), con el héroe en su playerStart, la Reina llega a TOCARLO (fix playtest 2026-07-10: antes se daba la vuelta por la correa sin llegar; ahora persigue libremente)', () => {
    // Sala real 11x21: héroe arranca en (0,9), a ~9u del centro (0,0) donde
    // aparece la Reina. Sin correa, persigue en línea recta hasta el contacto.
    const room = parseRoomData(bossQueenJson).room!;
    const world = createWorld(room);
    initBossEnemies(world);
    const events = createEventQueue(64);
    const q = boss(world);
    const contactDist = QUEEN_RADIUS + HERO_RADIUS;

    let reachedContact = false;
    for (let i = 0; i < 3600; i++) {
      // hasta 60s
      stepBosses(world, FIXED_DT, events);
      world.time += FIXED_DT;
      const dist = Math.hypot(world.hero.position.x - q.position.x, world.hero.position.y - q.position.y);
      if (dist <= contactDist + 0.05) {
        reachedContact = true;
        break;
      }
    }
    expect(reachedContact).toBe(true);
  });
});

describe('src/game/features/dungeon/levels/boss-queen.json', () => {
  it('valida contra room-format.ts (GDD §13) y referencia el jefe "queen"', () => {
    const result = parseRoomData(bossQueenJson);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.room?.boss).toBe('queen');
    expect(result.room?.tags).toContain('jefe');
  });

  it('es una arena alargada (height > width) con pasillos laterales (rocas, GDD §15.3)', () => {
    const result = parseRoomData(bossQueenJson);
    const room = result.room!;
    expect(room.height).toBeGreaterThan(room.width);
    expect(room.hazards.every((h) => h.kind === 'rock')).toBe(true);
    expect(room.hazards.length).toBeGreaterThan(0);
  });

  it('el foco central (banda alrededor de x=0) queda libre de rocas', () => {
    const result = parseRoomData(bossQueenJson);
    const room = result.room!;
    for (const rock of room.hazards) {
      const innerEdge = Math.abs(rock.position.x) - rock.width / 2;
      expect(innerEdge).toBeGreaterThan(2); // banda central libre de al menos 2u a cada lado
    }
  });
});

describe('generateDungeon: puede producir la sala de la Reina (sorteo entre salas "jefe")', () => {
  it('con suficientes semillas distintas, el generador elige boss-guardian Y boss-queen (no siempre la misma)', () => {
    const pool = getRoomPool();
    const bossRoomIds = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const map = generateDungeon(seed, pool);
      bossRoomIds.add(map.bossRoomId);
    }
    expect(bossRoomIds.has('boss-guardian')).toBe(true);
    expect(bossRoomIds.has('boss-queen')).toBe(true);
  });

  it('una run con boss-queen sortea también coherentemente (topología válida, jefe único)', () => {
    const pool = getRoomPool();
    let foundQueenSeed: number | null = null;
    for (let seed = 1; seed <= 60; seed++) {
      const map = generateDungeon(seed, pool);
      if (map.bossRoomId === 'boss-queen') {
        foundQueenSeed = seed;
        break;
      }
    }
    expect(foundQueenSeed).not.toBeNull();
    const map = generateDungeon(foundQueenSeed!, pool);
    expect(map.rooms.filter((r) => r.room.tags.includes('jefe')).length).toBe(1);
    expect(map.bossRoomId).toBe('boss-queen');
  });
});

describe('Reina: derrota y limpieza de sala (integración con stepWorld, modo sala única)', () => {
  it('matar a la Reina no limpia la sala si aún queda una larva viva; muere la última y sí se limpia', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;

    // Deja que una columna pare al menos una larva.
    advance(world, events, 1);
    const larvae = liveLarvae(world);
    expect(larvae.length).toBeGreaterThan(0);

    // Mata a la Reina (daño masivo con bypass de ventana: el cuerpo ya no es
    // vulnerable a proyectiles/armas normales, rediseño 2026-07-10).
    const q = boss(world);
    applyDamageToEnemy(world, q, q.hp, 1, 0, events, true);
    advance(world, events, 1);
    expect(q.hp).toBeLessThanOrEqual(0);
    expect(collectTypes(events)).toContain('boss-defeated');

    // La sala NO se da por limpiada mientras la larva siga viva.
    expect(world.phase).toBe('playing');

    // Mata también a las larvas vivas: ahora sí, todos muertos.
    for (const larva of liveLarvae(world)) {
      applyDamageToEnemy(world, larva, larva.hp, 1, 0, events);
    }
    // Confirma que collectDeadDrops (step.ts) no rompe nada aquí: este test
    // solo usa stepBosses/applyDamageToEnemy (no stepWorld), así que la
    // puntuación de sala limpiada la valida stepSingleRoomClear en
    // items.test.ts (fuera de alcance de este fichero); aquí basta con la
    // propiedad de negocio: sin más larvas vivas, allDead(world.enemies) sería true.
    const stillAlive = world.enemies.filter((e) => e.hp > 0);
    expect(stillAlive.length).toBe(0);
  });
});

// ── Rediseño 2026-07-10 (GDD §15.3): la vida está en las columnas ──────────

/** Mundo de la Reina con 2 columnas destructibles (rocas con id `column-*`). */
function makeQueenWorldWithColumns() {
  const world = createWorld(
    makeRoom({
      enemies: [{ id: 'boss-1', kind: 'boss', bossId: 'queen', position: { x: 0, y: 0 } }],
      hazards: [
        { id: 'column-a', kind: 'rock' as const, position: { x: 3, y: 0 }, width: 1, height: 1 },
        { id: 'column-b', kind: 'rock' as const, position: { x: -3, y: 0 }, width: 1, height: 1 },
      ],
    }),
  );
  initBossEnemies(world);
  return world;
}

/** Coloca al héroe sobre `col` embistiendo (velocidad ≥ umbral) y cuenta `times` golpes, respetando el cooldown entre ellos. */
function ramColumn(
  world: ReturnType<typeof createWorld>,
  events: ReturnType<typeof createEventQueue>,
  col: { position: { x: number; y: number } },
  times: number,
) {
  for (let n = 0; n < times; n++) {
    world.hero.position.x = col.position.x;
    world.hero.position.y = col.position.y;
    world.hero.velocity.x = RAM_SPEED_THRESHOLD + 1;
    world.hero.velocity.y = 0;
    stepQueenColumns(world, world.contactDamageCooldowns, events);
    world.time += QUEEN_COLUMN_HIT_COOLDOWN + FIXED_DT;
  }
}

describe('Reina: la vida está en las columnas (rediseño 2026-07-10, GDD §15.3)', () => {
  it('onInit puebla queenState(world).columns desde las rocas `column-*` de su sala', () => {
    const world = makeQueenWorldWithColumns();
    expect(queenState(world).columns.length).toBe(2);
    expect(queenState(world).columns.every((c) => c.hp === QUEEN_COLUMN_HP && !c.broken)).toBe(true);
  });

  it('dos embestidas rompen una columna (QUEEN_COLUMN_HP=2): la 1.ª solo la agrieta (emite boss-column-cracked) y no baja la vida del jefe; la 2.ª rompe y sí la baja', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue();
    const q = boss(world);
    const col = queenState(world).columns[0];
    const before = q.hp;

    // Golpes previos (QUEEN_COLUMN_HP - 1 = 1): dañan la columna (la agrieta), no bajan la vida del jefe.
    ramColumn(world, events, col, QUEEN_COLUMN_HP - 1);
    expect(col.hp).toBe(1);
    expect(col.broken).toBe(false);
    expect(q.hp).toBe(before);
    expect(collectTypes(events)).toContain('boss-column-cracked');

    // Golpe final: rompe (hp→0) y baja el daño por columna.
    ramColumn(world, events, col, 1);
    expect(col.broken).toBe(true);
    expect(q.hp).toBeCloseTo(before - QUEEN_MAX_HP * QUEEN_COLUMN_DAMAGE_FRACTION, 5);
    expect(collectTypes(events)).toContain('boss-column-broken');
  });

  it('al romper una columna se emite boss-column-roar (la Reina grita de dolor), además de boss-column-broken', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue();
    const col = queenState(world).columns[0];
    ramColumn(world, events, col, QUEEN_COLUMN_HP);
    expect(col.broken).toBe(true);
    const types = collectTypes(events);
    expect(types).toContain('boss-column-broken');
    expect(types).toContain('boss-column-roar');
  });

  it('la columna rota deja de ser sólida (se retira de world.obstacles)', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue();
    const col = queenState(world).columns[0];
    expect(world.obstacles.some((o) => o.id === col.id)).toBe(true);
    ramColumn(world, events, col, QUEEN_COLUMN_HP);
    expect(col.broken).toBe(true);
    expect(world.obstacles.some((o) => o.id === col.id)).toBe(false);
  });

  it('solo la embestida daña la columna: tocarla a baja velocidad no le resta vida', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue();
    const col = queenState(world).columns[0];
    world.hero.position.x = col.position.x;
    world.hero.position.y = col.position.y;
    world.hero.velocity.x = 0.1; // muy por debajo de RAM_SPEED_THRESHOLD
    world.hero.velocity.y = 0;
    stepQueenColumns(world, world.contactDamageCooldowns, events);
    expect(col.hp).toBe(QUEEN_COLUMN_HP);
  });

  it('al cuerpo del jefe un proyectil/arma normal le hace daño REDUCIDO (no aturdida), no cero', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue();
    const q = boss(world);
    const before = q.hp;
    applyDamageToEnemy(world, q, 10, 0, 0, events); // sin ignore-window: como un proyectil
    expect(q.hp).toBeCloseTo(before - 10 * QUEEN_DAMAGE_OUTSIDE_WINDOW, 5);
    expect(q.hp).toBeLessThan(before);
  });

  it('una embestida directa al CUERPO sin aturdir le hace daño reducido (>0, ya no un valor fijo)', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue();
    const q = boss(world);
    const before = q.hp;
    world.hero.position.x = q.position.x;
    world.hero.position.y = q.position.y;
    world.hero.velocity.x = RAM_SPEED_THRESHOLD + 1;
    world.hero.velocity.y = 0;
    stepHeroEnemyContacts(world, world.contactDamageCooldowns, events);
    expect(q.hp).toBeLessThan(before); // le entra algo
    expect(before - q.hp).toBeLessThan(3); // reducido (embestida × 0.15), pequeño
  });

  it('al romper una columna la Reina queda ATURDIDA (vulnerable) unos segundos y luego vuelve a no-aturdida', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue();
    const q = boss(world);
    const col = queenState(world).columns[0];
    // Quedan 2 columnas: romper UNA deja otra en pie → aturdimiento TEMPORAL.
    ramColumn(world, events, col, QUEEN_COLUMN_HP);
    expect(q.bossVulnerableUntil).toBeGreaterThan(world.time);
    advance(world, events, 1); // queenStepPattern deriva bossVulnerable del reloj
    expect(q.bossVulnerable).toBe(true);
    // Pasado el aturdimiento vuelve a no-vulnerable (aún queda una columna).
    world.time += QUEEN_COLUMN_STUN_DURATION;
    advance(world, events, 1);
    expect(q.bossVulnerable).toBe(false);
  });

  it('estando ATURDIDA, un ataque normal le hace MÁS daño que sin aturdir (daño completo)', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue();
    const q = boss(world);
    q.bossVulnerable = true; // simula la ventana de aturdimiento
    const before = q.hp;
    applyDamageToEnemy(world, q, 10, 0, 0, events);
    expect(q.hp).toBeCloseTo(before - 10, 5); // completo, no ×0.15
  });

  it('rotas TODAS las columnas (sala real), la Reina queda vulnerable de forma PERMANENTE y le queda ~1/3 de vida para rematar', () => {
    const room = parseRoomData(bossQueenJson).room!;
    const world = createWorld(room);
    initBossEnemies(world);
    const events = createEventQueue(64);
    const q = boss(world);
    expect(queenState(world).columns.length).toBe(8);
    for (const col of [...queenState(world).columns]) {
      ramColumn(world, events, col, QUEEN_COLUMN_HP);
    }
    expect(queenState(world).columns.every((c) => c.broken)).toBe(true);
    expect(q.bossVulnerableUntil).toBe(Infinity);
    advance(world, events, 1);
    expect(q.bossVulnerable).toBe(true);
    // 8 × QUEEN_COLUMN_DAMAGE_FRACTION = 2/3 → le queda ~1/3 para el remate.
    expect(q.hp / q.maxHp).toBeCloseTo(1 / 3, 2);
  });
});

// ── TAREA 5 (docs/plans/QUEEN_REDESIGN_PLAN.md): persecución con evasión ───
// La Reina ya no atraviesa columnas/rocas al perseguir al héroe: reutiliza la
// misma circunnavegación tangencial del Guardián (moveBossTowardWithAvoidance,
// generalizada con un parámetro `speed`), a QUEEN_STALK_SPEED_BY_PHASE. Sube
// el reto (feedback del director: "el jefe va sobrado de fácil") porque ahora
// SÍ puede acorralar al jugador usando las columnas en vez de colarse a través.

describe('Reina: persigue RODEANDO obstáculos (TAREA 5 rediseño 2026-07-10, "no atraviesa columnas")', () => {
  it('con una columna entre la Reina y el héroe, su círculo nunca solapa la columna y aun así reduce la distancia al héroe', () => {
    const world = makeQueenWorldWithColumns();
    const events = createEventQueue(64);
    const q = boss(world);
    const col = queenState(world).columns[0]; // column-a en (3,0), medio-lado 0.5 — justo en la línea recta boss→héroe.
    world.hero.position.x = 6;
    world.hero.position.y = 0;

    const distStart = Math.hypot(world.hero.position.x - q.position.x, world.hero.position.y - q.position.y);

    for (let i = 0; i < 900; i++) {
      // 15s: tiempo de sobra para rodear la columna y seguir avanzando.
      stepBosses(world, FIXED_DT, events);
      world.time += FIXED_DT;

      // El círculo de la Reina (radio QUEEN_RADIUS) nunca solapa el AABB de
      // la columna, intacta durante todo el test (nadie la embiste aquí).
      const nearestX = Math.min(Math.max(q.position.x, col.position.x - col.halfW), col.position.x + col.halfW);
      const nearestY = Math.min(Math.max(q.position.y, col.position.y - col.halfH), col.position.y + col.halfH);
      const dx = q.position.x - nearestX;
      const dy = q.position.y - nearestY;
      expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(QUEEN_RADIUS * QUEEN_RADIUS - 1e-6);
    }

    const distEnd = Math.hypot(world.hero.position.x - q.position.x, world.hero.position.y - q.position.y);
    // La rodea (circunnavegación tangencial), pero sigue progresando hacia el héroe.
    expect(distEnd).toBeLessThan(distStart);
  });

  it('sin obstáculos en medio, la Reina sigue acercándose al héroe con la evasión activada (persecución no rota)', () => {
    const world = makeQueenWorld(); // sin columnas: makeRoom() no añade hazards
    const events = createEventQueue(64);
    const q = boss(world);
    world.hero.position.x = 6;
    world.hero.position.y = 6;

    const distStart = Math.hypot(world.hero.position.x - q.position.x, world.hero.position.y - q.position.y);
    advance(world, events, 300); // 5s de sobra en campo abierto
    const distEnd = Math.hypot(world.hero.position.x - q.position.x, world.hero.position.y - q.position.y);
    expect(distEnd).toBeLessThan(distStart);
  });
});
