/**
 * Selección top-K de los emisores de luz más cercanos a un punto, para pools
 * fijos de luces reales que se reasignan por proximidad cada frame (mismo
 * problema que ya resuelve `ProjectileView.tsx` para el pool de luces de
 * proyectiles). Se extrae aquí como función PURA porque, a partir de la
 * reducción de la escena de ~43 luces a 7 (docs de la rama
 * `luces-optimizadas`), un segundo consumidor —el pool de 3 spotLights de
 * antorcha de muro reasignadas al héroe— necesita exactamente el mismo
 * algoritmo, sin arrastrar ningún estado de React.
 *
 * Presupuesto: se llama una vez por frame desde useFrame, así que CERO
 * asignaciones de memoria por llamada — nada de `new`/`map`/`filter`/`sort`/
 * spread. Distancia siempre al cuadrado (nunca `Math.hypot`/`sqrt`, sobra
 * para comparar cuál es más cercano).
 *
 * Algoritmo (calca la "fase 2" de selección top-K acotada de
 * `features/combat/ProjectileView.tsx:429-456`: sustituye el peor candidato
 * ya ocupado si el nuevo emisor está más cerca), con una diferencia
 * deliberada: en vez de mantener un array `dist2` aparte (un scratch que en
 * ProjectileView vive en un `useRef` persistente entre frames, porque ese
 * componente sí tiene ciclo de vida de React), aquí la distancia de cada
 * slot ya ocupado se RECALCULA desde `out[k]` en el momento de comparar. Con
 * `n` tan pequeño (pool de 3 luces) el coste extra es insignificante, y a
 * cambio la función queda sin ningún estado oculto que un caller tenga que
 * crear y pasar aparte — solo necesita el propio array de salida.
 */

/** Punto mínimo que necesita `selectNearestInto`: cualquier emisor con posición en el plano XZ del suelo (Vec2.y ≡ Z, ver engine/geometry.ts). */
export interface NearestEmitterPoint {
  x: number;
  z: number;
}

/**
 * Rellena `out[0..n)` con los índices (en `emitters`) de los `n` emisores
 * más cercanos a `(x, z)`, más cercano no implica orden alguno entre sí (solo
 * pertenencia al top-K). Los huecos sobrantes cuando `emitters.length < n`
 * quedan en `-1`. `out` debe tener longitud >= `n`; las posiciones >= `n` no
 * se tocan. No lanza con `n = 0` ni con `emitters` vacío.
 */
export function selectNearestInto(
  emitters: readonly NearestEmitterPoint[],
  x: number,
  z: number,
  out: number[],
  n: number,
): void {
  for (let k = 0; k < n; k++) out[k] = -1;

  for (let i = 0; i < emitters.length; i++) {
    const e = emitters[i];
    const dx = e.x - x;
    const dz = e.z - z;
    const d2 = dx * dx + dz * dz;

    // Busca el slot "peor" ya ocupado (mayor distancia² al punto); un hueco
    // vacío (-1) cuenta como +Infinity, así que siempre gana frente a
    // cualquier distancia real y se rellena primero.
    let worstSlot = -1;
    let worstDist2 = -1;
    for (let k = 0; k < n; k++) {
      const idx = out[k];
      let od2: number;
      if (idx === -1) {
        od2 = Infinity;
      } else {
        const oe = emitters[idx];
        const odx = oe.x - x;
        const odz = oe.z - z;
        od2 = odx * odx + odz * odz;
      }
      if (od2 > worstDist2) {
        worstDist2 = od2;
        worstSlot = k;
      }
    }

    if (worstSlot !== -1 && d2 < worstDist2) {
      out[worstSlot] = i;
    }
  }
}
