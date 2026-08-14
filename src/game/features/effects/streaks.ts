/**
 * Rastro de proyectiles: UN trazo por TRAMO RECTO de la trayectoria (origen →
 * rebote → ... → fin), en vez de marcas sueltas cada `PROJECTILE_WAX_EMIT_DISTANCE`
 * como hacía antes (feedback de David: "cuando salen varios [proyectiles] no
 * se ve bien qué es lo que deja en el suelo, sale confuso [...] en los
 * hechizos deben estar orientados correctamente, unos más largos, otros más
 * cortos, o incluso uno solo que empiece en el origen del disparo y acabe
 * donde rebota, y vuelva a empezar ahí y terminar donde acaba").
 *
 * Pool NUEVO e independiente de `WaxPool` (wax.ts, que sigue siendo el rastro
 * del HÉROE, sin tocar): mismo espíritu — ring buffer preasignado,
 * PERSISTENTE (sin vida/decay, un trazo cerrado se queda tal cual hasta que
 * el buffer recicla su slot o hay un `clear()`), `version`/`epoch` para que
 * la vista suba a GPU solo lo que cambió. Cero three.js aquí (mismo criterio
 * que wax.ts/particles.ts/shockwave.ts): datos + lógica puros, testeables sin
 * infraestructura de render 3D. `StreakView.tsx` es el único consumidor.
 *
 * ── Ciclo de vida de UN trazo (lo decide el LLAMADOR, `ProjectileView.tsx`) ─
 * A diferencia de `WaxPool.emit()` (una llamada = un depósito terminado), un
 * trazo aquí vive en DOS fases explícitas que el llamador orquesta con el
 * índice que le devuelve `open()`:
 *
 *   1. `open(x, z, ...)` — nace en `(x, z)` (el origen del tramo) con
 *      longitud 0. Devuelve el índice del ring buffer ocupado; el llamador
 *      debe conservarlo (junto con el origen `x, z`, que este pool NO
 *      recuerda) mientras el tramo siga vivo.
 *   2. `update(idx, originX, originZ, curX, curZ)` — reestira el MISMO
 *      slot `idx` desde el origen guardado por el llamador hasta la posición
 *      actual del proyectil: recalcula punto medio/ángulo/longitud sobre la
 *      misma instancia, sin consumir un slot nuevo. Se llama UNA VEZ POR
 *      FRAME mientras el proyectil vuela (así el rastro se ve estirarse en
 *      vivo, no aparece de golpe) y también es la forma de "cerrar" un tramo:
 *      la ÚLTIMA llamada con la posición de rebote/muerte deja el trazo con
 *      su geometría final — no existe un `close()` aparte, cerrar es
 *      simplemente dejar de llamar a `update()` sobre ese índice.
 *
 * Al rebotar, el llamador hace una `update()` final (con la posición de
 * rebote) para cerrar el tramo actual y a continuación un `open()` nuevo en
 * ese mismo punto — el trazo siguiente vuelve a empezar donde acabó el
 * anterior, encadenados. `StreakPool` no necesita saber nada de rebotes: es
 * responsabilidad del llamador decidir CUÁNDO abrir/cerrar (ver
 * `ProjectileView.tsx`, que detecta el rebote comparando `Projectile.bouncesLeft`
 * entre frames).
 *
 * ── Por qué el origen NO vive en este pool ──────────────────────────────
 * `ProjectileView.tsx` ya tiene un slot fijo por proyectil (uno por índice de
 * `world.projectiles`, con sus propios `useRef`) que sobrevive mientras el
 * proyectil vuela — es el sitio natural para guardar "el trazo abierto de
 * ESTE proyectil" y su origen, sin que este pool tenga que reservar memoria
 * de "origen" por slot del ring buffer (que son cosas distintas: un slot de
 * proyectil vs. un slot de trazo).
 *
 * ── Convención del ángulo, ya lista para `StreakView.tsx` ─────────────────
 * `angle[idx]` se guarda en la convención que necesita la vista para tumbar
 * el quad y orientarlo de un solo golpe: `obj.rotation.set(-Math.PI/2, 0,
 * angle[idx])`. Con el orden Euler XYZ de three (matriz = Rx·Ry·Rz, ver el
 * comentario de `WaxView.tsx` sobre `pool.rot`), el eje X LOCAL del quad
 * (`unitPlane`, por donde corre el detalle horizontal de `bolt_streak.png`/
 * `frost_streak.png`) queda, tras aplicar `Rz(angle)` y luego `Rx(-90°)`,
 * apuntando en la dirección `(cos(angle), -sin(angle))` de (X, Z) mundo — por
 * eso `angle = atan2(-dz, dx)` (NO `atan2(dx, dz)`, la convención que usa
 * `group.rotation.y` para objetos DE PIE en otras vistas de este mismo
 * fichero de combate: aquí el ángulo entra por Z, no por Y, precisamente para
 * poder tumbar con X después sin sacar el quad del plano horizontal — ver la
 * derivación completa en el comentario de cabecera de `StreakView.tsx`).
 * Verificado con dos casos: `dx=1,dz=0 → angle=0` (el eje largo del quad
 * apunta a +X mundo); `dx=0,dz=1 → angle=-π/2` (apunta a +Z mundo). Cubierto
 * por test.
 */

