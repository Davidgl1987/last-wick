/**
 * Tipos de dominio del mundo. Simulación pura: SIN imports de React ni three.js.
 *
 * Sistema de coordenadas: la sim vive en 2D sobre el plano del suelo
 * (`Vec2`/`AABB` viven en `engine/geometry.ts`). El origen (0,0) es el centro
 * de la sala; +y apunta "hacia la cámara" (sur). Las factorías (createWorld,
 * pools, buildRoomEntities) viven en `world/create.ts`.
 */

import type { AABB, Vec2 } from '@/engine/geometry';
import type { Rng } from '@/engine/rng';

// ── Formato de sala (contrato de datos del GDD §13) ───────────────────────

export type RoomTag = 'inicio' | 'combate' | 'llave' | 'recompensa' | 'jefe' | 'tienda';

export type DoorSide = 'north' | 'south' | 'east' | 'west';

/** Hueco de puerta en un borde: posición del centro a lo largo del borde (u, desde el centro del lado). */
export interface DoorSlot {
  side: DoorSide;
  offset: number;
}

/**
 * `'boss'` es un arquetipo más (GDD §15): reutiliza TODO el plumbing de
 * Enemy (colisión, lookup por id, contención por sala, muerte/drop) en vez
 * de un tipo de entidad propio — la elección que menos toca el código
 * existente manteniendo la sim pura (decisión de la Fase B0, ver informe).
 * Su comportamiento concreto (fases/telegraph/patrones) vive en los campos
 * `boss*` de `Enemy` + `features/bosses/registry.ts` (tabla de definición por jefe).
 */
export type EnemyKind = 'dummy' | 'chaser' | 'spike' | 'trail' | 'shooter' | 'boss';

/** Colocación de enemigo en la sala: posición inicial + destino de patrulla (recorrido ida/vuelta). */
export interface EnemySpawn {
  id: string;
  kind: EnemyKind;
  position: Vec2;
  /** Punto opuesto de la patrulla; si se omite, se deriva automáticamente (eje con más espacio). */
  patrolTarget?: Vec2;
  /** Dirección de la púa del Spike (unitaria); por defecto (0,1). */
  facing?: Vec2;
  /** Vida inicial personalizada (editor, GDD §13); por defecto la del arquetipo. */
  hp?: number;
  /** Radio de colisión personalizado (editor, GDD §13); por defecto ENEMY_RADIUS. */
  radius?: number;
  /** Solo kind==='boss': qué entrada de `features/bosses/registry.ts` gobierna su vida/patrones. */
  bossId?: BossId;
}

export type HazardKind = 'pit' | 'spikes' | 'barrel' | 'rock';

/** Hazard rectangular centrado en `position` (los circulares, ej. barril, usarán width=height). */
export interface HazardSpawn {
  id: string;
  kind: HazardKind;
  position: Vec2;
  width: number;
  height: number;
}

/**
 * `'shopkeeper'` (docs/plans/ECONOMY_PLAN.md F4): NPC placeholder de la sala
 * de tienda. No se recoge (ver `tryPickup`/`stepShopkeeperContact` en
 * features/items/items.ts): al contacto abre la fase 'shopping'.
 */
export type ItemKind = 'coin' | 'potion' | 'key' | 'shopkeeper';

export interface ItemSpawn {
  id: string;
  kind: ItemKind;
  position: Vec2;
}

/**
 * Id de jefe (GDD §15): identifica la entrada en `features/bosses/registry.ts` que
 * define vida, umbrales de fase y función de patrón. `test-boss` es el jefe
 * trivial de la Fase B0 (framework), disponible solo en dev/tests. `guardian`
 * es el Guardián de Canto (GDD §15.2, Fase B1). `queen` es la Reina del
 * Enjambre (GDD §15.3, Fase B2). `prisma` es El Prisma (GDD §15.4, Fase B3).
 * `storm` es La Tormenta (GDD §15.5, Fase B4).
 */
export type BossId = 'test-boss' | 'guardian' | 'queen' | 'prisma' | 'storm';

/** Estado en vivo de una puerta de una sala en la mazmorra multi-sala. */
export interface RoomDoorRuntime {
  /** Índice en `dungeon.connections`. */
  connectionIndex: number;
  side: DoorSide;
  /** Centro del hueco en coordenadas de mundo. */
  center: Vec2;
  requiresKey: boolean;
  open: boolean;
}

