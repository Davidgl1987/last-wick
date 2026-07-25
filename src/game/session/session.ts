/**
 * Sesión de juego: el objeto mutable que posee la sim y el estado de alta
 * frecuencia compartido entre input y render. Vive fuera de React (se guarda
 * en un ref/useState-inicial); NUNCA se usa como estado de React.
 */

import { ROOMS_PER_RUN } from '@/game/world/constants';
import { createEffectsState, type EffectsState } from '@/game/features/effects/effectsState';
import { ParticlePool } from '@/game/features/effects/particles';
import { ShockwavePool } from '@/game/features/effects/shockwave';
import { TrailPool } from '@/game/features/effects/trail';
import { WaxPool } from '@/game/features/effects/wax';
import { BOSS_DIFFICULTY_ORDER } from '@/game/features/bosses/registry';
import { initBossEnemies } from '@/game/features/bosses/lifecycle';
import { generateDungeon } from '@/game/features/dungeon/dungeon';
import { createDungeonWorld } from '@/game/features/dungeon/dungeon-world';
import { createEventQueue, type EventQueue } from '@/engine/events';
import { applyUpgrade, rollBossReward, rollShopStock, type UpgradeDef } from '@/game/session/upgrades';
import { createWorld } from '@/game/world/create';
import type { BossId, RoomData, World } from '@/game/world/types';

/** Estado de effects de la sesión: sobrevive a los reinicios de run (no se recrea en restartSession). */
export interface EffectsSession {
  particles: ParticlePool;
  trail: TrailPool;
  /**
   * Capa de cera persistente (rama `estilo-oscuro`, playtest ronda 7, ver
   * wax.ts): a diferencia de `trail`, sobrevive a los cambios de SALA dentro
   * de la misma mazmorra (nunca se recrea aquí) pero se limpia explícitamente
   * en `restartSession`/`advanceToNextDungeon` (más abajo) — mismo criterio
   * que `trauma`/`hitStopRemaining` en `state`, no el de `particles`/`trail`
   * (esos sí sobreviven íntegros a un reinicio, son geometría pura sin
   * estado de sala; la cera en cambio SÍ debe cerrarse con la run/mazmorra,
   * petición explícita: "un rastro de todos los movimientos que ha hecho"
   * solo tiene sentido dentro de la mazmorra actual).
   */
  wax: WaxPool;
  shockwaves: ShockwavePool;
  state: EffectsState;
}

function createEffectsSession(): EffectsSession {
  return {
    particles: new ParticlePool(),
    trail: new TrailPool(),
    wax: new WaxPool(),
    shockwaves: new ShockwavePool(),
    state: createEffectsState(),
  };
}

/** Estado de puntería escrito por input/ y leído por render/ (sin re-renders). */
export interface AimState {
  active: boolean;
  /** Dirección de tiro unitaria (arrastre invertido), plano del suelo. */
  dirX: number;
  dirY: number;
  /** Fuerza normalizada [0,1] (arrastre clampado a MAX_DRAG_DISTANCE). */
  force: number;
}

export interface GameSession {
  world: World;
  events: EventQueue;
  aim: AimState;
  /** Acumulador de timestep fijo (s pendientes de simular). */
  accumulator: number;
  /** Fracción [0,1) del tick actual, para interpolar el render. */
  renderAlpha: number;
  /** Posición del héroe en el tick anterior, para interpolación de render. */
  heroPrevX: number;
  heroPrevY: number;
  /** Sala original con la que se creó el mundo (modo sala única: playtest del editor). */
  room: RoomData;
  /** Pool de salas y semilla usados para (re)generar la mazmorra (modo run completa); null en modo sala única. */
  dungeonPool: RoomData[] | null;
  seed: number;
  /**
   * Semilla forzada (parámetro `seed` de `createDungeonGameSession`, usado
   * por los tests para determinismo — GameRoot.tsx ya no la lee de la URL):
   * si no es null, los reinicios regeneran SIEMPRE el mismo mapa en vez de
   * sortear una semilla nueva.
   */
  forcedSeed: number | null;
  /** Partículas/estela/trauma/hit-stop (fase 4, GDD §12): independiente del mundo, sobrevive a reinicios de run. */
  effects: EffectsSession;
  /**
   * Run multi-mazmorra (GDD §10): orden de jefes de la run (uno por mazmorra
   * encadenada), FIJO por dificultad creciente (`BOSS_DIFFICULTY_ORDER`,
   * registry.ts — playtest de David 2026-07-15: La Tormenta, la más difícil,
   * siempre la última). Vacío en modo sala única (playtest/`?boss=`): esos
   * modos no encadenan mazmorras.
   */
  bossSequence: BossId[];
  /** Índice del jefe/mazmorra actual dentro de `bossSequence` (0 = primera). */
  stageIndex: number;
  /**
   * Opciones de recompensa gratis calculadas al derrotar un jefe no-final
   * (docs/plans/ECONOMY_PLAN.md F3, fase 'boss-reward'): vacío si aún no se
   * han calculado para esta sala o tras elegir. Ver `ensureBossRewardChoices`
   * y `chooseBossReward`.
   */
  bossRewardChoices: UpgradeDef[];
  /**
   * Stock de la tienda de la mazmorra actual (docs/plans/ECONOMY_PLAN.md F4):
   * hasta 4 mejoras distintas, sorteadas UNA vez al crear la mazmorra (y en
   * cada `advanceToNextDungeon`/`restartSession`) con `world.rng` — NO se
   * vuelve a sortear al reabrir la tienda dentro de la misma mazmorra (ver
   * `rollShopStock`, session/upgrades.ts).
   */
  shopStock: UpgradeDef[];
  /**
   * Modo dios de playtest (`?godmode`, render/debug-params.ts): fijado UNA vez
   * al crear la sesión, sobrevive a `restartSession`/`advanceToNextDungeon`
   * (que recrean `world` con una referencia nueva) porque cada uno de esos
   * puntos reaplica este flag al `world.godMode` recién creado.
   */
  godMode: boolean;
}

