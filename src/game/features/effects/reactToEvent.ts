/**
 * Traduce un GameEvent de la sim en reacciones de effects: burst de partículas,
 * trauma de cámara, hit-stop y háptica. Se llama una vez por evento drenado
 * desde el mismo `drainEvents` de useGameLoop.ts (la cola solo se puede
 * drenar una vez por frame; centralizar aquí evita un segundo consumidor).
 *
 * Función pura respecto a sus argumentos explícitos (solo muta los pools y
 * el EffectsState recibidos); no importa React ni three.js.
 */

import type { GameEvent, GameEventType } from '@/engine/events';
import { BARREL_BLAST_RADIUS } from '@/game/features/hazards/constants';
import type { WeaponMode } from '@/game/world/types';
import { BURST_BY_EVENT, ITEM_PICKUP_COLOR, PROJECTILE_WALL_COLOR } from './burstTable';
import { vibrate, HAPTIC_PATTERN } from './haptics';
import { addTrauma, triggerHitStop, type EffectsState } from './effectsState';
import type { FlashPool } from './flash';
import { particleTextureIndex, type ParticlePool, type ParticleTextureName } from './particles';
import type { ShockwavePool } from './shockwave';

/** Duración de hit-stop (s) en golpes fuertes: embestida con daño ≥2, explosión, muerte de enemigo. */
const HIT_STOP_DURATION = 0.08;
/**
 * Duración de hit-stop del clímax de derrota de jefe (GDD §15.1 punto 8: "la
 * mayor... pausa de impacto de todo el juego"): más larga que cualquier otro
 * hit-stop del juego a propósito.
 */
const BOSS_DEFEATED_HIT_STOP_DURATION = 0.22;
/** Umbral de daño de embestida/impacto para considerar "golpe fuerte" (GDD/consigna de la tarea). */
const STRONG_HIT_DAMAGE_THRESHOLD = 2;

/**
 * Radio base (u de mundo) del fogonazo de impacto (VFX_PLAN T3) por tipo de
 * evento: eventos ausentes de esta tabla no disparan fogonazo. Se escala por
 * la misma `intensityScale` que ya afina el trauma más abajo y se topa a
 * `FLASH_MAX_SIZE`. `barrel-explosion` queda FUERA de esta tabla a propósito
 * (ver el bloque de spawn más abajo): su tamaño es el radio REAL de la
 * explosión, no un valor de diseño fijo.
 *
 * - `enemy-hit` (~0.5 u, valor de referencia de VFX_PLAN T3): impacto normal.
 * - `boss-hit`: mayor que `enemy-hit`, mismo criterio que su trauma en
 *   `burstTable.ts` (0.35 vs 0.06) — golpear a un jefe debe sentirse más grande.
 * - `shield-block`: algo mayor que `enemy-hit` (su trauma, 0.12, también es
 *   mayor) — un bloqueo con éxito merece leerse bien.
 * - `wall-bounce`/`projectile-wall`: menores, "más humildes" que un impacto
 *   contra un enemigo (mismo criterio que su burst en `burstTable.ts`).
 * - `boss-immune-hit`: el más pequeño con diferencia (comentario de
 *   `burstTable.ts`: "deliberadamente más pequeño... no hay daño real").
 */
const FLASH_SIZE_BY_EVENT: Partial<Record<GameEventType, number>> = {
  'enemy-hit': 0.5,
  'boss-hit': 0.7,
  'shield-block': 0.55,
  'wall-bounce': 0.4,
  'projectile-wall': 0.35,
  'boss-immune-hit': 0.3,
};

/** Techo del radio del fogonazo para cualquier evento que no sea 'barrel-explosion' (evita que un intensityScale alto lo desproporcione). */
const FLASH_MAX_SIZE = 0.9;

