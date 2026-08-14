/**
 * Tests headless del pool de fogonazos de impacto (VFX_PLAN T3): preasignado,
 * nunca crece, recicla slots por cursor circular al saturarse (mismo patrón
 * que ShockwavePool) y libera al expirar por vida. Sin three.js.
 */

import { describe, expect, it } from 'vitest';
import { BARREL_BLAST_RADIUS } from '@/game/features/hazards/constants';
import type { GameEvent } from '@/engine/events';
import { createEffectsState } from './effectsState';
import { FlashPool, FLASH_LIFE, FLASH_POOL_SIZE } from './flash';
import { ParticlePool } from './particles';
import { reactToEvent } from './reactToEvent';

describe('FlashPool', () => {
  it('spawn ocupa un slot libre con los datos del fogonazo', () => {
    const pool = new FlashPool(4);
    pool.spawn(1, 2, 0.5, 1, 0.5, 0);
    expect(pool.active[0]).toBe(1);
    expect(pool.x[0]).toBe(1);
    expect(pool.z[0]).toBe(2);
    expect(pool.size[0]).toBe(0.5);
    expect(pool.r[0]).toBe(1);
    expect(pool.g[0]).toBe(0.5);
    expect(pool.b[0]).toBe(0);
    expect(pool.life[0]).toBeCloseTo(FLASH_LIFE);
    expect(pool.maxLife[0]).toBeCloseTo(FLASH_LIFE);
  });

  it('el pool no crece: los arrays mantienen su capacidad aunque se sature', () => {
    const pool = new FlashPool(4);
    for (let i = 0; i < 10; i++) {
      pool.spawn(i, i, 0.3, 1, 1, 1); // 10 spawns sobre 4 slots
    }
    expect(pool.capacity).toBe(4);
    expect(pool.x.length).toBe(4);
    expect(pool.active.length).toBe(4);
  });

  it('recicla por cursor circular cuando se agotan los slots libres', () => {
    const pool = new FlashPool(2);
    pool.spawn(1, 1, 0.1, 1, 0, 0); // slot 0
    pool.spawn(2, 2, 0.1, 0, 1, 0); // slot 1
    pool.spawn(3, 3, 0.1, 0, 0, 1); // recicla slot 0 (round-robin)
    expect(pool.x[0]).toBe(3);
    expect(pool.r[0]).toBe(0);
    expect(pool.b[0]).toBe(1);
    expect(pool.x[1]).toBe(2); // slot 1 intacto
  });

  it('update libera el slot al agotar su vida, no antes', () => {
    const pool = new FlashPool(4);
    pool.spawn(0, 0, 0.4, 1, 1, 1);
    expect(pool.active[0]).toBe(1);
    pool.update(FLASH_LIFE / 2);
    expect(pool.active[0]).toBe(1); // aún vivo a mitad de vida
    pool.update(FLASH_LIFE); // total > FLASH_LIFE
    expect(pool.active[0]).toBe(0);
  });

  it('el tamaño por defecto es FLASH_POOL_SIZE (8)', () => {
    const pool = new FlashPool();
    expect(pool.capacity).toBe(FLASH_POOL_SIZE);
    expect(FLASH_POOL_SIZE).toBe(8);
  });
});

describe('reactToEvent → flashes', () => {
  function makeEvent(type: GameEvent['type'], intensity = 1, label = ''): GameEvent {
    return { type, x: 3, y: 4, intensity, label };
  }

  it("'enemy-hit' dispara un fogonazo blanco de ~0.5 u en el punto de impacto", () => {
    const particles = new ParticlePool(64);
    const effects = createEffectsState();
    const flashes = new FlashPool();
    reactToEvent(makeEvent('enemy-hit', 1), particles, effects, null, Math.random, undefined, flashes);
    expect(flashes.active[0]).toBe(1);
    expect(flashes.x[0]).toBe(3);
    expect(flashes.z[0]).toBe(4);
    expect(flashes.size[0]).toBeCloseTo(0.5);
    expect(flashes.r[0]).toBeCloseTo(1);
    expect(flashes.g[0]).toBeCloseTo(1);
    expect(flashes.b[0]).toBeCloseTo(1);
  });

  it("'barrel-explosion' nunca supera BARREL_BLAST_RADIUS aunque la intensidad sea mayor (lo visual promete lo mecánico, AGENTS.md)", () => {
    const particles = new ParticlePool(64);
    const effects = createEffectsState();
    const flashes = new FlashPool();
    reactToEvent(makeEvent('barrel-explosion', 999), particles, effects, null, Math.random, undefined, flashes);
    expect(flashes.active[0]).toBe(1);
    // `Math.fround`: `size` es un Float32Array, así que el propio
    // BARREL_BLAST_RADIUS (float64) pierde precisión al guardarse (2.4 →
    // 2.4000000953674316) — comparar contra el float64 exacto sería más
    // estricto que la precisión real del pool y un falso negativo.
    expect(flashes.size[0]).toBeLessThanOrEqual(Math.fround(BARREL_BLAST_RADIUS));
  });

  it("'barrel-explosion' con la intensidad real (BARREL_BLAST_RADIUS) no se recorta", () => {
    const particles = new ParticlePool(64);
    const effects = createEffectsState();
    const flashes = new FlashPool();
    reactToEvent(makeEvent('barrel-explosion', BARREL_BLAST_RADIUS), particles, effects, null, Math.random, undefined, flashes);
    expect(flashes.size[0]).toBeCloseTo(BARREL_BLAST_RADIUS);
  });

  it("un evento sin fogonazo definido (p.ej. 'item-pickup') no dispara flash", () => {
    const particles = new ParticlePool(64);
    const effects = createEffectsState();
    const flashes = new FlashPool();
    reactToEvent(makeEvent('item-pickup', 1, 'coin'), particles, effects, null, Math.random, undefined, flashes);
    expect(flashes.active[0]).toBe(0);
  });

  it('flashes=null (default) no rompe la llamada existente', () => {
    const particles = new ParticlePool(64);
    const effects = createEffectsState();
    expect(() => reactToEvent(makeEvent('enemy-hit', 1), particles, effects)).not.toThrow();
  });

  it("'boss-hit' con más daño produce un fogonazo mayor que uno con menos (misma escala que el trauma)", () => {
    const particles = new ParticlePool(64);
    const weakFlashes = new FlashPool();
    reactToEvent(makeEvent('boss-hit', 1), particles, createEffectsState(), null, Math.random, undefined, weakFlashes);
    const strongFlashes = new FlashPool();
    reactToEvent(makeEvent('boss-hit', 8), particles, createEffectsState(), null, Math.random, undefined, strongFlashes);
    expect(strongFlashes.size[0]).toBeGreaterThan(weakFlashes.size[0]);
  });
});
