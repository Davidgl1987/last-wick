/**
 * Tests del Guardián de Canto (GDD §15.2, Fase B1 de docs/plans/BOSSES_PLAN.md):
 * ciclo completo persecución→telegraph→carga→choque→aturdimiento→recuperación,
 * daño+empujón al golpear al héroe, doble carga encadenada solo en fase 2/3,
 * campo de esquirlas solo en fase 3, y la regla de daño por ventana de
 * vulnerabilidad heredada del framework (bosses/lifecycle.ts). También valida
 * `src/game/features/dungeon/levels/boss-guardian.json` contra el parser de room-format.ts.
 */

import { describe, expect, it } from 'vitest';
import bossGuardianJson from '@/game/features/dungeon/levels/boss-guardian.json';
import { HERO_RADIUS, HERO_WALK_SPEED } from '@/game/features/hero/constants';
import { applyDamageToEnemy } from '@/game/features/combat/combat';
import { createEventQueue } from '@/engine/events';
import { explodeBarrel, stepBarrels } from '@/game/features/hazards/hazards';
import { stepHeroPhysics } from '@/engine/physics';
import { parseRoomData } from '@/game/features/dungeon/room-format';
import { type EnemySpawn, type HazardSpawn, type RoomData, type RoomTag, barrelInAir } from '@/game/world/types';
import { createWorld } from '@/game/world/create';
import { initBossEnemies, stepBosses } from '@/game/features/bosses/lifecycle';
import { getBossDef } from '@/game/features/bosses/registry';
import { collectTypes } from '@/game/features/bosses/test-helpers';
import { guardianBarrelSpawnPoints } from './barrels';
import { GUARDIAN_BARREL_DAMAGE_FRACTION, GUARDIAN_BARREL_FALL_DURATION, GUARDIAN_BARREL_MAX_ACTIVE, GUARDIAN_BARREL_RADIUS, GUARDIAN_BARREL_SPAWN_INTERVAL, GUARDIAN_BARREL_STUN_DURATION, GUARDIAN_CHARGE_DAMAGE_PHASE1, GUARDIAN_CHARGE_DAMAGE_PHASE3, GUARDIAN_CHASE_SPEED, GUARDIAN_DAMAGE_OUTSIDE_WINDOW, GUARDIAN_DETECT_RANGE, GUARDIAN_FAR_CHARGE_RANGE, GUARDIAN_MAX_HP, GUARDIAN_MIN_CHARGE_CLEARANCE, GUARDIAN_RADIUS, GUARDIAN_STUN_DURATION } from './constants';

const FIXED_DT = 1 / 60;

function makeRoom(partial: Partial<RoomData> = {}): RoomData {
  return {
    version: 1,
    id: 'guardian-room',
    name: 'Sala del Guardián',
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

/** Roca 2x2 pegada al borde este de una sala 15x15 (halfW=7.5): centrada en x=6.5, así que su cara oeste está en x=5.5. */
function eastRock(): HazardSpawn {
  return { id: 'rock-east', kind: 'rock', position: { x: 6.5, y: 0 }, width: 2, height: 2 };
}

function makeGuardianWorld(opts: { bossSpawn?: Partial<EnemySpawn>; hazards?: HazardSpawn[] } = {}) {
  const spawn: EnemySpawn = {
    id: 'boss-1',
    kind: 'boss',
    bossId: 'guardian',
    position: { x: 0, y: 0 },
    patrolTarget: { x: -6, y: -6 },
    ...opts.bossSpawn,
  };
  const world = createWorld(makeRoom({ enemies: [spawn], hazards: opts.hazards ?? [] }));
  initBossEnemies(world);
  return world;
}

/** Avanza N ticks llamando a stepBosses (igual patrón que lifecycle.test.ts). */
function advance(world: ReturnType<typeof createWorld>, events: ReturnType<typeof createEventQueue>, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    stepBosses(world, FIXED_DT, events);
    world.time += FIXED_DT;
  }
}

/**
 * Avanza tick a tick hasta que `predicate` sea true (o `maxTicks` como tope
 * de seguridad). Necesario para el aturdimiento (~1.4s ≈ 84 ticks): un
 * `advance` de duración fija que se pase de esa ventana la cerraría de
 * nuevo antes de que el test llegue a comprobarla.
 */
function advanceUntil(
  world: ReturnType<typeof createWorld>,
  events: ReturnType<typeof createEventQueue>,
  predicate: () => boolean,
  maxTicks = 400,
): void {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    stepBosses(world, FIXED_DT, events);
    world.time += FIXED_DT;
  }
}

describe('Guardián de Canto: definición', () => {
  it('tiene 40 HP y techo de daño 60/65/70% por fase (GDD §15.6)', () => {
    const def = getBossDef('guardian');
    expect(def.maxHp).toBe(GUARDIAN_MAX_HP);
    expect(def.maxHp).toBe(40);
    expect(def.hitDamageCapFraction).toEqual([0.6, 0.65, 0.7]);
    // Fuera de ventana recibe el 20% del daño del arma (playtest 2026-07-10),
    // no inmune (0) como los demás jefes.
    expect(def.damageOutsideWindow).toBe(GUARDIAN_DAMAGE_OUTSIDE_WINDOW);
    expect(def.damageOutsideWindow).toBe(0.2);
  });
});

describe('Guardián: ciclo persecución → telegraph → carga → choque → aturdimiento → recuperación', () => {
  it('telegrafía al detectar al héroe a rango medio, con ≥0.6s de aviso (GDD §15.1 punto 2)', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    world.hero.position.x = 0;
    world.hero.position.y = 3; // dentro de GUARDIAN_DETECT_RANGE (4.5)

    advance(world, events, 1);
    const boss = world.enemies[0];
    expect(boss.bossTelegraphUntil).toBeGreaterThan(world.time);
    expect(boss.bossTelegraphUntil - world.time).toBeGreaterThanOrEqual(0.6);
    expect(collectTypes(events)).toContain('boss-telegraph');
  });

  it('tras el telegraph, carga en línea recta hacia la última posición vista del héroe', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    world.hero.position.x = 0;
    world.hero.position.y = 3;
    advance(world, events, 1); // entra en telegraph
    const boss = world.enemies[0];
    const posBeforeCharge = { x: boss.position.x, y: boss.position.y };

    advance(world, events, 60); // ~1s: agota el telegraph (0.8s) y entra en carga
    expect(boss.bossStage).toBe(2); // GUARDIAN_STAGE_CHARGING
    // Se movió en la dirección hacia donde estaba el héroe (facing ~ (0,1)).
    expect(boss.position.y).toBeGreaterThan(posBeforeCharge.y);
    expect(boss.facing.y).toBeGreaterThan(0.9);
  });

  it('choque contra una roca aturde al Guardián (ventana de vulnerabilidad ~1.4s, GDD §15.6)', () => {
    const world = makeGuardianWorld({
      bossSpawn: { position: { x: 0, y: 0 } },
      hazards: [eastRock()],
    });
    const events = createEventQueue(64);
    world.hero.position.x = 100; // lejos: no interfiere con el empuje al héroe
    world.hero.position.y = 100;

    // Fuerza la carga directamente hacia la roca (este) sin depender de detección.
    const boss = world.enemies[0];
    boss.bossStage = 1; // GUARDIAN_STAGE_TELEGRAPH
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;
    world.hero.position.x = 10;
    world.hero.position.y = 0;

    // Avanza SOLO hasta el instante del choque (un avance fijo largo se
    // pasaría de la ventana de aturdimiento de 1.4s y la vería ya cerrada).
    advanceUntil(world, events, () => boss.bossVulnerable);
    expect(boss.bossVulnerable).toBe(true);
    expect(boss.bossStage).toBe(3); // GUARDIAN_STAGE_STUNNED

    // La ventana dura ~1.4s y se cierra sola.
    advance(world, events, 90); // 1.5s
    expect(boss.bossVulnerable).toBe(false);
  });

  it('tras recuperarse del aturdimiento (fase 1) vuelve a perseguir, sin encadenar otra carga', () => {
    const world = makeGuardianWorld({ hazards: [eastRock()] });
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    boss.bossStage = 1;
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;
    world.hero.position.x = 10;
    world.hero.position.y = 0;

    advanceUntil(world, events, () => boss.bossVulnerable); // hasta el choque
    expect(boss.bossVulnerable).toBe(true);

    advance(world, events, 120); // agota la ventana de aturdimiento + pausa de recuperación
    expect(boss.bossStage).toBe(0); // GUARDIAN_STAGE_CHASE, no CHAIN_PAUSE
  });
});

