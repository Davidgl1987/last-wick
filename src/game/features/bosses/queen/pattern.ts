/**
 * Reina del Enjambre (GDD §15.3, Fase B2).
 *
 * Reuso de campos de `Enemy` (mismo espíritu que el Guardián, ver nota en
 * `guardian/pattern.ts`): la Reina NUNCA pasa por `stepEnemyAi`, así que:
 * - `patrolTo`/`patrolFrom`/`bossTimer`: sin uso propio en la Reina desde la
 *   TAREA 5 del rediseño (docs/plans/QUEEN_REDESIGN_PLAN.md, "persigue
 *   RODEANDO obstáculos"): la deambulación aleatoria previa (que atravesaba
 *   columnas, sin evasión) se retira — `queenStepMove` persigue al héroe
 *   directamente con `moveBossTowardWithAvoidance` (misma circunnavegación
 *   tangencial del Guardián, generalizada en esta tarea), que YA rodea
 *   columnas/rocas; sumar un wander sin evadir solo reintroducía el problema
 *   que esta tarea corrige. Quedan en su valor inicial del pool y no se leen.
 * - `bossCounter`: cuenta atrás (en segundos, no ticks) hasta soltar el
 *   próximo charco de rastro — comparte "reloj" con `trailDropTimer` del Trail
 *   normal en espíritu, pero como campo genérico de jefe.
 * - `bossTelegraphUntil`: reutilizado como reloj de cuenta atrás hasta la
 *   próxima oleada de larvas (QUEEN_WAVE_INTERVAL); no es un telegraph real
 *   (la Reina no tiene, GDD §15.3), pero el campo ya existe y el render lo
 *   deja en paz porque `bossId==='queen'` no dibuja el anillo genérico de
 *   telegraph (ver EnemyViews.tsx: solo bossVulnerable pinta algo, y aquí es
 *   permanente).
 *
 * Larvas: NO son un `BossDef` ni un `EnemyKind` nuevo — son `Enemy` normales
 * de `kind:'dummy'` con `hp`/`radius` propios, viviendo como slots
 * PREASIGNADOS al final de `world.enemies` (ver `queenOnInit`), igual pool
 * preasignado que proyectiles/charcos. `enemy.facing` guarda su dirección de
 * avance fija (fase 1, línea recta); en fase 2/3 se recalcula cada tick
 * (persecución real) y no se usa `facing` como caché.
 */

import type { EventQueue } from '@/engine/events';
import { dropPotionAt } from '@/game/features/items/items';
import type { Enemy, World } from '@/game/world/types';
import { moveBossTowardWithAvoidance } from '@/game/features/bosses/movement';
import { queenBrokenColumnCount, type QueenState } from './columns';
import { QUEEN_COLUMN_HP, QUEEN_GUARDIAN_MAX, QUEEN_LARVA_HP, QUEEN_LARVA_ID_PREFIX, QUEEN_LARVA_MAX, QUEEN_LARVA_RADIUS, QUEEN_STALK_SPEED_BASE, QUEEN_STALK_SPEED_PER_COLUMN, QUEEN_TRAIL_DROP_INTERVAL, QUEEN_TRAIL_DROP_INTERVAL_PHASE2, QUEEN_TRAIL_PUDDLE_LIFETIME, QUEEN_TRAIL_PUDDLE_RADIUS, QUEEN_WAVE_INTERVAL } from './constants';
import { queenActivateGuardian, queenSpawnChasers, queenStepGuardians, queenStepLarvae } from './larvae';

/**
 * Reserva `QUEEN_LARVA_MAX` slots de larva en `world.enemies`, inactivos
 * (hp=0) hasta que una oleada los active (GDD §15.3: "invoca larvas por
 * oleadas"). Se hace UNA vez al construir el mundo (`onInit`, llamado desde
 * `lifecycle.ts::initBossEnemies`) para que el render (`EnemyViews`, que hace
 * `.map` sobre `world.enemies` en el cuerpo del componente, no en useFrame)
 * los vea desde el primer render — evita el bug de entidades que nacen sin
 * mesh por `.push` a mitad de partida (ver nota de `BarrelViews`/`ItemViews`
 * en AGENTS.md). `collectDeadDrops` (step.ts) los marca como "ya soltaron
 * moneda" desde el primer tick (hp<=0 antes de activarse nunca): así, al
 * activarse y morir de verdad más tarde, nunca sueltan moneda — cumple GDD
 * §15.3 "sin drop de moneda" sin tocar el pipeline de drops.
 */
