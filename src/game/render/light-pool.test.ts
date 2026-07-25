/**
 * Tests de `selectNearestInto` (base compartida del pool de 3 antorchas por
 * cercanía, ver cabecera de light-pool.ts): cubren recuento (menos/exacto/
 * más emisores que `n`, `n=0`, lista vacía) y que el resultado son de verdad
 * los `n` más cercanos, incluido un caso con empate.
 */

import { describe, expect, it } from 'vitest';
import { selectNearestInto, type NearestEmitterPoint } from './light-pool';

function dist2(a: NearestEmitterPoint, x: number, z: number): number {
  const dx = a.x - x;
  const dz = a.z - z;
  return dx * dx + dz * dz;
}

describe('selectNearestInto', () => {
  it('con menos emisores que n, rellena lo que hay y deja -1 en los huecos', () => {
    const emitters: NearestEmitterPoint[] = [
      { x: 1, z: 0 },
      { x: 0, z: 2 },
    ];
    const out = [-99, -99, -99, -99];
    selectNearestInto(emitters, 0, 0, out, 4);
    // Los dos únicos emisores deben estar presentes (en algún orden), y el resto -1.
    expect(out.slice(0, 2).sort()).toEqual([0, 1]);
    expect(out[2]).toBe(-1);
    expect(out[3]).toBe(-1);
  });

  it('con exactamente n emisores, los asigna todos sin huecos', () => {
    const emitters: NearestEmitterPoint[] = [
      { x: 1, z: 0 },
      { x: 0, z: 1 },
      { x: -1, z: 0 },
    ];
    const out = [-1, -1, -1];
    selectNearestInto(emitters, 0, 0, out, 3);
    expect(out.slice().sort()).toEqual([0, 1, 2]);
  });

  it('con más emisores que n, elige los n más cercanos de verdad', () => {
    const emitters: NearestEmitterPoint[] = [
      { x: 10, z: 0 }, // lejos
      { x: 1, z: 0 }, // cerca
      { x: 0, z: 2 }, // medio
      { x: 0, z: -1 }, // muy cerca
      { x: -8, z: 0 }, // lejos
    ];
    const out = [-1, -1];
    selectNearestInto(emitters, 0, 0, out, 2);
    expect(out).not.toContain(-1);
    // Los dos más cercanos al origen son los índices 3 (d=1) y 1 (d=1)... calculamos con dist2.
    const chosenDist2 = out.map((i) => dist2(emitters[i], 0, 0)).sort((a, b) => a - b);
    const allDist2 = emitters.map((e) => dist2(e, 0, 0)).sort((a, b) => a - b);
    expect(chosenDist2).toEqual(allDist2.slice(0, 2));
  });

  it('n = 0 no escribe nada y no lanza', () => {
    const emitters: NearestEmitterPoint[] = [{ x: 1, z: 0 }];
    const out = [-77];
    selectNearestInto(emitters, 0, 0, out, 0);
    expect(out).toEqual([-77]); // intacto: n=0 no toca out[0]
  });

  it('lista vacía de emisores deja todos los slots en -1', () => {
    const out = [-1, -1, -1];
    selectNearestInto([], 5, 5, out, 3);
    expect(out).toEqual([-1, -1, -1]);
  });

  it('empate: elige n índices válidos y ninguno de los descartados está más cerca que un elegido', () => {
    // 4 emisores equidistantes del origen (mismo radio, distintas direcciones) + 1 más lejano.
    const emitters: NearestEmitterPoint[] = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
      { x: 5, z: 5 }, // claramente más lejano
    ];
    const out = [-1, -1];
    selectNearestInto(emitters, 0, 0, out, 2);
    expect(out).not.toContain(-1);
    const chosenIdx = new Set(out);
    expect(chosenIdx.size).toBe(2); // dos slots, dos índices distintos
    const worstChosenDist2 = Math.max(...out.map((i) => dist2(emitters[i], 0, 0)));
    for (let i = 0; i < emitters.length; i++) {
      if (chosenIdx.has(i)) continue;
      expect(dist2(emitters[i], 0, 0)).toBeGreaterThanOrEqual(worstChosenDist2);
    }
  });
});
