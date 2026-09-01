// ── Reina del Enjambre (GDD §15.3, Fase B2) ───────────────────────────────

/** Vida máxima (GDD §15.6): mucha vida, sin ataque directo fuerte. */
export const QUEEN_MAX_HP = 55;
/** Radio de colisión: grande, distinta del Guardián (GDD §15.3 "cuerpo grande y distinto"). */
export const QUEEN_RADIUS = 0.58;
/** Techo de daño de un golpe de la Reina al héroe, por fase (GDD §15.1 punto 6): no tiene ataque directo, solo contacto de cuerpo si se le encima el jugador. */
export const QUEEN_HIT_DAMAGE_CAP_FRACTION: [number, number, number] = [0.6, 0.65, 0.7];
/**
 * Rediseño 2026-07-10 (GDD §15.3, docs/plans/QUEEN_REDESIGN_PLAN.md): la vida
 * de la Reina está en sus 8 columnas, pero al CUERPO SIEMPRE le puedes hacer
 * daño con cualquier ataque (playtest: "aunque muy poco si no está aturdido").
 * Fuera de aturdimiento el daño del arma/embestida se escala por este factor
 * pequeño; al romperse una columna la Reina queda ATURDIDA (`bossVulnerable`)
 * unos segundos y ahí recibe el daño COMPLETO; con TODAS las columnas rotas
 * pasa a estar vulnerable de forma permanente (remate del último 1/3 a golpes).
 */
export const QUEEN_DAMAGE_OUTSIDE_WINDOW = 0.15;

/** Golpes de embestida que aguanta una columna de la Reina (bajado de 3 a 2 en la simplificación 2026-08-31: al eliminar el rol guardiana ya no hay fuego defensivo que forzar un forcejeo largo — intacta → 1 golpe agrieta → 2.º golpe rompe). */
export const QUEEN_COLUMN_HP = 2;
/**
 * Prefijo del id LOCAL (tras el `roomId:` opcional) de las rocas que son
 * columnas de la Reina (T2 render, GDD §15.3): boss-queen.json las nombra
 * `column-nw-1..4`/`column-ne-1..4`. Mismo criterio que ya usa
 * `queen/pattern.ts::queenOnInit` (ahí inline, sin importar este fichero para
 * no tocar la sim) para poblar el estado de la Reina (`QueenState.columns`);
 * el render lo reutiliza
 * para excluir esas rocas del pintado genérico de `RoomView` (las pinta
 * `QueenColumnsView` con su propio estado intacta/agrietada/escombros).
 */
export const QUEEN_COLUMN_ID_PREFIX = 'column';
/**
 * Vida que pierde la Reina al romperse UNA columna, como fracción de su vida
 * máxima (playtest 2026-07-10): las 8 columnas suman 2/3 de su vida; el 1/3
 * restante se remata a golpes normales, ya con la Reina siempre vulnerable.
 */
export const QUEEN_COLUMN_DAMAGE_FRACTION = 2 / 3 / 8;
/** Cooldown (s) por columna entre golpes de embestida contados, para que un mismo choque (varios ticks solapado) reste 1 hp y no varios. */
export const QUEEN_COLUMN_HIT_COOLDOWN = 0.4;
/** Aturdimiento de la Reina al romperse una columna (s): ventana en la que recibe daño COMPLETO (playtest 2026-07-10: "si le atacas justo al romper una columna, ahí sí le haces más daño"). */
export const QUEEN_COLUMN_STUN_DURATION = 1.4;
/**
 * Margen extra (u) sumado al radio del héroe al comprobar si toca una
 * columna (rediseño 2026-07-10): `stepHeroPhysics` ya resuelve la colisión
 * física héroe↔columna (es un Obstacle sólido) ANTES de `stepQueenColumns`
 * en el mismo tick — al llegar aquí el héroe queda exactamente tangente al
 * borde de la columna (push-out), no solapado. Sin este margen, el test de
 * solapamiento fallaría por el margen de error de punto flotante justo en el
 * tick del impacto, que es el único tick en que puede detectarse.
 */
export const QUEEN_COLUMN_TOUCH_SKIN = 0.05;

// (Aquí vivían QUEEN_MOVE_SPEED_PHASE1/2/3 y QUEEN_WANDER_INTERVAL, la
// velocidad por fase y la cadencia de la deambulación aleatoria. Quedaron sin
// un solo uso —comprobado con grep— al retirarse el wander en la TAREA 5 del
// rediseño 2026-07-10 (`queenStepMove` persigue al héroe con evasión, sin
// punto de deambulación propio) y al sustituirse el escalado por fase por el
// escalado POR COLUMNAS ROTAS, ver QUEEN_STALK_SPEED_BASE/PER_COLUMN más
// abajo. Se borran en la simplificación 2026-08-31 para que nadie las tome
// por el tuning vivo del jefe.)

/**
 * Rastro de la Reina (GDD §15.3 "como el Trail, pero más grande y duradero"):
 * reutiliza el pool de charcos del Trail (world.puddles, features/hazards/hazards.ts::
 * stepPuddles) con parámetros PROPIOS —radio mayor, vida más larga— en vez de
 * los de TRAIL_PUDDLE_RADIUS/TRAIL_PUDDLE_LIFETIME (que son del enemigo Trail
 * normal). Cadencia fase 1; fase 2 la acelera (QUEEN_TRAIL_DROP_INTERVAL_PHASE2).
 */
