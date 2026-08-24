/**
 * Paseo WASD/flechas (GDD §3): SOLO escritorio, detectado por capacidades
 * (`supportsKeyboardMove`, keyboard-move.ts) — nunca por `userAgent`. En
 * táctil no se registra ni un solo listener: el juego queda exactamente
 * igual que hoy. Mismo patrón que AimInput.tsx: devuelve null, todo el
 * trabajo vive en un único `useEffect`, cero re-renders y cero asignaciones
 * de objeto por evento — solo mutación de los dos escalares de `session.move`
 * (leído por `useGameLoop.ts`, que lo copia a `world.heroMove` cada frame).
 */

import { useEffect } from 'react';
import type { GameSession } from '@/game/session/session';
import { isTypingInTextField } from '@/game/ui/dom-focus';
import { KeyboardMoveTracker, supportsKeyboardMove } from './keyboard-move';

export function KeyboardMoveInput({ session }: { session: GameSession }) {
  useEffect(() => {
    // Al montar: {0,0} siempre (ya es el valor inicial de session.move, pero
    // se deja explícito), incluso en el camino táctil de abajo, que corta
    // antes de registrar listener alguno.
    session.move.x = 0;
    session.move.y = 0;
    if (!supportsKeyboardMove(window.matchMedia?.bind(window))) return;

    const tracker = new KeyboardMoveTracker();

    const sync = (): void => {
      session.move.x = tracker.x;
      session.move.y = tracker.y;
    };

    /** Suelta todo (blur/visibilitychange/desmontaje): sin esto, una tecla soltada fuera de la ventana dejaría a Lumora caminando sola para siempre. */
    const reset = (): void => {
      tracker.clear();
      session.move.x = 0;
      session.move.y = 0;
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      // No robar atajos del navegador (Ctrl/Cmd/Alt+letra) ni las teclas de
      // un campo de texto editable (reutiliza el mismo criterio que WeaponBar).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInTextField()) return;
      if (!tracker.press(e.code)) return; // no es una tecla de movimiento: no la tocamos
      e.preventDefault(); // consumida de verdad: evita que las flechas hagan scroll de la página
      sync();
    };

    // Sin guardas de modificador/foco en keyup a propósito: si se soltara la
    // tecla estando el foco en un campo de texto (foco cambiado a mitad de
    // pulsación), la tecla quedaría marcada como pulsada para siempre en el
    // tracker — soltar SIEMPRE se procesa, solo blur/visibilitychange además
    // limpian por completo ante pérdida de foco de la ventana entera.
    const onKeyUp = (e: KeyboardEvent): void => {
      if (!tracker.release(e.code)) return;
      e.preventDefault();
      sync();
    };

    const onBlur = (): void => reset();
    const onVisibilityChange = (): void => {
      if (document.hidden) reset();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reset();
    };
  }, [session]);

  return null;
}