describe('Guardián: persecución lenta constante y doble umbral de carga (rediseño 2026-08-31, GDD §15.2)', () => {
  it('a distancia media (banda GUARDIAN_DETECT_RANGE–GUARDIAN_FAR_CHARGE_RANGE) NO telegrafía y reduce la distancia al héroe (persecución lenta)', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 0;
    world.hero.position.y = 6; // banda media: > GUARDIAN_DETECT_RANGE (4.5), < GUARDIAN_FAR_CHARGE_RANGE (7)
    expect(world.hero.position.y).toBeGreaterThan(GUARDIAN_DETECT_RANGE);
    expect(world.hero.position.y).toBeLessThan(GUARDIAN_FAR_CHARGE_RANGE);
    const distStart = Math.hypot(world.hero.position.x - boss.position.x, world.hero.position.y - boss.position.y);

    // Horizonte corto a propósito (0.5s a GUARDIAN_CHASE_SPEED=1.6u/s ≈ 0.8u):
    // reduce la distancia de sobra sin llegar a cruzar el umbral cercano
    // (dejaría de ser persecución pura y pasaría a telegrafiar).
    advance(world, events, 30);

    expect(boss.bossTelegraphUntil).toBe(0);
    expect(boss.bossStage).toBe(0); // GUARDIAN_STAGE_CHASE: sigue persiguiendo, no telegrafía
    expect(collectTypes(events)).not.toContain('boss-telegraph');
    const distEnd = Math.hypot(world.hero.position.x - boss.position.x, world.hero.position.y - boss.position.y);
    expect(distEnd).toBeLessThan(distStart);
    expect(distEnd).toBeGreaterThan(GUARDIAN_DETECT_RANGE); // sigue en banda media, no ha cruzado el umbral cercano
  });

  it('a distancia larga (≥ GUARDIAN_FAR_CHARGE_RANGE) SÍ telegrafía y acaba cargando (cierra el hueco de quien se mantiene lejos a proyectiles)', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 0;
    world.hero.position.y = GUARDIAN_FAR_CHARGE_RANGE + 1; // claramente por encima del umbral lejano

    advance(world, events, 1);
    expect(boss.bossStage).toBe(1); // GUARDIAN_STAGE_TELEGRAPH
    expect(boss.bossTelegraphUntil).toBeGreaterThan(world.time);
    expect(collectTypes(events)).toContain('boss-telegraph');

    advance(world, events, 60); // ~1s: agota el telegraph (0.8s) y entra en carga
    expect(boss.bossStage).toBe(2); // GUARDIAN_STAGE_CHARGING
    expect(boss.facing.y).toBeGreaterThan(0.9); // carga hacia el héroe (norte)
  });

  it('a distancia corta (≤ GUARDIAN_DETECT_RANGE) sigue telegrafiando de inmediato (regresión: comportamiento cercano intacto)', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 0;
    world.hero.position.y = 2; // dentro de GUARDIAN_DETECT_RANGE (4.5)

    advance(world, events, 1);
    expect(boss.bossStage).toBe(1); // GUARDIAN_STAGE_TELEGRAPH
    expect(boss.bossTelegraphUntil).toBeGreaterThan(world.time);
    expect(collectTypes(events)).toContain('boss-telegraph');
  });

  it('tras el ciclo carga → choque → stun → recuperación, vuelve a perseguir y reduce la distancia al héroe sin intervención', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 0;
    world.hero.position.y = 3;
    // Fuerza el telegraph directamente (mismo patrón que el resto de tests de
    // choque): no depende del tiempo de persecución previo, solo del ciclo
    // posterior (choque contra la pared norte → stun → recuperación).
    boss.bossStage = 1; // GUARDIAN_STAGE_TELEGRAPH
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;

    advanceUntil(world, events, () => boss.bossVulnerable); // choca contra la pared norte, se aturde
    advanceUntil(world, events, () => !boss.bossVulnerable, 200); // agota aturdimiento + pausa de recuperación
    expect(boss.bossStage).toBe(0); // GUARDIAN_STAGE_CHASE: vuelve a perseguir solo, sin intervención externa

    // Reubica al héroe a banda media (persecución pura, sin recargar) desde
    // la posición REAL donde quedó el Guardián tras el choque, y confirma que
    // se acerca solo con el tiempo, sin que el test toque bossStage/bossTimer.
    world.hero.position.x = boss.position.x;
    world.hero.position.y = boss.position.y + 6;
    const distStart = Math.hypot(world.hero.position.x - boss.position.x, world.hero.position.y - boss.position.y);
    advance(world, events, 30);
    const distEnd = Math.hypot(world.hero.position.x - boss.position.x, world.hero.position.y - boss.position.y);
    expect(distEnd).toBeLessThan(distStart);
    expect(boss.bossStage).toBe(0); // sigue persiguiendo, no ha vuelto a telegrafiar (banda media)
  });

  it('GUARDIAN_CHASE_SPEED es menor que HERO_WALK_SPEED: el paseo WASD siempre puede abrir hueco hasta el umbral lejano', () => {
    // Contrato del rediseño (constants.ts, comentario de GUARDIAN_CHASE_SPEED):
    // si esto dejara de cumplirse, el Guardián alcanzaría a un héroe que se
    // aleja en línea recta y kitear a proyectiles sería imposible incluso
    // antes de cruzar GUARDIAN_FAR_CHARGE_RANGE.
    expect(GUARDIAN_CHASE_SPEED).toBeLessThan(HERO_WALK_SPEED);
    expect(GUARDIAN_CHASE_SPEED).toBe(1.6);
    expect(HERO_WALK_SPEED).toBe(2.0);
  });

  it('con la sala real y el héroe al otro lado de una roca interior (línea boss→héroe la atraviesa), en banda media el Guardián la rodea sin quedarse clavado (regresión B1.6.1, ahora persiguiendo al héroe en vez de una esquina fija)', () => {
    // El objetivo de la persecución dejó de ser un punto fijo (esquina de
    // patrulla) y pasó a ser el héroe (rediseño 2026-08-31): el riesgo del bug
    // histórico B1.6.1 ("el boss quedaba clavado tocando la roca para
    // siempre") es ahora MAYOR, porque el héroe puede plantarse justo detrás
    // de una roca interior. `movement.test.ts` ya prueba la garantía genérica
    // de `moveBossTowardWithAvoidance` (nunca atraviesa un obstáculo y sigue
    // progresando) con un enemigo/roca sintéticos; este test la reproduce
    // INTEGRADA, con el Guardián real en la sala real (`boss-guardian.json`).
    const room = parseRoomData(bossGuardianJson).room!;
    const world = createWorld(room);
    initBossEnemies(world);
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    // Spawn real de boss-guardian.json (sin sobrescribir: solo se coloca al héroe).
    expect(boss.position.x).toBe(0);
    expect(boss.position.y).toBe(0);

    // Héroe al suroeste, al otro lado de `rock-sw` (-3.2,-3.2, 1.8x1.8): NO en
    // la diagonal exacta boss→centro-de-roca (eso alinea también con el punto
    // de reposicionamiento, el centro exacto de la sala (0,0), que por la
    // simetría de las 4 rocas de esta arena queda a <GUARDIAN_MIN_CHARGE_CLEARANCE
    // de las 4 en diagonal — un caso límite AJENO al rediseño, de
    // GUARDIAN_STAGE_REPOSITION, que no toca este test). Con un ángulo
    // desplazado la línea recta boss→héroe sigue atravesando la roca de
    // lleno (comprobado más abajo) pero deja de coincidir con ese eje
    // degenerado. Distancia en banda media (entre GUARDIAN_DETECT_RANGE y
    // GUARDIAN_FAR_CHARGE_RANGE): arranca persiguiendo sin telegrafiar.
    world.hero.position.x = -5.325;
    world.hero.position.y = -3.728;
    const distStart = Math.hypot(world.hero.position.x - boss.position.x, world.hero.position.y - boss.position.y);
    expect(distStart).toBeGreaterThan(GUARDIAN_DETECT_RANGE);
    expect(distStart).toBeLessThan(GUARDIAN_FAR_CHARGE_RANGE);

    // Confirma la premisa (no solo por construcción geométrica a mano): el
    // segmento recto boss→héroe SÍ atraviesa el AABB de `rock-sw`, no es un
    // rodeo que la esquiva por fuera.
    const rockSw = room.hazards.find((h) => h.id === 'rock-sw')!;
    const halfW = rockSw.width / 2;
    const halfH = rockSw.height / 2;
    let lineCrossesRock = false;
    for (let t = 0; t <= 1; t += 0.01) {
      const x = boss.position.x + t * (world.hero.position.x - boss.position.x);
      const y = boss.position.y + t * (world.hero.position.y - boss.position.y);
      if (Math.abs(x - rockSw.position.x) < halfW && Math.abs(y - rockSw.position.y) < halfH) {
        lineCrossesRock = true;
        break;
      }
    }
    expect(lineCrossesRock).toBe(true);

    let everOverlapping = false;
    let lastCheckDist = Infinity;
    let ticksSinceProgress = 0;
    let maxTicksSinceProgress = 0;
    // 10s con el héroe QUIETO: de sobra para exponer un atasco real. El
    // Guardián cruza pronto a rango cercano (la banda media es estrecha
    // frente a GUARDIAN_CHASE_SPEED) y de ahí encadena reposicionamiento →
    // telegraph → carga → stun → vuelta a perseguir — ciclo sano, no un
    // atasco; lo que NO puede pasar en ningún punto de ese ciclo es solapar
    // la roca o congelarse sin avanzar mientras esté en persecución pura.
    for (let i = 0; i < 600; i++) {
      stepBosses(world, FIXED_DT, events);
      world.time += FIXED_DT;

      // (1) El círculo del Guardián nunca solapa el AABB de ninguna roca de
      // la sala real, en NINGÚN tick intermedio (la circunnavegación debe
      // rodearla por la tangente, nunca atravesarla) — vale para las 4, no
      // solo `rock-sw`, y en cualquier stage (persiguiendo, reposicionando o
      // cargando: `bossHitsSolid` gatea el movimiento en todos ellos).
      for (const obstacle of world.obstacles) {
        const aabb = obstacle.aabb;
        const nearestX = Math.max(aabb.minX, Math.min(boss.position.x, aabb.maxX));
        const nearestY = Math.max(aabb.minY, Math.min(boss.position.y, aabb.maxY));
        const dx = boss.position.x - nearestX;
        const dy = boss.position.y - nearestY;
        if (dx * dx + dy * dy < GUARDIAN_RADIUS * GUARDIAN_RADIUS - 1e-6) everOverlapping = true;
      }

      // (2) Progreso neto hacia el héroe, muestreado cada ~1s (mismo patrón
      // que la regresión histórica de patrulla, B1.6.1): solo mientras siga
      // en el stage de persecución (GUARDIAN_STAGE_CHASE=0) — las pausas de
      // telegraph/stun son legítimas (tienen su propia duración probada en
      // otros tests) y no cuentan como atasco.
      if (i % 60 === 0 && boss.bossStage === 0 /* GUARDIAN_STAGE_CHASE */) {
        const dist = Math.hypot(world.hero.position.x - boss.position.x, world.hero.position.y - boss.position.y);
        if (dist < lastCheckDist - 0.01) {
          ticksSinceProgress = 0;
        } else {
          ticksSinceProgress += 60;
        }
        lastCheckDist = dist;
        maxTicksSinceProgress = Math.max(maxTicksSinceProgress, ticksSinceProgress);
      }
    }

    expect(everOverlapping).toBe(false);
    expect(maxTicksSinceProgress).toBeLessThanOrEqual(60);

    // Y el desplazamiento neto es real, no un roce: se acerca de verdad
    // (traza real: ~6.5u → ~3.65u en 10s, cruzando un ciclo completo).
    const distEnd = Math.hypot(world.hero.position.x - boss.position.x, world.hero.position.y - boss.position.y);
    expect(distEnd).toBeLessThan(distStart - 1);
  });

  it('con el héroe en la DIAGONAL EXACTA (eje degenerado de las 4 rocas), el Guardián NO se queda congelado reposicionando (fix 2026-08-31)', () => {
    // Regresión del punto muerto encontrado al revisar el rediseño: cuando
    // GUARDIAN_STAGE_REPOSITION apuntaba al CENTRO de la sala, bastaba con
    // que el jugador se pusiera en diagonal para dejar al Guardián clavado
    // para siempre. Traza real de entonces: 13 s parado en (-0.094,-0.094),
    // desplazamiento 0.0000 u. El motivo: al llegar al centro,
    // `moveBossTowardWithAvoidance` lo detiene (corte de `dist < 0.15`), y
    // desde el centro las 4 rocas del anillo de `boss-guardian.json` quedan,
    // por simetría, a menos de GUARDIAN_MIN_CHARGE_CLEARANCE en las cuatro
    // diagonales — nunca hay línea despejada, así que nunca salía del stage
    // ni volvía a moverse. Es EXACTAMENTE el exploit que este rediseño venía
    // a cerrar (mantener la distancia y dispararle gratis), reaparecido por
    // otra vía. Hoy el reposicionamiento persigue al héroe, así que siempre
    // hay avance.
    const room = parseRoomData(bossGuardianJson).room!;
    const world = createWorld(room);
    initBossEnemies(world);
    const events = createEventQueue(64);
    const boss = world.enemies[0];

    // Diagonal exacta suroeste (el eje degenerado), a distancia media.
    const dist0 = 6;
    world.hero.position.x = -dist0 / Math.SQRT2;
    world.hero.position.y = -dist0 / Math.SQRT2;

    const startX = boss.position.x;
    const startY = boss.position.y;
    advance(world, events, 600); // 10 s con el héroe QUIETO

    // Se ha movido de verdad (con el bug: 0.0000 u), y además ha recortado
    // distancia hacia el héroe en vez de vagar sin rumbo.
    const travelled = Math.hypot(boss.position.x - startX, boss.position.y - startY);
    expect(travelled).toBeGreaterThan(1);
    const distEnd = Math.hypot(world.hero.position.x - boss.position.x, world.hero.position.y - boss.position.y);
    expect(distEnd).toBeLessThan(dist0 - 1);
  });
});

