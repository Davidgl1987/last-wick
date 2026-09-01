/**
 * Tests de la señal "hay teclado" para las pistas del microtutorial
 * (HUD.tsx, ver useKeyboardHint.ts). Módulo puro: sin DOM.
 */

import { describe, expect, it } from 'vitest';
import { isKeyboardHintCode } from './keyboard-hint';

describe('isKeyboardHintCode', () => {
  it('true con WASD', () => {
    expect(isKeyboardHintCode('KeyW')).toBe(true);
    expect(isKeyboardHintCode('KeyA')).toBe(true);
    expect(isKeyboardHintCode('KeyS')).toBe(true);
    expect(isKeyboardHintCode('KeyD')).toBe(true);
  });

  it('true con las flechas', () => {
    expect(isKeyboardHintCode('ArrowUp')).toBe(true);
    expect(isKeyboardHintCode('ArrowDown')).toBe(true);
    expect(isKeyboardHintCode('ArrowLeft')).toBe(true);
    expect(isKeyboardHintCode('ArrowRight')).toBe(true);
  });

  it('true con Tab (cambio de arma, WeaponBar.tsx)', () => {
    expect(isKeyboardHintCode('Tab')).toBe(true);
  });

  it('false con cualquier otra tecla: no debe activar las pistas por un tecleo suelto', () => {
    expect(isKeyboardHintCode('Space')).toBe(false);
    expect(isKeyboardHintCode('Escape')).toBe(false);
    expect(isKeyboardHintCode('KeyQ')).toBe(false);
    expect(isKeyboardHintCode('Enter')).toBe(false);
    expect(isKeyboardHintCode('ShiftLeft')).toBe(false);
    expect(isKeyboardHintCode('Digit1')).toBe(false);
  });
});
