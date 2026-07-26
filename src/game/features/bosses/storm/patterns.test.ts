/**
 * Tests de PROPIEDAD de los generadores de La Tormenta (GDD §15.5, Fase B4):
 * para muchas semillas y las tres fases se comprueba, sobre las EMISIONES
 * REALES, que el pasillo garantizado por construcción se cumple siempre. No son
 * tests de ejemplo: barren ≥ 100 semillas del rng determinista del proyecto y
 * verifican invariantes geométricos, no salidas concretas.
 *
 * Recordatorio de honestidad (ver cabecera de patterns.ts): las balas vuelan en
 * línea recta radial, conservan su ángulo polar, y todas nacen en
 * `STORM_MIN_EMISSION_RADIUS`; por eso el pasillo se mide como el mayor arco
 * angular vacío de cada ola en el radio de emisión (el más estrecho) y basta
 * con exigir ahí ≥ pasillo mínimo.
 */

import { describe, expect, it } from 'vitest';

import { createRng } from '@/engine/rng';
import { PROJECTILE_LIFETIME } from '@/game/features/combat/constants';
import {
  STORM_BULLET_SPEED,
  STORM_BURST_CORRIDORS,
  STORM_HERO_DODGE_SPEED,
  STORM_MAX_LIVE_BULLETS_BUDGET,
  STORM_MIN_EMISSION_RADIUS,
  STORM_REACH_RADIUS,
  STORM_RING_COUNT,
  STORM_RING_INTERVAL,
  STORM_SPIRAL_ANGULAR_SPEED,
  stormCorridorMinAngle,
  stormRingGapShiftMax,
} from './constants';
import {
  createStormState,
  fireRadialBurst,
  resetBurst,
  resetRings,
  resetSpiral,
  stepRings,
  stepSpiral,
  type StormEmit,
} from './patterns';

const PHASES: readonly (1 | 2 | 3)[] = [1, 2, 3];
const SEEDS = 120; // ≥ 100 semillas por fase (req. 7)
const DT = 1 / 60; // mismo dt fijo que la sim
const CENTER_X = 0;
const CENTER_Y = 0;
/** Ángulo mínimo de pasillo en el radio de emisión (el más estrecho). */
const CORRIDOR_MIN_ANGLE = stormCorridorMinAngle(STORM_MIN_EMISSION_RADIUS);
const EPS = 1e-9;

interface Bullet {
  angle: number; // ángulo polar (rad), = ángulo de emisión (movimiento radial)
  originDist: number; // distancia del origen al centro
  speed: number;
}
type Wave = Bullet[];

/** Recolector de olas: agrupa las balas emitidas en la MISMA llamada al stepper. */
function makeCollector(): { emit: StormEmit; flush: () => void; waves: Wave[] } {
  const waves: Wave[] = [];
  let current: Wave = [];
  const emit: StormEmit = (originX, originY, dirX, dirY, speed) => {
    current.push({
      angle: Math.atan2(dirY, dirX),
      originDist: Math.hypot(originX - CENTER_X, originY - CENTER_Y),
      speed,
    });
  };
  const flush = (): void => {
    if (current.length > 0) {
      waves.push(current);
      current = [];
    }
  };
  return { emit, flush, waves };
}

/** Normaliza un ángulo a [0, 2π). */
function norm(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

/** Mayor arco angular vacío de una ola + su centro (sobre las emisiones reales). */
function maxGapAndCenter(angles: number[]): { gap: number; center: number } {
  const sorted = angles.map(norm).sort((a, b) => a - b);
  let gap = 0;
  let center = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
    const g = b - a;
    if (g > gap) {
      gap = g;
      center = norm(a + g / 2);
    }
  }
  return { gap, center };
}

/** Cuenta cuántos arcos vacíos de la ola llegan al umbral (para la ráfaga: K pasillos). */
function countGapsAtLeast(angles: number[], threshold: number): number {
  const sorted = angles.map(norm).sort((a, b) => a - b);
  let n = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
    if (b - a >= threshold) n++;
  }
  return n;
}