// ── Fix playtest 2026-07-06: no cargar con un obstáculo demasiado cerca ────

describe('Guardián: NO carga si tiene un obstáculo demasiado cerca en la dirección de tiro (fix "sigue atascándose", GDD §15.2)', () => {
  it('con una roca pegada entre boss y héroe, el boss NO entra en carga (reposiciona en su lugar)', () => {
    // Boss a 0.5u de la cara oeste de la roca este (x=5.5); héroe justo detrás
    // de la roca (más al este, dentro de rango de detección). La dirección de
    // carga (+x) hacia el héroe atraviesa la roca a menos de
    // GUARDIAN_MIN_CHARGE_CLEARANCE: antes del fix, el boss chocaría casi al
    // instante y quedaría aturdido a bocajarro del héroe (el bug real de
    // playtest: camping contra la misma roca).
    const world = makeGuardianWorld({
      bossSpawn: { position: { x: 5.0, y: 0 } },
      hazards: [eastRock()],
    });
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 5.4; // dentro de GUARDIAN_DETECT_RANGE, tras la roca
    world.hero.position.y = 0;

    advance(world, events, 30); // 0.5s: tiempo de sobra para detectar y decidir

    // Nunca llega a telegrafiar/cargar hacia la roca: se queda reposicionando.
    expect(boss.bossStage).toBe(5); // GUARDIAN_STAGE_REPOSITION
    expect(boss.bossTelegraphUntil).toBe(0);
    expect(boss.bossVulnerable).toBe(false);

    // Y nunca llega a chocar/aturdirse contra la roca (el bug real): tras un
    // horizonte largo, sigue sin haberse aturdido nunca junto a ella.
    advance(world, events, 300); // 5s más
    expect(boss.bossVulnerable).toBe(false);
  });

  it('con recorrido despejado, el boss SÍ carga con normalidad (comportamiento intacto)', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 0;
    world.hero.position.y = 3; // dentro de rango, sin ningún obstáculo entre medias

    advance(world, events, 1);
    expect(boss.bossStage).toBe(1); // GUARDIAN_STAGE_TELEGRAPH: telegrafía normal
    expect(boss.bossTelegraphUntil).toBeGreaterThan(world.time);
  });

  it('GUARDIAN_MIN_CHARGE_CLEARANCE es mayor que GUARDIAN_RADIUS (deja margen real de carga, no solo evita el contacto)', () => {
    expect(GUARDIAN_MIN_CHARGE_CLEARANCE).toBeGreaterThan(GUARDIAN_RADIUS);
  });

  it('reposicionado, si el héroe se aparta y despeja la línea de tiro, retoma la carga con normalidad', () => {
    const world = makeGuardianWorld({
      bossSpawn: { position: { x: 5.0, y: 0 } },
      hazards: [eastRock()],
    });
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 5.4;
    world.hero.position.y = 0;

    advance(world, events, 30);
    expect(boss.bossStage).toBe(5); // GUARDIAN_STAGE_REPOSITION

    // El héroe se mueve a una posición con línea despejada desde donde el
    // boss haya reposicionado (hacia el centro de la sala): al norte, lejos
    // de la roca este.
    world.hero.position.x = 0;
    world.hero.position.y = 3;

    advanceUntil(world, events, () => boss.bossStage === 1, 600); // GUARDIAN_STAGE_TELEGRAPH
    expect(boss.bossStage).toBe(1);
  });
});

