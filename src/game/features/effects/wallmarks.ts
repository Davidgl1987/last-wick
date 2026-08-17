/**
 * Marcas de impacto en muro (encargo de David: "añade una marca en la pared
 * donde impacten los proyectiles" — escarcha del arma Hielo, chispazo arcano
 * del Hechizo): pool NUEVO e independiente de `streaks.ts` (rastro EN EL
 * SUELO, recién hecho — ver su cabecera para el patrón general). Mismo
 * espíritu: ring buffer preasignado, PERSISTENTE (sin vida/decay, una marca
 * se queda tal cual hasta que el buffer recicla su slot o hay un `clear()`),
 * `version`/`epoch` para que la vista suba a GPU solo lo que cambió. Cero
 * three.js aquí (mismo criterio que streaks.ts/wax.ts/shockwave.ts): datos +
 * lógica puros, testeables sin infraestructura de render 3D.
 * `WallMarkView.tsx` es el único consumidor.
 *
 * Diferencia real con `streaks.ts`: una marca de muro es un DECAL PUNTUAL
 * (posición 3D + orientación), no un tramo con longitud — por eso el ciclo de
 * vida es un único `spawn()` (mismo contrato que `WaxPool.emit()`/
 * `FlashPool.spawn()`), no el open()/update() de dos fases de `StreakPool`.
 * También necesita altura Y de verdad (la del proyectil al impactar,
 * constante — el juego es 2D, sin relieve vertical) en vez del Y fijo casi a
 * ras de suelo de streaks/wax, y un YAW (rotación en Y) que orienta el quad
 * VERTICAL hacia la normal del muro, en vez de un ángulo en el plano XZ para
 * un quad tumbado.
 *
 * ── Cómo se decide "esto es un impacto de muro" (y de dónde sale la normal) ──
 * El diseño sugerido para esta tarea era leer la velocidad antes/después del
 * rebote en `ProjectileView.tsx` (mismo sitio que ya detecta el rebote
 * comparando `Projectile.bouncesLeft` entre frames para cerrar/abrir
 * trazos) y sacar la normal del eje que cambia de signo. Eso funciona bien
 * para el REBOTE (el hechizo con `bouncesLeft` > 0: la velocidad "después" es
 * real, no cero), pero se rompe para el IMPACTO FINAL (flecha siempre, o el
 * último rebote del hechizo): ahí `deactivateProjectile` deja `p.velocity`
 * en (0,0) ANTES de que el render vuelva a leer el proyectil (el tick de sim
 * que mata el proyectil se ejecuta entero antes de que useFrame observe nada
 * — nunca hay un frame con velocidad "recién reflejada pero aún no puesta a
 * cero"), así que no hay componente que comparar.
 *
 * Peor: un proyectil del héroe también se desactiva SIN tocar ningún muro —
 * al golpear un enemigo (combat.ts), al detonar un barril (hazards.ts) o al
 * agotar su TTL (combat.ts) — y las tres rutas dejan `p.active=false` y
 * `p.velocity=(0,0)` de forma indistinguible desde fuera. Inferir "murió
 * contra un muro" solo por esa transición (con o sin velocidad) habría sido
 * un FALSO POSITIVO constante: la razón más común para que un proyectil del
 * héroe muera es que acierte a un enemigo, así que las marcas habrían
 * aparecido flotando en mitad de la sala cada vez que el jugador acierta un
 * disparo — justo el defecto que `AGENTS.md`/el encargo piden evitar ("la
 * marca no debe aparecer flotando en el aire").
 *
 * `wallNormalAt()` evita el problema por construcción: en vez de INFERIR el
 * impacto desde el historial de velocidad, COMPRUEBA la geometría real en la
 * posición de impacto — mismo método del punto más cercano que
 * `collideCircleAabb`/`collideInnerBounds` (engine/physics.ts) pero de SOLO
 * LECTURA (sin mutar posición/velocidad ni emitir eventos: la física de esta
 * colisión ya la resolvió combat.ts ese mismo tick, `p.position` llega EMPUJADA
 * exactamente a la superficie tocada, tanto si el proyectil sigue vivo
 * -rebote- como si no -impacto final-). Si no hay ninguna superficie a
 * distancia `radius` del punto, sencillamente no era un muro, y no sale
 * marca — funciona igual de bien para el rebote que para el impacto final,
 * sin necesitar ninguna de las dos velocidades, y no se ve afectado por
 * futuras formas nuevas de desactivar un proyectil (no depende de conocer
 * la lista completa de "causas de muerte que NO son un muro").
 *
 * ── Obstáculos CON VOLUMEN (rocas y otros props sólidos) ────────────────────
 * `wallNormalAt()` recibe `world.obstacles` (no solo los segmentos de muro):
 * ese array YA incluye las rocas de la sala — `Obstacle` (world/types.ts) es
 * "un segmento de muro/puerta cerrada O una roca", indistinguibles aquí a
 * propósito (misma resolución AABB del punto más cercano para ambos, ver
 * `buildRoomEntities` en world/create.ts, que convierte cada hazard
 * `kind: 'rock'` en un `Obstacle` con su AABB). Es la MISMA lista que usa
 * `stepHeroProjectileCollisions` (combat.ts) para resolver la colisión real,
 * así que una roca golpeada ya se resuelve aquí sin cambios adicionales
 * (verificado: impacto recto y en esquina contra un `Obstacle` no-muro dan la
 * normal correcta, mismos tests que un segmento de muro).
 *
 * Lo que SÍ queda fuera de `world.obstacles` — a propósito — son los
 * BARRILES (`world.barrels`, `Barrel` en world/types.ts): un barril no es un
 * `Obstacle` estático, es una entidad que EXPLOTA y desaparece
 * (`HazardView.tsx`: `group.visible = !barrel.exploded`, sin restos con
 * volumen). Un proyectil detenido por un barril (`stepBarrels`, hazards.ts)
 * no debe dejar marca: si se dejara caer al criterio normal de
 * `wallNormalAt` (que no sabe de barriles), buscaría la superficie sólida
 * MÁS CERCANA a esa posición — con frecuencia ninguna, pero si el barril
 * estaba cerca de una roca o de la pared exterior, generaría una marca ahí,
 * a veces a distancia notable del barril real y siempre en una superficie
 * que no fue la que realmente recibió el golpe. `touchesExplodedBarrel()`
 * cierra ese hueco por construcción (mismo espíritu que `wallNormalAt`:
 * comprobación geométrica directa, no inferencia por causa de muerte) —
 * `spawnWallMarkForImpact` (ProjectileView.tsx) la consulta ANTES de
 * `wallNormalAt` y corta ahí: mejor ninguna marca que una marca flotando
 * donde ya no queda ningún volumen.
 */