export function queenOnInit(world: World, boss: Enemy): void {
  for (let i = 0; i < QUEEN_LARVA_MAX; i++) {
    world.enemies.push({
      id: `${QUEEN_LARVA_ID_PREFIX}${i}`,
      kind: 'dummy',
      roomId: boss.roomId,
      position: { x: boss.position.x, y: boss.position.y },
      velocity: { x: 0, y: 0 },
      radius: QUEEN_LARVA_RADIUS,
      hp: 0,
      maxHp: QUEEN_LARVA_HP,
      patrolFrom: { x: boss.position.x, y: boss.position.y },
      patrolTo: { x: boss.position.x, y: boss.position.y },
      patrolForward: true,
      // Las larvas nunca pasan por stepPatrol (movimiento propio en
      // larvae.ts) — es solo relleno del tipo, sin efecto en su comportamiento.
      patrolTurnUntil: 0,
      chasing: false,
      facing: { x: 0, y: 1 },
      trailDropTimer: 0,
      shooterPhase: 'chase',
      shooterPhaseTimer: 0,
      hitFlashUntil: 0,
      spikeDamageCooldownUntil: 0,
      knockbackUntil: 0,
      steerBias: 0,
      bossPhase: 1,
      bossVulnerable: false,
      bossDamageOutsideWindowFactor: 0,
      bossBarrelDamage: 0,
      bossVulnerableUntil: 0,
      bossTelegraphUntil: 0,
      bossTelegraphKind: '',
      bossTimer: 0,
      bossStage: 0,
      bossCounter: 0,
      bossWeaponGateA: '',
      bossWeaponGateB: '',
    });
  }
  // (Ya no hay setup de deambulación que hacer aquí: TAREA 5 del rediseño
  // retira el wander aleatorio — `queenStepMove` persigue directamente al
  // héroe con evasión, sin punto objetivo propio que inicializar. Tampoco se
  // fija ningún ancla de correa: la Reina persigue libremente al héroe, sin
  // volver a un centro — playtest 2026-07-10 "quitar la correa".)

  // Rediseño 2026-07-10 (GDD §15.3, docs/plans/QUEEN_REDESIGN_PLAN.md §1): el
  // cuerpo del jefe ya NO es vulnerable (ni de forma permanente ni por
  // ventana) — su vida está en las columnas de su sala. Puebla las `columns`
  // del estado a partir de los `Obstacle` ya construidos por los hazards 'rock'
  // de su propia sala (ver buildRoomEntities), cuyo id local empieza por
  // "column" (boss-queen.json: column-nw-1..4/column-ne-1..4). En integración
  // multi-sala futura habría que poblar esto al ENTRAR en la sala del jefe en
  // vez de aquí; por ahora `onInit` basta para el modo sala única de los tests
  // y la ruta de playtest `?boss=b2`.
  // Reserva el slot opaco `world.bossState` con el estado propio de la Reina
  // (su vida vive en `columns`); el core no conoce este tipo, solo se toca aquí
  // y vía `queenState` (ver queen/columns.ts).
  const state: QueenState = { bossId: 'queen', columns: [] };
  world.bossState = state;
  for (const o of world.obstacles) {
    if (o.roomId !== boss.roomId) continue;
    const local = o.id.includes(':') ? o.id.slice(o.id.lastIndexOf(':') + 1) : o.id;
    if (!local.startsWith('column')) continue;
    state.columns.push({
      id: o.id,
      position: { x: (o.aabb.minX + o.aabb.maxX) / 2, y: (o.aabb.minY + o.aabb.maxY) / 2 },
      halfW: (o.aabb.maxX - o.aabb.minX) / 2,
      halfH: (o.aabb.maxY - o.aabb.minY) / 2,
      hp: QUEEN_COLUMN_HP,
      broken: false,
      roomId: o.roomId,
    });
  }

  // A1 (playtest 2026-07-10): cada columna nace YA con su guardiana (hasta el
  // cupo QUEEN_GUARDIAN_MAX), para que no haya ventana libre en la que arrasar
  // las columnas seguidas. El resto lo repone `queenStepGuardians`.
  let placedGuardians = 0;
  for (const col of state.columns) {
    if (placedGuardians >= QUEEN_GUARDIAN_MAX) break;
    if (queenActivateGuardian(world, boss, col, null)) placedGuardians++;
  }
}

/** Cadencia de rastro según fase (GDD §15.3: "en fase 2 el rastro se genera más rápido"). */
function queenTrailIntervalForPhase(phase: 1 | 2 | 3): number {
  return phase >= 2 ? QUEEN_TRAIL_DROP_INTERVAL_PHASE2 : QUEEN_TRAIL_DROP_INTERVAL;
}