describe('Guardián: carga contra el héroe', () => {
  it('la carga que golpea al héroe hace 1 de daño en fases 1-2 (GDD §15.6, bajado de 2 tras playtest 2026-07-06) y lo empuja', () => {
    // El valor literal es parte del contrato de tuning del GDD §15.6.
    expect(GUARDIAN_CHARGE_DAMAGE_PHASE1).toBe(1);

    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    // Coloca al héroe justo en la trayectoria de la carga (facing se fija al
    // entrar en carga, apuntando hacia la posición del héroe en ese instante).
    world.hero.position.x = 0;
    world.hero.position.y = 2;
    boss.position.x = 0;
    boss.position.y = 0;
    boss.bossStage = 1;
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;

    const hpBefore = world.hero.hp;
    advance(world, events, 120); // agota telegraph y avanza la carga hasta el impacto

    expect(world.hero.hp).toBe(hpBefore - 1);
    expect(collectTypes(events)).toContain('player-damaged');
    // Empujón fuerte: el héroe sale despedido en la dirección de la carga (+y).
    expect(world.hero.velocity.y).toBeGreaterThan(0);
  });

  it('la carga hace 2 de daño en fase 3 (GDD §15.6, bajado de 3 tras playtest 2026-07-06)', () => {
    expect(GUARDIAN_CHARGE_DAMAGE_PHASE3).toBe(2);

    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    boss.hp = Math.floor(boss.maxHp * 0.2); // fuerza fase 3
    boss.bossPhase = 3;
    world.hero.position.x = 0;
    world.hero.position.y = 2;
    boss.position.x = 0;
    boss.position.y = 0;
    boss.bossStage = 1;
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;

    const hpBefore = world.hero.hp;
    advance(world, events, 120);

    expect(world.hero.hp).toBe(hpBefore - 2);
  });

  it('nunca hace un golpe letal a vida llena (techo de daño de jefe, GDD §15.1 punto 6)', () => {
    const world = makeGuardianWorld();
    world.hero.maxHp = 3;
    world.hero.hp = 3;
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 0;
    world.hero.position.y = 2;
    boss.position.x = 0;
    boss.position.y = 0;
    boss.bossStage = 1;
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;

    advance(world, events, 120);
    expect(world.hero.hp).toBeGreaterThan(0);
  });
});

describe('Guardián: doble carga encadenada (fase 2/3, GDD §15.2)', () => {
  it('en fase 1, tras aturdirse vuelve a perseguir (no telegrafía una segunda carga inmediata)', () => {
    const world = makeGuardianWorld({ hazards: [eastRock()] });
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    expect(boss.bossPhase).toBe(1);
    boss.bossStage = 1;
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;
    world.hero.position.x = 10;
    world.hero.position.y = 0;

    advance(world, events, 300); // choca, se aturde
    advance(world, events, 120); // recupera
    expect(boss.bossStage).toBe(0); // CHASE directo, sin CHAIN_PAUSE (4) de por medio
  });

  it('en fase 2 (66%), tras la primera carga encadena una segunda con pausa corta antes de volver a perseguir', () => {
    const world = makeGuardianWorld({ hazards: [eastRock()] });
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    boss.hp = Math.floor(boss.maxHp * 0.6); // fuerza fase 2
    boss.bossPhase = 2;

    boss.bossStage = 1;
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;
    world.hero.position.x = 10;
    world.hero.position.y = 0;

    advanceUntil(world, events, () => boss.bossVulnerable); // primera carga: choca y se aturde
    expect(boss.bossVulnerable).toBe(true);

    advanceUntil(world, events, () => !boss.bossVulnerable, 200); // agota el aturdimiento (1.4s)
    expect(boss.bossStage).toBe(4); // GUARDIAN_STAGE_CHAIN_PAUSE: encadena una 2ª carga

    // Tras la pausa corta, vuelve a telegrafiar (segunda carga de la secuencia).
    advanceUntil(world, events, () => boss.bossStage === 1, 200);
    expect(boss.bossStage).toBe(1);
    expect(collectTypes(events).filter((t) => t === 'boss-telegraph').length).toBeGreaterThanOrEqual(1);
  });

  it('en fase 3 (33%) también encadena 2 cargas (no más de 2, GDD §15.2 solo especifica fase 2/3 con doble carga)', () => {
    const world = makeGuardianWorld({ hazards: [eastRock()] });
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    boss.hp = Math.floor(boss.maxHp * 0.2);
    boss.bossPhase = 3;

    boss.bossStage = 1;
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;
    world.hero.position.x = 10;
    world.hero.position.y = 0;

    advanceUntil(world, events, () => boss.bossVulnerable); // primera carga: choca y se aturde
    advanceUntil(world, events, () => !boss.bossVulnerable, 200); // aturdimiento agotado
    expect(boss.bossStage).toBe(4); // encadena

    advanceUntil(world, events, () => boss.bossVulnerable, 400); // segunda carga: choca de nuevo
    advanceUntil(world, events, () => !boss.bossVulnerable, 200); // segundo aturdimiento agotado
    expect(boss.bossStage).toBe(0); // ya no encadena una tercera: vuelve a perseguir
  });
});