/** Estado en vivo de una sala colocada en la mazmorra multi-sala. */
export interface RoomRuntime {
  id: string;
  name: string;
  tags: RoomTag[];
  origin: Vec2;
  /** Interior jugable en coordenadas de MUNDO. */
  bounds: AABB;
  /** true cuando el héroe ha entrado alguna vez (activa a sus enemigos). */
  visited: boolean;
  /** true cuando todos sus enemigos han muerto (abre sus puertas, ofrece mejora). */
  cleared: boolean;
  enemyIds: string[];
  doors: RoomDoorRuntime[];
}

/** Sala serializable: la moneda de intercambio entre editor, juego y generador procedural. */
export interface RoomData {
  version: 1;
  id: string;
  name: string;
  /** Interior jugable en unidades de mundo (los muros de WALL_THICKNESS quedan fuera). */
  width: number;
  height: number;
  playerStart: Vec2;
  tags: RoomTag[];
  doorSlots: DoorSlot[];
  enemies: EnemySpawn[];
  hazards: HazardSpawn[];
  items: ItemSpawn[];
  /**
   * GDD §15: si está presente, esta sala es la sala de jefe de la run y
   * `boss` referencia su entrada en `features/bosses/registry.ts`. El generador exige
   * exactamente una sala con `boss` por run (ver dungeon.ts).
   */
  boss?: BossId;
}

// ── Estado vivo del mundo ─────────────────────────────────────────────────

export type WeaponMode = 'body' | 'arrow' | 'spell';

/**
 * Modificadores acumulados por mejoras (GDD §11, docs/plans/ECONOMY_PLAN.md):
 * todo empieza en su valor neutro. Los campos `*Bonus`/`*Level` los suma
 * `apply` de cada `UpgradeDef` (session/upgrades.ts); esta interfaz vive en
 * world/ (capa inferior) y no conoce el pool de mejoras concreto.
 */
export interface HeroModifiers {
  ramDamageBonus: number;
  arrowDamageBonus: number;
  spellDamageBonus: number;
  spellRadiusBonus: number;
  shieldCharges: number;
  /** +1 u/s de velocidad de lanzamiento corporal por nivel (Estela de Cometa). Neutro: 0. */
  launchSpeedBonus: number;
  /** Multiplicador del retroceso recibido al ser dañado (Canto Rodado): 1 = normal, más bajo = menos empuje. */
  knockbackTakenMultiplier: number;
  /** +1 flecha extra en ángulo por nivel (Bandada). Neutro: 0. */
  arrowCountBonus: number;
  /** +1 enemigo atravesado por la flecha por nivel, sobre el pierce base (Aguja Fantasma). Neutro: 0. */
  arrowPierceBonus: number;
  /** +1 hechizo extra en ángulo por nivel (Coro Arcano). Neutro: 0. */
  spellCountBonus: number;
  /** +1 rebote extra del hechizo por nivel, sobre el rebote base (Eco Errante). Neutro: 0. */
  spellBounceBonus: number;
  /** Nivel actual de Canto de Urraca (imán de monedas); 0 = sin imán. */
  coinMagnetLevel: number;
}

export interface Hero {
  position: Vec2;
  velocity: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  /** I-frames tras recibir daño (world.time hasta el que dura). */
  invulnerableUntil: number;
  /** Momento (world.time) del último lanzamiento corporal, para el cooldown. */
  lastLaunchTime: number;
  weaponMode: WeaponMode;
  lastArrowTime: number;
  lastSpellTime: number;
  hasKey: boolean;
  modifiers: HeroModifiers;
  /**
   * Nivel actual por mejora (docs/plans/ECONOMY_PLAN.md): gating de máximos y
   * cálculo de precio del siguiente nivel. Clave = `UpgradeId` (session/upgrades.ts);
   * se tipa como `string` aquí para no acoplar world/ (capa inferior) al pool
   * de mejoras concreto, que vive en session/.
   */
  upgradeLevels: Partial<Record<string, number>>;
  /** Monedero gastable (docs/plans/ECONOMY_PLAN.md): persiste entre mazmorras de la misma run, se pierde al morir/reiniciar. */
  coins: number;
  /**
   * Reina (rediseño 2026-07-10, GDD §15.3): acumulador de tiempo continuo que
   * el héroe lleva LENTO sobre el rastro de la Reina (charco con `slows`).
   * `stepPuddles` lo suma mientras dure el frenado y lo resetea a 0 en cuanto
   * sale del rastro (o cruza a velocidad de embestida sin ser frenado); pasado
   * `QUEEN_TRAIL_DOT_GRACE` empieza a aplicar el DoT. No confundir con los
   * i-frames (`invulnerableUntil`): son mecanismos independientes.
   */
  trailDwell: number;
}

