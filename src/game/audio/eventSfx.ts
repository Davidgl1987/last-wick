/**
 * Traduce un GameEvent de la sim en un sonido: mismo espíritu que
 * `features/effects/reactToEvent.ts` (tabla de datos + una función), pero
 * para audio en vez de partículas/shake. La TABLA (`SFX_BY_EVENT`) es pura y
 * testeable sin navegador; este módulo SÍ puede importar `sfxEngine` (a
 * diferencia de `reactToEvent.ts`, que no importa three.js) porque
 * `sfxEngine.playSfx` ya es no-op seguro sin `AudioContext`.
 *
 * Espacialización barata (sin `PannerNode` 3D, GDD-encargo de audio): el
 * héroe es el "oyente". `pan` sale de la diferencia en X (el plano de mundo
 * es XZ, solo X mapea a estéreo L/R); la atenuación por distancia evita que
 * los enemigos de salas lejanas (patrullan siempre, ver `stepEnemyAi`) suenen
 * igual de fuerte que uno al lado. Los eventos de bus `music` y los propios
 * del héroe (lanzamiento, daño/muerte/revive, foso, recogida, mejoras) NO se
 * atenúan ni panean: son diegéticos del jugador, siempre a volumen pleno y
 * centrados, pase lo que pase con `listenerX/listenerY`.
 */

import type { GameEvent, GameEventType } from '@/engine/events';
import type { WeaponMode } from '@/game/world/types';
import { playSfx } from './sfxEngine';
import type { SfxClipName } from './clips';

export interface EventSfx {
  /** Clip fijo, o variantes entre las que elegir una al azar (enemy-hit/enemy-died). */
  clip: SfxClipName | readonly SfxClipName[];
  volume?: number;
  rateJitter?: number;
  minInterval?: number;
  bus?: 'sfx' | 'music';
}

/**
 * Eventos deliberadamente MUDOS. Cada uno con su porqué: si un GameEventType
 * nuevo no aparece aquí NI en `SFX_BY_EVENT`, `eventSfx.test.ts` falla (en
 * vez de quedar mudo por simple olvido, ver ese test).
 */
export const SILENT_EVENTS: readonly GameEventType[] = [
  // Ya suenan 'doors-open' (sala limpiada) y 'door-locked' (puerta con
  // llave); el aviso de UI (useGameLoop.ts) cubre el resto de casos.
  'room-entered',
  // La fase 'shopping' gobierna `shop-opened` como bucle de reloj desde
  // useGameLoop. Reproducir además este evento como one-shot duplicaría el
  // primer tic al entrar y dejaría sonar el resto del clip tras salir.
  'shop-opened',
  // Rastro de polvo emitido en RÁFAGA mientras un jefe carga (varias veces
  // por segundo, GDD §15.2): puramente visual, sonar saturaría el bus y no
  // aporta nada que 'boss-telegraph' (el aviso real de la carga) no cubra ya.
  'boss-charge-dust',
];

/** Rango en X (u de mundo) que corresponde a paneo estéreo extremo. */
const PAN_RANGE = 8;
/** Distancia (u de mundo) a partir de la cual un sonido posicional deja de oírse. */
const AUDIBLE_RANGE = 26;
/** Velocidad normal de impacto (u/s) que corresponde a volumen máximo de 'wall-bounce'. */
const WALL_BOUNCE_VOLUME_REF = 6;
/** Volumen mínimo de 'wall-bounce' aun en el roce más suave (nunca inaudible del todo). */
const WALL_BOUNCE_VOLUME_FLOOR = 0.2;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Tabla evento → sonido. Los 5 tipos cuyo clip depende del `label`/arma
 * (`launch`, `projectile-wall`, `item-pickup`, `door-locked`,
 * `boss-telegraph`) SÍ tienen entrada aquí (para su `volume`/`bus`/
 * `minInterval`), pero su campo `clip` es un placeholder sin efecto: la
 * resolución real la decide `resolveEventClip` (más abajo), consultada
 * ANTES que esta tabla para esos 5 tipos (ver `pickClip`).
 */