/** Tipo de trazo: decide qué de los 2 `InstancedMesh` de `StreakView` recibe la instancia. SUS VALORES son el índice de malla — cambiarlos exige revisar `StreakView.tsx` a la vez (mismo criterio que `WAX_TYPE_*` en wax.ts). */
export const STREAK_TYPE_FROST = 0;
export const STREAK_TYPE_ARCANE = 1;
export type StreakType = typeof STREAK_TYPE_FROST | typeof STREAK_TYPE_ARCANE;
/** Nº de tipos distintos — `StreakView` monta exactamente este número de `InstancedMesh`. */
export const STREAK_TYPE_COUNT = 2;

/**
 * Capacidad del ring buffer: cada disparo del héroe abre 1 trazo (nace) + 1
 * más por cada rebote de hechizo (`SPELL_WALL_BOUNCES` = 1 de base, sube con
 * la mejora "spellBounceBonus"; la flecha nunca rebota). Con los cooldowns de
 * armas (flecha 0.5 s, hechizo 1 s) y el multidisparo en abanico
 * (docs/plans/ECONOMY_PLAN.md F2, hasta varios proyectiles por disparo), unos
 * cientos de trazos cubren de sobra varios minutos de combate continuo en una
 * mazmorra — sobra margen amplio. `Float32Array`/`Uint8Array`: coste de
 * memoria despreciable incluso mucho más alto (mismo razonamiento ya aceptado
 * para `WAX_POOL_CAPACITY=5000`, ver wax.ts).
 */
export const STREAK_POOL_CAPACITY = 1500;

/** Rango de variación del ancho pedido a `open()` (variedad, feedback de David: "unos más largos, otros más cortos"): [0.75, 1.25) del ancho base. */
const STREAK_WIDTH_FACTOR_MIN = 0.75;
const STREAK_WIDTH_FACTOR_RANGE = 0.5;

export class StreakPool {
  readonly capacity: number;
  /** Punto medio del tramo (mundo). */
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** Ángulo del tramo en el plano XZ, convención lista para `StreakView` (ver cabecera). */
  readonly angle: Float32Array;
  /** Longitud del tramo (u de mundo); 0 justo tras `open()`, antes del primer `update()`. */
  readonly length: Float32Array;
  /** Ancho del trazo (u de mundo), ya con la variación de `open()` aplicada. */
  readonly width: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  /** Tipo de trazo (`STREAK_TYPE_*`), ver cabecera del módulo. */
  readonly type: Uint8Array;
  /**
   * Espejo aleatorio (0/1, ver cabecera del módulo/feedback de David:
   * "espeja el trazo al azar"), fijado UNA vez en `open()` y constante durante
   * toda la vida del trazo (si cambiara en cada `update()` parpadearía). El
   * ÁNGULO real del tramo (`angle`, arriba) nunca se altera por esto: girar
   * 180° alrededor de la normal del quad ya tumbado (que en esta convención
   * de rotación es sumar π al mismo componente Z que lleva `angle`, ver
   * `StreakView.tsx`) es un espejo barato sin tocar la dirección geométrica
   * real del tramo.
   */
  readonly mirror: Uint8Array;

