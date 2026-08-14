/**
 * Motor de audio Web Audio: sin React, sin three.js, sin zustand — estado de
 * módulo mutable, mismo espíritu que `render/cameraSettings.ts`. Es la única
 * pieza del proyecto que crea un `AudioContext`; todo lo demás (`eventSfx.ts`,
 * `useGameLoop.ts`, `AimInput.tsx`, `ui/Button.tsx`, `TitleScreen.tsx`)
 * llama a `playSfx`/`setLoop`/`stopLoop` sin saber si el contexto existe.
 *
 * Grafo por voz: `source → [lowpass?] → panner (StereoPanner) → gainDeVoz →
 * busGain (sfx|music) → masterGain → destination`. El bucle continuo
 * (hoy el reloj de tienda `shop-opened`) usa el mismo bus `sfx` con su propio
 * `GainNode` de ganancia rampeada en vez de crear una voz por llamada.
 *
 * TODO debe ser no-op seguro si no hay `AudioContext` (entorno `node` de
 * vitest — ver `vite.config.ts`, `environment: 'node'`, sin `window` global
 * — o navegador sin soporte real): nunca lanzar, nunca romper el juego por
 * audio. De ahí que casi cada función empiece comprobando que el contexto (o
 * el buffer, o el bus) existe antes de tocarlo.
 *
 * Desbloqueo: los navegadores bloquean `AudioContext` hasta un gesto del
 * usuario. `initAudio(base)` (llamada una vez desde `app/App.tsx`) NO crea el
 * contexto — solo guarda la base servida y arma listeners `{pointerdown,
 * keydown, touchstart}` de una sola vez en `window`. El primer gesto real
 * dispara `unlockAudio()`, que crea el contexto, monta los 3 `GainNode` del
 * grafo de buses y lanza la precarga (fetch + `decodeAudioData`) de los 53
 * clips del manifiesto (`clips.ts`) en paralelo — un clip que falle se marca
 * como no disponible (`failedClips`) y su `playSfx` queda en no-op para
 * siempre, sin tocar al resto.
 *
 * Gestión de voces (juego con muchos eventos por segundo, GDD-encargo de
 * audio): throttle por clip (`minInterval`, 40 ms por defecto — más alto
 * cuando el llamador lo pide, ver `eventSfx.ts`), tope de voces simultáneas
 * por clip (4) y tope global (24). Al superarse cualquiera, la petición se
 * DESCARTA sin construir ni un solo nodo (comprobado ANTES de tocar el grafo,
 * cortar un sonido en curso para robarle la voz se oye peor que perder la
 * petición nueva). Cada `AudioBufferSourceNode` decrementa sus contadores en
 * su propio `onended`.
 */

import { getAudioSettings, subscribeAudioSettings, type AudioSettings } from './audioSettings';
import { clipUrl, SFX_CLIP_NAMES, type SfxClipName } from './clips';

export interface PlayOptions {
  /** Ganancia base del clip [0,1]; por defecto 1. */
  volume?: number;
  /** Multiplicador de tono (playbackRate). Por defecto 1. */
  rate?: number;
  /** Variación aleatoria de tono, ±ratio (0.06 = ±6%). Por defecto 0. */
  rateJitter?: number;
  /** Bus de salida. Por defecto 'sfx'. */
  bus?: 'sfx' | 'music';
  /** Corte de paso bajo en Hz (para el trueno). Por defecto sin filtro. */
  lowpass?: number;
  /** Retardo antes de sonar, en segundos. Por defecto 0. */
  delay?: number;
  /** Panorama estéreo [-1,1]. Por defecto 0. */
  pan?: number;
  /**
   * Throttle propio de esta petición en ms, por encima del por-defecto de
   * 40 ms (`DEFAULT_MIN_INTERVAL_MS`) — necesario para eventos que pueden
   * dispararse en ráfaga desde varias fuentes a la vez (varias larvas
   * cargando a la vez, un anillo de balas de La Tormenta...). No está en el
   * contrato original del encargo como campo de `PlayOptions`, pero
   * `eventSfx.ts` necesita un sitio por donde pasar el `minInterval` que su
   * propia tabla `SFX_BY_EVENT` declara por evento — añadirlo aquí evita
   * duplicar un segundo mecanismo de throttle fuera del motor.
   */
  minInterval?: number;
}