/** Sesión de sala única (playtest del editor, fases 1-2): sin mazmorra multi-sala. */
export function createGameSession(room: RoomData, godMode = false): GameSession {
  const world = createWorld(room);
  world.godMode = godMode;
  initBossEnemies(world);
  return {
    world,
    events: createEventQueue(64),
    aim: { active: false, dirX: 0, dirY: 0, force: 0 },
    accumulator: 0,
    renderAlpha: 1,
    heroPrevX: world.hero.position.x,
    heroPrevY: world.hero.position.y,
    room,
    dungeonPool: null,
    seed: 1,
    forcedSeed: null,
    effects: createEffectsSession(),
    bossSequence: [],
    stageIndex: 0,
    bossRewardChoices: [],
    shopStock: rollShopStock(world.hero, world.rng),
    godMode,
  };
}

/** Semilla aleatoria para una nueva run (no determinista: solo el generador en sí lo es dada una semilla). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/**
 * Jefes de DISEÑO disponibles en el pool (salas con `boss` definido,
 * excluyendo `test-boss`: es el jefe trivial de la Fase B0, solo dev/tests —
 * ver rooms.ts), sin duplicados. Orden de aparición en el pool, sin barajar
 * (el llamador baraja con su propio RNG sembrado).
 */
function designBossesInPool(pool: readonly RoomData[]): BossId[] {
  const seen = new Set<BossId>();
  const bosses: BossId[] = [];
  for (const room of pool) {
    if (room.boss === undefined || room.boss === 'test-boss') continue;
    if (seen.has(room.boss)) continue;
    seen.add(room.boss);
    bosses.push(room.boss);
  }
  return bosses;
}

/**
 * Secuencia de jefes de una run (GDD §10, run multi-mazmorra): todos los
 * jefes de diseño del pool, en el orden FIJO de dificultad creciente
 * `BOSS_DIFFICULTY_ORDER` (registry.ts) — playtest de David 2026-07-15: "como
 * este [La Tormenta] es el más difícil, me gustaría que estuviera el último,
 * así que mejor los jefes por orden, y entre jefes, mazmorras aleatorias".
 * Robusto a pools que no traigan los 4 (p.ej. antes de implementar un jefe):
 * ordena los presentes, ignora los ausentes. Las mazmorras ENTRE jefes siguen
 * siendo aleatorias (`generateDungeon` con su propia semilla) — esto solo
 * fija el orden de los jefes, no el contenido de cada mazmorra.
 */
function deriveBossSequence(pool: readonly RoomData[]): BossId[] {
  const present = new Set(designBossesInPool(pool));
  return BOSS_DIFFICULTY_ORDER.filter((boss) => present.has(boss));
}

/**
 * Sesión de run completa (GDD §10): genera una mazmorra de ROOMS_PER_RUN
 * salas a partir del pool. `forcedSeed` fija el mapa también en reinicios
 * (usado por los tests); sin ella, cada run sortea una semilla nueva.
 *
 * Run multi-mazmorra: deriva `bossSequence` (todos los jefes de diseño del
 * pool, en el orden fijo de dificultad `BOSS_DIFFICULTY_ORDER`), y genera la
 * mazmorra del primer stage con la sala de ESE jefe concreto
 * (`generateDungeon(..., bossId)`) — la mazmorra en sí sigue siendo aleatoria
 * (semilla de la run). `isFinalDungeon` es true solo si hay un único jefe en
 * la secuencia.
 */
