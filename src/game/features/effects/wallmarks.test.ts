/**
 * Tests headless de `WallMarkPool`/`wallNormalAt` (wallmarks.ts): sin
 * three.js (mismo criterio que streaks.test.ts/wax.test.ts). Cubre spawn(),
 * el reciclaje del ring buffer, clear(), la convención de yaw que
 * `WallMarkView.tsx` necesita, y la geometría de solo lectura que decide "hay
 * un muro tocando este punto" (obstáculos AABB, límites internos de sala, y
 * los casos negativos que evitan marcas flotando en mitad de la sala).
 */

import { describe, expect, it } from 'vitest';
import {
  WALL_MARK_POOL_CAPACITY,
  WALL_MARK_TYPE_ARCANE,
  WALL_MARK_TYPE_COUNT,
  WALL_MARK_TYPE_FROST,
  WallMarkPool,
  wallNormalAt,
  type WallObstacleLike,
} from './wallmarks';

describe('WallMarkPool', () => {
  it('el tamaño por defecto es el presupuesto del pool (~64, encargo de David)', () => {
    const pool = new WallMarkPool();
    expect(pool.capacity).toBe(WALL_MARK_POOL_CAPACITY);
    expect(WALL_MARK_POOL_CAPACITY).toBe(64);
  });

  it('constantes de tipo: valores estables (WallMarkView los usa como índice de malla)', () => {
    expect(WALL_MARK_TYPE_FROST).toBe(0);
    expect(WALL_MARK_TYPE_ARCANE).toBe(1);
    expect(WALL_MARK_TYPE_COUNT).toBe(2);
  });

  it('spawn() escribe posición 3D, tipo y un yaw derivado de la normal', () => {
    const pool = new WallMarkPool(8);
    const idx = pool.spawn(3, 0.3, 4, 1, 0, WALL_MARK_TYPE_ARCANE, () => 0.5);
    expect(idx).toBe(0);
    expect(pool.x[0]).toBeCloseTo(3);
    expect(pool.y[0]).toBeCloseTo(0.3);
    expect(pool.z[0]).toBeCloseTo(4);
    expect(pool.type[0]).toBe(WALL_MARK_TYPE_ARCANE);
    expect(pool.yaw[0]).toBeCloseTo(Math.PI / 2); // normal (1,0) -> atan2(1,0) = π/2
  });

  it('convención de yaw: normal (0,1) [+Z] -> yaw=0', () => {
    const pool = new WallMarkPool(8);
    pool.spawn(0, 0, 0, 0, 1, WALL_MARK_TYPE_FROST);
    expect(pool.yaw[0]).toBeCloseTo(0);
  });

  it('convención de yaw: normal (0,-1) [-Z] -> yaw=±π', () => {
    const pool = new WallMarkPool(8);
    pool.spawn(0, 0, 0, 0, -1, WALL_MARK_TYPE_FROST);
    expect(Math.abs(pool.yaw[0])).toBeCloseTo(Math.PI);
  });

  it('convención de yaw: normal (-1,0) [-X] -> yaw=-π/2', () => {
    const pool = new WallMarkPool(8);
    pool.spawn(0, 0, 0, -1, 0, WALL_MARK_TYPE_FROST);
    expect(pool.yaw[0]).toBeCloseTo(-Math.PI / 2);
  });

  it('yaw es invariante a la escala de la normal (no hace falta normalizarla antes de spawn())', () => {
    const pool = new WallMarkPool(8);
    pool.spawn(0, 0, 0, 5, 0, WALL_MARK_TYPE_FROST); // (5,0) en vez de (1,0)
    expect(pool.yaw[0]).toBeCloseTo(Math.PI / 2);
  });

  it('spawn() varía el tamaño y fija un roll con rng determinista', () => {
    const pool = new WallMarkPool(8);
    // rng=0 -> tamaño mínimo, roll=0.
    pool.spawn(0, 0, 0, 1, 0, WALL_MARK_TYPE_FROST, () => 0);
    expect(pool.size[0]).toBeCloseTo(0.45);
    expect(pool.roll[0]).toBeCloseTo(0);
  });

  it('spawn() con rng real: tamaño siempre dentro de [0.45, 0.8) (muchos ensayos)', () => {
    const pool = new WallMarkPool(1000);
    for (let i = 0; i < 500; i++) pool.spawn(0, 0, 0, 1, 0, WALL_MARK_TYPE_FROST);
    for (let i = 0; i < pool.count; i++) {
      expect(pool.size[i]).toBeGreaterThanOrEqual(0.45 - 1e-9);
      expect(pool.size[i]).toBeLessThan(0.8 + 1e-9);
    }
  });

  it('el pool no crece: los arrays mantienen su capacidad aunque se depositen más marcas que slots', () => {
    const pool = new WallMarkPool(10);
    for (let i = 0; i < 30; i++) pool.spawn(i, 0, i, 1, 0, WALL_MARK_TYPE_FROST);
    expect(pool.capacity).toBe(10);
    expect(pool.x.length).toBe(10);
    expect(pool.count).toBe(10);
  });

  it('reciclaje del más antiguo: el ring buffer da la vuelta y sobrescribe el slot 0', () => {
    const pool = new WallMarkPool(3);
    pool.spawn(1, 0, 1, 1, 0, WALL_MARK_TYPE_FROST); // idx 0
    pool.spawn(2, 0, 2, 1, 0, WALL_MARK_TYPE_FROST); // idx 1
    pool.spawn(3, 0, 3, 1, 0, WALL_MARK_TYPE_FROST); // idx 2
    expect(pool.cursor).toBe(0); // dio la vuelta
    pool.spawn(9, 0, 9, 1, 0, WALL_MARK_TYPE_ARCANE); // recicla idx 0
    expect(pool.x[0]).toBeCloseTo(9);
    expect(pool.type[0]).toBe(WALL_MARK_TYPE_ARCANE);
    expect(pool.x[1]).toBeCloseTo(2); // intacto
    expect(pool.count).toBe(3); // saturado
  });

  it('version se incrementa en spawn(), nunca en clear()', () => {
    const pool = new WallMarkPool(8);
    expect(pool.version).toBe(0);
    pool.spawn(0, 0, 0, 1, 0, WALL_MARK_TYPE_FROST);
    expect(pool.version).toBe(1);
    pool.spawn(0, 0, 0, 1, 0, WALL_MARK_TYPE_FROST);
    expect(pool.version).toBe(2);
    pool.clear();
    expect(pool.version).toBe(2); // clear() no toca version
  });

  it('clear() reinicia cursor/count a 0 e incrementa epoch, preserva version', () => {
    const pool = new WallMarkPool(8);
    pool.spawn(1, 0, 1, 1, 0, WALL_MARK_TYPE_ARCANE);
    pool.spawn(2, 0, 2, 1, 0, WALL_MARK_TYPE_ARCANE);
    expect(pool.count).toBe(2);
    expect(pool.epoch).toBe(0);

    pool.clear();
    expect(pool.cursor).toBe(0);
    expect(pool.count).toBe(0);
    expect(pool.epoch).toBe(1);

    pool.spawn(9, 0, 9, 1, 0, WALL_MARK_TYPE_FROST);
    expect(pool.x[0]).toBeCloseTo(9); // vuelve a escribir desde el índice 0
    expect(pool.count).toBe(1);
  });

  it('sin rng explícito usa Math.random por defecto: mismo contrato que ProjectileView.tsx', () => {
    const pool = new WallMarkPool(8);
    pool.spawn(0, 0, 0, 1, 0, WALL_MARK_TYPE_FROST);
    expect(pool.size[0]).toBeGreaterThanOrEqual(0.45 - 1e-9);
    expect(pool.size[0]).toBeLessThan(0.8 + 1e-9);
  });
});

