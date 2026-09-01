/**
 * Ciclado circular de modo de arma (GDD §3/§12): comparte esta única función
 * la rueda del ratón y Tab/Shift+Tab de WeaponBar.tsx — antes cada atajo
 * tenía su propio cálculo de índice, unificado 2026-08-31 al añadir Tab, para
 * que "siguiente/anterior arma" tenga una sola definición. Módulo PURO: sin
 * `window`/`document`/React — testeable en vitest con `environment: 'node'`,
 * mismo criterio que `features/hero/keyboard-move.ts`.
 *
 * El ORDEN debe coincidir con el de `MODES` en WeaponBar.tsx (los botones se
 * pintan en ese mismo orden) — si algún día se añade/reordena un arma, tocan
 * las dos listas (mismo patrón deliberado que `WEAPON_COLOR`, duplicado entre
 * render/assets.ts, weapon-bar.css y UpgradeIcon.tsx, ver comentario allí).
 */

import type { GamePhase, WeaponMode } from '@/game/world/types';

export const WEAPON_CYCLE_ORDER: readonly WeaponMode[] = ['body', 'arrow', 'spell'];

/**
 * Modo `step` posiciones (±1) más allá de `current` en `WEAPON_CYCLE_ORDER`,
 * dando la vuelta en ambos extremos (del último vuelve al primero y
 * viceversa). `step` siempre ±1: ni la rueda ni Tab saltan más de un modo por
 * muesca/pulsación.
 */
export function cycleWeaponMode(current: WeaponMode, step: 1 | -1): WeaponMode {
  const currentIndex = WEAPON_CYCLE_ORDER.indexOf(current);
  const nextIndex = (currentIndex + step + WEAPON_CYCLE_ORDER.length) % WEAPON_CYCLE_ORDER.length;
  return WEAPON_CYCLE_ORDER[nextIndex];
}

/**
 * true si el listener 'keydown' de WeaponBar.tsx debe secuestrar Tab
 * (preventDefault + ciclar de arma) — regla de accesibilidad (encargo de
 * David 2026-08-31): Tab es la tecla de navegación por foco del navegador,
 * así que solo se secuestra jugando de verdad (fase 'playing') y cuando el
 * foco NO está en un control por el que el usuario navegaría con Tab (campo
 * de texto editable, o cualquier otro control interactivo — botón, enlace,
 * tabindex propio). Si cualquiera de esas dos señales de foco es cierta, se
 * deja pasar la navegación nativa del navegador sin tocarla.
 *
 * Función PURA con los tres hechos ya resueltos como parámetros (no lee
 * `document`/`session` ella misma) — mismo motivo que `cycleWeaponMode` de
 * arriba: testeable sin DOM real. El único caller de producción
 * (WeaponBar.tsx) le pasa `isTypingInTextField()` e
 * `isInteractiveElement(document.activeElement)` (ambas en dom-focus.ts) ya
 * resueltas.
 */
export function canHijackTabForWeaponCycle({
  phase,
  isTypingInTextField,
  isFocusOnInteractiveElement,
}: {
  phase: GamePhase;
  isTypingInTextField: boolean;
  isFocusOnInteractiveElement: boolean;
}): boolean {
  return phase === 'playing' && !isTypingInTextField && !isFocusOnInteractiveElement;
}