export const SFX_BY_EVENT: Partial<Record<GameEventType, EventSfx>> = {
  launch: { clip: 'launch-body' }, // clip real: resolveEventClip según weaponMode
  'wall-bounce': { clip: 'wall-bounce', rateJitter: 0.05, minInterval: 60 },
  'projectile-wall': { clip: 'projectile-wall-arrow' }, // clip real: resolveEventClip según label
  'enemy-hit': { clip: ['enemy-hit-1', 'enemy-hit-2', 'enemy-hit-3'], rateJitter: 0.06 },
  'boss-hit': { clip: 'boss-hit', rateJitter: 0.04 },
  'boss-immune-hit': { clip: 'boss-immune-hit' },
  'enemy-died': { clip: ['enemy-died-1', 'enemy-died-2'], rateJitter: 0.04 },
  'player-damaged': { clip: 'player-damaged' },
  'player-died': { clip: 'player-died', bus: 'music' },
  'godmode-revive': { clip: 'godmode-revive' },
  'shield-block': { clip: 'shield-block' },
  'pit-fall': { clip: 'pit-fall' },
  'pit-respawn': { clip: 'pit-respawn' },
  'spikes-hit': { clip: 'spikes-hit', rateJitter: 0.05 },
  'barrel-explosion': { clip: 'barrel-explosion' },
  'item-pickup': { clip: 'pickup-coin' }, // clip real: resolveEventClip según label
  'upgrade-applied': { clip: 'upgrade-applied' },
  'upgrade-purchased': { clip: 'upgrade-purchased' },
  'room-cleared': { clip: 'room-cleared', bus: 'music' },
  'doors-open': { clip: 'doors-open' },
  'door-locked': { clip: 'door-unlocked' }, // clip real: resolveEventClip según label
  victory: { clip: 'victory', bus: 'music' },
  'dungeon-cleared': { clip: 'dungeon-cleared', bus: 'music' },
  'boss-door-sealed': { clip: 'boss-door-sealed' },
  'boss-phase-changed': { clip: 'boss-phase-changed', bus: 'music' },
  'boss-telegraph': { clip: 'boss-telegraph' }, // clip real: resolveEventClip (label '-fire' → enemy-shot)
  'boss-defeated': { clip: 'boss-defeated', bus: 'music' },
  'boss-shard-burst': { clip: 'boss-shard-burst' },
  'boss-barrel-spawn': { clip: 'boss-barrel-spawn' },
  'boss-barrel-land': { clip: 'boss-barrel-land' },
  'boss-barrel-charge-stun': { clip: 'boss-barrel-charge-stun' },
  'boss-wave-spawn': { clip: 'boss-wave-spawn' },
  // Varias larvas guardianas pueden telegrafiar carga casi a la vez (GDD
  // §15.3): minInterval alto para que suene como una sola alerta, no una
  // ametralladora de avisos.
  'boss-guardian-charge': { clip: 'boss-guardian-charge', minInterval: 220 },
  'boss-column-cracked': { clip: 'boss-column-cracked' },
  'boss-column-broken': { clip: 'boss-column-broken' },
  'boss-columns-cleared': { clip: 'boss-columns-cleared', bus: 'music' },
  'enemy-shot': { clip: 'enemy-shot', rateJitter: 0.05, minInterval: 70 },
};

/** GameEventType cuyo clip depende de `label`/`weaponMode` en vez de ser fijo (ver `resolveEventClip`). */
const DYNAMIC_EVENT_TYPES: ReadonlySet<GameEventType> = new Set([
  'launch',
  'projectile-wall',
  'item-pickup',
  'door-locked',
  'boss-telegraph',
]);

/**
 * Resolución PURA del clip para los 5 tipos "dinámicos" (label/arma
 * dependiente) — extraída como función independiente para poder testearla
 * sin pasar por `sfxEngine`/`AudioContext` (obligatorio del encargo).
 * `null` = mudo para esta combinación concreta de label (p.ej.
 * `item-pickup` con label `'shopkeeper'`, `door-locked` con el nombre de
 * sala en vez de 'locked'/'unlocked').
 */
