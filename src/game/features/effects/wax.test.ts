/**
 * Tests headless de la capa de rastro persistente (WaxPool, ring buffer SIN
 * vida/decay — un punto depositado permanece tal cual hasta que el buffer se
 * llena y el más antiguo se recicla). Sin three.js (mismo criterio que
 * particles.test.ts).
 *
 * Cubre el cúmulo de `emit()` (2-3 discos por llamada, tamaño/desplazamiento
 * distintos) y el campo `type` nuevos — `emit()` ya NO escribe un único slot
 * por llamada, así que los tests que antes asumían "1 emit = 1 índice" se
 * han reescrito para el cúmulo. La mayoría de tests fijan `rng` a una
 * CONSTANTE (p. ej. `() => 0.5`): como el algoritmo consume `rng()` un
 * número de veces variable (1 + 4 por disco), una constante hace que
 * CUALQUIER número de llamadas devuelva el mismo valor, así que el resultado
 * es exacto y fácil de verificar a mano sin tener que contar invocaciones.
 */

import { describe, expect, it } from 'vitest';
import { WAX_POOL_CAPACITY, WAX_TYPE_ARCANE, WAX_TYPE_COUNT, WAX_TYPE_FROST, WAX_TYPE_WAX, WaxPool } from './wax';

describe('WaxPool', () => {
  it('el tamaño por defecto es el del presupuesto nuevo (~5000, ×2.5 sobre el anterior por el cúmulo de 2-3 discos/emit)', () => {
    const pool = new WaxPool();
    expect(pool.capacity).toBe(WAX_POOL_CAPACITY);
    expect(WAX_POOL_CAPACITY).toBe(5000);
  });

  it('constantes de tipo: valores estables (WaxView los usa como índice de malla, no pueden cambiar sin revisar ese fichero)', () => {
    expect(WAX_TYPE_WAX).toBe(0);
    expect(WAX_TYPE_FROST).toBe(1);
    expect(WAX_TYPE_ARCANE).toBe(2);
    expect(WAX_TYPE_COUNT).toBe(3);
  });

  it('el pool no crece: los arrays mantienen su capacidad aunque se depositen muchos más discos que slots', () => {
    const pool = new WaxPool(20);
    for (let i = 0; i < 50; i++) pool.emit(i, i, 0.5, 1, 1, 1, WAX_TYPE_WAX);
    expect(pool.capacity).toBe(20);
    expect(pool.x.length).toBe(20);
    expect(pool.type.length).toBe(20);
    expect(pool.count).toBe(20); // saturado, nunca por encima de capacity aunque cada emit() escriba 2-3 slots
  });

  it('los discos NO tienen vida: emitir un cúmulo y no volver a tocarlo deja sus datos intactos indefinidamente (no hay update())', () => {
    const pool = new WaxPool(8);
    pool.emit(3, 4, 0.7, 0.1, 0.2, 0.3, WAX_TYPE_WAX, () => 0.5); // rng=0.5 constante → 3 discos, sin desplazamiento (ver test de fórmula exacta más abajo)
    expect((pool as unknown as { update?: unknown }).update).toBeUndefined();
    expect(pool.x[0]).toBeCloseTo(3);
    expect(pool.z[0]).toBeCloseTo(4);
    expect(pool.size[0]).toBeCloseTo(0.7 * 0.85); // 0.6 + 0.5·0.5 = 0.85 (factor de tamaño con rng constante 0.5)
  });

  it('emit() ya NO escribe un único slot: con rng=0.5 constante deposita SIEMPRE 3 discos (0.5 no es < 0.5)', () => {
    const pool = new WaxPool(32);
    const cursorBefore = pool.cursor;
    pool.emit(0, 0, 1, 1, 1, 1, WAX_TYPE_WAX, () => 0.5);
    expect(pool.cursor - cursorBefore).toBe(3);
    expect(pool.version).toBe(3);
    expect(pool.count).toBe(3);
  });

  it('emit() con rng=0.1 constante (< 0.5) deposita SIEMPRE 2 discos', () => {
    const pool = new WaxPool(32);
    const cursorBefore = pool.cursor;
    pool.emit(0, 0, 1, 1, 1, 1, WAX_TYPE_FROST, () => 0.1);
    expect(pool.cursor - cursorBefore).toBe(2);
    expect(pool.version).toBe(2);
  });

  it('fórmula exacta del cúmulo con rng=0.5 constante: sin desplazamiento lateral (0.5 es el centro del rango [-1,1)·offsetRange), tamaño ×0.85, rot=π', () => {
    const pool = new WaxPool(32);
    pool.emit(10, 20, 2, 1, 0, 0, WAX_TYPE_ARCANE, () => 0.5);
    // blobCount = 3 (0.5 no es < 0.5). offsetRange = size·0.5 = 1. dx = dz = (0.5·2-1)·1 = 0.
    for (let i = 0; i < 3; i++) {
      expect(pool.x[i]).toBeCloseTo(10);
      expect(pool.z[i]).toBeCloseTo(20);
      expect(pool.size[i]).toBeCloseTo(2 * 0.85); // 1.7
      expect(pool.rot[i]).toBeCloseTo(Math.PI); // 0.5 · 2π
      expect(pool.type[i]).toBe(WAX_TYPE_ARCANE);
    }
  });

  it('fórmula exacta del cúmulo con rng=0.1 constante: desplazamiento lateral negativo, tamaño ×0.65', () => {
    const pool = new WaxPool(32);
    pool.emit(10, 20, 2, 1, 0, 0, WAX_TYPE_FROST, () => 0.1);
    // blobCount = 2 (0.1 < 0.5). offsetRange = size·0.5 = 1. dx = dz = (0.1·2-1)·1 = -0.8.
    for (let i = 0; i < 2; i++) {
      expect(pool.x[i]).toBeCloseTo(10 - 0.8);
      expect(pool.z[i]).toBeCloseTo(20 - 0.8);
      expect(pool.size[i]).toBeCloseTo(2 * 0.65); // 1.3
      expect(pool.rot[i]).toBeCloseTo(0.1 * Math.PI * 2);
    }
  });

  it('type: TODOS los discos de un mismo cúmulo comparten el tipo pasado a emit() (un depósito no mezcla tipos)', () => {
    const pool = new WaxPool(32);
    const cursorBefore = pool.cursor;
    pool.emit(0, 0, 1, 1, 1, 1, WAX_TYPE_FROST, () => 0.9); // 0.9 no es < 0.5 → 3 discos
    const written = pool.cursor - cursorBefore;
    expect(written).toBe(3);
    for (let i = cursorBefore; i < pool.cursor; i++) {
      expect(pool.type[i]).toBe(WAX_TYPE_FROST);
    }
  });

  it('tamaño de cada disco del cúmulo dentro de [0.6, 1.1) del tamaño pedido, con rng real (muchos ensayos)', () => {
    const pool = new WaxPool(4096);
    const requested = 1.4;
    for (let trial = 0; trial < 300; trial++) {
      pool.emit(0, 0, requested, 1, 1, 1, WAX_TYPE_WAX);
    }
    for (let i = 0; i < pool.count; i++) {
      expect(pool.size[i]).toBeGreaterThanOrEqual(requested * 0.6 - 1e-9);
      expect(pool.size[i]).toBeLessThan(requested * 1.1 + 1e-9);
    }
  });

  it('desplazamiento lateral de cada disco acotado a ±medio tamaño pedido respecto al punto de emisión, con rng real (muchos ensayos)', () => {
    const pool = new WaxPool(4096);
    const size = 2;
    const emitX = 5;
    const emitZ = -3;
    for (let trial = 0; trial < 300; trial++) {
      pool.emit(emitX, emitZ, size, 1, 1, 1, WAX_TYPE_WAX);
    }
    const maxOffset = size * 0.5;
    for (let i = 0; i < pool.count; i++) {
      expect(Math.abs(pool.x[i] - emitX)).toBeLessThanOrEqual(maxOffset + 1e-9);
      expect(Math.abs(pool.z[i] - emitZ)).toBeLessThanOrEqual(maxOffset + 1e-9);
    }
  });

  it('reciclaje del más antiguo CON cúmulo que da la vuelta A MITAD (ring buffer pequeño, blobCount fijo a 3 vía rng=0.5)', () => {
    const pool = new WaxPool(4);
    pool.emit(1, 1, 2, 1, 0, 0, WAX_TYPE_WAX, () => 0.5); // 3 discos sin offset (ver fórmula exacta): idx 0,1,2 = (1,1)
    expect(pool.cursor).toBe(3);
    pool.emit(9, 9, 2, 0, 1, 0, WAX_TYPE_FROST, () => 0.5); // 3 discos más, sin offset: idx 3,0,1 = (9,9) — da la vuelta A MITAD del cúmulo
    expect(pool.cursor).toBe(2); // (3 + 3) % 4

    expect(pool.x[3]).toBeCloseTo(9); // 1er disco del 2º emit
    expect(pool.x[0]).toBeCloseTo(9); // 2º disco del 2º emit: recicla el idx 0 del 1er emit
    expect(pool.x[1]).toBeCloseTo(9); // 3er disco del 2º emit: recicla el idx 1 del 1er emit
    expect(pool.x[2]).toBeCloseTo(1); // idx 2 NO lo toca el 2º emit (solo escribió 3 de los 4 slots): sigue siendo del 1er emit
    expect(pool.type[2]).toBe(WAX_TYPE_WAX);
    expect(pool.type[3]).toBe(WAX_TYPE_FROST);
  });

  it('count satura en capacity aunque cada emit() deposite varios discos', () => {
    const pool = new WaxPool(5);
    for (let i = 0; i < 10; i++) pool.emit(i, i, 1, 1, 1, 1, WAX_TYPE_WAX, () => 0.5); // 3 discos/llamada
    expect(pool.count).toBe(5);
    expect(pool.x.length).toBe(5);
  });

  it('version se incrementa UNA VEZ POR DISCO (no por llamada a emit): un cúmulo de 3 sube version en 3, nunca en clear()', () => {
    const pool = new WaxPool(32);
    expect(pool.version).toBe(0);
    pool.emit(0, 0, 1, 1, 1, 1, WAX_TYPE_WAX, () => 0.5); // 3 discos
    expect(pool.version).toBe(3);
    pool.emit(0, 0, 1, 1, 1, 1, WAX_TYPE_WAX, () => 0.1); // 2 discos
    expect(pool.version).toBe(5);
    pool.clear();
    expect(pool.version).toBe(5); // clear() no toca version (es acumulado, no un contador de "activos")
  });

  it('clear() reinicia cursor/count a 0 e incrementa epoch (reinicio de run/mazmorra), pero preserva version', () => {
    const pool = new WaxPool(8);
    pool.emit(1, 1, 1, 1, 1, 1, WAX_TYPE_WAX, () => 0.5); // 3 discos
    expect(pool.count).toBe(3);
    expect(pool.epoch).toBe(0);

    pool.clear();
    expect(pool.cursor).toBe(0);
    expect(pool.count).toBe(0);
    expect(pool.epoch).toBe(1);

    // Tras clear(), el ring buffer vuelve a escribir desde el índice 0 (como recién creado).
    const cursorBefore = pool.cursor;
    pool.emit(9, 9, 1, 1, 1, 1, WAX_TYPE_ARCANE, () => 0.1); // 2 discos
    expect(cursorBefore).toBe(0);
    // offsetRange = size·0.5 = 0.5; dx = (0.1·2-1)·offsetRange = -0.8·0.5 = -0.4.
    expect(pool.x[0]).toBeCloseTo(9 - 0.4);
    expect(pool.count).toBe(2);
  });

  it('rot: los discos de un mismo cúmulo llevan rotaciones DISTINTAS entre sí con rng real (no todos el mismo ángulo)', () => {
    const pool = new WaxPool(32);
    pool.emit(0, 0, 1, 1, 1, 1, WAX_TYPE_FROST); // rng real (Math.random): 2 o 3 discos
    const written = pool.cursor;
    expect(written).toBeGreaterThanOrEqual(2);
    const rotations = new Set<number>();
    for (let i = 0; i < written; i++) rotations.add(pool.rot[i]);
    expect(rotations.size).toBeGreaterThan(1); // probabilidad de colisión exacta con Math.random es prácticamente nula
  });

  it('rot dentro de [0, 2π) con rng real, sin importar el tipo', () => {
    const pool = new WaxPool(64);
    pool.emit(0, 0, 1, 1, 1, 1, WAX_TYPE_WAX);
    for (let i = 0; i < pool.count; i++) {
      expect(pool.rot[i]).toBeGreaterThanOrEqual(0);
      expect(pool.rot[i]).toBeLessThan(Math.PI * 2);
    }
  });

  it('sin rng explícito usa Math.random por defecto: mismo contrato que HeroView.tsx/ProjectileView.tsx, que llaman a emit() con 7 argumentos (sin rng)', () => {
    const pool = new WaxPool(16);
    pool.emit(0, 0, 1, 1, 1, 1, WAX_TYPE_WAX); // firma corta (con type, sin rng), igual que los llamadores reales
    expect(pool.count).toBeGreaterThanOrEqual(2);
    expect(pool.count).toBeLessThanOrEqual(3);
    for (let i = 0; i < pool.count; i++) {
      expect(pool.type[i]).toBe(WAX_TYPE_WAX);
    }
  });

  it('clear() no arrastra el tipo de la run anterior: tras clear(), el próximo emit() sobrescribe el tipo del slot 0', () => {
    const pool = new WaxPool(8);
    pool.emit(1, 1, 1, 1, 1, 1, WAX_TYPE_ARCANE, () => 0.5);
    expect(pool.type[0]).toBe(WAX_TYPE_ARCANE);

    pool.clear();
    pool.emit(9, 9, 1, 1, 1, 1, WAX_TYPE_WAX, () => 0.5);
    expect(pool.type[0]).toBe(WAX_TYPE_WAX);
  });
});
