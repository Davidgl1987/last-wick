/**
 * Tests headless de `StreakPool` (streaks.ts): sin three.js (mismo criterio
 * que wax.test.ts/particles.test.ts). Cubre el ciclo open()/update() de un
 * trazo, la convención de ángulo que `StreakView.tsx` necesita, el reciclaje
 * del ring buffer y clear().
 */

import { describe, expect, it } from 'vitest';
import { STREAK_POOL_CAPACITY, STREAK_TYPE_ARCANE, STREAK_TYPE_COUNT, STREAK_TYPE_FROST, StreakPool } from './streaks';

describe('StreakPool', () => {
  it('el tamaño por defecto es el presupuesto del pool', () => {
    const pool = new StreakPool();
    expect(pool.capacity).toBe(STREAK_POOL_CAPACITY);
  });

  it('constantes de tipo: valores estables (StreakView los usa como índice de malla)', () => {
    expect(STREAK_TYPE_FROST).toBe(0);
    expect(STREAK_TYPE_ARCANE).toBe(1);
    expect(STREAK_TYPE_COUNT).toBe(2);
  });

  it('open() nace con longitud 0 en el punto dado, con el color/tipo pedidos', () => {
    const pool = new StreakPool(8);
    const idx = pool.open(3, 4, 1, 0.1, 0.2, 0.3, STREAK_TYPE_ARCANE, () => 0.5);
    expect(idx).toBe(0);
    expect(pool.x[0]).toBeCloseTo(3);
    expect(pool.z[0]).toBeCloseTo(4);
    expect(pool.length[0]).toBe(0);
    expect(pool.angle[0]).toBe(0);
    expect(pool.r[0]).toBeCloseTo(0.1);
    expect(pool.g[0]).toBeCloseTo(0.2);
    expect(pool.b[0]).toBeCloseTo(0.3);
    expect(pool.type[0]).toBe(STREAK_TYPE_ARCANE);
  });

  it('open() varía el ancho dentro de [0.75, 1.25) del ancho pedido, con rng determinista', () => {
    const pool = new StreakPool(8);
    // rng=0 -> factor mínimo 0.75; rng constante consumida por width y luego por mirror.
    pool.open(0, 0, 2, 1, 1, 1, STREAK_TYPE_FROST, () => 0);
    expect(pool.width[0]).toBeCloseTo(2 * 0.75);
  });

  it('open() con rng real: ancho siempre dentro de [0.75, 1.25) del ancho pedido (muchos ensayos)', () => {
    const pool = new StreakPool(1000);
    const requested = 0.3;
    for (let i = 0; i < 500; i++) pool.open(0, 0, requested, 1, 1, 1, STREAK_TYPE_FROST);
    for (let i = 0; i < pool.count; i++) {
      expect(pool.width[i]).toBeGreaterThanOrEqual(requested * 0.75 - 1e-9);
      expect(pool.width[i]).toBeLessThan(requested * 1.25 + 1e-9);
    }
  });

  it('open() decide el espejo (mirror) con rng: valores 0/1 únicamente, ambos posibles con rng real', () => {
    const pool = new StreakPool(1000);
    for (let i = 0; i < 500; i++) pool.open(0, 0, 1, 1, 1, 1, STREAK_TYPE_FROST);
    const seen = new Set<number>();
    for (let i = 0; i < pool.count; i++) {
      expect(pool.mirror[i] === 0 || pool.mirror[i] === 1).toBe(true);
      seen.add(pool.mirror[i]);
    }
    expect(seen.size).toBe(2); // con 500 ensayos, prácticamente seguro ver ambos valores
  });

  it('update() reestira el MISMO slot: punto medio, longitud y ángulo recalculados, sin consumir un slot nuevo del ring buffer', () => {
    const pool = new StreakPool(8);
    const idx = pool.open(0, 0, 1, 1, 1, 1, STREAK_TYPE_ARCANE);
    const cursorAfterOpen = pool.cursor;
    pool.update(idx, 0, 0, 4, 0); // tramo a lo largo de +X, longitud 4
    expect(pool.cursor).toBe(cursorAfterOpen); // no se movió el cursor
    expect(pool.x[idx]).toBeCloseTo(2);
    expect(pool.z[idx]).toBeCloseTo(0);
    expect(pool.length[idx]).toBeCloseTo(4);
  });

  it('convención de ángulo: dx=1,dz=0 -> angle=0 (el eje largo del quad, tras tumbar, apunta a +X mundo)', () => {
    const pool = new StreakPool(8);
    const idx = pool.open(0, 0, 1, 1, 1, 1, STREAK_TYPE_FROST);
    pool.update(idx, 0, 0, 1, 0);
    expect(pool.angle[idx]).toBeCloseTo(0);
  });

  it('convención de ángulo: dx=0,dz=1 -> angle=-π/2 (apunta a +Z mundo)', () => {
    const pool = new StreakPool(8);
    const idx = pool.open(0, 0, 1, 1, 1, 1, STREAK_TYPE_FROST);
    pool.update(idx, 0, 0, 0, 1);
    expect(pool.angle[idx]).toBeCloseTo(-Math.PI / 2);
  });

  it('convención de ángulo: dx=-1,dz=0 -> angle=±π (apunta a -X mundo)', () => {
    const pool = new StreakPool(8);
    const idx = pool.open(0, 0, 1, 1, 1, 1, STREAK_TYPE_FROST);
    pool.update(idx, 0, 0, -1, 0);
    expect(Math.abs(pool.angle[idx])).toBeCloseTo(Math.PI);
  });

  it('convención de ángulo: dx=0,dz=-1 -> angle=π/2 (apunta a -Z mundo)', () => {
    const pool = new StreakPool(8);
    const idx = pool.open(0, 0, 1, 1, 1, 1, STREAK_TYPE_FROST);
    pool.update(idx, 0, 0, 0, -1);
    expect(pool.angle[idx]).toBeCloseTo(Math.PI / 2);
  });

  it('update() con longitud ~0 (el proyectil no se ha movido aún) no toca el ángulo previo', () => {
    const pool = new StreakPool(8);
    const idx = pool.open(5, 5, 1, 1, 1, 1, STREAK_TYPE_FROST);
    pool.update(idx, 5, 5, 5.2, 5); // primer estirón real, fija un ángulo no-nulo
    const angleAfterFirstMove = pool.angle[idx];
    expect(angleAfterFirstMove).not.toBe(0);
    pool.update(idx, 5, 5, 5 + 1e-6, 5); // longitud ~0 de nuevo (ruido de punto flotante)
    expect(pool.angle[idx]).toBe(angleAfterFirstMove); // el ángulo NO se pisa con basura
    expect(pool.length[idx]).toBeCloseTo(0);
  });

  it('encadenado de tramos: cerrar (última update) y abrir uno nuevo en el punto de rebote consume un slot nuevo', () => {
    const pool = new StreakPool(8);
    const first = pool.open(0, 0, 1, 1, 1, 1, STREAK_TYPE_ARCANE);
    pool.update(first, 0, 0, 3, 0); // vuela hasta (3,0)
    pool.update(first, 0, 0, 5, 0); // rebota en (5,0): última estirada del tramo 1
    expect(pool.length[first]).toBeCloseTo(5);

    const second = pool.open(5, 0, 1, 1, 1, 1, STREAK_TYPE_ARCANE); // tramo 2 nace donde acabó el 1
    expect(second).not.toBe(first);
    pool.update(second, 5, 0, 5, 2); // vuela hasta (5,2)
    expect(pool.x[second]).toBeCloseTo(5);
    expect(pool.z[second]).toBeCloseTo(1);
    expect(pool.length[second]).toBeCloseTo(2);
    // El tramo 1 sigue intacto (persistente, no se desvanece ni se toca al abrir el 2º).
    expect(pool.length[first]).toBeCloseTo(5);
    expect(pool.x[first]).toBeCloseTo(2.5);
  });

  it('el pool no crece: los arrays mantienen su capacidad aunque se abran muchos más trazos que slots', () => {
    const pool = new StreakPool(10);
    for (let i = 0; i < 30; i++) pool.open(i, i, 1, 1, 1, 1, STREAK_TYPE_FROST);
    expect(pool.capacity).toBe(10);
    expect(pool.x.length).toBe(10);
    expect(pool.count).toBe(10);
  });

  it('reciclaje del más antiguo: el ring buffer da la vuelta y sobrescribe el slot 0', () => {
    const pool = new StreakPool(3);
    pool.open(1, 1, 1, 1, 0, 0, STREAK_TYPE_FROST); // idx 0
    pool.open(2, 2, 1, 0, 1, 0, STREAK_TYPE_FROST); // idx 1
    pool.open(3, 3, 1, 0, 0, 1, STREAK_TYPE_FROST); // idx 2
    expect(pool.cursor).toBe(0); // dio la vuelta
    pool.open(9, 9, 1, 1, 1, 1, STREAK_TYPE_ARCANE); // recicla idx 0
    expect(pool.x[0]).toBeCloseTo(9);
    expect(pool.type[0]).toBe(STREAK_TYPE_ARCANE);
    expect(pool.x[1]).toBeCloseTo(2); // intacto
    expect(pool.count).toBe(3); // saturado
  });

  it('version se incrementa en open() y en update(), nunca en clear()', () => {
    const pool = new StreakPool(8);
    expect(pool.version).toBe(0);
    const idx = pool.open(0, 0, 1, 1, 1, 1, STREAK_TYPE_FROST);
    expect(pool.version).toBe(1);
    pool.update(idx, 0, 0, 1, 0);
    expect(pool.version).toBe(2);
    pool.update(idx, 0, 0, 2, 0);
    expect(pool.version).toBe(3);
    pool.clear();
    expect(pool.version).toBe(3); // clear() no toca version
  });

  it('clear() reinicia cursor/count a 0 e incrementa epoch, preserva version', () => {
    const pool = new StreakPool(8);
    pool.open(1, 1, 1, 1, 1, 1, STREAK_TYPE_ARCANE);
    pool.open(2, 2, 1, 1, 1, 1, STREAK_TYPE_ARCANE);
    expect(pool.count).toBe(2);
    expect(pool.epoch).toBe(0);

    pool.clear();
    expect(pool.cursor).toBe(0);
    expect(pool.count).toBe(0);
    expect(pool.epoch).toBe(1);

    const cursorBefore = pool.cursor;
    pool.open(9, 9, 1, 1, 1, 1, STREAK_TYPE_FROST);
    expect(cursorBefore).toBe(0);
    expect(pool.x[0]).toBeCloseTo(9); // vuelve a escribir desde el índice 0
    expect(pool.count).toBe(1);
  });

  it('sin rng explícito usa Math.random por defecto: mismo contrato que ProjectileView.tsx, que llama a open() sin rng', () => {
    const pool = new StreakPool(8);
    const idx = pool.open(0, 0, 1, 1, 1, 1, STREAK_TYPE_FROST);
    expect(pool.width[idx]).toBeGreaterThanOrEqual(0.75 - 1e-9);
    expect(pool.width[idx]).toBeLessThan(1.25 + 1e-9);
  });
});
