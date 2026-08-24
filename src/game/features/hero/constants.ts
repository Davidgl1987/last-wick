/**
 * Tuning del héroe: cuerpo, lanzamiento corporal e input de puntería — GDD, Apéndice.
 * Valores validados por playtesting; no ajustar sin probar.
 */

// ── Héroe ─────────────────────────────────────────────────────────────────

/**
 * Playtest ronda 7 (2026-07-20, David): "la vela no me gusta así rechoncha.
 * Me gusta más estrecha y alta. Has cambiado el modelo y no la hitbox, te
 * pedí lo contrario." Reducida ~37% (0.38→0.24) para que la hitbox case con
 * la silueta fina y alta de `heroCandleGeometry` (`render/assets-dark.ts`) — ver
 * comentario allí y en `HeroView.tsx` para el reparto radio/altura. Cambio
 * de balance EXPLÍCITAMENTE autorizado (afecta también a dark=0: la esfera
 * clásica queda más pequeña, consecuencia aceptada, no compensada).
 */
export const HERO_RADIUS = 0.24;
export const HERO_START_HP = 5;
export const HERO_MAX_HP = 9;
/** Velocidad de salida del lanzamiento corporal a fuerza 0 (u/s). */
export const LAUNCH_SPEED_MIN = 3.6;
/** Velocidad de salida del lanzamiento corporal a fuerza 1 (u/s). */
export const LAUNCH_SPEED_MAX = 7.5;

export const BODY_LAUNCH_COOLDOWN = 0.2;

/**
 * Velocidad del paseo WASD/flechas (GDD §3, solo escritorio): ayuda de
 * recolocación, nunca una alternativa al tirachinas. Subida de 1.4 a 2.0
 * (playtest, David: "¿podrías darle más velocidad a wasd sin que mate a
 * enemigos?"), y sigue acotada por tres cifras reales del repo:
 * - Por debajo de `CHASER_SPEED` (2.35 u/s, `features/enemies/chaser/constants.ts`):
 *   no permite alejarse cómodamente de un perseguidor.
 * - Por debajo de `RAM_SPEED_THRESHOLD` (2.5 u/s, `features/combat/constants.ts`).
 * - 56% de `LAUNCH_SPEED_MIN` (3.6 u/s, arriba): por debajo incluso del
 *   lanzamiento corporal más flojo, para que no sustituya al tiro.
 *
 * Lo que de verdad GARANTIZA que WASD no mate enemigos no es esta cifra: es
 * que caminar es cinemático y nunca escribe en `hero.velocity` (ver
 * `stepHeroWalk`, walk.ts), así que `ramDamage` (combat.ts), que solo mira
 * `hero.velocity`, ve siempre velocidad 0 al caminar y devuelve 0 sin
 * excepción. Estar por debajo de `RAM_SPEED_THRESHOLD` es un cinturón de
 * seguridad adicional (relevante si algún día `heroWalkFactor`, walk.ts,
 * cambiara de mezclar posición a mezclar velocidad), no la razón real.
 */
export const HERO_WALK_SPEED = 2.0;

// ── Input / puntería ──────────────────────────────────────────────────────

/** Longitud de arrastre que equivale a fuerza 100% (u de mundo). */
export const MAX_DRAG_DISTANCE = 2.8;
/** Fuerza mínima: por debajo el tiro se cancela con aviso. */
export const MIN_LAUNCH_FORCE = 0.08;
