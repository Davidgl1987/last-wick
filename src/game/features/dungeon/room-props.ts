/**
 * Colocación DETERMINISTA del atrezzo de sala (F5, ART_KIT_PLAN.md §5): qué
 * piezas de decoración pura (sin colisión, la sim no las conoce — mismo
 * criterio que `torch-placements.ts`/`TorchPropsView.tsx`) van en cada sala y
 * dónde. Módulo PURO a propósito (sin `three` ni React): se testea en el
 * entorno `node` de vitest, igual que `wall-modules.ts`/`kit-models.ts`.
 *
 * "Determinista por hash del id de la sala" (encargo F5, nada de
 * `Math.random()`: la misma sala debe verse igual entre recargas, el editor
 * tiene que seguir siendo reproducible) — mismo espíritu que
 * `RoomView.tsx::pickRockVariant`, pero aquí hace falta más que elegir entre 3
 * cubos: se necesita una secuencia entera de decisiones (cuántas piezas,
 * dónde, cuál). En vez de reinventar un generador, se hashea el id de sala a
 * un entero (`hashRoomId`, mismo algoritmo que `pickRockVariant`) y se
 * alimenta a `createRng` (`engine/rng.ts`, el mismo mulberry32 que usa
 * `generateDungeon` para el layout): determinismo total por id de sala, con
 * una API de "siguiente float" ya probada en el resto del proyecto.
 *
 * Tres categorías, una función pura por cada una — ver ART_KIT_PLAN.md F5 y
 * la restricción de diseño del encargo (ningún prop con volumen invade el
 * interior jugable "en medio de la sala"):
 * - `floorScatterPlacements`: baldosas partidas/con hierbajos/con rocas,
 *   PLANAS contra el suelo (categoría (a) de la restricción: se leen como
 *   suelo, nunca como obstáculo) — pueden ir en cualquier punto del interior,
 *   evitando solo los hazards (para no "brotar" de un foso o un campo de
 *   pinchos) y un margen junto al muro (para no quedar bajo un poste de
 *   esquina). Cualquier sala puede llevarlas, pero el CATÁLOGO de variantes lo
 *   decide la familia de suelo real de la sala (`FLOOR_FAMILIES[...].scatter`,
 *   `@/game/render/floor-families.ts`) y llega aquí ya resuelto como parámetro
 *   — este módulo no sabe de familias, solo coloca lo que le pasan.
 * - `wallClutterPlacements`: escombros/cajas/cajones CON volumen, así que
 *   caen en la categoría (c) — solo en las esquinas del interior, dentro de
 *   la huella que ya ocupan el muro y el poste (nunca sueltos en mitad de la
 *   sala). Cualquier sala puede llevarlos, contenido a máximo
 *   `WALL_CLUTTER_MAX` por sala.
 * - `wallDecorPlacements`: banderas/candelabro — categoría (b), SIEMPRE por
 *   FUERA del interior jugable (mismo desplazamiento que las antorchas de
 *   muro, `TORCH_WALL_OUT` en `torch-placements.ts`), colgando del parapeto.
 *   Solo se llama para salas de jefe/tienda (ver `RoomPropsView.tsx`).
 *
 * Todas trabajan en coordenadas de MUNDO (el `AABB` de `bounds` que ya usa
 * `torch-placements.ts`/`RoomView.tsx`), no coordenadas locales de sala: el
 * llamador no necesita traducir nada de vuelta.
 */

import type { AABB } from '@/engine/geometry';
import { createRng, type Rng } from '@/engine/rng';
import type { KitModelName } from '@/game/render/kit-models';
import type { HazardSpawn } from '@/game/world/types';

// ── Hash de id de sala → semilla determinista ──────────────────────────────

/**
 * Hash de cadena a entero SIN signo (mismo algoritmo que
 * `RoomView.tsx::pickRockVariant`: multiplicador primo 31, sin pretensión
 * criptográfica, solo repartir ids arbitrarios de forma estable) — listo para
 * `createRng`, que espera una semilla `>>> 0`.
 */
function hashRoomId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

// ── Escombros/hierbajos de suelo (categoría (a): plano, en cualquier punto) ─

export interface FloorScatterPlacement {
  x: number;
  z: number;
  variant: KitModelName;
  /** Múltiplo de 90°: las variantes de decal son losas más o menos cuadradas, un giro discreto basta para variar la lectura sin dejar ninguna junta rara. */
  rotationY: number;
}