export function resolveEventClip(event: GameEvent, weaponMode: WeaponMode): SfxClipName | null {
  switch (event.type) {
    case 'launch':
      if (weaponMode === 'arrow') return 'launch-arrow';
      if (weaponMode === 'spell') return 'launch-spell';
      return 'launch-body';
    case 'projectile-wall':
      if (event.label === 'arrow') return 'projectile-wall-arrow';
      if (event.label === 'spell') return 'projectile-wall-spell';
      return null;
    case 'item-pickup':
      if (event.label === 'coin') return 'pickup-coin';
      if (event.label === 'potion') return 'pickup-potion';
      if (event.label === 'key') return 'pickup-key';
      return null; // 'shopkeeper': mudo, lo cubre 'shop-opened'
    case 'door-locked':
      if (event.label === 'unlocked') return 'door-unlocked';
      if (event.label === 'locked') return 'door-locked';
      return null; // otro label (nombre de sala): mudo
    case 'boss-telegraph':
      // Disparo del Prisma viajando como boss-telegraph (ver comentario de
      // 'enemy-shot' en engine/events.ts): label '<arma>-fire'.
      if (event.label.endsWith('-fire')) return 'enemy-shot';
      return 'boss-telegraph';
    default:
      return null;
  }
}

/** Elige el clip a reproducir: dinámico para los 5 tipos especiales, fijo o variante al azar para el resto. */
function pickClip(event: GameEvent, weaponMode: WeaponMode, config: EventSfx, rng: () => number): SfxClipName | null {
  if (DYNAMIC_EVENT_TYPES.has(event.type)) return resolveEventClip(event, weaponMode);
  if (Array.isArray(config.clip)) {
    const variants = config.clip;
    return variants[Math.floor(rng() * variants.length)] ?? variants[0];
  }
  return config.clip as SfxClipName;
}

/** ¿Este tipo de evento es diegético del héroe (nunca atenuado ni paneado, ver cabecera del fichero)? */
function isHeroLocal(type: GameEventType, bus: 'sfx' | 'music'): boolean {
  if (bus === 'music') return true;
  if (type === 'launch' || type === 'item-pickup') return true;
  return type.startsWith('player-') || type.startsWith('pit-') || type.startsWith('upgrade-');
}

/** Volumen ∝ intensidad para los pocos eventos donde la intensidad es una magnitud física audible (hoy solo 'wall-bounce', velocidad normal de impacto). */
function dynamicVolumeFactor(event: GameEvent): number {
  if (event.type === 'wall-bounce') {
    return clamp(event.intensity / WALL_BOUNCE_VOLUME_REF, WALL_BOUNCE_VOLUME_FLOOR, 1);
  }
  return 1;
}

export function playEventSfx(
  event: GameEvent,
  listenerX: number,
  listenerY: number,
  weaponMode: WeaponMode,
): void {
  if (SILENT_EVENTS.includes(event.type)) return;
  const config = SFX_BY_EVENT[event.type];
  if (!config) return;

  const clip = pickClip(event, weaponMode, config, Math.random);
  if (!clip) return;

  const bus = config.bus ?? 'sfx';
  let pan = 0;
  let attenuation = 1;
  if (!isHeroLocal(event.type, bus)) {
    const dx = event.x - listenerX;
    const dy = event.y - listenerY;
    pan = clamp(dx / PAN_RANGE, -1, 1);
    const dist = Math.hypot(dx, dy);
    attenuation = clamp(1 - dist / AUDIBLE_RANGE, 0, 1);
    if (attenuation <= 0) return; // demasiado lejos: ni construir el nodo
  }

  playSfx(clip, {
    volume: (config.volume ?? 1) * attenuation * dynamicVolumeFactor(event),
    rateJitter: config.rateJitter,
    minInterval: config.minInterval,
    bus,
    pan,
  });
}
