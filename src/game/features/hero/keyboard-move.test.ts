/**
 * Tests de detección de capacidades y del rastreador de teclas del paseo
 * WASD/flechas (GDD §3). Módulo puro: sin DOM, sin mocks de `window`.
 */

import { describe, expect, it, vi } from 'vitest';
import { KeyboardMoveTracker, supportsKeyboardMove } from './keyboard-move';

const HOVER_FINE_QUERY = '(hover: hover) and (pointer: fine)';

describe('supportsKeyboardMove', () => {
  it('true cuando matchMedia reporta hover:hover + pointer:fine (escritorio)', () => {
    const matchMedia = vi.fn((_query: string) => ({ matches: true }));
    expect(supportsKeyboardMove(matchMedia)).toBe(true);
    // La query pedida debe ser EXACTAMENTE esta cadena (petición explícita:
    // por capacidades, nunca por userAgent).
    expect(matchMedia).toHaveBeenCalledWith(HOVER_FINE_QUERY);
    expect(matchMedia).toHaveBeenCalledTimes(1);
  });

  it('false cuando matchMedia reporta hover:none / pointer:coarse (táctil)', () => {
    const matchMedia = vi.fn((_query: string) => ({ matches: false }));
    expect(supportsKeyboardMove(matchMedia)).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith(HOVER_FINE_QUERY);
  });

  it('false si no hay matchMedia disponible (undefined o null: entorno sin DOM)', () => {
    expect(supportsKeyboardMove(undefined)).toBe(false);
    expect(supportsKeyboardMove(null)).toBe(false);
  });
});

describe('KeyboardMoveTracker', () => {
  it('WASD acumula por eje y se cancela por completo al soltar', () => {
    const tracker = new KeyboardMoveTracker();
    expect(tracker.press('KeyW')).toBe(true);
    expect(tracker.x).toBe(0);
    expect(tracker.y).toBe(-1);

    expect(tracker.press('KeyD')).toBe(true);
    expect(tracker.x).toBe(1);
    expect(tracker.y).toBe(-1);

    expect(tracker.release('KeyW')).toBe(true);
    expect(tracker.x).toBe(1);
    expect(tracker.y).toBe(0);

    expect(tracker.release('KeyD')).toBe(true);
    expect(tracker.x).toBe(0);
    expect(tracker.y).toBe(0);
  });

  it('las flechas usan el mismo eje/signo que su tecla WASD equivalente y se combinan con ella', () => {
    const tracker = new KeyboardMoveTracker();
    tracker.press('ArrowUp');
    tracker.press('ArrowRight');
    expect(tracker.x).toBe(1);
    expect(tracker.y).toBe(-1);

    tracker.press('KeyA'); // mismo eje x que ArrowRight, signo opuesto: se cancelan
    expect(tracker.x).toBe(0);
    tracker.release('ArrowRight');
    expect(tracker.x).toBe(-1); // solo queda KeyA

    tracker.press('KeyS'); // mismo eje y que ArrowUp, signo opuesto
    expect(tracker.y).toBe(0);
  });

  it('el vector queda CRUDO, sin normalizar (la diagonal no se recorta aquí)', () => {
    const tracker = new KeyboardMoveTracker();
    tracker.press('KeyW');
    tracker.press('KeyD');
    expect(tracker.x).toBe(1);
    expect(tracker.y).toBe(-1); // no (0.707, -0.707): la normalización vive solo en stepHeroWalk
  });

  it('teclas desconocidas se ignoran (devuelven false) y no tocan el vector', () => {
    const tracker = new KeyboardMoveTracker();
    tracker.press('KeyW');
    expect(tracker.press('Space')).toBe(false);
    expect(tracker.release('Escape')).toBe(false);
    expect(tracker.x).toBe(0);
    expect(tracker.y).toBe(-1);
  });

  it('clear() suelta todas las teclas y deja el vector en {0,0}', () => {
    const tracker = new KeyboardMoveTracker();
    tracker.press('KeyW');
    tracker.press('KeyD');
    tracker.clear();
    expect(tracker.x).toBe(0);
    expect(tracker.y).toBe(0);

    // Las teclas quedan realmente sueltas (no solo el vector puesto a 0 una
    // vez): soltar de nuevo una de ellas es un no-op, no la "reactiva".
    expect(tracker.release('KeyW')).toBe(true);
    expect(tracker.x).toBe(0);
    expect(tracker.y).toBe(0);
  });

  it('pulsar dos veces la misma tecla (autorepeat de keydown) no duplica el eje', () => {
    const tracker = new KeyboardMoveTracker();
    tracker.press('KeyD');
    tracker.press('KeyD');
    tracker.press('KeyD');
    expect(tracker.x).toBe(1);
    tracker.release('KeyD');
    expect(tracker.x).toBe(0);
  });

  it('soltar una tecla nunca pulsada no rompe el vector', () => {
    const tracker = new KeyboardMoveTracker();
    tracker.press('KeyW');
    expect(tracker.release('KeyS')).toBe(true); // tecla de movimiento válida, pero nunca estaba pulsada
    expect(tracker.x).toBe(0);
    expect(tracker.y).toBe(-1); // KeyW intacta
    expect(tracker.release('KeyD')).toBe(true);
    expect(tracker.x).toBe(0);
    expect(tracker.y).toBe(-1);
  });
});