/** Obstáculo sólido derivado de los hazards 'rock' de la sala o de un segmento de muro/puerta cerrada. */
export interface Obstacle {
  id: string;
  aabb: AABB;
  /** Sala dueña del obstáculo (mazmorra multi-sala); undefined en el modo sala única de los tests. */
  roomId?: string;
}

export type ProjectileOwner = 'hero' | 'enemy';

/** Proyectiles en pool preasignado: activar/desactivar, nunca crear/destruir. */
export interface Projectile {
  active: boolean;
  kind: 'arrow' | 'spell' | 'enemy';
  owner: ProjectileOwner;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  damage: number;
  ttl: number;
  bouncesLeft: number;
  /** Número de enemigos que puede atravesar todavía (flecha). */
  pierceLeft: number;
  /** IDs de enemigos ya golpeados por este proyectil (evita doble impacto el mismo tick). */
  hitEnemyIds: string[];
  /**
   * Etiqueta de color por-proyectil (rama `estilo-oscuro`, feedback playtest
   * 2026-07-17: "luz por bola" + "un color por ataque" en La Tormenta, "los
   * ataques de proyectiles de su color" en el Prisma). '' = color clásico por
   * defecto (proyectil del héroe, o enemigo que no rellena el campo, p.ej. el
   * Shooter). Rellenado por el patrón que dispara (storm/pattern.ts,
   * prisma/pattern.ts) al llamar a `fireEnemyProjectile`; leído por el render
   * (ProjectileView.tsx: cuerpo, halo y pool de luces) para teñir — escalar
   * plano, cero coste en la sim.
   */
  colorTag: string;
}

export type ShooterPhase = 'chase' | 'charge';

/** Estado de IA por enemigo (fase 2): campos específicos por arquetipo, todos opcionales salvo los comunes. */
export interface Enemy {
  id: string;
  kind: EnemyKind;
  /** Sala dueña del enemigo (mazmorra multi-sala); undefined en el modo sala única de los tests. */
  roomId?: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  /** Origen y destino de patrulla (Dummy/Spike/Trail). */
  patrolFrom: Vec2;
  patrolTo: Vec2;
  /** true = moviéndose hacia patrolTo; false = volviendo a patrolFrom. */
  patrolForward: boolean;
  /** Dummy: si está en modo persecución (para aplicar la correa). */
  chasing: boolean;
  /** Spike: dirección de la púa (unitaria), fija. */
  facing: Vec2;
  /** Trail: tiempo restante hasta soltar el próximo charco. */
  trailDropTimer: number;
  /** Shooter: fase del ciclo y tiempo restante en la fase actual. */
  shooterPhase: ShooterPhase;
  shooterPhaseTimer: number;
  /** Flash blanco al ser golpeado: world.time hasta el que dura. */
  hitFlashUntil: number;
  /** Timestamp (world.time) hasta el que el hazard de pinchos no vuelve a dañarle. */
  spikeDamageCooldownUntil: number;
  /** world.time hasta el que el knockback controla la velocidad (la IA no la sobreescribe). */
  knockbackUntil: number;
  /**
   * Lado de giro (+1/−1) elegido al esquivar un obstáculo; persiste mientras
   * el camino directo siga bloqueado (evita oscilar entre lados) y se
   * resetea a 0 al despejarse.
   */
  steerBias: number;

