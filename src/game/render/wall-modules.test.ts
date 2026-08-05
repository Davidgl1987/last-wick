import { describe, expect, it } from 'vitest';
import { wallModuleLayout } from './wall-modules';

/** Tolerancia numérica para las comprobaciones de `count * moduleLength * scale === length`. */
const EPS = 1e-9;

describe('wallModuleLayout', () => {
  it('longitud EXACTAMENTE múltiplo del módulo: 1 módulo por módulo, sin estirar (scale=1)', () => {
    expect(wallModuleLayout(3.36, 3.36)).toEqual({ count: 1, scale: 1 });
    const { count, scale } = wallModuleLayout(13.44, 3.36); // 4 × 3.36
    expect(count).toBe(4);
    expect(scale).toBeCloseTo(1, 12);
  });

  it('longitud FRACCIONARIA: redondea al nº de módulos más cercano y ajusta la escala para cubrir exacto', () => {
    // 10 u con módulo 3.36 → 10/3.36 ≈ 2.976 → redondea a 3 módulos.
    const { count, scale } = wallModuleLayout(10, 3.36);
    expect(count).toBe(3);
    expect(count * 3.36 * scale).toBeCloseTo(10, 9);
  });

  it('longitud MÁS CORTA que un módulo: nunca 0 módulos, se estira uno solo hasta cubrir el tramo', () => {
    const { count, scale } = wallModuleLayout(1.2, 3.36);
    expect(count).toBe(1);
    expect(scale).toBeCloseTo(1.2 / 3.36, 12);
    expect(count * 3.36 * scale).toBeCloseTo(1.2, 9);
  });

  it('longitud MUCHO más corta que el módulo (resto de pared junto a una puerta): sigue siendo 1 módulo', () => {
    const { count, scale } = wallModuleLayout(0.05, 3.36);
    expect(count).toBe(1);
    expect(scale).toBeGreaterThan(0);
    expect(count * 3.36 * scale).toBeCloseTo(0.05, 9);
  });

  it('redondeo justo en la frontera .5 (round-half-up, como Math.round de JS)', () => {
    // length = 1.5 * moduleLength → length/moduleLength = 1.5 exacto → Math.round(1.5) = 2.
    const moduleLength = 2;
    const { count, scale } = wallModuleLayout(3, moduleLength);
    expect(count).toBe(2);
    expect(count * moduleLength * scale).toBeCloseTo(3, 9);
  });

  it('propiedad general: count * moduleLength * scale === length (tolerancia numérica) para un barrido de longitudes', () => {
    const moduleLength = 3.36;
    const lengths = [0.1, 0.5, 1, 1.68, 2.0, 2.5, 3.36, 3.4, 5, 6.72, 7, 9.13, 13.44, 20.07];
    for (const length of lengths) {
      const { count, scale } = wallModuleLayout(length, moduleLength);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(Math.abs(count * moduleLength * scale - length)).toBeLessThan(EPS);
    }
  });

  it('funciona igual con otro moduleLength (p. ej. floor_tile_small u otra pieza modular)', () => {
    const { count, scale } = wallModuleLayout(5, 1.68);
    expect(count).toBe(3); // 5/1.68 ≈ 2.976 → 3
    expect(count * 1.68 * scale).toBeCloseTo(5, 9);
  });
});
