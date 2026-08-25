/**
 * Primitivas geométricas del plano del suelo. Genéricas, sin dominio de juego.
 *
 * Sistema de coordenadas: la sim vive en 2D sobre el plano del suelo.
 * `Vec2.x` ≡ X del mundo 3D y `Vec2.y` ≡ Z del mundo 3D (plano XZ).
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Caja alineada a ejes en el plano del suelo. */
export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Avanza un ángulo `current` hacia `target` por el ARCO MÁS CORTO, con
 * suavizado exponencial (mismo patrón `1 - exp(-lambda*dt)` que ya usan
 * CameraRig/particles/effectsState — ver ese código si hace falta ajustar
 * `lambda`). Pensado para orientaciones (yaw) que darían un salto de ±2π al
 * hacer un lerp lineal ingenuo cerca del wrap-around.
 *
 * `delta` se normaliza a (-π, π] antes de aplicar el factor de suavizado, y
 * el factor se clampa a [0, 1] para que un `dt` grande (frame lento/tab en
 * segundo plano) nunca overshoote el objetivo.
 */
export function dampAngleTowards(current: number, target: number, lambda: number, dt: number): number {
  const TAU = Math.PI * 2;
  let delta = (target - current + Math.PI) % TAU;
  if (delta < 0) delta += TAU;
  delta -= Math.PI;
  const factor = Math.min(1, Math.max(0, 1 - Math.exp(-lambda * dt)));
  return current + delta * factor;
}

/**
 * Rota un ángulo `current` hacia `target` por el ARCO MÁS CORTO, a velocidad
 * angular CONSTANTE: avanza como mucho `maxStep` radianes (típicamente
 * `angularSpeed * dt`) y, si lo que queda por girar cabe en ese paso,
 * aterriza EXACTO en `target` sin overshoot — nunca da un paso más allá.
 *
 * Diferencia con `dampAngleTowards` (arriba): aquella es suavizado
 * exponencial que se acerca asintóticamente al objetivo y, por diseño,
 * nunca "termina" del todo (siempre queda un resto, por pequeño que sea).
 * Esta función SÍ termina, en un instante conocido de antemano (el que
 * tarda en cubrir el arco a `maxStep` por llamada) — es lo que hace falta
 * cuando la SIM necesita saber con certeza si un giro ya ha concluido (p.ej.
 * `stepPatrol`: el enemigo no reanuda la marcha hasta que el giro termina).
 *
 * `delta` se normaliza a (-π, π] igual que en `dampAngleTowards`, así que
 * siempre gira por el lado más corto, nunca dando la vuelta larga.
 */
export function rotateAngleTowards(current: number, target: number, maxStep: number): number {
  const TAU = Math.PI * 2;
  let delta = (target - current + Math.PI) % TAU;
  if (delta < 0) delta += TAU;
  delta -= Math.PI;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}