  // ── Jefe (GDD §15, solo kind==='boss') ───────────────────────────────────
  /** Qué entrada de `features/bosses/registry.ts` gobierna este jefe. */
  bossId?: BossId;
  /** Fase actual por umbral de vida (1 = 100-66%, 2 = 66-33%, 3 = 33-0%). */
  bossPhase: 1 | 2 | 3;
  /**
   * true mientras el jefe está en su ventana de vulnerabilidad explícita
   * (GDD §15.1 punto 4): fuera de ventana, applyDamageToEnemy (combat.ts)
   * escala el daño recibido por `bossDamageOutsideWindowFactor`.
   */
  bossVulnerable: boolean;
  /**
   * Multiplicador de daño recibido fuera de ventana de vulnerabilidad (0 =
   * inmune, 1 = daño normal). `combat.ts` lo lee como un escalar plano —
   * mantiene la sim de combate totalmente ajena a `features/bosses/registry.ts` (sin
   * ciclo de imports); `features/bosses/lifecycle.ts::initBossEnemies` lo copia una vez desde
   * `BossDef.damageOutsideWindow` al construir el mundo.
   */
  bossDamageOutsideWindowFactor: number;
  /** Guardián: daño al jefe por explosión de barril en su radio (HP absoluto, bypass de ventana). 0 = usar BARREL_DAMAGE normal (resto de enemigos/jefes). */
  bossBarrelDamage: number;
  /** Reina (rediseño 2026-07-10): world.time hasta el que el cuerpo del jefe está ATURDIDO (vulnerable, daño completo). 0 = no aturdida (daño reducido); Infinity = vulnerable permanente (todas las columnas rotas). Lo consume `queenStepPattern` para fijar `bossVulnerable`. */
  bossVulnerableUntil: number;
  /** world.time hasta el que dura el telegraph en curso (0 = no telegrafiando). */
  bossTelegraphUntil: number;
  /** Etiqueta libre del telegraph/ataque en curso (para render + patrón), '' si no aplica. */
  bossTelegraphKind: string;
  /**
   * Bolsa de estado propia del patrón del jefe concreto (contador de ciclo,
   * temporizador de ataque, índice de sub-fase...): campos escalares
   * genéricos y reutilizables — cada `stepPattern` por jefe
   * (`features/bosses/<jefe>/pattern.ts`) decide cómo usarlos, sin necesitar
   * un tipo por jefe ni asignar objetos nuevos por tick.
   */
  bossTimer: number;
  bossStage: number;
  bossCounter: number;
  /**
   * El Prisma (GDD §15.4, Fase B3): arma que gatea el daño ahora mismo
   * ('ram'|'arrow'|'spell'), '' = sin gate (el resto de jefes/enemigos, daño
   * normal). `applyDamageToEnemy` (combat.ts) lo lee como escalar plano —
   * combat.ts sigue sin importar nada de `features/bosses/` (mismo criterio
   * que `bossDamageOutsideWindowFactor`). `bossWeaponGateB` es el segundo
   * color válido durante el solape de fase 3 (golpe doble si aciertas
   * cualquiera de los dos); '' si no hay solape activo.
   */
  bossWeaponGateA: string;
  bossWeaponGateB: string;
}

/**
 * Nota de reuso de campos por `features/bosses/guardian/pattern.ts::guardianStepPattern` (Fase
 * B1, GDD §15.2): un jefe nunca pasa por `stepEnemyAi` (solo por
 * `features/bosses/lifecycle.ts::stepBosses`), así que `facing`/`patrolFrom`/`patrolTo` —
 * pensados para Dummy/Spike/Trail — quedan libres como almacenamiento
 * vectorial genérico sin ampliar `Enemy` con campos "boss3"/"boss4":
 * `facing` guarda la dirección unitaria de carga en curso; `patrolTo` guarda
 * el punto de patrulla perimetral objetivo. Ver comentario en
 * features/bosses/guardian/pattern.ts.
 */

/** Charco dejado por el Trail (o por la Reina/esquirlas del Guardián): pool preasignado, activar/desactivar. */
export interface Puddle {
  active: boolean;
  position: Vec2;
  radius: number;
  ttl: number;
  /**
   * Reina (rediseño 2026-07-10, GDD §15.3): true en los charcos de su rastro
   * — ralentizan + DoT por permanencia (ver `stepPuddles`) en vez del daño de
   * contacto simple del Trail normal/esquirlas del Guardián, que dejan este
   * campo en `false`.
   */
  slows: boolean;
}

/** Moneda/poción/llave viva en el mundo (recogible). */
export interface Item {
  id: string;
  kind: ItemKind;
  position: Vec2;
  active: boolean;
  roomId?: string;
}

/** Barril vivo: puede explotar una sola vez (encadena con otros al morir). */
export interface Barrel {
  id: string;
  position: Vec2;
  radius: number;
  exploded: boolean;
  roomId?: string;
  /**
   * Barril del Guardián que cae del cielo (GDD §15.2, playtest 2026-07-06):
   * `world.time` en el que el barril ATERRIZA y pasa a activo normal. Mientras
   * `world.time < landingAt` está "en el aire" (sombra creciendo + trayecto de
   * caída): NO es arrollable/explotable (se ignora en stepBarrels y en la
   * detección de arrollamiento de la carga del Guardián), y el render anima su
   * sombra + la caída de su Y. Ausente/0 = barril normal, ya en suelo (los
   * barriles estáticos de sala nunca lo llevan). El render deriva TODA la
   * animación de este único timestamp (sin campo booleano extra).
   */
  landingAt?: number;
}