/** Tope de voces simultáneas para UN MISMO clip (ver cabecera del fichero). */
const MAX_VOICES_PER_CLIP = 4;
/** Tope de voces simultáneas en TODO el motor. */
const MAX_VOICES_TOTAL = 24;
/** Throttle por defecto entre dos peticiones del mismo clip, en ms. */
const DEFAULT_MIN_INTERVAL_MS = 40;
/** Rampa de volumen de los buses al cambiar un slider (evita chasquido). */
const BUS_VOLUME_RAMP_S = 0.02;
/** Rampa de ganancia del bucle continuo al arrancar/parar/cambiar de volumen. */
const LOOP_GAIN_RAMP_S = 0.08;
/** Margen tras el que se detiene de verdad el `AudioBufferSourceNode` del bucle, una vez la rampa a 0 ya lo dejó inaudible. */
const LOOP_STOP_MARGIN_S = LOOP_GAIN_RAMP_S * 4;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// ── Estado de módulo (mismo espíritu que cameraSettings.ts) ────────────────

let baseUrl = '';
let listenersArmed = false;
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxBusGain: GainNode | null = null;
let musicBusGain: GainNode | null = null;

/** Buffers decodificados, uno por clip disponible. */
const buffers = new Map<SfxClipName, AudioBuffer>();
/** Clips cuya carga/decodificación falló: `playSfx` sobre ellos es no-op para siempre. */
const failedClips = new Set<SfxClipName>();

/** Última vez (ms de `AudioContext.currentTime`) que se ACEPTÓ reproducir cada clip, para el throttle. */
const lastPlayedAtMs = new Map<SfxClipName, number>();
/** Voces activas por clip, para el tope de 4. */
const activeVoicesByClip = new Map<SfxClipName, number>();
let activeVoicesTotal = 0;

interface LoopVoice {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  /** true mientras la rampa de apagado está en marcha (evita reprogramar un `stop` ya armado). */
  stopping: boolean;
}
/** Bucles continuos activos (hoy el reloj de tienda); el mecanismo es genérico. */
const loops = new Map<SfxClipName, LoopVoice>();

/**
 * Constructor de `AudioContext` del navegador actual, o `null` si no hay
 * ninguno (entorno `node` de vitest, o navegador realmente sin soporte).
 * `webkitAudioContext` cubre Safari antiguo.
 */
function getAudioContextConstructor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Aplica los 3 volúmenes de `audioSettings.ts` a los `GainNode` de bus. `immediate`: sin rampa (arranque del contexto). */
function applyBusVolumes(settings: AudioSettings, immediate: boolean): void {
  const ctx = audioCtx;
  if (!ctx || !masterGain || !sfxBusGain || !musicBusGain) return;
  if (immediate) {
    masterGain.gain.value = settings.master;
    sfxBusGain.gain.value = settings.sfx;
    musicBusGain.gain.value = settings.music;
    return;
  }
  const t = ctx.currentTime;
  masterGain.gain.setTargetAtTime(settings.master, t, BUS_VOLUME_RAMP_S);
  sfxBusGain.gain.setTargetAtTime(settings.sfx, t, BUS_VOLUME_RAMP_S);
  musicBusGain.gain.setTargetAtTime(settings.music, t, BUS_VOLUME_RAMP_S);
}

// Suscripción a audioSettings.ts a nivel de módulo (igual que kit.ts guarda
// sus caches a nivel de módulo): antes de que exista `audioCtx` esta llamada
// no hace nada (applyBusVolumes comprueba el contexto), pero en cuanto
// `unlockAudio` lo crea, cualquier cambio posterior de slider ya llega aquí.
subscribeAudioSettings(() => applyBusVolumes(getAudioSettings(), false));

/** Lanza la descarga+decodificación de los 53 clips en paralelo; tolerante a fallos por clip. */
function preloadClips(): void {
  const ctx = audioCtx;
  if (!ctx) return;
  for (const name of SFX_CLIP_NAMES) {
    if (buffers.has(name) || failedClips.has(name)) continue;
    fetch(clipUrl(name, baseUrl))
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        buffers.set(name, buffer);
      })
      .catch(() => {
        // Un clip que no decodifica no debe romper el resto (cabecera del fichero).
        failedClips.add(name);
      });
  }
}

