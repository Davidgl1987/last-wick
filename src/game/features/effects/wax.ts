/**
 * Capa de rastro PERSISTENTE (rama `estilo-oscuro`, playtest ronda 7, David:
 * "la cera que deja de rastro se va haciendo pequeña... la cera no se hace
 * pequeña, como mucho que desaparezca poco a poco, pero tampoco debería...
 * hay que dejar un rastro de todos los movimientos que ha hecho"):
 * a diferencia de `TrailPool` (estela de vida corta, cadencia por TIEMPO,
 * solo mientras el héroe va rápido), este pool es un ring buffer GRANDE de
 * puntos SIN vida/decay — un punto depositado permanece para siempre, tal
 * cual se depositó (mismo tamaño, mismo color, misma rotación, mismo tipo),
 * hasta que el buffer se llena y el más antiguo se recicla para dejar sitio
 * al nuevo. Emisión por DISTANCIA recorrida (no por tiempo, ver
 * HeroView.tsx/ProjectileView.tsx): el rastro queda uniforme sea cual sea la
 * velocidad del héroe, en vez de "solo cuando corre" como la estela clásica.
 *
 * Cero three.js aquí (mismo criterio que TrailPool/ParticlePool): datos +
 * lógica de depósito/reciclaje puros, testeables sin infraestructura de
 * render 3D. `WaxView.tsx` es el único consumidor.
 *
 * ── Cúmulo por depósito (feedback de David, ronda VFX post-T1: "la cera
 * sigue viéndose como pegatinas... debería verse [...] con formas un poco
 * más irregulares [...] quizá quede mejor soltar círculos de distintos
 * tamaños y un poco desplazados hacia los lados") ─────────────────────────
 * Antes (T1) `emit()` escribía UN slot con una rotación aleatoria (pensada
 * para un quad de splat). Ahora cada `emit()` deposita un CÚMULO de 2 o 3
 * discos: tamaños distintos (0.6×-1.1× del tamaño pedido) y desplazados
 * lateralmente del punto de emisión (hasta la mitad del tamaño pedido, en
 * dirección aleatoria) — el conjunto se lee como una salpicadura irregular
 * en vez de una fila de lunares idénticos. `rot` se conserva por si acaso
 * (no aporta nada a un disco liso, pero SÍ orienta al azar el cristal de
 * escarcha de `WaxView`, ver más abajo) — se sigue generando dentro de
 * `emit()` con el mismo `rng: () => number = Math.random` inyectable que ya
 * usaba T1 y que usa `ParticlePool.burst`.
 *
 * `WAX_POOL_CAPACITY` sube de 2000 a 5000 (×2.5) porque cada `emit()` ahora
 * consume 2-3 slots (media 2.5) en vez de 1: sin subirla, el rastro
 * conservaría muchos MENOS pasos de historia que antes (se reciclaría 2.5×
 * más rápido). Siguen siendo `Float32Array`/`Uint8Array` — coste de memoria
 * despreciable incluso a 5000.
 *
 * ── Tipo por depósito (Problema 2: "cada arma deja su propio rastro") ─────
 * `type` (`Uint8Array`, valores `WAX_TYPE_*` de abajo) dice a `WaxView` qué
 * geometría/material usar: cera (disco liso Lambert), escarcha (cristal de
 * hielo) o arcano (runa). Lo decide el LLAMADOR (HeroView según
 * `hero.weaponMode`, ProjectileView según `p.kind`) — este módulo solo lo
 * transporta, igual que ya transporta color. `emit()` sella el MISMO tipo en
 * los 2-3 discos de un cúmulo (un solo depósito no mezcla tipos).
 */

export const WAX_POOL_CAPACITY = 5000;

/** Cadencia de depósito del héroe: un punto cada ~0.3-0.4 u recorridas (rastro uniforme de TODOS sus movimientos, sin umbral de velocidad). */
export const HERO_WAX_EMIT_DISTANCE = 0.35;
/** Cadencia de depósito de los proyectiles del héroe: algo más espaciada (van más rápido, un punto cada ~0.5 u ya deja un rastro denso). */
export const PROJECTILE_WAX_EMIT_DISTANCE = 0.5;

/**
 * Tipo de depósito: decide qué de los 3 `InstancedMesh` de `WaxView` recibe
 * la instancia. Constantes numéricas (no un `enum` de TS: consistente con el
 * resto del módulo, que guarda todo en arrays tipados) — SUS VALORES son el
 * índice usado por `WaxView` para elegir malla, así que no son arbitrarios:
 * cambiarlos exige revisar `WaxView.tsx` a la vez.
 */
export const WAX_TYPE_WAX = 0;
export const WAX_TYPE_FROST = 1;
export const WAX_TYPE_ARCANE = 2;
export type WaxType = typeof WAX_TYPE_WAX | typeof WAX_TYPE_FROST | typeof WAX_TYPE_ARCANE;
/** Nº de tipos distintos — `WaxView` monta exactamente este número de `InstancedMesh`. */
export const WAX_TYPE_COUNT = 3;

