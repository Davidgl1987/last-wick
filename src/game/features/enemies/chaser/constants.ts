export const CHASER_HP = 3;
export const CHASER_SPEED = 2.35;
/**
 * Fracción de CHASER_SPEED a la que avanza mientras el héroe apunta
 * (2026-08-24: antes ACELERABA al detectar puntería; ahora frena para dar aire
 * al tiro). Nunca 0: sigue acercándose, solo que más despacio, y en cuanto se
 * suelta el gesto recupera CHASER_SPEED en el mismo tick (no hay rampa).
 */
export const CHASER_AIMING_SPEED_FACTOR = 0.575;
/** Velocidad del Chaser cuando detecta que el jugador está apuntando (~57,5 % de la normal). */
export const CHASER_SPEED_WHILE_AIMING = CHASER_SPEED * CHASER_AIMING_SPEED_FACTOR;