import type { AABB, Vec2 } from '@/engine/geometry';

/** Tipo de marca: decide qué de los 2 `InstancedMesh` de `WallMarkView` recibe la instancia. SUS VALORES son el índice de malla — cambiarlos exige revisar `WallMarkView.tsx` a la vez (mismo criterio que `STREAK_TYPE_*` en streaks.ts). */
export const WALL_MARK_TYPE_FROST = 0;
export const WALL_MARK_TYPE_ARCANE = 1;
export type WallMarkType = typeof WALL_MARK_TYPE_FROST | typeof WALL_MARK_TYPE_ARCANE;
/** Nº de tipos distintos — `WallMarkView` monta exactamente este número de `InstancedMesh`. */
export const WALL_MARK_TYPE_COUNT = 2;

/** ~64 marcas (encargo de David): de sobra para varios combates seguidos pegado a un muro sin que el reciclaje del ring buffer se note — rara vez hay más de un puñado de marcas visibles a la vez en una sala. */
export const WALL_MARK_POOL_CAPACITY = 64;

/** Rango de tamaño (lado del quad, u de mundo) de cada marca: variedad pedida por el encargo ("tamaño variable"), sin relación con el radio real de colisión (esto es puramente decorativo, a diferencia de p.ej. un fogonazo). */
const WALL_MARK_SIZE_MIN = 0.45;
const WALL_MARK_SIZE_RANGE = 0.35;

export class WallMarkPool {
  readonly capacity: number;
  /** Posición 3D del impacto (mundo): a diferencia de streaks/wax, aquí SÍ importa la altura Y real (la del proyectil al impactar), no un valor casi-a-ras-de-suelo fijo. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Yaw (rotación en Y) que orienta el quad vertical hacia la normal del muro: `atan2(normalX, normalZ)`, misma convención "ángulo de cara" que ya usa el resto del render (p.ej. `ProjectileSlot`: `group.rotation.y = atan2(vx, vz)`). Ver `WallMarkView.tsx` para cómo se aplica sin sacar el quad de su plano vertical. */
  readonly yaw: Float32Array;
  /** Rotación libre de la marca sobre su propio plano (el encargo, a diferencia del trazo del suelo: "aquí SÍ puede rotarse libremente" — no hay una dirección de vuelo que respetar). Fijada una vez en `spawn()`. */
  readonly roll: Float32Array;
  /** Lado del quad (u de mundo), ya con la variación de `spawn()` aplicada. */
  readonly size: Float32Array;
  /** Tipo de marca (`WALL_MARK_TYPE_*`), ver cabecera del módulo. */
  readonly type: Uint8Array;