export function createDungeonGameSession(
  pool: RoomData[],
  forcedSeed: number | null = null,
  godMode = false,
): GameSession {
  const seed = forcedSeed ?? randomSeed();
  const bossSequence = deriveBossSequence(pool);
  const stageIndex = 0;
  const dungeon = generateDungeon(seed, pool, ROOMS_PER_RUN, bossSequence[stageIndex]);
  const world = createDungeonWorld(dungeon, seed);
  world.godMode = godMode;
  initBossEnemies(world);
  world.isFinalDungeon = stageIndex >= bossSequence.length - 1;
  return {
    world,
    events: createEventQueue(64),
    aim: { active: false, dirX: 0, dirY: 0, force: 0 },
    accumulator: 0,
    renderAlpha: 1,
    heroPrevX: world.hero.position.x,
    heroPrevY: world.hero.position.y,
    room: world.room,
    dungeonPool: pool,
    seed,
    forcedSeed,
    effects: createEffectsSession(),
    bossSequence,
    stageIndex,
    bossRewardChoices: [],
    shopStock: rollShopStock(world.hero, world.rng),
    godMode,
  };
}

/**
 * Pausa la sim (GDD §12: botón de pausa + modal). Solo tiene efecto durante
 * 'playing' (no se puede pausar sobre un modal de mejora/fin de run). La sim
 * se detiene por fase, sin desmontar nada: `stepWorld` ya trata cualquier
 * fase != 'playing' como "solo avanzar el reloj".
 */
export function pauseGame(session: GameSession): void {
  if (session.world.phase === 'playing') {
    session.world.phase = 'paused';
  }
}

/** Reanuda desde pausa; no-op si la fase no es 'paused' (ej. si mientras tanto hubo game-over). */
export function resumeGame(session: GameSession): void {
  if (session.world.phase === 'paused') {
    session.world.phase = 'playing';
  }
}

/**
 * Reinicia la run completa. En modo mazmorra (dungeonPool no nulo) genera un
 * mapa NUEVO con una semilla nueva (GDD §10.3: reinicio de run = nueva run,
 * no repetir el mismo mapa) y recalcula `bossSequence` desde el stage 0
 * (morir o reiniciar pierde el progreso de la secuencia de jefes) — el orden
 * es siempre el mismo fijo por dificultad (`BOSS_DIFFICULTY_ORDER`), así que
 * el recálculo es solo por simetría con el stage 0; en modo sala única
 * recrea la misma sala.
 */
export function restartSession(session: GameSession): void {
  let world: World;
  session.stageIndex = 0;
  if (session.dungeonPool) {
    session.seed = session.forcedSeed ?? randomSeed();
    session.bossSequence = deriveBossSequence(session.dungeonPool);
    const dungeon = generateDungeon(session.seed, session.dungeonPool, ROOMS_PER_RUN, session.bossSequence[0]);
    world = createDungeonWorld(dungeon, session.seed);
    world.isFinalDungeon = session.stageIndex >= session.bossSequence.length - 1;
    session.room = world.room;
  } else {
    world = createWorld(session.room);
  }
  world.godMode = session.godMode;
  initBossEnemies(world);
  session.world = world;
  session.accumulator = 0;
  session.renderAlpha = 1;
  session.heroPrevX = world.hero.position.x;
  session.heroPrevY = world.hero.position.y;
  session.aim.active = false;
  session.aim.force = 0;
  // Recompensa de jefe (docs/plans/ECONOMY_PLAN.md F3): un reinicio no debe
  // arrastrar opciones calculadas para la mazmorra anterior.
  session.bossRewardChoices = [];
  // Tienda (docs/plans/ECONOMY_PLAN.md F4): reinicio = mazmorra nueva → stock nuevo.
  session.shopStock = rollShopStock(world.hero, world.rng);
  // Trauma/hit-stop no deben sobrevivir a un reinicio de run (evita un shake
  // heredado de la muerte al aparecer en la nueva run); los pools de
  // partículas/estela sí se conservan (son geometría pura, sin estado de sala).
  session.effects.state.trauma = 0;
  session.effects.state.hitStopRemaining = 0;
  // Cera (ver comentario de `EffectsSession.wax` arriba): reinicio de run =
  // mazmorra nueva, el rastro de la anterior no debe seguir pintado encima.
  session.effects.wax.clear();
}

/**
 * Opciones de recompensa gratis al derrotar un jefe no-final (fase
 * 'boss-reward', docs/plans/ECONOMY_PLAN.md F3): idempotente, calcula una vez
 * por sala (`rollBossReward`, una mejora no maxeada por categoría de ataque).
 *
 * Caso borde: si todas las mejoras de ataque ya están al máximo, no hay nada
 * que ofrecer — en vez de dejar la sim atascada en 'boss-reward' sin opciones,
 * se avanza directamente a 'dungeon-cleared' (mismo desenlace que elegir una
 * recompensa, sin recompensa que aplicar).
 */