/**
 * Crea el `AudioContext` (idempotente) y lanza la precarga. Debe llamarse
 * SOLO en respuesta a un gesto del usuario (los navegadores lo suspenden si
 * no) — por eso `initAudio` la arma como listener `{ once: true }` en vez de
 * llamarla directamente.
 */
export function unlockAudio(): void {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return;
  }
  const Ctx = getAudioContextConstructor();
  if (!Ctx) return; // sin soporte: todo playSfx/setLoop queda en no-op (cabecera del fichero)

  audioCtx = new Ctx();
  masterGain = audioCtx.createGain();
  sfxBusGain = audioCtx.createGain();
  musicBusGain = audioCtx.createGain();
  sfxBusGain.connect(masterGain);
  musicBusGain.connect(masterGain);
  masterGain.connect(audioCtx.destination);
  applyBusVolumes(getAudioSettings(), true);

  void audioCtx.resume();
  preloadClips();
}

/**
 * Idempotente: guarda la base servida y arma los listeners de desbloqueo la
 * primera vez que se llama. NO crea el `AudioContext` todavía (cabecera del
 * fichero). Llamada una vez desde `app/App.tsx`.
 */
export function initAudio(base: string): void {
  baseUrl = base;
  if (listenersArmed || typeof window === 'undefined') return;
  listenersArmed = true;
  const onGesture = (): void => unlockAudio();
  window.addEventListener('pointerdown', onGesture, { once: true });
  window.addEventListener('keydown', onGesture, { once: true });
  window.addEventListener('touchstart', onGesture, { once: true });
}

/** Decrementa los contadores de voces activas de un clip cuando su fuente termina. */
function releaseVoice(name: SfxClipName): void {
  const count = (activeVoicesByClip.get(name) ?? 1) - 1;
  if (count <= 0) activeVoicesByClip.delete(name);
  else activeVoicesByClip.set(name, count);
  activeVoicesTotal = Math.max(0, activeVoicesTotal - 1);
}

/**
 * Reproduce un clip. No-op si no hay contexto, si el clip no está cargado
 * todavía (o falló al decodificar), si el volumen efectivo es 0, si el
 * throttle de `minInterval` descarta la petición, o si se supera el tope de
 * voces por clip/global (ver cabecera del fichero: todo esto se comprueba
 * ANTES de construir ningún nodo).
 */
export function playSfx(name: SfxClipName, opts: PlayOptions = {}): void {
  const ctx = audioCtx;
  if (!ctx || !masterGain || !sfxBusGain || !musicBusGain) return;
  const buffer = buffers.get(name);
  if (!buffer) return;

  const bus = opts.bus ?? 'sfx';
  const settings = getAudioSettings();
  const busVolume = bus === 'music' ? settings.music : settings.sfx;
  const requestedVolume = opts.volume ?? 1;
  // Puerta de "volumen efectivo 0" (cabecera del fichero): el volumen REAL
  // que sonará lo decide el propio grafo de `GainNode` (rampeado en vivo por
  // `applyBusVolumes`), esto solo evita construir nodos para un sonido que
  // ahora mismo sonaría a 0 igualmente.
  if (settings.master <= 0 || busVolume <= 0 || requestedVolume <= 0) return;

  const nowMs = ctx.currentTime * 1000;
  const minInterval = opts.minInterval ?? DEFAULT_MIN_INTERVAL_MS;
  const lastMs = lastPlayedAtMs.get(name);
  if (lastMs !== undefined && nowMs - lastMs < minInterval) return;

  const voicesForClip = activeVoicesByClip.get(name) ?? 0;
  if (voicesForClip >= MAX_VOICES_PER_CLIP || activeVoicesTotal >= MAX_VOICES_TOTAL) return;

  lastPlayedAtMs.set(name, nowMs);
  activeVoicesByClip.set(name, voicesForClip + 1);
  activeVoicesTotal += 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const jitterRatio = opts.rateJitter ? 1 + (Math.random() * 2 - 1) * opts.rateJitter : 1;
  source.playbackRate.value = (opts.rate ?? 1) * jitterRatio;

  // Grafo: source → [lowpass?] → panner → gainDeVoz → busGain → masterGain → destination.
  let upstream: AudioNode = source;
  let filter: BiquadFilterNode | null = null;
  if (opts.lowpass) {
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = opts.lowpass;
    upstream.connect(filter);
    upstream = filter;
  }

  const panner = ctx.createStereoPanner();
  panner.pan.value = clamp(opts.pan ?? 0, -1, 1);
  upstream.connect(panner);

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = requestedVolume;
  panner.connect(voiceGain);

  const busGainNode = bus === 'music' ? musicBusGain : sfxBusGain;
  voiceGain.connect(busGainNode);

  source.onended = () => {
    source.disconnect();
    filter?.disconnect();
    panner.disconnect();
    voiceGain.disconnect();
    releaseVoice(name);
  };

  const when = ctx.currentTime + Math.max(0, opts.delay ?? 0);
  source.start(when);
}

