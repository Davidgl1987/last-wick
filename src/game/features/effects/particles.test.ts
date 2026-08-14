/**
 * Tests headless del pool de partículas (fase 4): preasignado, nunca crece,
 * recicla slots al saturarse y expira partículas por vida. Sin three.js.
 */

import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng';
import { LIGHT_MASK_NAMES, SPLAT_NAMES } from '@/game/render/vfx-textures';
import { ParticlePool, PARTICLE_POOL_SIZE, PARTICLE_TEXTURES, particleTextureIndex, type ParticleTextureName } from './particles';
import { reactToEvent } from './reactToEvent';
import { createEffectsState } from './effectsState';
import { ShockwavePool } from './shockwave';
import type { GameEvent } from '@/engine/events';

describe('ParticlePool', () => {
  it('el pool no crece: los arrays mantienen su capacidad aunque se sature', () => {
    const pool = new ParticlePool(16);
    const rng = createRng(7);
    for (let i = 0; i < 10; i++) {
      pool.burst(0, 0, 8, 3, 0.1, 0.5, 1, 1, 1, rng); // 80 spawns sobre 16 slots
    }
    expect(pool.capacity).toBe(16);
    expect(pool.x.length).toBe(16);
    expect(pool.active.length).toBe(16);
    expect(pool.aliveCount).toBeLessThanOrEqual(16);
  });

  it('update expira partículas al agotar su vida y libera slots', () => {
    const pool = new ParticlePool(8);
    const rng = createRng(7);
    pool.burst(0, 0, 8, 2, 0.1, 0.3, 1, 0, 0, rng); // vida 0.3 s
    expect(pool.aliveCount).toBe(8);
    pool.update(0.1);
    expect(pool.aliveCount).toBe(8); // aún vivas
    pool.update(0.25); // total 0.35 > 0.3
    expect(pool.aliveCount).toBe(0);
  });

  it('las partículas se mueven y caen (integración simple)', () => {
    const pool = new ParticlePool(4);
    pool.spawn(1, 2, 0, 3, 1, 0.1, 1, 1, 1, 1, 0);
    const x0 = pool.x[0];
    pool.update(0.1);
    expect(pool.x[0]).toBeGreaterThan(x0); // avanza en su dirección
    expect(pool.y[0]).toBeGreaterThanOrEqual(0); // nunca bajo el suelo
  });

  it('el tamaño por defecto es el del presupuesto (~256)', () => {
    const pool = new ParticlePool();
    expect(pool.capacity).toBe(PARTICLE_POOL_SIZE);
    expect(PARTICLE_POOL_SIZE).toBe(256);
  });

  it('spawn() escribe rot tal cual se pasa, coherente con el resto de campos visuales (size/r/g/b)', () => {
    const pool = new ParticlePool(4);
    pool.spawn(0, 0, 0, 1, 1, 0.1, 1, 1, 1, 1, 2.35);
    // toBeCloseTo, no toBe: rot vive en un Float32Array (mismo motivo que el
    // resto de campos numéricos del pool), y 2.35 no es representable exacto
    // en float32 (redondea a 2.3499999...).
    expect(pool.rot[0]).toBeCloseTo(2.35, 5);
  });

  it('burst() genera rot con el rng inyectado (mismo sitio/estilo que angle/speed/size): reproducible y en [0, 2π)', () => {
    const poolA = new ParticlePool(8);
    poolA.burst(0, 0, 5, 3, 0.1, 0.5, 1, 1, 1, createRng(99));
    const poolB = new ParticlePool(8);
    poolB.burst(0, 0, 5, 3, 0.1, 0.5, 1, 1, 1, createRng(99));

    for (let i = 0; i < 5; i++) {
      expect(poolA.rot[i]).toBeGreaterThanOrEqual(0);
      expect(poolA.rot[i]).toBeLessThan(Math.PI * 2);
      // mismo seed → misma secuencia del rng → mismo rot (determinismo, clave para '?seed=' y replays)
      expect(poolA.rot[i]).toBe(poolB.rot[i]);
    }
    // partículas distintas del mismo burst reciben rotaciones distintas (si no, las 48
    // esferas-ahora-splats de un barril seguirían leyéndose como copias idénticas)
    const distinctRot = new Set(Array.from(poolA.rot.slice(0, 5)));
    expect(distinctRot.size).toBeGreaterThan(1);
  });

  it('spawn() escribe tex tal cual se pasa; sin argumento cae al default 0 (splat02, "resto")', () => {
    const pool = new ParticlePool(4);
    pool.spawn(0, 0, 0, 1, 1, 0.1, 1, 1, 1, 1, 0, 3);
    expect(pool.tex[0]).toBe(3);

    const poolDefault = new ParticlePool(4);
    // Sin el último argumento: mismo caso que el único llamador externo de
    // spawn() fuera de este módulo (HeroView.tsx, burst de cambio de arma),
    // que no pasa tex — debe seguir compilando y comportándose como antes.
    poolDefault.spawn(0, 0, 0, 1, 1, 0.1, 1, 1, 1, 1, 0);
    expect(poolDefault.tex[0]).toBe(0);
  });

  it('burst() escribe LA MISMA textura en todas las partículas del burst (a diferencia de rot, que sí varía por partícula)', () => {
    const pool = new ParticlePool(8);
    pool.burst(0, 0, 5, 3, 0.1, 0.5, 1, 1, 1, createRng(1), 2);
    for (let i = 0; i < 5; i++) {
      expect(pool.tex[i]).toBe(2);
    }
    // Sin el último argumento: default 0, mismo caso que burst() en HeroView.tsx.
    const poolDefault = new ParticlePool(4);
    poolDefault.burst(0, 0, 3, 3, 0.1, 0.5, 1, 1, 1, createRng(1));
    for (let i = 0; i < 3; i++) {
      expect(poolDefault.tex[i]).toBe(0);
    }
  });
});

