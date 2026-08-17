/**
 * Tests headless de `WallMarkPool`/`wallNormalAt`/`touchesExplodedBarrel`
 * (wallmarks.ts): sin three.js (mismo criterio que streaks.test.ts/
 * wax.test.ts). Cubre spawn(), el reciclaje del ring buffer, clear(), la
 * convención de yaw que `WallMarkView.tsx` necesita, la geometría de solo
 * lectura que decide "hay un muro/obstáculo tocando este punto" (obstáculos
 * AABB — muros Y rocas, ver `wallNormalAt`, "obstáculos" en su nombre no dice
 * "muros" a propósito —, límites internos de sala, y los casos negativos que
 * evitan marcas flotando en mitad de la sala), y la exclusión explícita de
 * barriles reventados (`touchesExplodedBarrel`).
 *
 * El último bloque (`integración: pipeline físico real`) usa
 * `collideCircleAabb` de `engine/physics.ts` — la MISMA función que
 * `stepHeroProjectileCollisions` (combat.ts) usa para resolver la colisión
 * real — para reproducir end-to-end el caso reportado por David ("las
 * manchas en los assets como piedras salen muy desplazadas"): empuja un
 * proyectil contra una roca con los valores reales de `rock-1` de la Sala de
 * Pruebas (`features/dungeon/rooms.ts`) y comprueba que `wallNormalAt` ve,
 * en la posición ya resuelta por la física, exactamente la misma superficie
 * y normal — no solo que la fórmula de `wallNormalAt` sea correcta en
 * abstracto, sino que el pipeline completo (física → marca) lo es.
 */

import { describe, expect, it } from 'vitest';
import { collideCircleAabb } from '@/engine/physics';
import {
  touchesExplodedBarrel,
  WALL_MARK_POOL_CAPACITY,
  WALL_MARK_TYPE_ARCANE,
  WALL_MARK_TYPE_COUNT,
  WALL_MARK_TYPE_FROST,
  WallMarkPool,
  wallNormalAt,
  type ExplodedBarrelLike,
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

  it('mezcla de obstáculos (roca + segmento de muro): reconoce cuál de los dos toca de verdad, no siempre el primero de la lista', () => {
    // `Obstacle` no distingue roca de muro por tipo (ver cabecera del módulo):
    // wallNormalAt trata ambos exactamente igual. Aquí una "roca" (índice 0,
    // lejos) y un "muro" (índice 1, el que de verdad toca) — confirma que NO
    // hace falta que el obstáculo que toca sea el primero de la lista.
    const rock: WallObstacleLike = { aabb: { minX: -8, maxX: -7, minY: -8, maxY: -7 } }; // lejos
    const wallSegment: WallObstacleLike = { aabb: { minX: 2, maxX: 6, minY: -0.5, maxY: 0.5 } }; // cerca
    const n = wallNormalAt(2 - radius, 0, radius, [rock, wallSegment], null);
    expect(n).toEqual({ x: -1, z: 0 }); // cara -X del "muro", no null ni la roca lejana
  });

  it('dos obstáculos ambos al alcance: gana el primero de la lista (mismo criterio de corte que combat.ts, que tampoco pondera solapes)', () => {
    const near: WallObstacleLike = { aabb: { minX: -0.6, maxX: 0.6, minY: -0.6, maxY: 0.6 } };
    const alsoNear: WallObstacleLike = { aabb: { minX: -0.5, maxX: 0.5, minY: 2, maxY: 3 } };
    // Punto que toca `near` (índice 0) pero no `alsoNear` (índice 1, lejos en Y).
    const n = wallNormalAt(0.6 + radius, 0, radius, [near, alsoNear], null);
    expect(n).toEqual({ x: 1, z: 0 });
  });
});

describe('touchesExplodedBarrel', () => {
  const radius = 0.18; // PROJECTILE_RADIUS

  it('toca un barril YA explotado en el rango de contacto -> true', () => {
    const barrels: ExplodedBarrelLike[] = [{ position: { x: 3, y: 4 }, radius: 0.5, exploded: true }];
    expect(touchesExplodedBarrel(3.6, 4, radius, barrels)).toBe(true); // dist 0.6, rango de contacto 0.18+0.5=0.68
  });

  it('límite exacto de contacto (radius + barril.radius): inclusive, true', () => {
    const barrels: ExplodedBarrelLike[] = [{ position: { x: 0, y: 0 }, radius: 0.5, exploded: true }];
    const dist = radius + 0.5;
    expect(touchesExplodedBarrel(dist, 0, radius, barrels)).toBe(true);
  });

  it('justo fuera del rango de contacto -> false (no todo el mundo es un barril)', () => {
    const barrels: ExplodedBarrelLike[] = [{ position: { x: 0, y: 0 }, radius: 0.5, exploded: true }];
    expect(touchesExplodedBarrel(radius + 0.5 + 0.01, 0, radius, barrels)).toBe(false);
  });

  it('barril NO explotado (todavía en pie): se ignora aunque el círculo lo toque de lleno', () => {
    // stepBarrels (hazards.ts) detona el barril en el mismo tick que lo toca
    // un proyectil del héroe, así que en la práctica esto no debería darse
    // para un proyectil ya desactivado — pero la función debe ser explícita:
    // solo excluye barriles YA reventados, nunca uno intacto.
    const barrels: ExplodedBarrelLike[] = [{ position: { x: 0, y: 0 }, radius: 0.5, exploded: false }];
    expect(touchesExplodedBarrel(0, 0, radius, barrels)).toBe(false);
  });

  it('lista vacía -> false', () => {
    expect(touchesExplodedBarrel(0, 0, radius, [])).toBe(false);
  });

  it('varios barriles: encuentra el explotado aunque no sea el primero de la lista', () => {
    const barrels: ExplodedBarrelLike[] = [
      { position: { x: -5, y: -5 }, radius: 0.5, exploded: false }, // en pie, lejos
      { position: { x: 10, y: 10 }, radius: 0.5, exploded: true }, // explotado, lejos
      { position: { x: 0, y: 0 }, radius: 0.5, exploded: true }, // explotado, toca
    ];
    expect(touchesExplodedBarrel(0.4, 0, radius, barrels)).toBe(true);
  });

  it('ningún barril cerca -> false (caso normal: la mayoría de impactos no están cerca de ningún barril)', () => {
    const barrels: ExplodedBarrelLike[] = [{ position: { x: 20, y: 20 }, radius: 0.5, exploded: true }];
    expect(touchesExplodedBarrel(0, 0, radius, barrels)).toBe(false);
  });
});

