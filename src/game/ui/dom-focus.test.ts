/**
 * Tests de `isInteractiveElement` (guarda de accesibilidad de Tab en
 * WeaponBar.tsx). `isTypingInTextField` NO se testea aquí: lee
 * `document.activeElement` directamente sin parámetro inyectable, y este
 * proyecto no tiene DOM real disponible en los tests (`environment: 'node'`,
 * ver vite.config.ts) — mismo estado que tenía antes de esta tarea.
 *
 * `isInteractiveElement` sí es testeable: toma el elemento ya resuelto como
 * parámetro (ver cabecera de dom-focus.ts), así que basta un objeto plano que
 * cumpla la forma mínima que usa (`tagName`/`hasAttribute`) — ni jsdom ni
 * ningún otro DOM real hacen falta.
 */

import { describe, expect, it } from 'vitest';
import { isInteractiveElement } from './dom-focus';

/** Objeto plano mínimo que satisface la forma que pide `isInteractiveElement` — un `Element` real la cumple sin conversión. */
function fakeElement(tagName: string, tabindex?: string): { tagName: string; hasAttribute(name: string): boolean } {
  return {
    tagName,
    hasAttribute: (name: string) => name === 'tabindex' && tabindex !== undefined,
  };
}

describe('isInteractiveElement', () => {
  it('false con null (nada enfocado explícitamente, p.ej. mitad de partida sin tabular)', () => {
    expect(isInteractiveElement(null)).toBe(false);
  });

  it('true en un <button>', () => {
    expect(isInteractiveElement(fakeElement('BUTTON'))).toBe(true);
  });

  it('true en un <a>', () => {
    expect(isInteractiveElement(fakeElement('A'))).toBe(true);
  });

  it('true en cualquier elemento con tabindex propio, tenga el valor que tenga', () => {
    expect(isInteractiveElement(fakeElement('DIV', '0'))).toBe(true);
    expect(isInteractiveElement(fakeElement('DIV', '-1'))).toBe(true);
  });

  it('false en un <div>/<body> normal sin tabindex (el caso típico a mitad de partida)', () => {
    expect(isInteractiveElement(fakeElement('DIV'))).toBe(false);
    expect(isInteractiveElement(fakeElement('BODY'))).toBe(false);
  });

  it('false en un <input>/<select> sin tabindex explícito (los cubre isTypingInTextField, no este)', () => {
    expect(isInteractiveElement(fakeElement('INPUT'))).toBe(false);
    expect(isInteractiveElement(fakeElement('SELECT'))).toBe(false);
  });
});
