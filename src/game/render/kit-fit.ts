/**
 * Helpers puros de "encaje" del kit (docs/plans/ART_KIT_PLAN.md, F2/F3):
 * leer el `boundingBox` REAL de una `kitGeometry(...)` para posicionar/escalar
 * una pieza, en vez de hardcodear las medidas ya verificadas en el plan
 * (p. ej. "barrier mide 3.36×0.924×0.42"). Esos números fueron la referencia
 * para DISEÑAR las vistas que usan este módulo, pero el código siempre lee el
 * `boundingBox` que `kit.ts::extractModelGeometry` ya calcula con
 * `computeBoundingBox()` — si algún modelo del kit cambiara de tamaño o no
 * siguiera exactamente la convención esperada, el código lo sigue colocando
 * bien en vez de fallar en silencio con un número obsoleto.
 *
 * Extraído de `RoomView.tsx` (F2) porque F3 (columnas de la Reina, barriles,
 * pinchos, foso) necesita exactamente los mismos tres cálculos en varios
 * ficheros más — mejor un único módulo compartido que tres copias del mismo
 * comentario.
 */

import * as THREE from 'three';

/** Ancho (X) × alto (Y) × profundo (Z) del `boundingBox` ya calculado de una geometría del kit. */
export function kitBoxSize(geometry: THREE.BufferGeometry): THREE.Vector3 {
  const box = geometry.boundingBox;
  if (!box) throw new Error('geometría del kit sin boundingBox calculado (¿kit.ts no llamó a computeBoundingBox?)');
  return new THREE.Vector3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
}

/**
 * Desplazamiento en Y para que la BASE (min.y del boundingBox) de una pieza
 * quede exactamente en y=0 — "apoyada en el suelo jugable". La mayoría de
 * piezas del kit (barrier, column, rocks, wall_gated) ya modelan su pivote
 * así (min.y≈0), pero este cálculo no lo asume: funciona igual si no fuera
 * exactamente así.
 */
export function kitGroundOffset(geometry: THREE.BufferGeometry): number {
  return -(geometry.boundingBox?.min.y ?? 0);
}

/**
 * Desplazamiento en Y para que la CARA SUPERIOR (max.y del boundingBox) de
 * una pieza quede en y=0 — usado por el suelo. CRÍTICO (encargo de David,
 * verificado en navegador): `floor_tile_large`/`floor_tile_small` NO apoyan
 * en su min.y como el resto del kit — su cara superior transitable está en
 * max.y (con min.y por debajo de 0, representando el grosor de la losa) — así
 * que colocarlas por min.y (como cualquier otra pieza) las dejaría hundidas
 * bajo el plano y=0 donde vive el héroe/los objetos/los hazards.
 */
export function kitTopAlignOffset(geometry: THREE.BufferGeometry): number {
  return -(geometry.boundingBox?.max.y ?? 0);
}

/**
 * Desplazamiento en X/Z para que el CENTRO del `boundingBox` de una pieza
 * caiga en (0,0) — necesario para piezas del kit que NO nacen centradas en su
 * plano horizontal, a diferencia de la mayoría (que sí pivotan sobre su
 * centro X/Z): `rubble_half`, por ejemplo, tiene su X real de 0 a 4 (pensada
 * para encajar por un borde, no para plantarse por su centro — ya verificado
 * contra su `.gltf` en `QueenColumnsView.tsx::kitXZCenterOffset`, que
 * necesitaba exactamente este mismo cálculo); `bartop_A_medium` y
 * `shelves_decorated` (F5, atrezzo de tienda) tienen el mismo problema en Z
 * (pensadas para montarse contra una pared, con su cara de anclaje cerca de
 * Z=0 y el volumen entero sobresaliendo hacia un lado). Mismo espíritu que
 * `kitGroundOffset`/`kitTopAlignOffset`: se lee siempre del `boundingBox`
 * real, nunca un desfase hardcodeado — así si el modelo cambiara, el código
 * lo sigue centrando bien sin tocarlo.
 */
export function kitXZCenterOffset(geometry: THREE.BufferGeometry): { x: number; z: number } {
  const box = geometry.boundingBox;
  if (!box) throw new Error('geometría del kit sin boundingBox calculado (¿kit.ts no llamó a computeBoundingBox?)');
  return { x: -(box.min.x + box.max.x) / 2, z: -(box.min.z + box.max.z) / 2 };
}

/**
 * Versión de una geometría del kit RECENTRADA en XZ (`kitXZCenterOffset`
 * aplicado sobre una COPIA, una única vez), cacheada por referencia de
 * geometría — `kitGeometry(name)`/`kitGeometryPart(...)` (kit.ts) devuelven
 * siempre la MISMA instancia para un mismo nombre, así que recentrar la
 * misma pieza dos veces desperdiciaría memoria de GPU (dos uploads del mismo
 * buffer) sin motivo.
 *
 * MOTIVO de recentrar la GEOMETRÍA aquí, una vez, en vez de compensar el
 * desfase en cada sitio donde una pieza se coloca por su centro
 * (`WallModuleInstances`, `RockVariantInstances`, `CornerColumns`,
 * `FloorTileInstances`... — ver RoomView.tsx): todas esas funciones colocan
 * cada instancia con `position = centro deseado` dando por hecho que el
 * origen local de la geometría YA es su centro — la mayoría de piezas del
 * kit lo cumplen, pero no todas (medido en playtest 2026-08-06: `wall_half`
 * tiene su X real en [0, 1.68] con centro en 0.84, no 0; `rocks`/
 * `rocks_small`/`rocks_decorated` están descentradas ~0.1-0.13 u en X y/o Z —
 * ver `RoomView.tsx::WallModuleInstances`/`RockVariantInstances` para las
 * cifras exactas). Compensar ESE desfase en cada colocación obligaría a
 * rehacer, para cada consumidor, la composición correcta de traslación +
 * rotación + escala (con un ángulo y una escala por eje distintos entre
 * tramos horizontales y verticales, p. ej.) — exactamente el tipo de
 * matemática fácil de acertar una vez y romper la siguiente vez que alguien
 * la toque. Recentrando la GEOMETRÍA una única vez, ANTES de que cualquier
 * transform de instancia la toque, el resto de cada función sigue
 * funcionando con la misma suposición de siempre ("el origen local es el
 * centro") sin cambiar una sola línea de su matemática de posición/rotación/
 * escala — la corrección vive en un solo sitio, funciona igual sin importar
 * el ángulo de la instancia (se aplica en el eje LOCAL, antes de rotar), y no
 * se puede olvidar en un consumidor nuevo. Mismo criterio que ya usa
 * `DoorLeaf` (RoomView.tsx) para `wall_doorway`.
 *
 * Si la geometría YA está centrada (offset (0,0), el caso normal — column y
 * todas las variantes de suelo, medido) se devuelve la MISMA referencia sin
 * clonar: cero coste extra para las piezas que no lo necesitan.
 */
const xzCenteredGeometryCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

export function kitXZCenteredGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = xzCenteredGeometryCache.get(geometry);
  if (cached) return cached;
  const { x, z } = kitXZCenterOffset(geometry);
  const centered = x === 0 && z === 0 ? geometry : geometry.clone().translate(x, 0, z);
  if (centered !== geometry) centered.computeBoundingBox();
  xzCenteredGeometryCache.set(geometry, centered);
  return centered;
}
