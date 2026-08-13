/**
 * Fogonazos de impacto (docs/plans/VFX_PLAN.md T3, GDD §12): pool minúsculo de
 * destellos aditivos brevísimos en el punto de impacto (golpe a enemigo/jefe,
 * rebote contra muro, bloqueo de escudo, explosión de barril...). Hasta este
 * plan un impacto solo generaba partículas, sin fogonazo: con el `Bloom` ya
 * montado en `render/PostEffects.tsx` este destello brilla sin coste extra.
 *
 * Datos puros (sin three.js); `FlashView.tsx` los renderiza con quads
 * preasignados. Calcado de `shockwave.ts` (mismo patrón de pool circular de
 * tamaño fijo: `spawn` siempre ocupa el siguiente slot del cursor, `update`
 * decrementa vida y libera al llegar a 0).
 */

export const FLASH_POOL_SIZE = 8;
/** Vida del fogonazo (s): brevísima a propósito (VFX_PLAN T3: "~0.10 s"), un pico de escala rápido seguido de caída, ver FlashView.tsx. */
export const FLASH_LIFE = 0.1;

export class FlashPool {
  readonly capacity: number;
  readonly active: Uint8Array;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly life: Float32Array;
  /**
   * Vida total en el momento de nacer, guardada por slot (no solo la
   * constante `FLASH_LIFE`) para que `FlashView.tsx` calcule el progreso
   * `1 - life/maxLife` de cada slot sin acoplarse a una única duración
   * compartida — mismo criterio que separar `life`/`maxRadius` en
   * `ShockwavePool`, un paso más explícito por si algún día un evento
   * necesita una vida distinta.
   */
  readonly maxLife: Float32Array;
  /** Radio del fogonazo en su pico de escala (u de mundo). */
  readonly size: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  private cursor = 0;

  constructor(capacity = FLASH_POOL_SIZE) {
    this.capacity = capacity;
    this.active = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.r = new Float32Array(capacity);
    this.g = new Float32Array(capacity);
    this.b = new Float32Array(capacity);
  }

  /** `x`/`z`: posición en el plano del suelo. `size`: radio en el pico de escala (u). `r`/`g`/`b`: color en [0,1]. */
  spawn(x: number, z: number, size: number, r: number, g: number, b: number): void {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.active[idx] = 1;
    this.x[idx] = x;
    this.z[idx] = z;
    this.size[idx] = size;
    this.r[idx] = r;
    this.g[idx] = g;
    this.b[idx] = b;
    this.life[idx] = FLASH_LIFE;
    this.maxLife[idx] = FLASH_LIFE;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      const life = this.life[i] - dt;
      if (life <= 0) {
        this.active[i] = 0;
        continue;
      }
      this.life[i] = life;
    }
  }
}