/** Diferencia angular con signo mínima entre dos ángulos, en (−π, π]. */
function angularDelta(a: number, b: number): number {
  let d = norm(b) - norm(a);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

// ── Corridor lineal común: cada bala nace a r_min y no a bocajarro ──────────

/**
 * (c) ninguna bala supera la rapidez máxima y (d) ninguna nace por debajo del
 * radio de emisión mínimo, para TODAS las balas de todas las olas.
 *
 * Busca CONTRAEJEMPLO y solo entonces afirma, en vez de gastar un `expect` por
 * bala: es exactamente la misma propiedad universal (se recorren todas las
 * balas, sin muestrear ni relajar umbrales), pero cada `expect` de vitest cuesta
 * ~10 µs y estos barridos emiten decenas de miles de balas. Con dos `expect` por
 * bala este fichero se iba a ~1.5 s (63 840 aserciones solo en el subtest del
 * hueco apuntado) y bajo contención de CPU ese subtest rozaba el timeout de 5 s
 * de vitest y flakeaba; la simulación en sí cuesta <10 ms. De paso el mensaje de
 * fallo identifica la ola y la bala culpables, que el `expect` por bala no daba.
 */
function assertSpeedAndRadius(waves: Wave[]): void {
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w];
    for (let i = 0; i < wave.length; i++) {
      const b = wave[i];
      const tooFast = !(b.speed <= STORM_BULLET_SPEED + EPS); // (c)
      const tooClose = !(b.originDist >= STORM_MIN_EMISSION_RADIUS - EPS); // (d)
      if (tooFast || tooClose) {
        expect.fail(
          `ola ${w}, bala ${i}: speed=${b.speed} (máx ${STORM_BULLET_SPEED}), ` +
            `originDist=${b.originDist} (mín ${STORM_MIN_EMISSION_RADIUS})`,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Espiral
// ─────────────────────────────────────────────────────────────────────────────

function runSpiral(phase: 1 | 2 | 3, seed: number): Wave[] {
  const s = createStormState();
  const c = makeCollector();
  resetSpiral(s, CENTER_X, CENTER_Y, createRng(seed));
  let active = true;
  let guard = 0;
  while (active && guard++ < 100000) {
    active = stepSpiral(s, DT, phase, c.emit);
    c.flush();
  }
  return c.waves;
}

describe('espiral: pasillo por construcción', () => {
  it('cada ola deja un hueco ≥ pasillo mínimo, para ≥100 semillas y las 3 fases', () => {
    for (const phase of PHASES) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const waves = runSpiral(phase, seed);
        expect(waves.length).toBeGreaterThan(0);
        for (const wave of waves) {
          const { gap } = maxGapAndCenter(wave.map((b) => b.angle));
          expect(gap).toBeGreaterThanOrEqual(CORRIDOR_MIN_ANGLE - EPS); // (a)
        }
        assertSpeedAndRadius(waves);
      }
    }
  });

  it('el hueco rota a velocidad ALCANZABLE por el héroe (REACH·ω ≤ v_héroe)', () => {
    // (b) para la espiral: el hueco a radio fijo rota a ω; el héroe lo sigue a
    // radio·ω. Cota de construcción, independiente de la semilla.
    expect(STORM_REACH_RADIUS * STORM_SPIRAL_ANGULAR_SPEED).toBeLessThanOrEqual(STORM_HERO_DODGE_SPEED + EPS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Anillos
// ─────────────────────────────────────────────────────────────────────────────

function runRings(phase: 1 | 2 | 3, seed: number): Wave[] {
  const s = createStormState();
  const c = makeCollector();
  resetRings(s, CENTER_X, CENTER_Y, phase, createRng(seed));
  let active = true;
  let guard = 0;
  while (active && guard++ < 100000) {
    active = stepRings(s, DT, phase, c.emit, createRng(seed ^ 0x9e3779b1));
    c.flush();
  }
  return c.waves;
}

describe('anillos: pasillo por construcción + alcanzabilidad', () => {
  it('cada anillo deja un hueco ≥ pasillo mínimo, ≥100 semillas y 3 fases', () => {
    for (const phase of PHASES) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const waves = runRings(phase, seed);
        expect(waves.length).toBe(STORM_RING_COUNT[phase - 1]);
        for (const wave of waves) {
          const { gap } = maxGapAndCenter(wave.map((b) => b.angle));
          expect(gap).toBeGreaterThanOrEqual(CORRIDOR_MIN_ANGLE - EPS); // (a)
        }
        assertSpeedAndRadius(waves);
      }
    }
  });

  it('con hueco APUNTADO (aimedGapAngle, tuning post-playtest 2026-07-15) la garantía de pasillo se conserva para cualquier ángulo forzado', () => {
    // Barre ángulos forzados repartidos por toda la circunferencia (no solo
    // uno) y las 3 fases: la anchura del hueco (`emitRing`) es independiente
    // de dónde esté centrado, así que debe seguir cumpliendo el pasillo
    // mínimo exactamente igual que con el hueco aleatorio de siempre.
    const AIMED_ANGLES = [0, 0.7, 1.3, Math.PI, -2.1, -0.5, 2.9];
    for (const phase of PHASES) {
      for (const aimedAngle of AIMED_ANGLES) {
        for (let seed = 1; seed <= 20; seed++) {
          const s = createStormState();
          const c = makeCollector();
          resetRings(s, CENTER_X, CENTER_Y, phase, createRng(seed), aimedAngle);
          // El primer hueco queda fijado EXACTAMENTE en el ángulo pedido.
          expect(s.ringGapAngle).toBe(aimedAngle);
          let active = true;
          let guard = 0;
          while (active && guard++ < 100000) {
            active = stepRings(s, DT, phase, c.emit, createRng(seed ^ 0x9e3779b1));
            c.flush();
          }
          expect(c.waves.length).toBe(STORM_RING_COUNT[phase - 1]);
          for (const wave of c.waves) {
            const { gap } = maxGapAndCenter(wave.map((b) => b.angle));
            expect(gap).toBeGreaterThanOrEqual(CORRIDOR_MIN_ANGLE - EPS); // (a) misma garantía, hueco forzado
          }
          assertSpeedAndRadius(c.waves);
          // El primer anillo emitido debe abrir su hueco centrado EXACTAMENTE
          // en el ángulo pedido (no en uno aleatorio, y no solo "cerca"):
          // `emitRing` reparte las balas simétricamente a partir de
          // `ringGapAngle ± gap/2`, así que el centro medido del hueco debe
          // coincidir con el ángulo pedido salvo error de punto flotante.
          const { center: firstGapCenter } = maxGapAndCenter(c.waves[0].map((b) => b.angle));
          const delta = Math.abs(angularDelta(firstGapCenter, aimedAngle));
          expect(delta).toBeLessThanOrEqual(1e-6); // confirma que "apuntar" de verdad apunta
        }
      }
    }
  });

  it('el hueco de anillos consecutivos se desplaza ≤ lo alcanzable a velocidad de héroe', () => {
    for (const phase of PHASES) {
      const shiftMax = stormRingGapShiftMax(phase);
      // La cota es alcanzable por construcción: el arco a recorrer (REACH·Δφ)
      // cabe en v_héroe·T (T = intervalo entre anillos de la fase).
      const interval = STORM_RING_INTERVAL[phase - 1];
      expect(STORM_REACH_RADIUS * shiftMax).toBeLessThanOrEqual(STORM_HERO_DODGE_SPEED * interval + EPS);
      for (let seed = 1; seed <= SEEDS; seed++) {
        const waves = runRings(phase, seed);
        let prev: number | null = null;
        for (const wave of waves) {
          const { center } = maxGapAndCenter(wave.map((b) => b.angle));
          if (prev !== null) {
            const delta = Math.abs(angularDelta(prev, center));
            expect(delta).toBeLessThanOrEqual(shiftMax + 1e-6); // (b): alcanzable
          }
          prev = center;
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ráfaga radial
// ─────────────────────────────────────────────────────────────────────────────

describe('ráfaga radial: K pasillos completos', () => {
  it('deja exactamente K huecos, cada uno ≥ pasillo mínimo, ≥100 semillas y 3 fases', () => {
    for (const phase of PHASES) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const c = makeCollector();
        const s = createStormState();
        resetBurst(s, CENTER_X, CENTER_Y, createRng(seed));
        fireRadialBurst(s, phase, c.emit);
        c.flush();
        expect(c.waves.length).toBe(1);
        const angles = c.waves[0].map((b) => b.angle);
        const { gap } = maxGapAndCenter(angles);
        expect(gap).toBeGreaterThanOrEqual(CORRIDOR_MIN_ANGLE - EPS); // (a)
        // K pasillos completos (GDD §15.5): exactamente STORM_BURST_CORRIDORS
        // arcos alcanzan el pasillo mínimo.
        expect(countGapsAtLeast(angles, CORRIDOR_MIN_ANGLE - EPS)).toBe(STORM_BURST_CORRIDORS);
        assertSpeedAndRadius(c.waves);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Presupuesto de pool (e)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simula un patrón contra un contador de balas VIVAS y devuelve el pico. Cada
 * bala vuela radialmente y muere al tocar el muro (arena cuadrada de media-arista
 * `HALF`) o al agotar PROJECTILE_LIFETIME. Distancia al muro desde el centro
 * en dirección θ = HALF / max(|cosθ|,|sinθ|).
 */
const ARENA_HALF = 6.08; // interior de sala ~13×13, muro 0.42

function bulletLife(angle: number): number {
  const wallDist = ARENA_HALF / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
  const travel = (wallDist - STORM_MIN_EMISSION_RADIUS) / STORM_BULLET_SPEED;
  return Math.min(PROJECTILE_LIFETIME, Math.max(0, travel));
}

interface LiveSim {
  deaths: number[]; // world-time de muerte de cada bala viva pendiente
  now: number;
  peak: number;
}

function makeLiveSim(): { sim: LiveSim; emit: StormEmit; tick: () => void } {
  const sim: LiveSim = { deaths: [], now: 0, peak: 0 };
  const emit: StormEmit = (_originX, _originY, dirX, dirY) => {
    const angle = Math.atan2(dirY, dirX);
    sim.deaths.push(sim.now + bulletLife(angle));
  };
  const tick = (): void => {
    sim.now += DT;
    sim.deaths = sim.deaths.filter((d) => d > sim.now);
    if (sim.deaths.length > sim.peak) sim.peak = sim.deaths.length;
  };
  return { sim, emit, tick };
}

describe('presupuesto de pool: pico de balas vivas ≤ techo', () => {
  it('cada patrón standalone (fase 2, densa) se mantiene bajo el presupuesto', () => {
    for (const phase of PHASES) {
      for (let seed = 1; seed <= 40; seed++) {
        // Espiral
        {
          const s = createStormState();
          const { sim, emit, tick } = makeLiveSim();
          resetSpiral(s, CENTER_X, CENTER_Y, createRng(seed));
          let active = true;
          let guard = 0;
          while ((active || sim.deaths.length > 0) && guard++ < 100000) {
            if (active) active = stepSpiral(s, DT, phase, emit);
            tick();
          }
          expect(sim.peak).toBeGreaterThan(0);
          expect(sim.peak).toBeLessThanOrEqual(STORM_MAX_LIVE_BULLETS_BUDGET);
        }
        // Anillos
        {
          const s = createStormState();
          const { sim, emit, tick } = makeLiveSim();
          resetRings(s, CENTER_X, CENTER_Y, phase, createRng(seed));
          let active = true;
          let guard = 0;
          while ((active || sim.deaths.length > 0) && guard++ < 100000) {
            if (active) active = stepRings(s, DT, phase, emit, createRng(seed ^ 0x1234));
            tick();
          }
          expect(sim.peak).toBeLessThanOrEqual(STORM_MAX_LIVE_BULLETS_BUDGET);
        }
      }
    }
  });

  it('la CADENA espiral→anillos de fase 3 (el peor solape) queda bajo el techo', () => {
    // GDD §15.5: en fase 3 encadena espiral→anillos sin pausa. Es el escenario
    // de más balas vivas simultáneas (cola de la espiral + arranque de anillos).
    for (let seed = 1; seed <= 60; seed++) {
      const s = createStormState();
      const { sim, emit, tick } = makeLiveSim();
      resetSpiral(s, CENTER_X, CENTER_Y, createRng(seed));
      let spiralActive = true;
      let ringsActive = false;
      let guard = 0;
      while ((spiralActive || ringsActive || sim.deaths.length > 0) && guard++ < 100000) {
        if (spiralActive) {
          spiralActive = stepSpiral(s, DT, 3, emit);
          if (!spiralActive) {
            // Encadena anillos SIN pausa el mismo instante.
            resetRings(s, CENTER_X, CENTER_Y, 3, createRng(seed ^ 0xabcd));
            ringsActive = true;
          }
        } else if (ringsActive) {
          ringsActive = stepRings(s, DT, 3, emit, createRng(seed ^ 0x55aa));
        }
        tick();
      }
      expect(sim.peak).toBeLessThanOrEqual(STORM_MAX_LIVE_BULLETS_BUDGET);
    }
  });
});