/** Cuántos discos deposita como mínimo/máximo un único `emit()` (cúmulo irregular, ver cabecera). */
const WAX_CLUSTER_MIN_BLOBS = 2;
const WAX_CLUSTER_MAX_BLOBS = 3;
/** Rango del factor de tamaño de cada disco del cúmulo respecto al tamaño pedido a `emit()`: [0.6, 1.1). */
const WAX_CLUSTER_SIZE_FACTOR_MIN = 0.6;
const WAX_CLUSTER_SIZE_FACTOR_RANGE = 0.5;
/** Desplazamiento lateral máximo (en cada eje) de un disco respecto al punto de emisión, como fracción del tamaño pedido: "del orden de medio radio". */
const WAX_CLUSTER_OFFSET_FACTOR = 0.5;

export class WaxPool {
  readonly capacity: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly size: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  /** Rotación del disco alrededor de su propio eje (radianes, [0, 2π)), generada dentro de `emit()`. Sin efecto visual en el disco liso de cera; orienta al azar el cristal de escarcha (ver WaxView.tsx). */
  readonly rot: Float32Array;
  /** Tipo de depósito (`WAX_TYPE_*`), ver cabecera del módulo. */
  readonly type: Uint8Array;
  /** Próximo índice a escribir (ring buffer: da la vuelta y recicla el más antiguo). */
  cursor = 0;
  /** Nº de slots usados alguna vez, saturado en `capacity` (dice a la vista cuántas instancias hay que mostrar antes de que el buffer haya dado una vuelta completa). */
  count = 0;
  /** Nº total de slots depositados desde que existe el pool (nunca se resetea, ni en `clear`): la vista lo usa para detectar cuántos slots nuevos hay que subir a la GPU. Un `emit()` lo incrementa 2-3 veces (uno por disco del cúmulo), no 1. */
  version = 0;
  /** Incrementado SOLO en `clear()`: la vista lo usa para distinguir "se depositaron puntos nuevos" de "el pool se vació" (que exige ocultar TODAS las instancias, no solo actualizar las nuevas). */
  epoch = 0;

  constructor(capacity = WAX_POOL_CAPACITY) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.r = new Float32Array(capacity);
    this.g = new Float32Array(capacity);
    this.b = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.type = new Uint8Array(capacity);
  }

  /** Escribe UN slot del ring buffer (un disco del cúmulo de `emit()`). Recicla el más antiguo si el buffer está lleno. Devuelve el índice escrito. */
  private depositOne(x: number, z: number, size: number, r: number, g: number, b: number, type: WaxType, rot: number): number {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.x[idx] = x;
    this.z[idx] = z;
    this.size[idx] = size;
    this.r[idx] = r;
    this.g[idx] = g;
    this.b[idx] = b;
    this.rot[idx] = rot;
    this.type[idx] = type;
    if (this.count < this.capacity) this.count++;
    this.version++;
    return idx;
  }

  /**
   * Deposita un CÚMULO de 2-3 discos alrededor de `(x, z)` (ver cabecera del
   * módulo): mismo `type`/color para todo el cúmulo, tamaño y desplazamiento
   * lateral distintos por disco. Sin valor de retorno a propósito — ningún
   * llamador real (HeroView.tsx/ProjectileView.tsx) usa el índice escrito, y
   * devolver un array aquí sería una asignación por llamada dentro de un
   * `useFrame` (ver AGENTS.md: cero asignaciones por frame); los tests
   * verifican el resultado leyendo `pool.cursor`/`pool.x`/etc. directamente.
   *
   * `rng` genera blobCount + (desplazamiento X, desplazamiento Z, factor de
   * tamaño, rotación) por cada disco, en ese orden — inyectable para tests
   * deterministas, con `Math.random` de default para que los llamadores
   * reales no tengan que pasarlo ni tocarse.
   */
  emit(x: number, z: number, size: number, r: number, g: number, b: number, type: WaxType, rng: () => number = Math.random): void {
    const blobCount = rng() < 0.5 ? WAX_CLUSTER_MIN_BLOBS : WAX_CLUSTER_MAX_BLOBS;
    const offsetRange = size * WAX_CLUSTER_OFFSET_FACTOR;
    for (let i = 0; i < blobCount; i++) {
      const dx = (rng() * 2 - 1) * offsetRange;
      const dz = (rng() * 2 - 1) * offsetRange;
      const sizeFactor = WAX_CLUSTER_SIZE_FACTOR_MIN + rng() * WAX_CLUSTER_SIZE_FACTOR_RANGE;
      const rot = rng() * Math.PI * 2;
      this.depositOne(x + dx, z + dz, size * sizeFactor, r, g, b, type, rot);
    }
  }

  /** Vacía la capa (reinicio de run / cambio de mazmorra — NUNCA al cambiar de sala dentro de la misma mazmorra, ver session.ts). */
  clear(): void {
    this.cursor = 0;
    this.count = 0;
    this.epoch++;
  }
}