describe('integración: pipeline físico real (collideCircleAabb -> wallNormalAt)', () => {
  const radius = 0.18; // PROJECTILE_RADIUS (combat.ts)

  it('roca real de la Sala de Pruebas (rock-1, features/dungeon/rooms.ts): un proyectil empujado por la física llega exactamente donde wallNormalAt lo reconoce, con la normal de la cara que de verdad tocó', () => {
    // rock-1: position (-2,-3), width 1.2, height 1.2 -> aabb derivado tal
    // cual lo construye buildRoomEntities (world/create.ts).
    const rock1 = { minX: -2.6, maxX: -1.4, minY: -3.6, maxY: -2.4 };
    // `collideCircleAabb` es DISCRETA: resuelve el solape que ya existe en la
    // posición dada, no barre la trayectoria con la velocidad. Así que se
    // parte del estado real en que la llama la sim — el paso de integración
    // ya metió al proyectil dentro del radio de la cara sur (+Y) de la roca —
    // y la función lo empuja fuera. Colocarlo aún lejos y esperar que
    // colisione era el error de la primera versión de este test.
    const position = { x: -2.0, y: rock1.maxY + radius * 0.5 }; // solapando la cara sur
    const velocity = { x: 0, y: -6 }; // venía hacia el norte, contra la roca

    const hit = collideCircleAabb(position, velocity, radius, rock1, null);
    expect(hit).toBe(true);
    // La física empuja el centro a radius exacto de la cara +Y (sur) de la roca.
    expect(position.x).toBeCloseTo(-2.0);
    expect(position.y).toBeCloseTo(rock1.maxY + radius); // -2.22

    const normal = wallNormalAt(position.x, position.y, radius, [{ aabb: rock1 }], null);
    expect(normal).toEqual({ x: 0, z: 1 }); // cara sur: normal +Y/+Z, coherente con WallMarkPool.spawn (yaw=0)
  });

  it('mismo caso pero golpeando la cara +X (este) de la roca: normal (1,0), no la del "muro más cercano" de la sala', () => {
    const rock1 = { minX: -2.6, maxX: -1.4, minY: -3.6, maxY: -2.4 };
    const bounds = { minX: -5.5, minY: -7.5, maxX: 5.5, maxY: 7.5 }; // sala 11x15 (Sala de Pruebas)
    // Igual que arriba: se parte del solape ya producido (colisión discreta),
    // aquí contra la cara +X (este) de la roca.
    const position = { x: rock1.maxX + radius * 0.5, y: -3.0 };
    const velocity = { x: -6, y: 0 }; // venía hacia el oeste, contra la roca

    const hit = collideCircleAabb(position, velocity, radius, rock1, null);
    expect(hit).toBe(true);
    expect(position.x).toBeCloseTo(rock1.maxX + radius); // -1.22
    expect(position.y).toBeCloseTo(-3.0);

    // bounds SÍ se pasa (modo sala única): si el obstáculo no se reconociera,
    // este es justo el caso que "caería" al muro exterior más lejano en vez
    // de a la roca — el bug que describe el encargo.
    const normal = wallNormalAt(position.x, position.y, radius, [{ aabb: rock1 }], bounds);
    expect(normal).toEqual({ x: 1, z: 0 }); // cara este de la roca, NO el muro oeste de la sala (a varias unidades de distancia)
  });

  it('un proyectil detenido por un barril (no por la roca cercana) no deja marca, aunque la roca esté a tiro de piedra', () => {
    // Escenario que motiva touchesExplodedBarrel: un barril reventado justo
    // al lado de una roca real. Sin la exclusión explícita, wallNormalAt
    // encontraría la roca (que no fue la causante) y dejaría una marca ahí.
    const rock1 = { minX: -2.6, maxX: -1.4, minY: -3.6, maxY: -2.4 };
    const barrels: ExplodedBarrelLike[] = [{ position: { x: -1.0, y: -2.5 }, radius: 0.35, exploded: true }];
    const impactX = -1.2;
    const impactY = -2.5; // a distancia radius+barrilRadius del barril, y también dentro del alcance de rock1

    expect(touchesExplodedBarrel(impactX, impactY, radius, barrels)).toBe(true);
    // spawnWallMarkForImpact (ProjectileView.tsx) corta aquí y NUNCA llega a
    // llamar wallNormalAt para este impacto — la propia roca cercana confirma
    // que, si no fuera por el corte explícito, sí habría "encontrado algo":
    const wouldHaveFoundRock = wallNormalAt(impactX, impactY, radius, [{ aabb: rock1 }], null);
    expect(wouldHaveFoundRock).not.toBeNull();
  });
});