/** Margen desde el muro interior que NO recibe decoración de suelo (evita un decal pegado bajo un poste de esquina). */
const FLOOR_SCATTER_WALL_MARGIN = 1.3;
/** Área media (u²) que "posee" cada decal — controla la densidad total: sala pequeña (9×9=81) → ~2-3 decals; sala grande de jefe (15×15=225) → el tope `FLOOR_SCATTER_MAX`. */
const FLOOR_SCATTER_AREA_PER_DECAL = 32;
const FLOOR_SCATTER_MIN = 1;
/** Tope duro: "densidad CONTENIDA" (encargo F5) — es ambientación, nunca debe competir por atención con hazards/hero. */
const FLOOR_SCATTER_MAX = 4;
/** Separación mínima entre dos decals (evita que dos losas decoradas queden pegadas, leyéndose como una sola mancha rara). */
const FLOOR_SCATTER_MIN_GAP = 1.6;
/** Margen extra alrededor de un hazard que ningún decal debe invadir — aunque el decal sea plano, "brotar" de un foso o un campo de pinchos rompe la lectura del hazard (acceptance de F5: "no debe tapar un hazard"). */
const HAZARD_AVOID_MARGIN = 0.6;
/** Intentos de recolocación antes de renunciar a ESE decal (mejor un decal de menos que uno mal puesto). */
const PLACEMENT_ATTEMPTS = 8;

function overlapsHazard(x: number, z: number, hazards: readonly HazardSpawn[]): boolean {
  for (const h of hazards) {
    const halfW = h.width / 2 + HAZARD_AVOID_MARGIN;
    const halfH = h.height / 2 + HAZARD_AVOID_MARGIN;
    if (Math.abs(x - h.position.x) < halfW && Math.abs(z - h.position.y) < halfH) return true;
  }
  return false;
}

function tooCloseToPlaced(x: number, z: number, placed: readonly { x: number; z: number }[], minGap: number): boolean {
  for (const p of placed) {
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < minGap * minGap) return true;
  }
  return false;
}

/**
 * Decals de suelo (baldosas partidas/con hierbajos/con rocas) salpicados por
 * el interior de la sala, evitando hazards y el margen junto al muro. Cuenta
 * objetivo derivada del ÁREA de la sala (`FLOOR_SCATTER_AREA_PER_DECAL`),
 * acotada a `[FLOOR_SCATTER_MIN, FLOOR_SCATTER_MAX]`; si un candidato no
 * encuentra hueco válido tras `PLACEMENT_ATTEMPTS`, se descarta ESE decal (la
 * cuenta final puede salir por debajo del objetivo, nunca por encima).
 *
 * `variants` la decide QUIEN LLAMA (`FLOOR_FAMILIES[familia].scatter`, ver
 * `floor-families.ts`) — este módulo ya no sabe qué familia tiene la sala, así
 * que no puede inventarse un catálogo propio. Bug corregido con esto (playtest
 * 2026-08-07, medido): antes `floorScatterPlacements` siempre sorteaba entre
 * las 5 variantes de PIEDRA sin mirar la familia real, así que una sala de
 * MADERA (segura, sin enemigos) podía salir con escombros de piedra en mitad
 * del suelo — parpadeando además, por mal alineados (ver `RoomPropsView.tsx`).
 *
 * Lista vacía (familia sin decals, hoy solo `madera`) ⇒ `[]` inmediato, ANTES
 * de leer un solo número del `rng` compartido con `wallClutterPlacements`/
 * `wallDecorPlacements` (`computeRoomProps`, más abajo): así el resto del
 * atrezzo de la sala (esquinas, parapeto) no cambia de sitio solo porque le
 * tocó una familia sin catálogo de suelo — decisión tomada a propósito, no la
 * opción "consumir igual" que también habría sido válida.
 */
export function floorScatterPlacements(
  bounds: AABB,
  rng: Rng,
  hazards: readonly HazardSpawn[],
  variants: readonly KitModelName[],
): FloorScatterPlacement[] {
  if (variants.length === 0) return [];

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const targetCount = Math.min(
    FLOOR_SCATTER_MAX,
    Math.max(FLOOR_SCATTER_MIN, Math.round((width * height) / FLOOR_SCATTER_AREA_PER_DECAL)),
  );

  const innerMinX = bounds.minX + FLOOR_SCATTER_WALL_MARGIN;
  const innerMaxX = bounds.maxX - FLOOR_SCATTER_WALL_MARGIN;
  const innerMinZ = bounds.minY + FLOOR_SCATTER_WALL_MARGIN;
  const innerMaxZ = bounds.maxY - FLOOR_SCATTER_WALL_MARGIN;
  // Sala demasiado pequeña para dejar el margen por los 4 lados: sin decals de suelo (mejor ninguno que uno pegado al muro).
  if (innerMinX >= innerMaxX || innerMinZ >= innerMaxZ) return [];

  const placements: FloorScatterPlacement[] = [];
  for (let i = 0; i < targetCount; i++) {
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      const x = innerMinX + rng() * (innerMaxX - innerMinX);
      const z = innerMinZ + rng() * (innerMaxZ - innerMinZ);
      if (overlapsHazard(x, z, hazards)) continue;
      if (tooCloseToPlaced(x, z, placements, FLOOR_SCATTER_MIN_GAP)) continue;
      const variant = variants[Math.floor(rng() * variants.length)];
      const rotationY = Math.floor(rng() * 4) * (Math.PI / 2);
      placements.push({ x, z, variant, rotationY });
      break;
    }
  }
  return placements;
}