describe('wallNormalAt', () => {
  const box = { minX: 0, minY: 0, maxX: 4, maxY: 2 }; // obstáculo/roca rectangular
  const radius = 0.18; // PROJECTILE_RADIUS

  it('toca la cara -X del obstáculo (círculo a la izquierda, empujado a minX-radius): normal (-1,0)', () => {
    const n = wallNormalAt(box.minX - radius, 1, radius, [{ aabb: box }], null);
    expect(n).not.toBeNull();
    expect(n!.x).toBeCloseTo(-1);
    expect(n!.z).toBeCloseTo(0);
  });

  it('toca la cara +X del obstáculo: normal (1,0)', () => {
    const n = wallNormalAt(box.maxX + radius, 1, radius, [{ aabb: box }], null);
    expect(n!.x).toBeCloseTo(1);
    expect(n!.z).toBeCloseTo(0);
  });

  it('toca la cara -Y del obstáculo: normal (0,-1)', () => {
    const n = wallNormalAt(2, box.minY - radius, radius, [{ aabb: box }], null);
    expect(n!.x).toBeCloseTo(0);
    expect(n!.z).toBeCloseTo(-1);
  });

  it('toca la cara +Y del obstáculo: normal (0,1)', () => {
    const n = wallNormalAt(2, box.maxY + radius, radius, [{ aabb: box }], null);
    expect(n!.x).toBeCloseTo(0);
    expect(n!.z).toBeCloseTo(1);
  });

  it('toca una esquina del obstáculo: normal diagonal normalizada (√2/2, √2/2 en algún signo)', () => {
    // Esquina (maxX, maxY), círculo centrado justo a radius*cos45/sin45 de distancia.
    const d = radius / Math.SQRT2;
    const n = wallNormalAt(box.maxX + d, box.maxY + d, radius, [{ aabb: box }], null);
    expect(n).not.toBeNull();
    expect(n!.x).toBeCloseTo(Math.SQRT1_2, 2);
    expect(n!.z).toBeCloseTo(Math.SQRT1_2, 2);
    const len = Math.hypot(n!.x, n!.z);
    expect(len).toBeCloseTo(1); // normal siempre unitaria
  });

  it('NO toca el obstáculo si está lejos (evita marcas flotando en mitad de la sala)', () => {
    const n = wallNormalAt(20, 20, radius, [{ aabb: box }], null);
    expect(n).toBeNull();
  });

  it('caso real: proyectil muerto por ENEMIGO lejos de cualquier muro -> null (no debe salir marca)', () => {
    // Simula la posición de un enemigo típico en mitad de una sala, sin obstáculos ni bounds tocando.
    const obstacles: WallObstacleLike[] = [{ aabb: { minX: -1, minY: -1, maxX: 0, maxY: 0 } }];
    const n = wallNormalAt(5, 5, radius, obstacles, null);
    expect(n).toBeNull();
  });

  it('bounds=null (modo mazmorra multi-sala): ignora los límites de sala aunque la posición esté en el borde', () => {
    // Posición pegada a donde estaría el límite interior de una sala de minX=0 (ver el test siguiente), pero bounds no se pasa (null).
    const n = wallNormalAt(radius, 5, radius, [], null);
    expect(n).toBeNull();
  });

  it('modo sala única (bounds no nulo): toca cada uno de los 4 límites internos', () => {
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 6 };
    expect(wallNormalAt(radius, 3, radius, [], bounds)).toEqual({ x: -1, z: 0 });
    expect(wallNormalAt(10 - radius, 3, radius, [], bounds)).toEqual({ x: 1, z: 0 });
    expect(wallNormalAt(5, radius, radius, [], bounds)).toEqual({ x: 0, z: -1 });
    expect(wallNormalAt(5, 6 - radius, radius, [], bounds)).toEqual({ x: 0, z: 1 });
  });

  it('modo sala única: el centro de la sala no toca ningún límite -> null', () => {
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 6 };
    expect(wallNormalAt(5, 3, radius, [], bounds)).toBeNull();
  });

  it('los obstáculos se comprueban antes que bounds y cortan en el primero que toque', () => {
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 6 };
    const nearWallBox = { minX: 0.5, minY: 2, maxX: 1.5, maxY: 3 }; // roca lejos del borde de sala
    const n = wallNormalAt(0.5 - radius, 2.5, radius, [{ aabb: nearWallBox }], bounds);
    expect(n).toEqual({ x: -1, z: 0 }); // normal de la roca, no de bounds (que ni siquiera se toca aquí)
  });
});