  /** Próximo índice a escribir (ring buffer: da la vuelta y recicla el más antiguo). */
  cursor = 0;
  /** Nº de slots usados alguna vez, saturado en `capacity`. */
  count = 0;
  /** Nº total de escrituras desde que existe el pool; nunca se resetea, ni en `clear()`. La vista lo usa para detectar cuántos slots nuevos hay que subir a la GPU. */
  version = 0;
  /** Incrementado SOLO en `clear()`: distingue "hay marcas nuevas" de "el pool se vació" (barrido completo en la vista). */
  epoch = 0;

  constructor(capacity = WALL_MARK_POOL_CAPACITY) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.yaw = new Float32Array(capacity);
    this.roll = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.type = new Uint8Array(capacity);
  }

  /**
   * Deposita una marca en `(x,y,z)` con normal de muro `(normalX, normalZ)`
   * — NO hace falta que venga normalizada: `atan2` es invariante a escala, así
   * que cualquier vector no nulo en la dirección correcta vale. Recicla el
   * slot más antiguo si el pool está lleno. `rng` inyectable para tests
   * deterministas (`Math.random` por defecto, mismo contrato que
   * `StreakPool.open`/`WaxPool.emit`).
   */
  spawn(
    x: number,
    y: number,
    z: number,
    normalX: number,
    normalZ: number,
    type: WallMarkType,
    rng: () => number = Math.random,
  ): number {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.x[idx] = x;
    this.y[idx] = y;
    this.z[idx] = z;
    this.yaw[idx] = Math.atan2(normalX, normalZ);
    this.roll[idx] = rng() * Math.PI * 2;
    this.size[idx] = WALL_MARK_SIZE_MIN + rng() * WALL_MARK_SIZE_RANGE;
    this.type[idx] = type;
    if (this.count < this.capacity) this.count++;
    this.version++;
    return idx;
  }

  /** Vacía la capa (mismos puntos del ciclo de vida que `WaxPool.clear()`/`StreakPool.clear()`: reinicio de run / cambio de mazmorra — nunca al cambiar de sala dentro de la misma mazmorra). */
  clear(): void {
    this.cursor = 0;
    this.count = 0;
    this.epoch++;
  }
}

// ── Normal de muro de solo lectura (ver cabecera del módulo) ───────────────

/** Margen de tolerancia de flotantes: la posición que llega aquí ya viene empujada EXACTA a la superficie por el mismo tick de combat.ts (push-out de `collideCircleAabb`/`collideInnerBounds`); el margen es solo colchón de precisión, muy por debajo de cualquier distancia real muro-enemigo/muro-barril. */
const WALL_TOUCH_EPSILON = 0.05;

/** Subconjunto de `Obstacle` (world/types.ts) que necesita esta función: solo el AABB, para no acoplar este módulo al tipo completo (roomId/id no hacen falta aquí). */
export interface WallObstacleLike {
  readonly aabb: AABB;
}

/**
 * Normal de salida (unitaria, en el plano XZ del suelo) de la superficie
 * sólida que toca el círculo `(x,y,radius)`, o `null` si no toca ninguna.
 *
 * `bounds`: pasa `world.bounds` en modo sala única (`world.dungeon === null`)
 * o `null` en modo mazmorra multi-sala (ahí los muros ya son `obstacles` con
 * hueco de puerta, igual que la comprobación real de `stepHeroProjectileCollisions`
 * en combat.ts — mismo criterio, para que esta función de solo lectura nunca
 * pueda dar un resultado distinto de la colisión que de verdad se resolvió).
 *
 * Los obstáculos se comprueban en el orden recibido y se corta en el primero
 * que toque (igual que combat.ts, que tampoco pondera solapes múltiples).
 */
