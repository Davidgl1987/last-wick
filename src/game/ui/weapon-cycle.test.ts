/**
 * Tests del ciclado de arma (rueda/Tab/Shift+Tab, WeaponBar.tsx) y de la
 * guarda de accesibilidad que decide si Tab puede secuestrarse. Módulo puro:
 * sin DOM (mismo criterio que keyboard-move.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { canHijackTabForWeaponCycle, cycleWeaponMode, WEAPON_CYCLE_ORDER } from './weapon-cycle';

describe('WEAPON_CYCLE_ORDER', () => {
  it('tiene los 3 modos, en el mismo orden que los botones de WeaponBar (body, arrow, spell)', () => {
    expect(WEAPON_CYCLE_ORDER).toEqual(['body', 'arrow', 'spell']);
  });
});

describe('cycleWeaponMode', () => {
  it('step +1 avanza en orden body → arrow → spell → body (da la vuelta al llegar al final)', () => {
    expect(cycleWeaponMode('body', 1)).toBe('arrow');
    expect(cycleWeaponMode('arrow', 1)).toBe('spell');
    expect(cycleWeaponMode('spell', 1)).toBe('body');
  });

  it('step -1 retrocede en orden inverso body → spell → arrow → body (da la vuelta al llegar al principio)', () => {
    expect(cycleWeaponMode('body', -1)).toBe('spell');
    expect(cycleWeaponMode('spell', -1)).toBe('arrow');
    expect(cycleWeaponMode('arrow', -1)).toBe('body');
  });

  it('avanzar y retroceder son inversos entre sí (ida y vuelta deja el mismo modo)', () => {
    for (const mode of WEAPON_CYCLE_ORDER) {
      expect(cycleWeaponMode(cycleWeaponMode(mode, 1), -1)).toBe(mode);
      expect(cycleWeaponMode(cycleWeaponMode(mode, -1), 1)).toBe(mode);
    }
  });
});

describe('canHijackTabForWeaponCycle', () => {
  const playing = { phase: 'playing' as const, isTypingInTextField: false, isFocusOnInteractiveElement: false };

  it('true jugando ("playing"), sin foco en campo de texto ni en control interactivo', () => {
    expect(canHijackTabForWeaponCycle(playing)).toBe(true);
  });

  it('false si la fase no es "playing" (pausa, tienda, game-over, victoria...)', () => {
    expect(canHijackTabForWeaponCycle({ ...playing, phase: 'paused' })).toBe(false);
    expect(canHijackTabForWeaponCycle({ ...playing, phase: 'shopping' })).toBe(false);
    expect(canHijackTabForWeaponCycle({ ...playing, phase: 'game-over' })).toBe(false);
    expect(canHijackTabForWeaponCycle({ ...playing, phase: 'victory' })).toBe(false);
    expect(canHijackTabForWeaponCycle({ ...playing, phase: 'boss-reward' })).toBe(false);
  });

  it('false si el foco está en un campo de texto editable (isTypingInTextField)', () => {
    expect(canHijackTabForWeaponCycle({ ...playing, isTypingInTextField: true })).toBe(false);
  });

  it('false si el foco está en un control interactivo de la UI (botón, enlace, tabindex)', () => {
    expect(canHijackTabForWeaponCycle({ ...playing, isFocusOnInteractiveElement: true })).toBe(false);
  });

  it('false si se dan varias condiciones de bloqueo a la vez', () => {
    expect(
      canHijackTabForWeaponCycle({ phase: 'paused', isTypingInTextField: true, isFocusOnInteractiveElement: true }),
    ).toBe(false);
  });
});
