/**
 * Detección de capacidades y rastreo de teclas para el paseo WASD/flechas
 * (GDD §3, solo escritorio). Módulo PURO: sin `window`/`document`, testeable
 * en vitest con `environment: 'node'`. El componente que sí toca el DOM es
 * `KeyboardMoveInput.tsx`.
 *
 * Ejes (mundo XZ, GDD/world/types.ts): `Vec2.y` del mundo de simulación ≡ Z
 * del mundo 3D, y `CameraRig.tsx` coloca la cámara en +Z detrás del héroe
 * mirando hacia −Z (offset `(0, 9.5, 6.2)`, `+y` de mundo = "sur", hacia la
 * cámara — ver comentario de `World.heroMove`). Con esa cámara, +Y de mundo
 * (sur) proyecta hacia ABAJO en pantalla y −Y (norte) hacia ARRIBA. Por eso
 * W/ArrowUp usan signo −1 en el eje `y` (arriba en pantalla) y S/ArrowDown
 * usan +1 (abajo en pantalla); A/D usan el signo directo de X (la cámara no
 * gira en yaw, +X de mundo ya cae a la derecha en pantalla).
 */

/** Códigos físicos de tecla (KeyboardEvent.code, independiente de distribución) que mueven al héroe. */
type MoveKeyCode = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'ArrowUp' | 'ArrowLeft' | 'ArrowDown' | 'ArrowRight';

const MOVE_KEY_AXES: Record<MoveKeyCode, { axis: 'x' | 'y'; sign: 1 | -1 }> = {
  KeyW: { axis: 'y', sign: -1 },
  ArrowUp: { axis: 'y', sign: -1 },
  KeyS: { axis: 'y', sign: 1 },
  ArrowDown: { axis: 'y', sign: 1 },
  KeyA: { axis: 'x', sign: -1 },
  ArrowLeft: { axis: 'x', sign: -1 },
  KeyD: { axis: 'x', sign: 1 },
  ArrowRight: { axis: 'x', sign: 1 },
};

/** Orden fijo de recorrido para `recompute()`/`clear()` (evita depender de iteración de Set/Map). */
const MOVE_KEY_CODES = Object.keys(MOVE_KEY_AXES) as MoveKeyCode[];

/**
 * true si `code` es una tecla de movimiento reconocida (WASD/flechas).
 * Exportada (encargo 2026-08-31, Tab para cambiar de arma): `game/ui/
 * keyboard-hint.ts` la reutiliza para decidir cuándo mostrar las pistas de
 * teclado del microtutorial — Tab se suma aparte allí, no es una tecla de
 * movimiento y no pertenece a `MOVE_KEY_AXES`.
 */
export function isMoveKeyCode(code: string): code is MoveKeyCode {
  return Object.prototype.hasOwnProperty.call(MOVE_KEY_AXES, code);
}

/**
 * Capacidades, nunca `userAgent` (petición explícita: un portátil táctil o
 * una tablet con teclado/ratón conectado deben decidirse por lo que el
 * dispositivo puede hacer AHORA, no por su fabricante/SO). `hover: hover` +
 * `pointer: fine` es la combinación estándar para "hay un puntero preciso
 * habitual" (ratón/trackpad) — un móvil/tablet en modo solo-táctil no la
 * cumple aunque su userAgent diga "desktop" en algún proxy/emulador.
 */
export function supportsKeyboardMove(
  matchMedia: ((query: string) => { matches: boolean }) | undefined | null,
): boolean {
  return matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
}

/**
 * Rastreador de teclas de movimiento pulsadas. Sin DOM: `press`/`release` se
 * alimentan del `.code` crudo de los listeners de `KeyboardMoveInput.tsx`.
 *
 * El vector expuesto (`x`/`y`) se RECALCULA desde el conjunto de teclas
 * actualmente pulsadas (nunca se acumula por suma/resta incremental): así,
 * pulsar la misma tecla dos veces seguidas (autorepeat de `keydown`) no
 * duplica el eje, y soltar una tecla que nunca estuvo pulsada no lo rompe.
 * El vector queda CRUDO (sin normalizar): con W+D pulsadas a la vez vale
 * (1,-1), no (0.7,-0.7) — la normalización vive solo en `stepHeroWalk`
 * (walk.ts), así que la diagonal no es más rápida y esa regla no se duplica.
 */
export class KeyboardMoveTracker {
  private readonly held: Partial<Record<MoveKeyCode, boolean>> = {};
  x = 0;
  y = 0;

  /** Registra una tecla pulsada. Devuelve true si `code` es una tecla de movimiento reconocida. */
  press(code: string): boolean {
    if (!isMoveKeyCode(code)) return false;
    if (!this.held[code]) {
      this.held[code] = true;
      this.recompute();
    }
    return true;
  }

  /** Registra una tecla soltada. Devuelve true si `code` es una tecla de movimiento reconocida. */
  release(code: string): boolean {
    if (!isMoveKeyCode(code)) return false;
    if (this.held[code]) {
      this.held[code] = false;
      this.recompute();
    }
    return true;
  }

  /** Suelta todas las teclas y deja el vector en {0,0} (blur/visibilitychange/desmontaje). */
  clear(): void {
    for (const code of MOVE_KEY_CODES) this.held[code] = false;
    this.x = 0;
    this.y = 0;
  }

  private recompute(): void {
    let x = 0;
    let y = 0;
    for (const code of MOVE_KEY_CODES) {
      if (!this.held[code]) continue;
      const { axis, sign } = MOVE_KEY_AXES[code];
      if (axis === 'x') x += sign;
      else y += sign;
    }
    this.x = x;
    this.y = y;
  }
}
