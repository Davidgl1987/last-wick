/**
 * Tuning de items (moneda/poción/llave) — GDD, Apéndice.
 * Valores validados por playtesting; no ajustar sin probar.
 */

import type { EnemyKind } from '@/game/world/types';

/** Radio de recogida de items (moneda/poción/llave). */
export const ITEM_PICKUP_RADIUS = 0.5;
/** Curación de la poción (corazones). */
export const POTION_HEAL = 1;

/**
 * Monedas soltadas al morir un enemigo, por dureza del arquetipo
 * (docs/plans/ECONOMY_PLAN.md, economía base): consumido por
 * `collectDeadDrops` (world/step.ts).
 */
export const COIN_DROPS_BY_KIND: Record<EnemyKind, number> = {
  dummy: 1,
  chaser: 2,
  trail: 2,
  spike: 3,
  shooter: 3,
  boss: 10,
};

/** Radio mínimo/máximo del esparcido de monedas alrededor del cadáver (u). */
export const COIN_DROP_MIN_RADIUS = 0.25;
export const COIN_DROP_MAX_RADIUS = 0.6;

/**
 * Separación mínima entre monedas dropeadas (playtest 2026-08-14: "las
 * monedas no deberían salir tan juntas como para que se superpongan"), en u —
 * del orden del diámetro visual de la moneda (`COIN_RADIUS = 0.24` en
 * `features/items/ItemView.tsx`, capa de render). Este módulo es sim pura y
 * no puede importar de `render/`, así que el valor se DUPLICA a propósito:
 * si `COIN_RADIUS` cambia alguna vez, actualizar también aquí.
 */
export const COIN_DROP_MIN_SEPARATION = 0.5;
/** Intentos de reubicación en `separateCoinDrop` (items.ts) antes de aceptar la mejor posición encontrada — nunca un bucle sin límite. */
export const COIN_DROP_PLACEMENT_ATTEMPTS = 6;

/**
 * Imán de monedas (Canto de Urraca, docs/plans/ECONOMY_PLAN.md F2): radio de
 * atracción por nivel. Índice 0 sin usar (nivel 0 = sin imán, `stepItems` no
 * consulta este array en ese caso).
 */
export const COIN_MAGNET_RADIUS_BY_LEVEL: readonly number[] = [0, 2.5, 4, 6];
/** Velocidad a la que una moneda atraída se acerca al héroe (u/s, constante por nivel). */
export const COIN_MAGNET_SPEED = 7;