export function ensureBossRewardChoices(session: GameSession): UpgradeDef[] {
  if (session.bossRewardChoices.length === 0) {
    session.bossRewardChoices = rollBossReward(session.world.hero, session.world.rng);
    if (session.bossRewardChoices.length === 0) {
      session.world.phase = 'dungeon-cleared';
    }
  }
  return session.bossRewardChoices;
}

/** Aplica la recompensa de jefe elegida, vacía las opciones y avanza a 'dungeon-cleared' (sigue el flujo con NextDungeonModal). */
export function chooseBossReward(session: GameSession, def: UpgradeDef): void {
  applyUpgrade(session.world, def, session.events);
  session.bossRewardChoices = [];
  session.world.phase = 'dungeon-cleared';
}

/**
 * Avanza a la siguiente mazmorra de la run (GDD §10, run multi-mazmorra):
 * jefe derrotado pero quedan más en `bossSequence` (fase 'dungeon-cleared').
 * A diferencia de `restartSession`, NO es un reinicio: traspasa el progreso
 * del héroe (hp/maxHp/modificadores/monedero/niveles de mejora, docs/plans/ECONOMY_PLAN.md)
 * y las estadísticas ACUMULADAS del mundo anterior al nuevo, y no conserva
 * `hasKey` (cada mazmorra tiene su propia llave — `createDungeonWorld` ya la
 * deja en false).
 *
 * No-op si no queda un stage siguiente (llamador solo debe invocarla desde la
 * fase 'dungeon-cleared', que ya garantiza que hay más jefes por delante).
 */
export function advanceToNextDungeon(session: GameSession): void {
  const nextStageIndex = session.stageIndex + 1;
  if (!session.dungeonPool || nextStageIndex >= session.bossSequence.length) return;

  const prevWorld = session.world;
  session.stageIndex = nextStageIndex;
  session.seed = session.forcedSeed !== null ? session.forcedSeed + session.stageIndex : randomSeed();

  const bossId = session.bossSequence[session.stageIndex];
  const dungeon = generateDungeon(session.seed, session.dungeonPool, ROOMS_PER_RUN, bossId);
  const world = createDungeonWorld(dungeon, session.seed);
  world.godMode = session.godMode;
  initBossEnemies(world);
  world.isFinalDungeon = session.stageIndex >= session.bossSequence.length - 1;

  // Traspaso de progreso entre mazmorras encadenadas: vida, modificadores,
  // monedero y niveles de mejora del héroe (docs/plans/ECONOMY_PLAN.md), y
  // estadísticas ACUMULADAS de toda la run (no se reinician por mazmorra).
  // `hasKey` NO se traspasa: cada mazmorra tiene su propia llave.
  world.hero.hp = prevWorld.hero.hp;
  world.hero.maxHp = prevWorld.hero.maxHp;
  world.hero.modifiers = { ...prevWorld.hero.modifiers };
  world.hero.coins = prevWorld.hero.coins;
  world.hero.upgradeLevels = { ...prevWorld.hero.upgradeLevels };
  world.stats = { ...prevWorld.stats };

  session.room = world.room;
  session.world = world;
  session.accumulator = 0;
  session.renderAlpha = 1;
  session.heroPrevX = world.hero.position.x;
  session.heroPrevY = world.hero.position.y;
  session.aim.active = false;
  session.aim.force = 0;
  // Recompensa de jefe (docs/plans/ECONOMY_PLAN.md F3): ya se eligió (o se
  // saltó) para poder llegar aquí; no debe sobrevivir a la mazmorra siguiente.
  session.bossRewardChoices = [];
  // Tienda (docs/plans/ECONOMY_PLAN.md F4): mazmorra nueva → stock nuevo.
  session.shopStock = rollShopStock(world.hero, world.rng);
  session.effects.state.trauma = 0;
  session.effects.state.hitStopRemaining = 0;
  // Cera (ver comentario de `EffectsSession.wax` arriba): mazmorra nueva, no
  // se arrastra el rastro de la anterior (sí se conserva al cambiar de SALA
  // dentro de la MISMA mazmorra: aquí no se toca `wax` en ningún otro punto).
  session.effects.wax.clear();
}

/**
 * Cierra la tienda (docs/plans/ECONOMY_PLAN.md F4, ShopModal "Salir"): vuelve
 * a 'playing'. No re-sortea `shopStock` (el mismo stock vale toda la
 * mazmorra, reabrible con los niveles ya comprados reflejados). No-op si la
 * fase no es 'shopping'.
 */
export function closeShop(session: GameSession): void {
  if (session.world.phase === 'shopping') {
    session.world.phase = 'playing';
  }
}
