// ── Navegación de IA (steering local con evitación) ───────────────────────

/** Distancia de sondeo (raycast corto) por delante del enemigo para detectar obstáculos/hazards. */
export const AI_AVOID_LOOKAHEAD = 0.9;
/** Ángulo (rad) de desvío aplicado cuando el sondeo frontal detecta bloqueo. */
export const AI_AVOID_STEER_ANGLE = Math.PI / 3;
/** Margen extra sobre el radio del enemigo al comprobar bloqueo contra AABBs. */
export const AI_AVOID_SKIN = 0.12;

// ── Patrulla (stepPatrol, steering.ts): parada en seco + giro en los extremos ──
//
// Encargo de diseño (corrección 2026-08-25 sobre un primer intento que
// dejaba al enemigo "derivando" en vez de pararlo del todo — ver commit
// anterior: PATROL_TURN_DRIFT_SPEED, ya eliminada): al llegar a un extremo
// de su tramo, un enemigo en patrulla se PARA EN SECO —misma x,y exacta,
// velocity {0,0}, ni un float de deriva— y, una vez quieto, gira sobre sí
// mismo a velocidad angular CONSTANTE hasta encarar el nuevo waypoint. Solo
// entonces reanuda la marcha. El giro es estado de la SIM (`enemy.facing`,
// ver stepPatrol), no un efecto del damping del render: así la sim sabe con
// certeza cuándo el giro ha terminado y nunca arranca a moverse mientras el
// cuerpo todavía está girando (el bug concreto del primer intento: el
// damping exponencial del render solo llegaba al ~95% del arco cuando la
// ventana vencía).

/**
 * Tiempo (s) que tarda un giro de 180° — el caso típico de una patrulla de
 * ida y vuelta. Es el mando de ajuste de "cuánto se aprecia la parada":
 * subirlo alarga la ventana de tiro.
 */
export const PATROL_HALF_TURN_DURATION = 0.3;
/**
 * Velocidad angular (rad/s) del giro, derivada de la anterior: constante, no
 * amortiguada — la sim necesita saber CUÁNDO termina el giro para reanudar
 * la marcha justo entonces (ver `rotateAngleTowards`, `src/engine/geometry.ts`).
 */
export const PATROL_TURN_RATE = Math.PI / PATROL_HALF_TURN_DURATION;

// ── Orientación visual de enemigos (EnemyViews.tsx, spike/ai.ts) ──────────

/**
 * Umbral de velocidad por debajo del cual NO se actualiza el objetivo de
 * orientación (bug playtest 2026-07-14: "los ojos bailan cada frame", sobre
 * todo en las larvas de la Reina orbitando, que zigzaguean de dirección cada
 * tick sin desplazarse realmente distinto). Ya NO calibra ninguna velocidad
 * de deriva de patrulla — ese mecanismo se eliminó: la parada en un extremo
 * de ruta es completa (velocity {0,0}), y mientras dura, EnemyViews.tsx ni
 * siquiera pasa por este umbral: se orienta directamente por
 * `enemy.facing`, que la sim gobierna a velocidad angular constante (ver
 * PATROL_TURN_RATE arriba). Sigue vivo para el resto de casos que sí se
 * orientan por velocidad instantánea: persecución, órbita de larvas, etc.
 */
export const ENEMY_ORIENTATION_SPEED_THRESHOLD = 0.2;
/**
 * Constante de amortiguación del giro hacia la orientación objetivo (mismo
 * patrón `1 - exp(-lambda*dt)` que CameraRig/particles/effectsState, ver
 * `dampAngleTowards` en `src/engine/geometry.ts`). Suficientemente rápida
 * para no sentirse "flotante" pero sin snap instantáneo. Compartida por el
 * giro del CUERPO fuera de la ventana de patrulla (EnemyViews.tsx) y el giro
 * de las púas/ojo del Spike en marcha normal (spike/ai.ts, `stepSpike`).
 * Durante la ventana de giro de patrulla NINGUNO de los dos usa este
 * damping: la sim ya gobierna `facing` a velocidad angular constante y el
 * render solo la sigue en snap (ver EnemyViews.tsx) — amortiguar encima
 * llegaría tarde y el enemigo arrancaría a moverse con el giro visual
 * todavía sin terminar, justo el bug que el cambio de arriba elimina.
 */
export const ENEMY_ORIENTATION_DAMP_LAMBDA = 12;

// ── Combate genérico de enemigos ──────────────────────────────────────────

/** Radio de colisión por defecto de un enemigo. */
export const ENEMY_RADIUS = 0.4;