describe('Guardián: campo de esquirlas (fase 3, GDD §15.2)', () => {
  it('NO deja esquirlas en fase 1 al chocar contra una roca', () => {
    const world = makeGuardianWorld({ hazards: [eastRock()] });
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    boss.bossStage = 1;
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;
    world.hero.position.x = 10;
    world.hero.position.y = 0;

    advanceUntil(world, events, () => boss.bossVulnerable);
    expect(boss.bossVulnerable).toBe(true); // confirma que sí chocó
    expect(world.puddles.some((p) => p.active)).toBe(false);
    expect(collectTypes(events)).not.toContain('boss-shard-burst');
  });

  it('SÍ deja un campo de esquirlas (puddle con daño) al chocar en fase 3', () => {
    const world = makeGuardianWorld({ hazards: [eastRock()] });
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    boss.hp = Math.floor(boss.maxHp * 0.2);
    boss.bossPhase = 3;
    boss.bossStage = 1;
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;
    world.hero.position.x = 10;
    world.hero.position.y = 0;

    // Fase 3 encadena 2 cargas (GDD §15.2): tras la primera (choca contra la
    // roca) queda MUY cerca de ella, así que el fix "no carga si tiene un
    // obstáculo demasiado cerca" (playtest 2026-07-06) le hace reposicionarse
    // antes de la segunda — tiempo extra legítimo, no un choque inmediato.
    // Se usa un horizonte amplio (vs el `advance` fijo de antes del fix) para
    // dar margen al reposicionamiento + la segunda carga.
    advanceUntil(world, events, () => boss.bossVulnerable); // primera carga: choca y se aturde
    advanceUntil(world, events, () => !boss.bossVulnerable, 200); // aturdimiento agotado
    advanceUntil(world, events, () => boss.bossVulnerable, 800); // reposiciona + segunda carga: choca de nuevo

    expect(boss.bossVulnerable).toBe(true);
    expect(world.puddles.some((p) => p.active)).toBe(true);
    expect(collectTypes(events)).toContain('boss-shard-burst');
  });
});

describe('Guardián: daño del arma escalado por ventana (playtest 2026-07-10)', () => {
  it('golpe SIN aturdir: recibe el 20% del daño del arma (D=10 → -2), no inmune, y escala con el arma', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 0;
    world.hero.position.y = 3;
    advance(world, events, 1); // entra en telegraph
    expect(boss.bossVulnerable).toBe(false);

    const hpBefore = boss.hp;
    // El daño del ARMA se escala por GUARDIAN_DAMAGE_OUTSIDE_WINDOW (0.2): un
    // golpe de 10 baja 2. NO se redondea a 0 (armas diminutas siguen notándose)
    // y una mejora de arma —más daño de entrada— sube el chip proporcionalmente.
    applyDamageToEnemy(world, boss, 10, 1, 0, events);
    expect(boss.hp).toBeCloseTo(hpBefore - 10 * GUARDIAN_DAMAGE_OUTSIDE_WINDOW);
    expect(boss.hp).toBeCloseTo(hpBefore - 2);
    expect(boss.hp).toBeLessThan(hpBefore); // no inmune
  });

  it('arma diminuta (D=1) SIN aturdir baja HP fraccionario (>0), no se redondea a 0 → no parece inmune', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 0;
    world.hero.position.y = 3;
    advance(world, events, 1);
    expect(boss.bossVulnerable).toBe(false);

    const hpBefore = boss.hp;
    applyDamageToEnemy(world, boss, 1, 1, 0, events);
    expect(boss.hp).toBeCloseTo(hpBefore - 0.2);
    expect(boss.hp).toBeLessThan(hpBefore);
  });

  it('golpe estando aturdido (bossVulnerable=true): daño COMPLETO del arma (D=10 → -10), más que sin aturdir', () => {
    const world = makeGuardianWorld({ hazards: [eastRock()] });
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    boss.bossStage = 1;
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;
    world.hero.position.x = 10;
    world.hero.position.y = 0;

    advanceUntil(world, events, () => boss.bossVulnerable);
    expect(boss.bossVulnerable).toBe(true);

    const hpBefore = boss.hp;
    applyDamageToEnemy(world, boss, 10, 1, 0, events);
    expect(boss.hp).toBeCloseTo(hpBefore - 10); // completo
    // Y es más que el 20% que recibiría el mismo golpe sin aturdir.
    expect(10).toBeGreaterThan(10 * GUARDIAN_DAMAGE_OUTSIDE_WINDOW);
  });

  it('barril explotando en su radio SIN estar aturdido: baja 15% de maxHp (6), bypass de ventana', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 0;
    world.hero.position.y = 3;
    advance(world, events, 1); // entra en telegraph: fuera de ventana
    expect(boss.bossVulnerable).toBe(false);

    const barrel = {
      id: 'b-adjacent',
      position: { x: boss.position.x + 0.5, y: boss.position.y },
      radius: 0.4,
      exploded: false,
    };
    world.barrels.push(barrel);

    const hpBefore = boss.hp;
    explodeBarrel(world, barrel, events);
    expect(boss.hp).toBeCloseTo(hpBefore - GUARDIAN_BARREL_DAMAGE_FRACTION * GUARDIAN_MAX_HP);
    expect(boss.hp).toBeCloseTo(hpBefore - 6);
  });
});

describe('src/game/features/dungeon/levels/boss-guardian.json', () => {
  it('valida contra room-format.ts (GDD §13) y referencia el jefe "guardian"', () => {
    const result = parseRoomData(bossGuardianJson);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.room?.boss).toBe('guardian');
    expect(result.room?.tags).toContain('jefe');
  });

  it('es ~15x15, sin fosos ni otros hazards salvo 4 rocas grandes (GDD §15.2)', () => {
    const result = parseRoomData(bossGuardianJson);
    const room = result.room!;
    expect(room.width).toBe(15);
    expect(room.height).toBe(15);
    expect(room.hazards.every((h) => h.kind === 'rock')).toBe(true);
    expect(room.hazards.length).toBe(4);
  });

  it('tiene puertas en los 4 lados, como boss-test.json', () => {
    const result = parseRoomData(bossGuardianJson);
    const sides = result.room!.doorSlots.map((d) => d.side).sort();
    expect(sides).toEqual(['east', 'north', 'south', 'west']);
  });
});

describe('Guardián: radio real de jefe (regresión B1)', () => {
  it('initBossEnemies aplica GUARDIAN_RADIUS (colisión y render escalan con él)', () => {
    const world = makeGuardianWorld();
    expect(world.enemies[0].radius).toBeCloseTo(GUARDIAN_RADIUS, 6);
  });
});

// ── B1.5: barriles rodantes (GDD §15.2, playtest 2026-07-06) ────────────────

/** Barriles vivos (sin explotar) del mundo de test (sala única: roomId undefined en todos). */
function liveBarrels(world: ReturnType<typeof createWorld>) {
  return world.barrels.filter((b) => !b.exploded);
}

