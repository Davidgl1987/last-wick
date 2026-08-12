/**
 * Toggles de post-procesado (fase 1: infraestructura del composer + Vignette
 * y Noise; fases 2-3 añadirán Bloom y ChromaticAberration como efectos
 * reales, ver PostEffects.tsx). Persistidos en localStorage, igual que
 * `cameraSettings.ts`.
 *
 * Diferencia clave frente a `cameraSettings`: aquí el valor SÍ debe disparar
 * re-render. `cameraSettings.distanceScale` lo lee CameraRig en useFrame (un
 * objeto mutable basta, nunca queremos re-render por eso); estos flags, en
 * cambio, deciden qué efectos monta `<PostEffects>` — cambiar un checkbox
 * tiene que re-renderizar ese componente para montar/desmontar el efecto
 * correspondiente. Por eso exponemos un pub/sub mínimo (listeners + snapshot
 * inmutable) consumido con `useSyncExternalStore` en `usePostSettings()`.
 *
 * Frecuencia de escritura: ínfima. Los flags solo se mutan desde los
 * checkboxes del modal de pausa (interacción humana ocasional), nunca desde
 * el bucle de simulación ni desde render por frame — así que el coste de
 * recrear el snapshot y notificar listeners en cada `set` es irrelevante.
 */

import { useSyncExternalStore } from 'react';

/**
 * `v2` fuerza una migración única desde la etapa de playtest en la que los
 * cuatro efectos arrancaban apagados. Sin cambiar la clave, un navegador que
 * ya hubiese guardado esos `false` no adoptaría el nuevo look por defecto.
 */
const STORAGE_KEY = 'last-wick:post-effects:v2';

export interface PostSettings {
  bloom: boolean;
  vignette: boolean;
  noise: boolean;
  chromaticAberration: boolean;
  ambientDust: boolean;
}

/** Look final: los cuatro efectos activos desde el primer arranque. */
const DEFAULTS: PostSettings = {
  bloom: true,
  vignette: true,
  noise: true,
  chromaticAberration: true,
  ambientDust: true,
};

/** Valida un valor leído de JSON: cualquier campo que no sea boolean cae al default. */
function sanitize(raw: unknown): PostSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULTS };
  const obj = raw as Record<string, unknown>;
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof PostSettings)[]) {
    if (typeof obj[key] === 'boolean') result[key] = obj[key] as boolean;
  }
  return result;
}

function readInitial(): PostSettings {
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
let settings: PostSettings = readInitial();

/** Listeners registrados por `subscribe` (usados por useSyncExternalStore). */
const listeners = new Set<() => void>();

/** Suscripción mínima para useSyncExternalStore: registra y devuelve el cleanup. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Snapshot inmutable actual (misma referencia mientras no cambie nada). */
function getSnapshot(): PostSettings {
  return settings;
}

/** Escribe un flag, persiste el objeto entero en JSON y notifica a los listeners. */
export function setPostEffectEnabled(key: keyof PostSettings, value: boolean): void {
  settings = { ...settings, [key]: value };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
  for (const listener of listeners) listener();
}

/** Hook de lectura reactiva: re-renderiza el componente cuando cambia cualquier flag. */
export function usePostSettings(): PostSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
