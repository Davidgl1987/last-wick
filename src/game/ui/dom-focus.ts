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

/**
 * Elemento mínimo que necesita `isInteractiveElement`: cualquier cosa con
 * `tagName`/`hasAttribute` — un `Element` real del DOM los tiene ambos, así
 * que `document.activeElement` encaja sin conversión. Parametrizada en vez de
 * leer `document.activeElement` ella misma (mismo motivo que
 * `supportsKeyboardMove` en keyboard-move.ts acepta `matchMedia` como
 * parámetro en vez de leerlo de `window`): así es testeable en vitest con
 * `environment: 'node'` (vite.config.ts), sin DOM real.
 */
interface FocusTarget {
  tagName: string;
  hasAttribute(name: string): boolean;
}

/**
 * true si `el` es un control interactivo de la UI por el que el usuario
 * navegaría con Tab: botón, enlace, o cualquier cosa con `tabindex` propio
 * (basta con que el atributo esté presente, cualquier valor). NO incluye
 * campos de texto editables — eso ya lo cubre `isTypingInTextField` de
 * arriba; el único caller (WeaponBar.tsx, guarda de accesibilidad de Tab)
 * comprueba las dos por separado porque un `<select>`/`<textarea>` no lleva
 * `tabindex` explícito pese a formar parte de la navegación nativa.
 */
export function isInteractiveElement(el: FocusTarget | null): boolean {
  if (!el) return false;
  if (el.tagName === 'BUTTON' || el.tagName === 'A') return true;
  return el.hasAttribute('tabindex');
}
