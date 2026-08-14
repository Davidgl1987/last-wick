/**
 * Pool de partículas: arrays tipados preasignados (SoA), cero asignaciones
 * por frame. Uno o más InstancedMesh (ParticleView.tsx, uno por textura del
 * catálogo en uso) leen este pool en useFrame y mutan sus matrices/color de
 * instancia; este módulo solo posee los datos y la lógica de spawn/update,
 * sin three.js ni React.
 *
 * Cada partícula: posición + velocidad (plano XZ, "arriba" en Y para el
 * pequeño salto inicial), color (RGB [0,1]), tamaño base, vida restante y
 * vida total (para desvanecer). `active` marca los slots libres; spawn
 * recicla el slot más antiguo si el pool está lleno (nunca crece).
 *
 * `rot` (radianes): rotación de pantalla de la salpicadura, generada dentro
 * de `burst()` con el mismo `rng` inyectado que ya genera `angle`/`speed`/
 * `size` (mismo sitio, mismo estilo — ver también `WaxPool.emit` en
 * `features/effects/wax.ts`, que aplica el mismo criterio a sus manchas de
 * cera). `ParticleView` la usa para girar cada splat billboard dentro del
 * plano de la cámara, así una explosión de 48 partículas no se lee como 48
 * copias idénticas del mismo sprite.
 */

export const PARTICLE_POOL_SIZE = 256;

/**
 * Catálogo de texturas de partícula por índice (VFX_PLAN.md, ampliación
 * 2026-08-11 — feedback de David: "los barriles parece que sueltan las
 * mismas partículas de cera... pon texturas acordes a explosiones"). Antes
 * de esto, TODAS las partículas del juego compartían `splat02`, así que
 * explosión/impacto/rastro se leían idénticas; cada índice de aquí es una
 * silueta distinta para su familia de evento (asignación en `burstTable.ts`,
 * `BurstSpec.texture`).
 *
 * Los nombres son literales de `render/vfx-textures.ts`
 * (`LightMaskName | SplatName`), pero ESTE módulo NO importa ese fichero: lo
 * arrastraría three.js (AGENTS.md/VFX_PLAN §3.6: "Ningún módulo de
 * features/effects/*.ts importa three.js ni React"). `ParticleView.tsx` es
 * quien traduce cada nombre a su material real (aditivo si está en
 * `LIGHT_MASK_NAMES`, normal si es un Splat); `particles.test.ts` valida por
 * separado que estos nombres existen en el catálogo real.
 *
 * Orden = índice guardado en `ParticlePool.tex` (Uint8Array): burst()/spawn()
 * reciben y guardan el índice numérico, nunca el string, coherente con el
 * resto del pool (arrays tipados, cero objetos/strings en el hot path).
 *
 * - `splat02` (0): "resto" — recogidas, mejoras, muerte de enemigo, polvo de
 *   jefe... el splat que ya había, que para materia/polvo funciona.
 * - `disc` (1): explosión (barril, jefe derrotado, columna de
 *   jefe rota) — bola con rayos radiales, se lee como brasa/fogonazo.
 * - `shape_e` (2): impacto (golpes, rebotes, bloqueo de escudo) — destello
 *   de 4 puntas, chispa seca.
 * - `snowflake` (3): arma Hielo (`arrow` en el mundo simulado, "Hielo" en
 *   WeaponBar) — aspa de 4 pétalos, a tamaño pequeño y teñida de azul se lee
 *   como copo de nieve. Solo la usan `launch`/`projectile-wall` cuando el
 *   arma activa es la de hielo (reactToEvent.ts), sustituyendo a la textura
 *   por defecto de esos dos eventos igual que ya se sustituye su COLOR.
 */
export const PARTICLE_TEXTURES = ['splat02', 'disc', 'shape_e', 'snowflake'] as const;
export type ParticleTextureName = (typeof PARTICLE_TEXTURES)[number];

/**
 * Índice numérico de una textura del catálogo, para pasar a `burst()`/
 * `spawn()` y guardar en `ParticlePool.tex`. O(n) con n=4: se llama como
 * mucho una vez por evento drenado (reactToEvent.ts), nunca en el hot path
 * de `update()` ni de `ParticleView` (ese ya trabaja solo con el índice
 * guardado).
 */
export function particleTextureIndex(name: ParticleTextureName): number {
  const idx = PARTICLE_TEXTURES.indexOf(name);
  return idx < 0 ? 0 : idx;
}

