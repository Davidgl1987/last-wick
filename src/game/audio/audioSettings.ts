/**
 * Ajustes de volumen (General/Música/Efectos), persistidos en localStorage —
 * mismo patrón exacto que `postSettings.ts` (snapshot inmutable,
 * `subscribe`/`getSnapshot` vía `useSyncExternalStore`, `sanitize` defensivo
 * al leer).
 *
 * Motor de audio: `audio/sfxEngine.ts` se SUSCRIBE a este módulo con
 * `subscribeAudioSettings` (mismo `Set` de listeners que usa
 * `useAudioSettings`, sin estado duplicado) y aplica `master`/`music`/`sfx` a
 * los `GainNode` de sus buses con una rampa corta (`setTargetAtTime`) cada
 * vez que cambian — así arrastrar un slider en el modal de pausa (
 * `ui/PauseModal.tsx`) sube o baja el volumen real sin chasquido. El resto
 * del código fuera de React que necesite leer el volumen actual sin
 * suscribirse (tampoco es el caso hoy de nada más que `sfxEngine.ts`) puede
 * usar `getAudioSettings()`.
 *
 * Frecuencia de escritura: ínfima (arrastrar un slider ocasional en pausa),
 * igual que `postSettings.ts` — el coste de recrear el snapshot y notificar
 * listeners en cada `set` es irrelevante.
 */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'last-wick:audio';

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
}

/** Volúmenes por defecto, en [0, 1]. */
const DEFAULTS: AudioSettings = {
  master: 0.8,
  music: 0.7,
  sfx: 0.8,
};

/** Recorta un número al rango [0, 1]; usado por `sanitize` para valores fuera de rango. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Valida un valor leído de JSON: cualquier campo que no sea un número finito cae al default; los que se salgan de [0,1] se recortan. */
function sanitize(raw: unknown): AudioSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULTS };
  const obj = raw as Record<string, unknown>;
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof AudioSettings)[]) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = clamp01(value);
  }
  return result;
}

function readInitial(): AudioSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return { ...DEFAULTS };
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

/** Snapshot actual (inmutable: cada `set` crea uno nuevo para useSyncExternalStore). */
let settings: AudioSettings = readInitial();

/** Listeners registrados por `subscribe` (usados por useSyncExternalStore). */
const listeners = new Set<() => void>();

/** Suscripción mínima para useSyncExternalStore: registra y devuelve el cleanup. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Snapshot inmutable actual (misma referencia mientras no cambie nada). */
function getSnapshot(): AudioSettings {
  return settings;
}

/** Escribe un volumen (recortado a [0,1]), persiste el objeto entero en JSON y notifica a los listeners. */
export function setAudioVolume(key: keyof AudioSettings, value: number): void {
  settings = { ...settings, [key]: clamp01(value) };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
  for (const listener of listeners) listener();
}

/** Hook de lectura reactiva: re-renderiza el componente cuando cambia cualquier volumen. */
export function useAudioSettings(): AudioSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Snapshot actual sin engancharse a React (para `sfxEngine.ts`, que no es un
 * componente): misma referencia inmutable que lee `useAudioSettings`.
 */
export function getAudioSettings(): AudioSettings {
  return settings;
}

/**
 * Suscripción para código fuera de React (`sfxEngine.ts`): reutiliza el
 * mismo `Set` de listeners que ya usa `useSyncExternalStore` internamente,
 * sin duplicar el mecanismo de notificación.
 */
export function subscribeAudioSettings(listener: () => void): () => void {
  return subscribe(listener);
}
