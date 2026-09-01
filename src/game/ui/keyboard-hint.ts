/**
 * Señal "hay teclado" para las pistas de teclado del microtutorial (HUD.tsx,
 * GDD §3): qué tecla concreta cuenta como evidencia de que el jugador tiene
 * teclado a mano y lo está usando de verdad. Módulo PURO (sin window/
 * document/React, mismo criterio que features/hero/keyboard-move.ts):
 * testeable en vitest con `environment: 'node'`. El hook que sí toca el DOM
 * (listener 'keydown' + matchMedia) vive en useKeyboardHint.ts, aparte.
 *
 * Decisión de David (2026-08-31): SOLO WASD/flechas (paseo,
 * features/hero/keyboard-move.ts) y Tab (cambio de arma, WeaponBar.tsx)
 * cuentan — cualquier otra tecla (Escape, Space, una letra al azar…) NO debe
 * activar las pistas: un jugador táctil que roza sin querer el teclado en
 * pantalla del sistema, o alguien con un teclado físico conectado que nunca
 * lo usa para jugar, no debe ver pistas de un control que en la práctica no
 * está usando.
 */

import { isMoveKeyCode } from '@/game/features/hero/keyboard-move';

/** true si `code` (KeyboardEvent.code) es una de las teclas que activan las pistas de teclado: WASD/flechas o Tab. */
export function isKeyboardHintCode(code: string): boolean {
  return isMoveKeyCode(code) || code === 'Tab';
}