export class ParticlePool {
  readonly capacity: number;
  readonly active: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly size: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  /** Rotación de pantalla del splat billboard (radianes), generada dentro de `burst()`. */
  readonly rot: Float32Array;
  /** Índice en `PARTICLE_TEXTURES` (Uint8Array: 4 texturas hoy, sobra rango hasta 255). Lo reparte `ParticleView` entre sus N InstancedMesh, uno por textura. */
  readonly tex: Uint8Array;
  /** Puntero circular al próximo slot candidato a reciclar (evita escanear todo el pool en cada spawn). */
  private cursor = 0;
  /** Nº de slots activos ahora mismo (para tests/telemetría; no se usa en el hot path de three.js). */
  aliveCount = 0;

  constructor(capacity = PARTICLE_POOL_SIZE) {
    this.capacity = capacity;
    this.active = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.r = new Float32Array(capacity);
    this.g = new Float32Array(capacity);
    this.b = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.tex = new Uint8Array(capacity);
  }

  /** Busca un slot libre desde el cursor; si no hay ninguno, recicla el propio cursor (descarta la partícula más antigua en ese punto). */
  private nextSlot(): number {
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.cursor + i) % this.capacity;
      if (!this.active[idx]) {
        this.cursor = (idx + 1) % this.capacity;
        return idx;
      }
    }
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    return idx;
  }

  /**
   * Activa una partícula en el slot elegido. `angle`/`speed` fijan la
   * velocidad horizontal (plano XZ); `upSpeed` da el impulso vertical
   * inicial (pequeño salto/estallido). `rot` es la rotación de pantalla del
   * splat billboard (radianes), coherente con el resto de campos visuales
   * (`size`, `r`/`g`/`b`): quien llama a `spawn` la aporta ya calculada
   * — `burst()` la genera con su `rng` inyectado, igual que `angle`/`speed`/
   * `size`. `tex` es el índice en `PARTICLE_TEXTURES` (default 0 = `splat02`,
   * el "resto"): default para que el único llamador externo de `spawn` fuera
   * de este módulo/sus tests (`HeroView.tsx`, burst de cambio de arma) siga
   * compilando sin tocarlo — otro agente lo edita en paralelo.
   */
  spawn(
    x: number,
    z: number,
    angle: number,
    speed: number,
    upSpeed: number,
    size: number,
    life: number,
    r: number,
    g: number,
    b: number,
    rot: number,
    tex = 0,
  ): void {
    const idx = this.nextSlot();
    if (!this.active[idx]) this.aliveCount++;
    this.active[idx] = 1;
    this.x[idx] = x;
    this.y[idx] = 0;
    this.z[idx] = z;
    this.vx[idx] = Math.cos(angle) * speed;
    this.vy[idx] = upSpeed;
    this.vz[idx] = Math.sin(angle) * speed;
    this.size[idx] = size;
    this.life[idx] = life;
    this.maxLife[idx] = life;
    this.r[idx] = r;
    this.g[idx] = g;
    this.b[idx] = b;
    this.rot[idx] = rot;
    this.tex[idx] = tex;
  }

  /**
   * Lanza un burst de `count` partículas en abanico 360° alrededor de (x,z),
   * con jitter de velocidad/tamaño. `tex` (índice en `PARTICLE_TEXTURES`,
   * default 0 = `splat02`) es constante para TODO el burst — a diferencia de
   * `rot`, que burst() sí aleatoriza por partícula, todas las partículas de
   * un mismo evento comparten familia visual (una explosión no mezcla brasas
   * con chispas de impacto).
   */
  burst(
    x: number,
    z: number,
    count: number,
    baseSpeed: number,
    baseSize: number,
    life: number,
    r: number,
    g: number,
    b: number,
    rng: () => number,
    tex = 0,
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const speed = baseSpeed * (0.5 + rng());
      const upSpeed = baseSpeed * (0.3 + rng() * 0.9);
      const size = baseSize * (0.7 + rng() * 0.6);
      const rot = rng() * Math.PI * 2;
      this.spawn(x, z, angle, speed, upSpeed, size, life, r, g, b, rot, tex);
    }
  }

  /** Integra física simple (gravedad ligera + fricción del aire) y expira partículas agotadas. Cero asignaciones. */
  update(dt: number): void {
    const GRAVITY = 4.2;
    const DRAG = 0.9;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      const life = this.life[i] - dt;
      if (life <= 0) {
        this.active[i] = 0;
        this.aliveCount--;
        continue;
      }
      this.life[i] = life;
      this.vy[i] -= GRAVITY * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      const drag = Math.exp(-DRAG * dt);
      this.vx[i] *= drag;
      this.vz[i] *= drag;
      if (this.y[i] < 0) {
        this.y[i] = 0;
        this.vy[i] = 0;
      }
    }
  }
}