export function wallNormalAt(
  x: number,
  y: number,
  radius: number,
  obstacles: readonly WallObstacleLike[],
  bounds: AABB | null,
): { x: number; z: number } | null {
  for (let i = 0; i < obstacles.length; i++) {
    const normal = nearestAabbSurfaceNormal(x, y, radius, obstacles[i].aabb);
    if (normal) return normal;
  }
  if (bounds) {
    const normal = innerBoundsSurfaceNormal(x, y, radius, bounds);
    if (normal) return normal;
  }
  return null;
}

/** Método del punto más cercano (mismo que `collideCircleAabb`, engine/physics.ts), de solo lectura: sin push-out, sin mutar velocidad, sin emitir eventos. */
function nearestAabbSurfaceNormal(x: number, y: number, radius: number, box: AABB): { x: number; z: number } | null {
  const nearestX = x < box.minX ? box.minX : x > box.maxX ? box.maxX : x;
  const nearestY = y < box.minY ? box.minY : y > box.maxY ? box.maxY : y;
  const dx = x - nearestX;
  const dy = y - nearestY;
  const dist = Math.hypot(dx, dy);
  if (dist > 1e-6) {
    if (dist > radius + WALL_TOUCH_EPSILON) return null;
    return { x: dx / dist, z: dy / dist };
  }
  // Centro dentro de la caja (degenerado, igual que collideCircleAabb): normal de la cara más próxima.
  const dLeft = x - box.minX;
  const dRight = box.maxX - x;
  const dBottom = y - box.minY;
  const dTop = box.maxY - y;
  const minDist = Math.min(dLeft, dRight, dBottom, dTop);
  if (minDist === dLeft) return { x: -1, z: 0 };
  if (minDist === dRight) return { x: 1, z: 0 };
  if (minDist === dBottom) return { x: 0, z: -1 };
  return { x: 0, z: 1 };
}

/** Mismo método por-eje que `collideInnerBounds` (engine/physics.ts), de solo lectura. */
function innerBoundsSurfaceNormal(x: number, y: number, radius: number, bounds: AABB): { x: number; z: number } | null {
  const minX = bounds.minX + radius;
  const maxX = bounds.maxX - radius;
  const minY = bounds.minY + radius;
  const maxY = bounds.maxY - radius;
  if (x <= minX + WALL_TOUCH_EPSILON) return { x: -1, z: 0 };
  if (x >= maxX - WALL_TOUCH_EPSILON) return { x: 1, z: 0 };
  if (y <= minY + WALL_TOUCH_EPSILON) return { x: 0, z: -1 };
  if (y >= maxY - WALL_TOUCH_EPSILON) return { x: 0, z: 1 };
  return null;
}

// ── Exclusión de barriles (ver cabecera del módulo) ─────────────────────────

/** Subconjunto de `Barrel` (world/types.ts) que necesita `touchesExplodedBarrel`: sin `id`/`roomId`/`landingAt`, que no hacen falta aquí. */
export interface ExplodedBarrelLike {
  readonly position: Vec2;
  readonly radius: number;
  readonly exploded: boolean;
}

/**
 * true si el círculo `(x,y,radius)` toca un barril YA EXPLOTADO de la lista
 * (ver cabecera del módulo: un barril reventado no tiene volumen visual, así
 * que nunca debe recibir marca). Ignora los barriles todavía en pie —
 * `stepBarrels` (hazards.ts) marca `exploded=true` en el MISMO tick en que
 * detona por un proyectil del héroe, así que un proyectil desactivado por un
 * barril siempre lo encuentra ya explotado en este chequeo; un barril intacto
 * simplemente no es la causa de ningún impacto (`stepBarrels` lo habría
 * detonado, no dejado pasar el proyectil de largo).
 *
 * Comparación EXACTA (sin colchón de tolerancia, a diferencia de
 * `WALL_TOUCH_EPSILON`): la posición que llega aquí es la que `stepBarrels`
 * ya usó para decidir el contacto ese mismo tick (mismo `circleTouchesEntity`,
 * sin push-out de por medio que la desplace), así que no hace falta margen de
 * colchón adicional.
 */
export function touchesExplodedBarrel(x: number, y: number, radius: number, barrels: readonly ExplodedBarrelLike[]): boolean {
  for (let i = 0; i < barrels.length; i++) {
    const barrel = barrels[i];
    if (!barrel.exploded) continue;
    const dx = x - barrel.position.x;
    const dy = y - barrel.position.y;
    const rr = radius + barrel.radius;
    if (dx * dx + dy * dy <= rr * rr) return true;
  }
  return false;
}