describe('Guardián: aparición periódica de barriles rodantes (GDD §15.2)', () => {
  it('aparece un barril por slot de GUARDIAN_BARREL_SPAWN_INTERVAL, con evento boss-barrel-spawn y en la región central (playtest 2026-07-10)', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    world.hero.position.x = 100; // lejos: da igual que dispare persecución/carga — la cadencia de barriles es independiente del stage (guardianStepBarrelSpawn corre siempre, ver guardianStepPattern)
    world.hero.position.y = 100;

    advance(world, events, 1); // primer tick: cruza el slot 0 → primer barril
    expect(liveBarrels(world).length).toBe(1);
    expect(collectTypes(events)).toContain('boss-barrel-spawn');

    // El barril aparece cerca del centro (entre las rocas centrales), no
    // pegado al perímetro de la arena (fix playtest 2026-07-10: "ponlos entre
    // las rocas centrales mejor que en las esquinas").
    const barrel = liveBarrels(world)[0];
    const halfW = world.bounds.maxX;
    const distToWall = Math.min(
      halfW - Math.abs(barrel.position.x),
      halfW - Math.abs(barrel.position.y),
    );
    expect(distToWall).toBeGreaterThan(1);
    expect(Math.hypot(barrel.position.x, barrel.position.y)).toBeLessThan(4);

    // Antes del siguiente slot (~8s) no aparece otro.
    const intervalTicks = Math.round(GUARDIAN_BARREL_SPAWN_INTERVAL / FIXED_DT);
    advance(world, events, intervalTicks - 60); // hasta ~1s antes del slot
    expect(liveBarrels(world).length).toBe(1);

    // Cruzado el slot: segundo barril.
    advance(world, events, 120); // ~1s después del slot
    expect(liveBarrels(world).length).toBe(2);
  });

  it('respeta el cap GUARDIAN_BARREL_MAX_ACTIVE de barriles vivos simultáneos', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;

    // ~50s = 6 slots de 8s: sin cap habría 6+ barriles.
    advance(world, events, 3000);
    expect(liveBarrels(world).length).toBe(GUARDIAN_BARREL_MAX_ACTIVE);
    // Y el array no crece sin límite (los slots se reutilizan, patrón dropCoinAt).
    expect(world.barrels.length).toBe(GUARDIAN_BARREL_MAX_ACTIVE);
  });
});

describe('Guardián: barril recién caído del cielo no es sólido hasta aterrizar (GDD §15.2, playtest 2026-07-06)', () => {
  it('guardianSpawnBarrel fija landingAt en el futuro y barrelInAir es true hasta que world.time lo alcanza', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;

    advance(world, events, 1); // primer slot: aparece el primer barril
    const barrel = liveBarrels(world)[0];
    expect(barrel.landingAt).toBeCloseTo(world.time - FIXED_DT + GUARDIAN_BARREL_FALL_DURATION, 3);
    expect(barrelInAir(barrel, world.time)).toBe(true);

    advance(world, events, Math.round(GUARDIAN_BARREL_FALL_DURATION / FIXED_DT) + 5);
    expect(barrelInAir(barrel, world.time)).toBe(false);
  });

  it('NO explota por contacto del héroe mientras cae (stepBarrels lo ignora), y SÍ explota tras aterrizar', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;

    advance(world, events, 1); // aparece el barril, aún cayendo
    const barrel = liveBarrels(world)[0];
    expect(barrelInAir(barrel, world.time)).toBe(true);

    // Héroe plantado justo encima del barril mientras cae: no debe detonar.
    world.hero.position.x = barrel.position.x;
    world.hero.position.y = barrel.position.y;
    stepBarrels(world, events);
    expect(barrel.exploded).toBe(false);

    // Avanza hasta después de landingAt (mismo héroe encima) y repite el contacto.
    advance(world, events, Math.round(GUARDIAN_BARREL_FALL_DURATION / FIXED_DT) + 5);
    expect(barrelInAir(barrel, world.time)).toBe(false);
    stepBarrels(world, events);
    expect(barrel.exploded).toBe(true);
  });

  it('la carga del Guardián ATRAVIESA un barril que aún cae (no lo arrolla) y SÍ lo arrolla una vez aterrizado', () => {
    // Barril recién colocado a mano en la trayectoria de carga, con landingAt
    // futuro (simula el instante justo tras `guardianSpawnBarrel`).
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    // Barril muy cerca del Guardián (x=0.5): con GUARDIAN_CHARGE_SPEED=7.5u/s
    // la carga lo alcanza a los ~0.07s de empezar a cargar, muy por debajo de
    // GUARDIAN_BARREL_FALL_DURATION (1.1s) — sigue en el aire cuando la carga
    // pasa por su posición.
    world.barrels.push({
      id: 'falling-barrel',
      position: { x: 0.5, y: 0 },
      radius: 0.4,
      exploded: false,
      landingAt: world.time + GUARDIAN_BARREL_FALL_DURATION,
    });

    boss.bossStage = 1; // GUARDIAN_STAGE_TELEGRAPH
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;
    world.hero.position.x = 10; // fija la dirección de carga (este)
    world.hero.position.y = 0;

    // Avanza justo lo suficiente para agotar el telegraph (0.8s) y que la
    // carga recorra los 0.5u hasta el barril, sin llegar a landingAt (1.1s
    // tras el spawn en t=0): barril aún en el aire, atravesado sin arrollar.
    advance(world, events, 55); // ~0.92s
    const barrel = world.barrels.find((b) => b.id === 'falling-barrel')!;
    expect(barrelInAir(barrel, world.time)).toBe(true);
    expect(barrel.exploded).toBe(false);
    expect(boss.bossStage).not.toBe(3); // no se detuvo/aturdió por el barril en el aire

    // El Guardián sigue cargando hasta topar con la pared este (bounds
    // ±7.5): ahí se aturde normal (no por barril).
    advanceUntil(world, events, () => boss.bossVulnerable, 400);
    expect(collectTypes(events)).not.toContain('boss-barrel-charge-stun');
  });
});

describe('Guardián: carga que arrolla un barril (GDD §15.2)', () => {
  /** Mundo con el Guardián telegrafiando una carga hacia el este y un barril vivo plantado en su trayectoria. */
  function setupChargeIntoBarrel() {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.barrels.push({ id: 'barrel-in-path', position: { x: 3, y: 0 }, radius: 0.4, exploded: false });

    boss.bossStage = 1; // GUARDIAN_STAGE_TELEGRAPH
    boss.bossTelegraphUntil = world.time + 0.8;
    boss.bossTimer = 0.8;
    world.hero.position.x = 10; // fija la dirección de carga (este), lejos del blast
    world.hero.position.y = 0;
    return { world, events, boss };
  }

  it('explota el barril y el Guardián recibe su daño de barril (fracción de maxHp) SIN gating de ventana (su castigo, playtest 2026-07-06/2026-07-10)', () => {
    const { world, events, boss } = setupChargeIntoBarrel();

    advanceUntil(world, events, () => boss.bossVulnerable);

    const barrel = world.barrels.find((b) => b.id === 'barrel-in-path')!;
    expect(barrel.exploded).toBe(true);
    // No estaba en ventana al arrollarlo (venía cargando): sin el bypass el
    // daño sería 0 (damageOutsideWindow=0). Debe ser exactamente
    // GUARDIAN_BARREL_DAMAGE_FRACTION*maxHp (el castigo fuerte, el mayor de
    // los tres modos de daño del Guardián, no el BARREL_DAMAGE estándar que
    // sufriría cualquier otro enemigo en el radio).
    expect(boss.hp).toBeCloseTo(GUARDIAN_MAX_HP - GUARDIAN_BARREL_DAMAGE_FRACTION * GUARDIAN_MAX_HP);
    const types = collectTypes(events);
    expect(types).toContain('barrel-explosion');
    expect(types).toContain('boss-barrel-charge-stun');
  });

  it('queda aturdido GUARDIAN_BARREL_STUN_DURATION (~2.2s), más que el aturdimiento normal de 1.4s', () => {
    expect(GUARDIAN_BARREL_STUN_DURATION).toBeGreaterThan(GUARDIAN_STUN_DURATION);

    const { world, events, boss } = setupChargeIntoBarrel();
    advanceUntil(world, events, () => boss.bossVulnerable);
    expect(boss.bossStage).toBe(3); // GUARDIAN_STAGE_STUNNED
    expect(boss.bossTimer).toBeCloseTo(GUARDIAN_BARREL_STUN_DURATION, 6);

    // Pasado el aturdimiento NORMAL (1.4s) sigue vulnerable: es el largo.
    advance(world, events, 90); // 1.5s
    expect(boss.bossVulnerable).toBe(true);

    // Y pasado el largo (2.2s en total), se cierra.
    advance(world, events, 60); // total 2.5s
    expect(boss.bossVulnerable).toBe(false);
  });
});