/**
 * true si el barril del Guardián está aún cayendo del cielo (GDD §15.2): tiene
 * un `landingAt` futuro respecto a `time`. Los barriles en el aire no son
 * arrollables/explotables (se ignoran en stepBarrels y en la detección de
 * arrollamiento de la carga del Guardián). Función pura compartida por sim y
 * render para no duplicar el criterio.
 */
export function barrelInAir(barrel: Barrel, time: number): boolean {
  return barrel.landingAt !== undefined && time < barrel.landingAt;
}

/** Hazard estático con su sala dueña (mazmorra multi-sala). */
export interface HazardRuntime extends HazardSpawn {
  roomId?: string;
}

/**
 * Estado opaco propio de un jefe concreto (GDD §15). El core (`world/`,
 * `engine/`) reserva un único slot `World.bossState` pero NO conoce su forma:
 * cada jefe que necesite estado extra define su tipo concreto en
 * `features/bosses/<jefe>/` extendiendo esta interfaz, con un accessor tipado
 * (type-guard sobre `bossId`, en un único sitio). Mismo espíritu que `BossDef`:
 * añadir un jefe con estado propio no toca el core.
 */
export interface BossState {
  /** Discriminante para el type-guard del accessor de cada jefe; el core nunca lo lee. */
  readonly bossId: BossId;
}

/**
 * `'shopping'` (docs/plans/ECONOMY_PLAN.md F4): ShopModal abierto tras tocar
 * al tendero; misma pausa de sim que el resto de fases != 'playing'.
 * `'boss-victory-pause'` (playtest 2026-07-15, David: "al acabar con un jefe
 * sale inmediatamente la ventana de siguiente mazmorra, debería salir con un
 * poco de retraso, para poder ver el efecto al matar al jefe y quizá algún
 * gesto de victoria antes de la modal que lo tapa todo"): fase transitoria
 * entre `boss-defeated` y la apertura de BossRewardModal/VictoryModal — ver
 * `BOSS_VICTORY_PAUSE_DURATION` en world/step.ts.
 */
export type GamePhase =
  | 'playing'
  | 'paused'
  | 'boss-victory-pause'
  | 'boss-reward'
  | 'dungeon-cleared'
  | 'game-over'
  | 'victory'
  | 'shopping';

export interface RunStats {
  roomsCleared: number;
  coinsCollected: number;
  damageDealt: number;
  score: number;
}