export const QUEEN_TRAIL_DROP_INTERVAL = 0.8;
export const QUEEN_TRAIL_DROP_INTERVAL_PHASE2 = 0.45;
export const QUEEN_TRAIL_PUDDLE_RADIUS = 0.85;
export const QUEEN_TRAIL_PUDDLE_LIFETIME = 6.5;

/** Factor de frenado por tick del héroe LENTO sobre el rastro de la Reina (rediseño 2026-07-10): más agresivo que el barro para que quedarse en el rastro sea un error real. */
export const QUEEN_TRAIL_SLOW_FACTOR = 0.8;
/** Velocidad (u/s) por encima de la cual una EMBESTIDA cruza el rastro sin penalización (válvula: el rastro castiga pararte, no pasar lanzado). */
export const QUEEN_TRAIL_CROSS_SPEED = 4.5;
/** Gracia (s) sobre el rastro antes de que empiece el DoT (válvula: cruzar es gratis; quedarse, no). */
export const QUEEN_TRAIL_DOT_GRACE = 0.4;

/**
 * Larvas (GDD §15.3/§15.6, simplificación 2026-08-31 — playtest: "un único
 * rol, perseguir"): Dummy débil de 1 HP que nace de una COLUMNA VIVA (ya no
 * del cuerpo del jefe) y persigue al héroe desde el instante en que nace
 * (línea recta en fase 1, persecución real recalculada en fase 2/3). Cap de
 * larvas vivas simultáneas por rendimiento (QUEEN_LARVA_MAX): la Reina
 * reserva ese nº de slots en `world.enemies` (pool preasignado, mismo espíritu
 * que `createProjectilePool`/`createPuddlePool`) en vez de hacer `.push` en
 * caliente — evita el bug de renderers que hacen `.map` sobre un array que
 * crece a mitad de partida sin trigger de re-render (ver AGENTS.md, nota de
 * `BarrelViews`/`ItemViews`): los slots ya existen desde el spawn de la sala,
 * inactivos (hp=0) hasta que una columna activa uno.
 */
/**
 * Cadencia (s) con la que CADA columna viva pare un minion, por fase del jefe
 * (simplificación 2026-08-31: sustituye la oleada única sincronizada desde el
 * cuerpo — `queen/pattern.ts::queenStepColumnSpawns`). Se acelera por fase,
 * igual criterio que el rastro (`QUEEN_TRAIL_DROP_INTERVAL*`): más presión
 * conforme avanza la pelea.
 */
export const QUEEN_COLUMN_SPAWN_INTERVAL_BY_PHASE: [number, number, number] = [6, 5, 4];
/**
 * Cap TOTAL de larvas vivas de la Reina (pool preasignado en `queenOnInit`).
 * Simplificación 2026-08-31 (GDD §15.3, playtest: "eliminar el rol
 * guardiana"): un ÚNICO rol —perseguidora—, así que basta con una plaza por
 * columna de la sala real (8 en boss-queen.json); bajado de 10 (que reservaba
 * cupo para perseguidoras Y guardianas a la vez).
 */
export const QUEEN_LARVA_MAX = 8;
export const QUEEN_LARVA_HP = 1;
export const QUEEN_LARVA_RADIUS = 0.26;
/** Velocidad de una perseguidora hacia el héroe (fase 1). */
export const QUEEN_LARVA_SPEED = 1.1;
/** Perseguidoras más rápidas y agresivas en fase 2/3 (GDD §15.3). */
export const QUEEN_LARVA_CHASE_SPEED_PHASE2 = 1.35;
export const QUEEN_LARVA_CHASE_SPEED_PHASE3 = 1.7;
/** Prefijo de id de los slots de larva de la Reina (para distinguirlos del resto de `world.enemies`, ver `isQueenLarva`). */
export const QUEEN_LARVA_ID_PREFIX = 'queen-larva-';

/**
 * Persecución hacia el héroe (GDD §15.3, playtest 2026-07-06 "la Reina te
 * acecha"): plantarse en un punto fijo a disparar deja de ser seguro. NO es
 * un dash agresivo (eso es el Chaser) — solo un sesgo hacia el héroe
 * superpuesto a la deambulación normal (`queenStepMove` sigue fijando
 * `patrolTo` y dejando rastro igual que antes; el acecho es un empuje extra
 * hacia el héroe aplicado sobre ese movimiento). Sin correa: la Reina persigue
 * libremente por toda la arena (playtest 2026-07-10 "quitar la correa").
 */
/**
 * Velocidad de persecución de la Reina ESCALADA POR COLUMNAS ROTAS (playtest
 * 2026-07-10: "cada columna rota la enfurece y te persigue más rápido").
 * Bajado de 0.38 a 0.15 en el playtest 2026-08-31 ("incrementos moderados, no
 * extremos"): con las 8 columnas del diseño anterior, 1.2 + 8×0.38 ≈ 4.24 u/s
 * dejaba al héroe sin margen de huida (más del doble de HERO_WALK_SPEED, el
 * paseo WASD). Con 8 columnas rotas: 1.2 (0 rotas) → 2.4 (8 rotas) —
 * HERO_WALK_SPEED = 2.0, así que el remate aprieta pero ya no es casi
 * inevitable. Sustituye el escalado por fase anterior.
 */
export const QUEEN_STALK_SPEED_BASE = 1.2;
export const QUEEN_STALK_SPEED_PER_COLUMN = 0.15;
