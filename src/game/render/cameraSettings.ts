/**
 * Ajuste de distancia de cámara (punto 5 de playtest ronda 3): slider en el
 * modal de pausa para alejar/acercar la cámara, persistido en localStorage.
 *
 * SIN estado de React ni zustand: es un único objeto mutable (mismo patrón
 * que `session`), leído directamente por CameraRig en useFrame (nunca
 * dispara re-render) y escrito por el `<input type="range">` del modal de
 * pausa vía `setCameraDistanceScale`. Aplicado suavemente (lerp) dentro de
 * CameraRig, así que un cambio del slider nunca "salta" de golpe.
 */

const STORAGE_KEY = 'last-wick:camera-distance-scale';

/** Rango del slider: 0.75× (más cerca) a 1.5× (más lejos) de la distancia base. */
export const CAMERA_DISTANCE_SCALE_MIN = 0.75;
export const CAMERA_DISTANCE_SCALE_MAX = 1.5;
const CAMERA_DISTANCE_SCALE_DEFAULT = 1;

function clamp(value: number): number {
  if (Number.isNaN(value)) return CAMERA_DISTANCE_SCALE_DEFAULT;
  return Math.min(CAMERA_DISTANCE_SCALE_MAX, Math.max(CAMERA_DISTANCE_SCALE_MIN, value));
}

function readInitial(): number {
  if (typeof localStorage === 'undefined') return CAMERA_DISTANCE_SCALE_DEFAULT;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return CAMERA_DISTANCE_SCALE_DEFAULT;
  const parsed = Number.parseFloat(raw);
  return clamp(parsed);
}

/** Objeto mutable único: CameraRig lee `cameraSettings.distanceScale` cada frame. */
export const cameraSettings = {
  distanceScale: readInitial(),
};

/** Escribe el nuevo factor (clampado al rango del slider) y lo persiste. */
export function setCameraDistanceScale(value: number): void {
  cameraSettings.distanceScale = clamp(value);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, String(cameraSettings.distanceScale));
  }
}