function hexToRgb01(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function reactToEvent(
  event: GameEvent,
  particles: ParticlePool,
  effects: EffectsState,
  shockwaves: ShockwavePool | null = null,
  rng: () => number = Math.random,
  // Color hex del arma activa (WEAPON_COLOR[hero.weaponMode], resuelto por el
  // llamador — este módulo se mantiene sin importar three.js). 'launch' cubre
  // TANTO el lanzamiento corporal como el disparo de flecha/hechizo (un solo
  // evento para las 3 armas, ver combat.ts/launch.ts), así que su color no
  // puede ser fijo en BURST_BY_EVENT sin quedar desincronizado del arma activa
  // (playtest: "las partículas al moverte mantienen el color anterior").
  heroWeaponColorHex?: string,
  // Fogonazo de impacto (VFX_PLAN T3): pool opcional con default `null`,
  // mismo patrón que `shockwaves` arriba, para no romper las llamadas
  // existentes (tests, y cualquier futuro llamador que no lo necesite). Va
  // AL FINAL DEL TODO, después de `heroWeaponColorHex`: ese parámetro ya es
  // hoy el 6º y useGameLoop.ts lo pasa posicionalmente, así que colarse
  // delante de él rompería esa llamada real.
  flashes: FlashPool | null = null,
  // Arma activa del héroe (`hero.weaponMode`, resuelto por el llamador). Es la
  // IDENTIDAD del arma, separada de su COLOR: la sustitución de textura de
  // 'launch' (copo de Hielo, ver más abajo) se decidía antes comparando
  // `heroWeaponColorHex` contra el hex de Hielo, así que repintar el arma
  // habría apagado los copos EN SILENCIO (sin error ni test rojo — el test
  // comparaba contra la misma constante). Con el modo, renombrarlo o quitarlo
  // es un error de tipo en compilación. `WeaponMode` es un `import type` del
  // mundo simulado: no arrastra three.js a este módulo, que es lo que obliga a
  // que el color siga llegando ya resuelto desde el llamador (WEAPON_COLOR son
  // `three.Color` de render/assets.ts). Va detrás de `flashes` por el mismo
  // motivo que este va detrás de `heroWeaponColorHex`: useGameLoop.ts pasa
  // todos estos por posición, así que lo nuevo se añade AL FINAL, nunca en medio.
  heroWeaponMode?: WeaponMode,
): void {
  const spec = BURST_BY_EVENT[event.type];

  // Onda expansiva de la explosión de barril (GDD §12: "gran onda"): el
  // evento trae el radio de la explosión como intensidad.
  if (event.type === 'barrel-explosion' && shockwaves !== null) {
    shockwaves.spawn(event.x, event.y, Math.max(1, event.intensity));
  }

  // Color especial de recogida (dorado/rosa/azul) según el tipo de objeto.
  let color = spec.color;
  if (event.type === 'item-pickup' && event.label in ITEM_PICKUP_COLOR) {
    color = ITEM_PICKUP_COLOR[event.label];
  } else if (event.type === 'launch' && heroWeaponColorHex) {
    color = heroWeaponColorHex;
  } else if (event.type === 'projectile-wall' && event.label in PROJECTILE_WALL_COLOR) {
    color = PROJECTILE_WALL_COLOR[event.label];
  }

  // Extraído fuera del bloque de partículas (antes vivía solo ahí) para que
  // el fogonazo de impacto, más abajo, reutilice el MISMO color ya resuelto
  // arriba sin recalcularlo (VFX_PLAN T3: "reutiliza el color ya resuelto").
  const [r, g, b] = hexToRgb01(color);

  // Textura del burst (VFX_PLAN.md, ampliación 2026-08-11: "el ataque de
  // hielo podría tener alrededor partículas de nieve"): por defecto la que
  // fija `burstTable.ts` para el evento; el arma Hielo (`arrow` en el mundo
  // simulado, "Hielo" en WeaponBar) sustituye el copo `fan_c` en los dos
  // eventos donde ya se sustituye el COLOR arriba, mismo criterio.
  // 'projectile-wall' trae el arma en `event.label` ('arrow'|'spell'), igual
  // que la sustitución de color de arriba. 'launch' NO lleva arma en su label
  // (siempre se emite con label ''), así que el arma llega por el parámetro
  // `heroWeaponMode` — el MODO, no el color: la paleta del arma puede cambiar
  // (Hielo se llamaba "Fuego" hace nada) sin apagar los copos en silencio.
  let textureName: ParticleTextureName = spec.texture;
  if (event.type === 'launch' && heroWeaponMode === 'arrow') {
    textureName = 'snowflake';
  } else if (event.type === 'projectile-wall' && event.label === 'arrow') {
    textureName = 'snowflake';
  }

  if (spec.count > 0) {
    // La intensidad del evento (fuerza de lanzamiento, velocidad de impacto,
    // daño...) escala moderadamente el tamaño del burst sin descontrolar el pool.
    const scale = event.type === 'launch' || event.type === 'wall-bounce' ? Math.max(0.4, event.intensity) : 1;
    particles.burst(
      event.x,
      event.y,
      Math.round(spec.count * (event.type === 'barrel-explosion' ? 1 : Math.min(1.6, 0.6 + scale * 0.5))),
      spec.speed,
      spec.size,
      spec.life,
      r,
      g,
      b,
      rng,
      particleTextureIndex(textureName),
    );
  }

  // Extraído fuera del bloque de trauma (antes vivía solo ahí) para que el
  // tamaño del fogonazo de impacto, más abajo, reutilice la MISMA escala:
  // wall-bounce/boss-hit escalan por la magnitud real del golpe (velocidad/
  // daño), el resto usa un multiplicador fijo.
  const intensityScale =
    event.type === 'wall-bounce'
      ? Math.min(1.5, Math.max(0.3, event.intensity / 4))
      : event.type === 'boss-hit'
        ? Math.min(1.3, Math.max(0.35, event.intensity / 4))
        : 1;

  if (spec.trauma > 0) {
    addTrauma(effects, spec.trauma * intensityScale);
  }

  // Fogonazo de impacto (VFX_PLAN T3): destello aditivo brevísimo en el punto
  // de impacto, mismo color `r,g,b` ya resuelto arriba. 'barrel-explosion' es
  // un caso especial: su radio ES el radio real de la explosión
  // (event.intensity), topado a BARREL_BLAST_RADIUS (AGENTS.md: lo visual
  // promete lo mecánico — un fogonazo más grande que el radio de daño real
  // mentiría al jugador). El resto usa el tamaño base de FLASH_SIZE_BY_EVENT
  // escalado por la misma intensityScale del trauma, topado a FLASH_MAX_SIZE.
  if (flashes !== null) {
    if (event.type === 'barrel-explosion') {
      flashes.spawn(event.x, event.y, Math.min(event.intensity, BARREL_BLAST_RADIUS), r, g, b);
    } else {
      const baseSize = FLASH_SIZE_BY_EVENT[event.type];
      if (baseSize !== undefined) {
        flashes.spawn(event.x, event.y, Math.min(FLASH_MAX_SIZE, baseSize * intensityScale), r, g, b);
      }
    }
  }

  // Hit-stop: golpes fuertes (embestida/impacto con daño ≥2), explosión de barril, muerte de enemigo.
  const isStrongHit =
    (event.type === 'enemy-hit' || event.type === 'boss-hit' || event.type === 'player-damaged') &&
    event.intensity >= STRONG_HIT_DAMAGE_THRESHOLD;
  if (isStrongHit || event.type === 'barrel-explosion' || event.type === 'enemy-died') {
    triggerHitStop(effects, HIT_STOP_DURATION);
  }
  // Clímax de derrota de jefe (GDD §15.1 punto 8): hit-stop propio, más largo
  // que el resto del juego a propósito (ver BOSS_DEFEATED_HIT_STOP_DURATION).
  if (event.type === 'boss-defeated') {
    triggerHitStop(effects, BOSS_DEFEATED_HIT_STOP_DURATION);
  }

  // Háptica (GDD §12/ARCHITECTURE "Móvil"): daño recibido, explosión, victoria.
  if (event.type === 'player-damaged') {
    vibrate(HAPTIC_PATTERN.damage);
  } else if (event.type === 'barrel-explosion') {
    vibrate([...HAPTIC_PATTERN.explosion]);
  } else if (event.type === 'victory' || event.type === 'boss-defeated') {
    vibrate([...HAPTIC_PATTERN.victory]);
  }
}
