/**
 * Tests headless de las primitivas geométricas (sin React ni three.js).
 */

import { describe, expect, it } from 'vitest';
import { dampAngleTowards, rotateAngleTowards } from './geometry';

describe('dampAngleTowards', () => {
  it('gira por el arco más corto al cruzar ±PI (no da la vuelta larga)', () => {
    // De 3.0 a -3.0: la diferencia "directa" es -6.0, pero el arco más corto
    // cruzando el wrap-around es solo ≈0.28 rad (2π - 6.0).
    const current = 3.0;
    const target = -3.0;
    const lambda = 12;
    const dt = 1 / 60;
    const next = dampAngleTowards(current, target, lambda, dt);
    const shortArcDelta = Math.PI * 2 - 6.0; // ≈0.283
    const factor = 1 - Math.exp(-lambda * dt);
    const expectedNext = current + shortArcDelta * factor;
    expect(next).toBeCloseTo(expectedNext, 10);
    // El paso dado en un solo frame debe ser pequeño (arco corto), nunca
    // cercano a 2π ni a la magnitud del delta "directo" (6.0).
    expect(Math.abs(next - current)).toBeLessThan(0.5);
  });

  it('converge monótonamente hacia el objetivo sin oscilar', () => {
    let current = 0;
    const target = 1.2;
    const lambda = 12;
    const dt = 1 / 60;
    let prevDistance = Math.abs(target - current);
    for (let i = 0; i < 30; i++) {
      current = dampAngleTowards(current, target, lambda, dt);
      const distance = Math.abs(target - current);
      expect(distance).toBeLessThanOrEqual(prevDistance);
      prevDistance = distance;
    }
    expect(current).toBeCloseTo(target, 2);
  });

  it('un dt grande no sobrepasa el objetivo (factor clampado a 1)', () => {
    const current = 0;
    const target = 0.5;
    const lambda = 12;
    const dt = 10; // frame gigante (tab en segundo plano, etc.)
    const next = dampAngleTowards(current, target, lambda, dt);
    expect(next).toBeCloseTo(target, 10);
  });

  it('si ya está en el objetivo, se mantiene estable', () => {
    const next = dampAngleTowards(1.5, 1.5, 12, 1 / 60);
    expect(next).toBeCloseTo(1.5, 10);
  });
});

describe('rotateAngleTowards', () => {
  it('gira por el arco corto en sentido positivo cuando el objetivo está por delante', () => {
    const next = rotateAngleTowards(0, 1, 0.3);
    expect(next).toBeCloseTo(0.3, 10);
  });

  it('gira por el arco corto en sentido negativo cuando el objetivo está por detrás', () => {
    const next = rotateAngleTowards(0, -1, 0.3);
    expect(next).toBeCloseTo(-0.3, 10);
  });

  it('cerca de ±π, cruza el wrap-around por el lado corto en vez de dar la vuelta larga', () => {
    // De 3.0 a -3.0: igual que en el test de dampAngleTowards de arriba, el
    // arco "directo" sin normalizar mide 6.0, pero el corto (cruzando el
    // wrap-around) mide solo ≈0.283 rad — un maxStep pequeño debe mover
    // `current` HACIA +π (aumentando), no retroceder hacia 0.
    const current = 3.0;
    const target = -3.0;
    const maxStep = 0.1;
    const next = rotateAngleTowards(current, target, maxStep);
    expect(next).toBeGreaterThan(current);
    expect(next - current).toBeCloseTo(maxStep, 10);
  });

  it('aterriza EXACTO en el objetivo sin overshoot cuando el resto cabe en un solo paso', () => {
    // toBe (no toBeCloseTo): el contrato es "termina en un instante
    // conocido", y el valor de retorno debe ser el propio `target`, no una
    // aproximación por suma — sin este exacto, la sim no podría comparar
    // `facing` contra el rumbo objetivo para decidir si el giro ya acabó.
    const next = rotateAngleTowards(0, 0.05, 0.3);
    expect(next).toBe(0.05);
  });

  it('aterriza exacto también cruzando el wrap-around cuando el resto cabe en un solo paso', () => {
    const next = rotateAngleTowards(3.1, -3.1, 0.2);
    expect(next).toBe(-3.1);
  });

  it('con maxStep=0 no avanza nada (salvo que ya esté en el objetivo)', () => {
    const next = rotateAngleTowards(0.4, 1.0, 0);
    expect(next).toBeCloseTo(0.4, 10);
  });

  it('convergencia por pasos repetidos: varias llamadas seguidas llegan exacto al objetivo sin pasarse nunca', () => {
    let current = 0;
    const target = 2.5;
    const maxStep = 0.3;
    for (let i = 0; i < 20; i++) {
      const prevDistance = Math.abs(target - current);
      current = rotateAngleTowards(current, target, maxStep);
      const distance = Math.abs(target - current);
      // Cada paso reduce la distancia como mucho `maxStep`, nunca la aumenta
      // ni se pasa de largo (a diferencia de un lerp lineal ingenuo cerca
      // del wrap-around).
      expect(distance).toBeLessThanOrEqual(prevDistance);
    }
    expect(current).toBe(target);
  });
});