export interface World {
  room: RoomData;
  /** Interior jugable de la sala ACTUAL del héroe: las caras internas de sus 4 paredes. */
  bounds: AABB;
  obstacles: Obstacle[];
  hero: Hero;
  enemies: Enemy[];
  projectiles: Projectile[];
  puddles: Puddle[];
  items: Item[];
  barrels: Barrel[];
  /** Estado opaco del jefe de la sala actual (`BossState`), o null si no hay jefe con estado propio. Cada jefe accede al suyo mediante su accessor tipado en `features/bosses/`; el core nunca inspecciona su forma. */
  bossState: BossState | null;
  /** Hazards no-roca, no-barril (pit/spikes), estáticos durante la sala. */
  hazards: HazardRuntime[];
  /** Última posición firme (fuera de fosos) del héroe, para respawn tras caer. */
  safePosition: Vec2;
  /** world.time hasta el que dura la animación de caída (0 = no está cayendo). */
  fallingUntil: number;
  phase: GamePhase;
  stats: RunStats;
  rng: Rng;
  /** Mazmorra multi-sala activa (null en el modo sala única de los tests de fase 1-2). */
  dungeon: import('@/game/features/dungeon/dungeon').DungeonMap | null;
  /** Estado en vivo por sala (limpiada/visitada/puertas abiertas), indexado por room id. */
  roomRuntimes: Map<string, RoomRuntime>;
  /** Id de la sala donde está físicamente el héroe ahora mismo. */
  currentRoomId: string;
  /**
   * Contador incrementado cada vez que se reconstruyen los muros (puerta
   * abierta). El render lo sondea en useFrame para saber si debe reconstruir
   * las mallas de muro (evento rarísimo, no hot-path); evita comparar arrays.
   */
  wallVersion: number;
  /** world.time hasta el que no se repite el aviso "necesitas la llave" (anti-spam a 60 Hz). */
  lockedNoticeCooldownUntil: number;
  /**
   * true mientras el jugador tiene el gesto de puntería activo (drag en
   * curso). Lo escribe el driver de render/input antes de cada tick; el
   * Chaser lo usa para acelerar (GDD §7.2). No es estado de física: es una
   * señal externa que la sim solo lee.
   */
  heroAiming: boolean;
  /**
   * Movimiento WASD/flechas, solo escritorio (GDD §3, ayuda de recolocación):
   * vector de input CRUDO, sin normalizar ({0,0} = sin tecla pulsada; p.ej.
   * {1,1} en diagonal). Lo escribe `KeyboardMoveInput.tsx` (vía `session.move`)
   * antes de cada tick, igual que `heroAiming` — no es estado de física, es una
   * señal externa que la sim solo lee (`stepHeroWalk`, features/hero/walk.ts,
   * normaliza y aplica la velocidad fija de paseo). En táctil vale siempre
   * {0,0}: ahí no se registra ni un solo listener de teclado.
   */
  heroMove: Vec2;
  /**
   * Cooldowns por-enemigo reutilizados entre ticks (evita asignar un Map por
   * tick): último world.time en que ese enemigo hizo tick de daño de
   * contacto al héroe / recibió tick de daño de pinchos.
   */
  contactDamageCooldowns: Map<string, number>;
  spikeDamageCooldowns: Map<string, number>;
  /** IDs de enemigos cuya muerte ya soltó su moneda (evita doble drop del mismo cadáver). */
  deadEnemiesDropped: Set<string>;
  /** IDs de jefes cuya muerte ya emitió el evento 'boss-defeated' (GDD §15.1 punto 8: clímax una sola vez). */
  bossDefeatedEmitted: Set<string>;
  /** Tiempo de simulación acumulado (s). */
  time: number;
  /**
   * world.time en el que termina la fase 'boss-victory-pause' (0 = no hay
   * pausa en curso). `stepWorld` compara contra `world.time` cada tick para
   * decidir cuándo saltar a `bossVictoryNextPhase` (ver
   * BOSS_VICTORY_PAUSE_DURATION en world/step.ts).
   */
  bossVictoryPauseUntil: number;
  /**
   * Fase destino ('boss-reward' o 'victory') a la que salta `stepWorld` al
   * cumplirse `bossVictoryPauseUntil`. null fuera de 'boss-victory-pause'.
   */
  bossVictoryNextPhase: 'boss-reward' | 'victory' | null;
  /**
   * Run multi-mazmorra (GDD §10, feature de encadenado de jefes): true si esta
   * es la última mazmorra de la secuencia de jefes de la run. Al limpiar la
   * sala de jefe, `stepDungeonRoomClear` decide 'victory' (fin de la run) si
   * es true, o 'boss-reward' (recompensa gratis, hay más jefes por delante,
   * docs/plans/ECONOMY_PLAN.md F3) si no. Por defecto true en
   * `createWorld`/`createDungeonWorld` (modo sala única/tests): la sesión
   * (`session.ts`) lo recalcula tras construir cada mundo de una run
   * multi-mazmorra.
   */
  isFinalDungeon: boolean;
  /**
   * Anti-reapertura instantánea de la tienda (docs/plans/ECONOMY_PLAN.md F4):
   * true cuando el héroe puede volver a abrir la tienda al tocar al tendero.
   * Se pone a false al abrir (`stepShopkeeperContact`, features/items/items.ts)
   * y solo vuelve a true cuando el héroe SALE de su radio de contacto —
   * evita que cerrar la tienda con el héroe aún pegado al tendero la
   * reabra en el mismo tick. Solo hay una tienda por mazmorra, así que un
   * único flag global basta (no hace falta uno por item).
   */
  shopGreeterArmed: boolean;
  /**
   * Modo dios de playtest (`?godmode` en la URL, render/debug-params.ts;
   * David 2026-07-15: "para ver lo que quita de vida cada ataque" en la run
   * completa de 4 jefes). El daño se aplica SIEMPRE normal (hp baja, vignette,
   * knockback, i-frames — todo el feedback intacto); lo único que cambia es
   * `applyDamageToHero` (features/combat/combat.ts): en vez de dejar hp en 0 y
   * pasar a `'game-over'`, revive a `maxHp` y la partida sigue. Seteado UNA
   * vez al crear/recrear el mundo de la sesión (session.ts, igual que
   * `isFinalDungeon`); nunca cambia dentro de una run.
   */
  godMode: boolean;
}