describe('PARTICLE_TEXTURES ↔ catálogo real de render/vfx-textures.ts', () => {
  it('cada nombre de PARTICLE_TEXTURES existe en el catálogo real (Light Mask o Splat) — atrapa typos que TypeScript no puede: son dos uniones de string independientes a propósito (este módulo no importa three.js)', () => {
    const catalog = new Set<string>([...LIGHT_MASK_NAMES, ...SPLAT_NAMES]);
    for (const name of PARTICLE_TEXTURES) {
      expect(catalog.has(name), `"${name}" no está en LIGHT_MASK_NAMES ni SPLAT_NAMES`).toBe(true);
    }
  });

  it('particleTextureIndex() devuelve el índice posicional de cada nombre, y 0 (splat02) para uno no reconocido', () => {
    for (let i = 0; i < PARTICLE_TEXTURES.length; i++) {
      expect(particleTextureIndex(PARTICLE_TEXTURES[i])).toBe(i);
    }
    expect(particleTextureIndex('no-existe' as ParticleTextureName)).toBe(0);
  });
});

describe('reactToEvent → pools', () => {
  function makeEvent(type: GameEvent['type'], intensity = 1, label = ''): GameEvent {
    return { type, x: 3, y: 4, intensity, label };
  }

  it('un evento con burst activa partículas; uno silencioso no', () => {
    const pool = new ParticlePool(64);
    const effects = createEffectsState();
    const rng = createRng(1);
    reactToEvent(makeEvent('enemy-died'), pool, effects, null, rng);
    expect(pool.aliveCount).toBeGreaterThan(0);

    const silent = new ParticlePool(64);
    reactToEvent(makeEvent('room-entered'), silent, effects, null, rng);
    expect(silent.aliveCount).toBe(0);
  });

  it('la explosión de barril dispara hit-stop, trauma máximo y onda expansiva', () => {
    const pool = new ParticlePool(64);
    const effects = createEffectsState();
    const shockwaves = new ShockwavePool();
    reactToEvent(makeEvent('barrel-explosion', 2.0), pool, effects, shockwaves, createRng(1));
    expect(effects.trauma).toBe(1);
    expect(effects.hitStopRemaining).toBeGreaterThan(0);
    expect(shockwaves.active[0]).toBe(1);
    expect(shockwaves.maxRadius[0]).toBeCloseTo(2.0);
  });

  it('embestida floja (daño 1) NO dispara hit-stop; fuerte (daño ≥2) sí', () => {
    const pool = new ParticlePool(64);
    const weak = createEffectsState();
    reactToEvent(makeEvent('enemy-hit', 1), pool, weak, null, createRng(1));
    expect(weak.hitStopRemaining).toBe(0);

    const strong = createEffectsState();
    reactToEvent(makeEvent('enemy-hit', 2), pool, strong, null, createRng(1));
    expect(strong.hitStopRemaining).toBeGreaterThan(0);
  });

  it("'projectile-wall' (playtest 2026-07-16): chispas del color del arma que impactó, más humildes que 'enemy-hit'", () => {
    const arrowPool = new ParticlePool(64);
    const arrowEffects = createEffectsState();
    reactToEvent(makeEvent('projectile-wall', 1, 'arrow'), arrowPool, arrowEffects, null, createRng(1));
    expect(arrowPool.aliveCount).toBeGreaterThan(0);
    // #54c7ff (WEAPON_COLOR.arrow, render/assets.ts), no el gris genérico de 'wall-bounce'.
    expect(arrowPool.r[0]).toBeCloseTo(0x54 / 255, 2);
    expect(arrowPool.g[0]).toBeCloseTo(0xc7 / 255, 2);
    expect(arrowPool.b[0]).toBeCloseTo(0xff / 255, 2);

    const spellPool = new ParticlePool(64);
    const spellEffects = createEffectsState();
    reactToEvent(makeEvent('projectile-wall', 1, 'spell'), spellPool, spellEffects, null, createRng(1));
    // #d8b4fe (WEAPON_COLOR.spell).
    expect(spellPool.r[0]).toBeCloseTo(0xd8 / 255, 2);
    expect(spellPool.g[0]).toBeCloseTo(0xb4 / 255, 2);
    expect(spellPool.b[0]).toBeCloseTo(0xfe / 255, 2);

    // Más humilde que un impacto a enemigo: menos trauma de cámara.
    const enemyHitEffects = createEffectsState();
    reactToEvent(makeEvent('enemy-hit', 1), new ParticlePool(64), enemyHitEffects, null, createRng(1));
    expect(arrowEffects.trauma).toBeLessThan(enemyHitEffects.trauma);
  });

  // VFX_PLAN.md, ampliación 2026-08-11 (feedback de David: "los barriles
  // parece que sueltan las mismas partículas de cera... pon texturas
  // acordes a explosiones"): cada familia de evento tiene su propia silueta,
  // en vez de la única splat02 que llevaba TODO antes de esto.
  it("familia 'Explosión' (barrel-explosion/boss-defeated/boss-column-broken) usa disc", () => {
    for (const type of ['barrel-explosion', 'boss-defeated', 'boss-column-broken'] as const) {
      const pool = new ParticlePool(64);
      reactToEvent(makeEvent(type, 2), pool, createEffectsState(), null, createRng(1));
      expect(pool.tex[0], type).toBe(particleTextureIndex('disc'));
    }
  });

  it("familia 'Impactos' (enemy-hit/boss-hit/wall-bounce/shield-block/boss-immune-hit) usa shape_e", () => {
    for (const type of ['enemy-hit', 'boss-hit', 'wall-bounce', 'shield-block', 'boss-immune-hit'] as const) {
      const pool = new ParticlePool(64);
      reactToEvent(makeEvent(type, 1), pool, createEffectsState(), null, createRng(1));
      expect(pool.tex[0], type).toBe(particleTextureIndex('shape_e'));
    }
  });

  it("familia 'Resto' (recogida, muerte de enemigo, mejora, polvo de jefe) usa splat02", () => {
    for (const [type, label] of [
      ['item-pickup', 'coin'],
      ['enemy-died', ''],
      ['upgrade-applied', ''],
      ['boss-shard-burst', ''],
    ] as const) {
      const pool = new ParticlePool(64);
      reactToEvent(makeEvent(type, 1, label), pool, createEffectsState(), null, createRng(1));
      expect(pool.tex[0], type).toBe(particleTextureIndex('splat02'));
    }
  });

  it("'launch' con el arma Hielo activa (heroWeaponMode 'arrow') sustituye la textura por defecto (splat02) por el copo snowflake", () => {
    // El arma llega por MODO, no por color: comparar el hex del arma era
    // frágil (repintarla apagaba los copos sin romper ningún test).
    const ice = new ParticlePool(64);
    reactToEvent(makeEvent('launch', 1), ice, createEffectsState(), null, createRng(1), '#54c7ff', null, 'arrow');
    expect(ice.tex[0]).toBe(particleTextureIndex('snowflake'));

    // Otra arma (cuerpo) o ninguna: se queda en la textura por defecto de 'launch'.
    const body = new ParticlePool(64);
    reactToEvent(makeEvent('launch', 1), body, createEffectsState(), null, createRng(1), '#fef08a', null, 'body');
    expect(body.tex[0]).toBe(particleTextureIndex('splat02'));

    const noWeapon = new ParticlePool(64);
    reactToEvent(makeEvent('launch', 1), noWeapon, createEffectsState(), null, createRng(1));
    expect(noWeapon.tex[0]).toBe(particleTextureIndex('splat02'));
  });

  it("'projectile-wall' con label 'arrow' (Hielo) sustituye shape_e por el copo snowflake; con 'spell' se queda en shape_e", () => {
    const arrowPool = new ParticlePool(64);
    reactToEvent(makeEvent('projectile-wall', 1, 'arrow'), arrowPool, createEffectsState(), null, createRng(1));
    expect(arrowPool.tex[0]).toBe(particleTextureIndex('snowflake'));

    const spellPool = new ParticlePool(64);
    reactToEvent(makeEvent('projectile-wall', 1, 'spell'), spellPool, createEffectsState(), null, createRng(1));
    expect(spellPool.tex[0]).toBe(particleTextureIndex('shape_e'));
  });
});