/**
 * Persecución hacia el héroe RODEANDO obstáculos (TAREA 5 del rediseño de la
 * Reina, docs/plans/QUEEN_REDESIGN_PLAN.md: "atraviesa las columnas... debe
 * perseguir RODEÁNDOLAS" — sube el reto, GDD §15.3, playtest 2026-07-06 "la
 * Reina te acecha"; playtest 2026-07-10 "que llegue a tocar al jugador" +
 * "incrementaría la velocidad con la que persigue conforme pasan las fases" +
 * "quitar la correa, que persiga libremente"): plantarse en un punto fijo a
 * disparar deja de ser seguro. La Reina se dirige SIEMPRE hacia el héroe —sin
 * correa ni ancla central de vuelta— y persigue por toda la arena a
 * `QUEEN_STALK_SPEED_BY_PHASE[bossPhase-1]`, reutilizando EXACTAMENTE la
 * circunnavegación tangencial del Guardián (`moveBossTowardWithAvoidance`,
 * generalizada en esta tarea con un parámetro `speed`) en vez de escribir
 * `boss.position` sin comprobar sólidos: ya NO atraviesa columnas/rocas, las
 * rodea — con el efecto de diseño buscado de que la Reina usa las columnas
 * para acorralar en vez de dejarlas de lado.
 *
 * La deambulación aleatoria previa (wander independiente sumado al acecho,
 * con "envolvente" propia en fase 3) se retira: al rodear obstáculos, la
 * persecución directa YA se lee como gestión de terreno (se desvía, traza
 * rastro alrededor de las columnas) sin necesitar un segundo vector sin
 * evadir — que además volvería a atravesar obstáculos y rompería la garantía
 * de esta tarea. `queenStepTrail` (rastro) y el escalado de velocidad por
 * fase quedan intactos; solo cambia CÓMO se traduce la intención de
 * movimiento en posición real.
 */
function queenStepMove(world: World, boss: Enemy, dt: number): void {
  // Acelera con cada columna ROTA (playtest 2026-07-10: rompérselas la enfurece
  // → el remate deja de ser un tiro tranquilo). Sustituye el escalado por fase.
  const stalkSpeed = QUEEN_STALK_SPEED_BASE + queenBrokenColumnCount(world, boss) * QUEEN_STALK_SPEED_PER_COLUMN;
  moveBossTowardWithAvoidance(world, boss, world.hero.position.x, world.hero.position.y, dt, stalkSpeed);
}

/**
 * Rastro permanente (GDD §15.3: "como el Trail, pero más grande y duradero,
 * va cerrando el espacio limpio de la arena"). Reutiliza `world.puddles`
 * (mismo pool que el Trail y las esquirlas del Guardián) con parámetros
 * PROPIOS (QUEEN_TRAIL_PUDDLE_RADIUS/QUEEN_TRAIL_PUDDLE_LIFETIME): si el pool
 * está lleno, no suelta charco este tick (degradación silenciosa, igual
 * criterio que `acquirePuddle` de enemies/trail/ai.ts) en vez de crecer el array.
 *
 * `slows = true` (rediseño 2026-07-10, GDD §15.3): marca el charco como
 * rastro de la Reina para que `stepPuddles` (features/hazards/hazards.ts) le aplique
 * ralentización + DoT por permanencia en vez del daño de contacto simple del
 * Trail normal — el daño directo YA NO se aplica aquí, lo gestiona
 * `stepPuddles` con sus válvulas (gracia + velocidad de cruce).
 */
function queenStepTrail(world: World, boss: Enemy, dt: number): void {
  boss.bossCounter -= dt;
  if (boss.bossCounter > 0) return;
  boss.bossCounter = queenTrailIntervalForPhase(boss.bossPhase);
  const pool = world.puddles;
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].active) {
      pool[i].active = true;
      pool[i].position.x = boss.position.x;
      pool[i].position.y = boss.position.y;
      pool[i].radius = QUEEN_TRAIL_PUDDLE_RADIUS;
      pool[i].ttl = QUEEN_TRAIL_PUDDLE_LIFETIME;
      pool[i].slows = true;
      return;
    }
  }
}

/** Cadencia de oleadas de perseguidoras (GDD §15.6: "oleada cada ~3s"), independiente del rastro/guardianas. */
function queenStepWaves(world: World, boss: Enemy, dt: number, events: EventQueue): void {
  boss.bossTelegraphUntil -= dt;
  if (boss.bossTelegraphUntil > 0) return;
  boss.bossTelegraphUntil = QUEEN_WAVE_INTERVAL;
  queenSpawnChasers(world, boss, events);
}

export function queenStepPattern(world: World, boss: Enemy, dt: number, events: EventQueue): void {
  // Vulnerabilidad del cuerpo (rediseño 2026-07-10, GDD §15.3): al cuerpo
  // SIEMPRE le entra daño (cualquier ataque), pero reducido salvo cuando está
  // ATURDIDA. `stepQueenColumns` fija `bossVulnerableUntil` al romper una
  // columna (aturdimiento temporal) o a Infinity con TODAS rotas (vulnerable
  // permanente para rematar el último 1/3). Aquí se deriva `bossVulnerable` de
  // ese reloj cada tick: dentro de ventana → daño completo; fuera → el gate de
  // combat.ts escala por `damageOutsideWindow` (0.15, "apenas si no aturdida").
  boss.bossVulnerable = world.time < boss.bossVulnerableUntil;

  queenStepMove(world, boss, dt);
  queenStepTrail(world, boss, dt);
  queenStepWaves(world, boss, dt, events);
  queenStepGuardians(world, boss, dt, events);
  queenStepLarvae(world, boss, dt, events);
}

export function queenOnPhaseChanged(world: World, boss: Enemy): void {
  // Igual criterio que el Guardián (GDD §15.2): sostiene la pelea larga y
  // premia el progreso con una poción en el punto del cambio de fase.
  dropPotionAt(world, boss.position.x, boss.position.y);
}