describe('Guardián: poción de recompensa al cambiar de fase (GDD §15.2)', () => {
  it('suelta 1 poción al cruzar a fase 2 y otra al cruzar a fase 3 (2 en total, sin repetir)', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    const boss = world.enemies[0];
    world.hero.position.x = 100; // lejos: no recoge nada; el drop de poción solo depende del cruce de umbral de vida, no del stage del jefe
    world.hero.position.y = 100;

    const activePotions = () => world.items.filter((i) => i.active && i.kind === 'potion');
    expect(activePotions().length).toBe(0);

    // Cruza a fase 2 (≤66%).
    boss.hp = Math.floor(boss.maxHp * 0.6);
    advance(world, events, 1);
    expect(boss.bossPhase).toBe(2);
    expect(activePotions().length).toBe(1);
    // La suelta en su posición (el punto del cambio).
    const potion1 = activePotions()[0];
    expect(Math.hypot(potion1.position.x - boss.position.x, potion1.position.y - boss.position.y)).toBeLessThan(0.1);
    expect(collectTypes(events)).toContain('boss-phase-changed');

    // Cruza a fase 3 (≤33%).
    boss.hp = Math.floor(boss.maxHp * 0.2);
    advance(world, events, 1);
    expect(boss.bossPhase).toBe(3);
    expect(activePotions().length).toBe(2);

    // Sin más cruces no hay más pociones (el cambio de fase es de una sola vez).
    advance(world, events, 120);
    expect(activePotions().length).toBe(2);
  });
});

describe('boss-guardian.json: regla anti-trampa de arena (GDD §15.2)', () => {
  /**
   * Radio máximo de un círculo capaz de atravesar el hueco diagonal entre la
   * esquina exterior de una roca y la esquina de la sala (centro pegado a las
   * dos paredes: c = esquina − r; toca la esquina de la roca cuando
   * (g − r)·√2 = r, con g = holgura por eje). El criterio anti-trampa NO es
   * "nadie pasa": es que no quede a medias (héroe sí, Guardián no). Con las
   * rocas pegadas a las esquinas (2.8x2.8 en ±5.5, versión anterior) el hueco
   * era tan estrecho que NINGUNO de los dos cabía (gap=1.2 → radio máx
   * ≈0.284, menor que ambos radios: sin trampa, pero arena "sosa" según
   * playtest 2026-07-06). Con las rocas movidas al centro (1.8x1.8 en ±3.2)
   * el hueco roca-muro se abre mucho (gap=3.4 → radio máx ≈1.992): ahora caben
   * los DOS con holgura de sobra — sigue sin ser trampa, por el motivo
   * contrario.
   */
  function maxRadiusThroughCornerPocket(gap: number): number {
    return (gap * Math.SQRT2) / (1 + Math.SQRT2);
  }

  it('el hueco roca-esquina (roca-muro) es transitable para héroe Y Guardián por igual: sin trampa', () => {
    const room = parseRoomData(bossGuardianJson).room!;
    const halfW = room.width / 2;
    const halfH = room.height / 2;

    for (const rock of room.hazards) {
      const gapX = halfW - (Math.abs(rock.position.x) + rock.width / 2);
      const gapY = halfH - (Math.abs(rock.position.y) + rock.height / 2);
      // Las rocas de esquina son simétricas: misma holgura en ambos ejes.
      expect(gapX).toBeCloseTo(gapY, 6);
      // Rocas movidas hacia el centro tras playtest 2026-07-06 (1.8x1.8 en
      // ±3.2, antes 2.8x2.8 en ±5.5): la holgura roca-muro pasa de 1.2 a 3.4.
      expect(gapX).toBeCloseTo(3.4, 6);
      // Radio máximo que cabe por ese hueco (≈1.992) ahora es MAYOR que el
      // radio del Guardián (el más grande de los dos): caben ambos.
      expect(maxRadiusThroughCornerPocket(gapX)).toBeGreaterThan(GUARDIAN_RADIUS);
    }
    // El Guardián es más grande que el héroe: si él cabe, el héroe también.
    expect(GUARDIAN_RADIUS).toBeGreaterThan(HERO_RADIUS);
  });

  /**
   * Radio máximo de un círculo capaz de atravesar en línea recta el hueco
   * rectangular entre dos rocas vecinas (mismo eje, enfrentadas): el círculo
   * más grande que cabe justo entre ambas caras tiene radio = hueco/2 (se
   * queda centrado, tangente a las dos). A diferencia del hueco roca-esquina
   * (donde la trampa sería que NADIE pase), aquí la trampa real sería que el
   * hueco quede a medias: el héroe cabe pero el Guardián no, dejándole
   * "refugios" tras las rocas donde el jefe nunca puede seguirlo ni cargar
   * limpiamente. Por eso el criterio no es "menor que HERO_RADIUS" sino
   * "mayor que GUARDIAN_RADIUS": caben los dos con holgura.
   */
  function maxRadiusThroughStraightGap(gap: number): number {
    return gap / 2;
  }

  it('ningún hueco roca-roca (rocas vecinas del mismo lado) deja al héroe pasar sin que quepa también el Guardián', () => {
    const room = parseRoomData(bossGuardianJson).room!;
    const byId = new Map(room.hazards.map((h) => [h.id, h]));

    // Por simetría (4 rocas en ±3.2, mismo tamaño) solo hace falta comprobar
    // un par horizontal (NW-NE) y un par vertical (NW-SW); los otros 2 pares
    // (SE-SW horizontal, NE-SE vertical) son geométricamente idénticos.
    const pairs: [string, string, 'x' | 'y'][] = [
      ['rock-nw', 'rock-ne', 'x'],
      ['rock-nw', 'rock-sw', 'y'],
    ];

    for (const [idA, idB, axis] of pairs) {
      const a = byId.get(idA)!;
      const b = byId.get(idB)!;
      const centerGap = Math.abs(a.position[axis] - b.position[axis]);
      const halfWidthA = axis === 'x' ? a.width / 2 : a.height / 2;
      const halfWidthB = axis === 'x' ? b.width / 2 : b.height / 2;
      const gap = centerGap - halfWidthA - halfWidthB;
      expect(gap).toBeCloseTo(4.6, 6);
      expect(maxRadiusThroughStraightGap(gap)).toBeGreaterThan(GUARDIAN_RADIUS);
    }
  });

  it('el Guardián puede completar una carga contra el héroe sin travarse en las rocas nuevas (bossStage cicla con normalidad)', () => {
    const room = parseRoomData(bossGuardianJson).room!;
    const world = createWorld(room);
    initBossEnemies(world);
    const events = createEventQueue(64);
    const boss = world.enemies[0];

    // Coloca al héroe a rango de detección, lejos de cualquier roca (centro
    // de un lado libre), para forzar una carga limpia persecución→telegraph→
    // carga→(choque con pared, ninguna roca en la trayectoria)→aturdido→
    // recuperación, confirmando que el ciclo no se cuelga con la arena nueva.
    world.hero.position.x = 0;
    world.hero.position.y = 0;
    boss.position.x = 0;
    boss.position.y = 3;

    advanceUntil(world, events, () => boss.bossStage === 1 /* GUARDIAN_STAGE_TELEGRAPH */, 400);
    expect(boss.bossStage).toBe(1);
    advanceUntil(world, events, () => boss.bossStage === 3 /* GUARDIAN_STAGE_STUNNED */, 400);
    expect(boss.bossStage).toBe(3);
    advanceUntil(world, events, () => boss.bossStage === 0 /* de vuelta a CHASE */, 400);
    expect(boss.bossStage).toBe(0);
  });

  it('en modo sala única los huecos de puerta están sellados: héroe empujado contra cada puerta no sale de bounds', () => {
    const room = parseRoomData(bossGuardianJson).room!;
    const world = createWorld(room);
    initBossEnemies(world);
    const events = createEventQueue(64);

    const outward: Record<string, { x: number; y: number }> = {
      north: { x: 0, y: -1 },
      south: { x: 0, y: 1 },
      west: { x: -1, y: 0 },
      east: { x: 1, y: 0 },
    };

    for (const slot of room.doorSlots) {
      const dir = outward[slot.side];
      // Héroe plantado en el centro del hueco de puerta, empujado hacia fuera
      // durante 4s a tope de velocidad (la fricción no importa: se re-imprime
      // la velocidad cada tick, peor caso que cualquier knockback real).
      world.hero.position.x = dir.x * (world.bounds.maxX - 1) + (dir.x === 0 ? slot.offset : 0);
      world.hero.position.y = dir.y * (world.bounds.maxY - 1) + (dir.y === 0 ? slot.offset : 0);
      for (let i = 0; i < 240; i++) {
        world.hero.velocity.x = dir.x * 50; // clampado a MAX_SPEED dentro de stepHeroPhysics
        world.hero.velocity.y = dir.y * 50;
        stepHeroPhysics(world, events);
      }
      expect(Math.abs(world.hero.position.x)).toBeLessThanOrEqual(world.bounds.maxX - HERO_RADIUS + 1e-9);
      expect(Math.abs(world.hero.position.y)).toBeLessThanOrEqual(world.bounds.maxY - HERO_RADIUS + 1e-9);
    }
  });
});