// ── Escombros/cajas de esquina (categoría (c): dentro de la huella de muro+poste) ─

export const WALL_CLUTTER_KINDS = ['rubble_half', 'box_small', 'crate_small'] as const;
export type WallClutterKind = (typeof WALL_CLUTTER_KINDS)[number];

export interface WallClutterPlacement {
  x: number;
  z: number;
  kind: WallClutterKind;
  rotationY: number;
}

/** Tope duro de piezas de bulto por sala: es ambientación de esquina, no relleno — casi siempre 0-2. */
const WALL_CLUTTER_MAX = 2;
/** Probabilidad, por esquina candidata, de que SÍ lleve algo — permite (y es deseable) que una sala se quede sin ningún bulto. */
const WALL_CLUTTER_CHANCE = 0.5;
/**
 * Cuánto se adentra cada pieza desde la cara interior del muro, medido desde
 * CADA uno de los dos muros que forman la esquina (no es un radio: la pieza
 * queda en la diagonal de la esquina, a esta distancia de ambos muros).
 * Pensado para que cualquiera de las 3 piezas (incluida `rubble_half`
 * reducida, ver `RoomPropsView.tsx`) quede dentro de la huella que ya ocupa
 * el poste de esquina (`column`, ART_KIT_PLAN §2: footprint ≈0.59×0.59) sin
 * clavarse en el propio poste, que vive un poco más afuera (fuera de
 * `bounds`, en la esquina exterior del muro).
 */
const WALL_CLUTTER_INSET = 0.75;

function cornerCandidates(bounds: AABB): { x: number; z: number; dirX: number; dirZ: number }[] {
  const inset = WALL_CLUTTER_INSET;
  return [
    { x: bounds.minX + inset, z: bounds.minY + inset, dirX: 1, dirZ: 1 },
    { x: bounds.maxX - inset, z: bounds.minY + inset, dirX: -1, dirZ: 1 },
    { x: bounds.minX + inset, z: bounds.maxY - inset, dirX: 1, dirZ: -1 },
    { x: bounds.maxX - inset, z: bounds.maxY - inset, dirX: -1, dirZ: -1 },
  ];
}

/**
 * Hasta `WALL_CLUTTER_MAX` piezas de bulto (escombros/caja/cajón), SOLO en
 * las 4 esquinas del interior de la sala — nunca sueltas en mitad. Recorre
 * las esquinas en orden FIJO (nunca barajado: determinismo por orden de
 * lectura del `rng`, no hace falta más) tirando una moneda por esquina
 * (`WALL_CLUTTER_CHANCE`) hasta agotar el tope o las 4 esquinas; cada esquina
 * aceptada también se descarta si cae dentro de un hazard (esquina con un
 * hazard pegado, caso raro pero posible en salas pequeñas).
 */
export function wallClutterPlacements(bounds: AABB, rng: Rng, hazards: readonly HazardSpawn[]): WallClutterPlacement[] {
  const placements: WallClutterPlacement[] = [];
  for (const corner of cornerCandidates(bounds)) {
    if (placements.length >= WALL_CLUTTER_MAX) break;
    if (rng() >= WALL_CLUTTER_CHANCE) continue;
    if (overlapsHazard(corner.x, corner.z, hazards)) continue;
    const kind = WALL_CLUTTER_KINDS[Math.floor(rng() * WALL_CLUTTER_KINDS.length)];
    const rotationY = Math.atan2(corner.dirX, corner.dirZ);
    placements.push({ x: corner.x, z: corner.z, kind, rotationY });
  }
  return placements;
}

// ── Banderas/candelabro de parapeto (categoría (b): SIEMPRE fuera del interior) ─

export const WALL_DECOR_BANNER_KINDS = ['banner_red', 'banner_blue'] as const;
export type WallDecorKind = (typeof WALL_DECOR_BANNER_KINDS)[number] | 'candle_triple';

export interface WallDecorPlacement {
  x: number;
  z: number;
  kind: WallDecorKind;
  /** Dirección unitaria hacia el centro de la sala (mismo contrato que `TorchEmitter.dirX/dirZ` en torch-placements.ts): orienta la pieza para que su cara "buena" mire adentro. */
  dirX: number;
  dirZ: number;
}

/** Cuánto sobresale la decoración por FUERA del interior jugable — mismo criterio y mismo valor que `TORCH_WALL_OUT` (torch-placements.ts, privada ahí): categoría (b) de la restricción de diseño, nunca dentro de `bounds`. */
const WALL_DECOR_OUT = 0.25;