  /** Próximo índice a escribir (ring buffer: da la vuelta y recicla el más antiguo). */
  cursor = 0;
  /** Nº de slots usados alguna vez, saturado en `capacity`. */
  count = 0;
  /** Nº total de escrituras (open + update) desde que existe el pool; nunca se resetea, ni en `clear()`. La vista lo usa para detectar cuántos slots nuevos hay que subir a la GPU. */
  version = 0;
  /** Incrementado SOLO en `clear()`: distingue "hay trazos nuevos/actualizados" de "el pool se vació" (barrido completo en la vista). */
  epoch = 0;

  constructor(capacity = STREAK_POOL_CAPACITY) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.angle = new Float32Array(capacity);
    this.length = new Float32Array(capacity);
    this.width = new Float32Array(capacity);
    this.r = new Float32Array(capacity);
    this.g = new Float32Array(capacity);
    this.b = new Float32Array(capacity);
    this.type = new Uint8Array(capacity);
    this.mirror = new Uint8Array(capacity);
  }

  /**
   * Abre un trazo nuevo en `(x, z)` con longitud 0 (nace ahí, se estira con
   * `update()`). Recicla el slot más antiguo si el buffer está lleno.
   * Devuelve el índice escrito — el llamador debe guardarlo (junto con el
   * origen `x, z`, que este pool no conserva, ver cabecera) para poder llamar
   * a `update()` sobre el mismo slot mientras el tramo esté vivo.
   *
   * `rng` decide el ancho dentro del rango de variación y el espejo —
   * inyectable para tests deterministas, `Math.random` de default (mismo
   * contrato que `WaxPool.emit`).
   */
  open(
    x: number,
    z: number,
    width: number,
    r: number,
    g: number,
    b: number,
    type: StreakType,
    rng: () => number = Math.random,
  ): number {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.x[idx] = x;
    this.z[idx] = z;
    this.angle[idx] = 0;
    this.length[idx] = 0;
    this.width[idx] = width * (STREAK_WIDTH_FACTOR_MIN + rng() * STREAK_WIDTH_FACTOR_RANGE);
    this.r[idx] = r;
    this.g[idx] = g;
    this.b[idx] = b;
    this.type[idx] = type;
    this.mirror[idx] = rng() < 0.5 ? 1 : 0;
    if (this.count < this.capacity) this.count++;
    this.version++;
    return idx;
  }

  /**
   * Reestira el trazo `idx` (abierto con `open()`) desde su origen fijo
   * `(originX, originZ)` — conservado por el LLAMADOR, ver cabecera — hasta
   * la posición actual `(curX, curZ)`. Recalcula punto medio/longitud/ángulo
   * sobre la MISMA instancia (no consume un slot nuevo del ring buffer). Sin
   * efecto sobre `angle` si el tramo mide ~0 todavía (evita un ángulo
   * indefinido por `atan2(0,0)` en el primer frame tras `open()`, cuando el
   * proyectil aún no se ha movido de su origen); `length` sí se actualiza
   * siempre (a 0 en ese caso, que es correcto: nada que dibujar todavía).
   */
  update(idx: number, originX: number, originZ: number, curX: number, curZ: number): void {
    const dx = curX - originX;
    const dz = curZ - originZ;
    const len = Math.hypot(dx, dz);
    this.x[idx] = (originX + curX) / 2;
    this.z[idx] = (originZ + curZ) / 2;
    this.length[idx] = len;
    if (len > 1e-4) this.angle[idx] = Math.atan2(-dz, dx);
    this.version++;
  }

  /** Vacía la capa (mismos puntos del ciclo de vida que `WaxPool.clear()`: reinicio de run / cambio de mazmorra — nunca al cambiar de sala dentro de la misma mazmorra). */
  clear(): void {
    this.cursor = 0;
    this.count = 0;
    this.epoch++;
  }
}