// ── B1.6.1: fix tras playtest 2026-07-06 (barriles rodantes superpuestos) ──
//
// La otra mitad histórica de B1.6.1 (la patrulla perimetral atascándose
// contra una roca interior, "no queda atascado... esquina de patrulla") vivía
// aquí como dos tests dedicados a `guardianStepPatrolMove`/`boss.patrolTo`.
// Ambos —y el mecanismo que ejercitaban— desaparecieron en el rediseño
// 2026-08-31 (patrulla → persecución constante, GUARDIAN_STAGE_CHASE). La
// garantía real que probaban (`moveBossTowardWithAvoidance` nunca atraviesa
// un obstáculo y sigue progresando hacia el objetivo) sigue cubierta,
// genérica y directamente, en `bosses/movement.test.ts`; y el ciclo completo
// carga→choque→stun→recuperación en la arena real ya lo cubre el test de
// arriba ("puede completar una carga... sin travarse en las rocas nuevas").

describe('Guardián: puntos fijos de aparición de barriles, sin solapes (fix B1.6.1, GDD §15.2; reubicados al centro tras playtest 2026-07-10)', () => {
  /** Media diagonal de una roca 1.8x1.8 (boss-guardian.json): medio lado 0.9. */
  const ROCK_HALF = 0.9;
  /** Centros de las 4 rocas del anillo central, iguales a boss-guardian.json. */
  const ROCK_CENTERS = [
    { x: -3.2, y: 3.2 },
    { x: 3.2, y: 3.2 },
    { x: 3.2, y: -3.2 },
    { x: -3.2, y: -3.2 },
  ];

  it('guardianBarrelSpawnPoints deriva 8 puntos fijos en la región central (huecos entre rocas + interior), ninguno sobre una roca ni en el centro exacto', () => {
    const world = makeGuardianWorld();
    const points = guardianBarrelSpawnPoints(world.bounds);
    expect(points.length).toBe(8);
    // Más puntos que GUARDIAN_BARREL_MAX_ACTIVE (3): sigue habiendo margen de elección.
    expect(points.length).toBeGreaterThan(GUARDIAN_BARREL_MAX_ACTIVE);

    for (const p of points) {
      // Región central: mucho más cerca del centro que de las paredes (sala 15x15, halfW=7.5).
      expect(Math.hypot(p.x, p.y)).toBeLessThan(4);
      // Nunca el centro exacto (ahí aparece el propio Guardián).
      expect(Math.hypot(p.x, p.y)).toBeGreaterThan(0);
      // Ninguno solapa el AABB de una roca del anillo.
      for (const rock of ROCK_CENTERS) {
        const overlapsX = Math.abs(p.x - rock.x) < ROCK_HALF;
        const overlapsY = Math.abs(p.y - rock.y) < ROCK_HALF;
        expect(overlapsX && overlapsY).toBe(false);
      }
    }
    // Sin duplicados (8 puntos distintos).
    const unique = new Set(points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(unique.size).toBe(8);
  });

  it('3 apariciones consecutivas caen en 3 de los 8 puntos fijos, sin solaparse (distancia mínima ≥ 2×radio)', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    world.hero.position.x = 100; // lejos: da igual que dispare persecución/carga — la cadencia de barriles es independiente del stage (guardianStepBarrelSpawn corre siempre, ver guardianStepPattern)
    world.hero.position.y = 100;

    const fixedPoints = guardianBarrelSpawnPoints(world.bounds);
    const intervalTicks = Math.round(GUARDIAN_BARREL_SPAWN_INTERVAL / FIXED_DT);

    // Fuerza 3 slots consecutivos de aparición (cada ~8s).
    advance(world, events, 1); // primer barril (slot 0)
    advance(world, events, intervalTicks); // segundo barril (slot 1)
    advance(world, events, intervalTicks); // tercer barril (slot 2)

    const spawned = liveBarrels(world);
    expect(spawned.length).toBe(3);

    // Cada barril spawneado coincide (con tolerancia) con uno de los 8 puntos fijos.
    for (const barrel of spawned) {
      const matchesFixedPoint = fixedPoints.some(
        (p) => Math.abs(p.x - barrel.position.x) < 1e-6 && Math.abs(p.y - barrel.position.y) < 1e-6,
      );
      expect(matchesFixedPoint).toBe(true);
    }

    // Distancia mínima entre cualquier par de barriles vivos ≥ 2×radio (sin solape).
    let minPairDist = Infinity;
    for (let i = 0; i < spawned.length; i++) {
      for (let j = i + 1; j < spawned.length; j++) {
        const d = Math.hypot(spawned[i].position.x - spawned[j].position.x, spawned[i].position.y - spawned[j].position.y);
        minPairDist = Math.min(minPairDist, d);
      }
    }
    expect(minPairDist).toBeGreaterThanOrEqual(2 * GUARDIAN_BARREL_RADIUS);

    // Los 3 puntos elegidos son distintos entre sí (no repite el mismo punto fijo).
    const uniquePositions = new Set(spawned.map((b) => `${b.position.x.toFixed(3)},${b.position.y.toFixed(3)}`));
    expect(uniquePositions.size).toBe(3);
  });

  it('sin barriles vivos, el primer spawn elige un punto fijo (cualquiera, empate determinista)', () => {
    const world = makeGuardianWorld();
    const events = createEventQueue(64);
    world.hero.position.x = 100;
    world.hero.position.y = 100;

    const fixedPoints = guardianBarrelSpawnPoints(world.bounds);
    advance(world, events, 1);
    const barrel = liveBarrels(world)[0];
    const matchesFixedPoint = fixedPoints.some(
      (p) => Math.abs(p.x - barrel.position.x) < 1e-6 && Math.abs(p.y - barrel.position.y) < 1e-6,
    );
    expect(matchesFixedPoint).toBe(true);
  });
});
