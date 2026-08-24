/**
 * Utilidad de foco compartida por los listeners de teclado globales (atajos
 * de arma en WeaponBar.tsx, paseo WASD en features/hero/KeyboardMoveInput.tsx):
 * ninguno debe robarle las teclas a un campo de texto editable.
 */

/** true si el foco actual está en un campo de texto editable (inputs del editor). */
export function isTypingInTextField(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