/** Los 4 puntos medios de muro (no esquinas: para no competir visualmente con `wallClutterPlacements`, que sí vive en las esquinas), cada uno ya con su dirección hacia el centro. */
function wallMidpoints(bounds: AABB): { x: number; z: number; dirX: number; dirZ: number }[] {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minY + bounds.maxY) / 2;
  const out = WALL_DECOR_OUT;
  return [
    { x: cx, z: bounds.minY - out, dirX: 0, dirZ: 1 }, // norte
    { x: cx, z: bounds.maxY + out, dirX: 0, dirZ: -1 }, // sur
    { x: bounds.minX - out, z: cz, dirX: 1, dirZ: 0 }, // oeste
    { x: bounds.maxX + out, z: cz, dirX: -1, dirZ: 0 }, // este
  ];
}

/**
 * Bandera (roja o azul, sorteada) en un punto medio de muro + candelabro
 * `candle_triple` en OTRO punto medio distinto — 2 piezas fijas, nunca más
 * (densidad contenida: solo se llama para sala de jefe/tienda, que ya llevan
 * las antorchas de `TorchPropsView`, ver `RoomPropsView.tsx`). Ambas por
 * FUERA del interior jugable (categoría (b)), igual que una antorcha de muro.
 */
export function wallDecorPlacements(bounds: AABB, rng: Rng): WallDecorPlacement[] {
  const midpoints = wallMidpoints(bounds);
  const bannerIndex = Math.floor(rng() * midpoints.length);
  const bannerKind = WALL_DECOR_BANNER_KINDS[Math.floor(rng() * WALL_DECOR_BANNER_KINDS.length)];
  // Candelabro en un muro DISTINTO al de la bandera (nunca el mismo índice), elegido entre los 3 restantes.
  const remaining = midpoints.map((_, i) => i).filter((i) => i !== bannerIndex);
  const candleIndex = remaining[Math.floor(rng() * remaining.length)];

  const banner = midpoints[bannerIndex];
  const candle = midpoints[candleIndex];
  return [
    { x: banner.x, z: banner.z, kind: bannerKind, dirX: banner.dirX, dirZ: banner.dirZ },
    { x: candle.x, z: candle.z, kind: 'candle_triple', dirX: candle.dirX, dirZ: candle.dirZ },
  ];
}

// ── Punto de entrada único por sala ─────────────────────────────────────────

export interface RoomPropsResult {
  floorScatter: FloorScatterPlacement[];
  wallClutter: WallClutterPlacement[];
  wallDecor: WallDecorPlacement[];
}

/**
 * Calcula TODO el atrezzo de una sala de una vez, a partir de su id (semilla)
 * y su interior jugable (`bounds`, coordenadas de MUNDO). `featured` (sala de
 * jefe o de tienda, ver ART_KIT_PLAN.md F5) gatea `wallDecorPlacements`
 * (banderas/candelabro): el resto de salas de combate no las llevan, solo
 * decals de suelo + bulto de esquina.
 *
 * `floorScatterVariants` la calcula QUIEN LLAMA a partir de la familia de
 * suelo real de la sala (`FLOOR_FAMILIES[pickFloorFamily(room)].scatter`, ver
 * `floor-families.ts`) y se pasa tal cual a `floorScatterPlacements` — este
 * fichero no importa nada de `render/` a propósito (es tipo puro, ver cabecera
 * del fichero, `KitModelName` es solo un tipo y no acopla nada en tiempo de
 * ejecución) para no decidir aquí qué familia le toca a una sala: esa decisión
 * vive en un único sitio (`RoomView.tsx`/`RoomPropsView.tsx` llaman a
 * `pickFloorFamily` con el mismo criterio) para que suelo y decal nunca puedan
 * divergir.
 *
 * Un ÚNICO `rng` (creado de la semilla de esta sala) alimenta las tres
 * categorías EN ORDEN (suelo → esquinas → parapeto): sigue siendo 100%
 * determinista por `roomId` sea cual sea el orden, y evita tener que inventar
 * 3 semillas derivadas distintas para una sola sala.
 */
export function computeRoomProps(
  roomId: string,
  bounds: AABB,
  featured: boolean,
  hazards: readonly HazardSpawn[],
  floorScatterVariants: readonly KitModelName[],
): RoomPropsResult {
  const rng = createRng(hashRoomId(roomId));
  const floorScatter = floorScatterPlacements(bounds, rng, hazards, floorScatterVariants);
  const wallClutter = wallClutterPlacements(bounds, rng, hazards);
  const wallDecor = featured ? wallDecorPlacements(bounds, rng) : [];
  return { floorScatter, wallClutter, wallDecor };
}