/**
 * Sube/arranca (o apaga/detiene) el bucle continuo `name` con ganancia
 * `gain` [0,1] y velocidad `rate`. Arranca la fuente perezosamente en la
 * primera llamada con ganancia > 0; con ganancia 0 delega en `stopLoop` para
 * no dejar una fuente sonando a volumen 0 toda la partida (cabecera del
 * fichero). Rampa corta (`LOOP_GAIN_RAMP_S`) para no chasquear al cambiar de
 * velocidad del héroe frame a frame.
 */
export function setLoop(name: SfxClipName, gain: number, rate = 1): void {
  const clamped = clamp(gain, 0, 1);
  if (clamped <= 0) {
    stopLoop(name);
    return;
  }
  const ctx = audioCtx;
  if (!ctx || !sfxBusGain) return;

  let loop = loops.get(name);
  // Una voz que ya está en su rampa de apagado NO se puede reutilizar: su
  // `stop()` ya quedó programado en el reloj del contexto y Web Audio no
  // permite cancelarlo. Se la deja morir sola (su `onended` comprueba
  // identidad antes de borrar del mapa, ver `stopLoop`) y se arranca una voz
  // nueva. Pasa de verdad y a menudo: el héroe frena por debajo del umbral de
  // deslizamiento y vuelve a acelerar dentro de la misma rampa (rebote contra
  // un muro, lanzamiento encadenado); sin esto el bucle se cortaba en seco a
  // mitad de movimiento.
  if (loop && loop.stopping) loop = undefined;
  if (!loop) {
    const buffer = buffers.get(name);
    if (!buffer) return; // clip aún no decodificado: no arranca hasta que sfxEngine termine de precargarlo
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    source.connect(gainNode);
    gainNode.connect(sfxBusGain);
    source.start();
    loop = { source, gainNode, stopping: false };
    loops.set(name, loop);
  }
  loop.source.playbackRate.value = rate;
  loop.gainNode.gain.setTargetAtTime(clamped, ctx.currentTime, LOOP_GAIN_RAMP_S);
}

/** Apaga con rampa y detiene de verdad la fuente del bucle `name`; no-op si no estaba sonando. */
export function stopLoop(name: SfxClipName): void {
  const loop = loops.get(name);
  if (!loop || loop.stopping) return;
  loop.stopping = true;
  const ctx = audioCtx;
  if (!ctx) {
    loops.delete(name);
    return;
  }
  loop.gainNode.gain.setTargetAtTime(0, ctx.currentTime, LOOP_GAIN_RAMP_S);
  loop.source.stop(ctx.currentTime + LOOP_STOP_MARGIN_S);
  loop.source.onended = () => {
    loop.source.disconnect();
    loop.gainNode.disconnect();
    // Solo borra del mapa si ESTA sigue siendo la voz vigente: si durante la
    // rampa de apagado el héroe volvió a moverse, `setLoop` ya registró otra
    // voz distinta y borrarla aquí dejaría una fuente sonando sin handle.
    if (loops.get(name) === loop) loops.delete(name);
  };
}
