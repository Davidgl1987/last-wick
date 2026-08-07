/**
 * FAMILIAS de suelo (piedra/tierra/madera): la baldosa base y sus variantes de
 * rejilla continua (`subtle`/`loud`, ver `FloorGrid` en `RoomView.tsx`) Y los
 * decals de suelo SUELTOS que puede salpicar `floorScatterPlacements`
 * (`room-props.ts`/`RoomPropsView.tsx::FloorScatterMesh`) sobre esa familia.
 * Módulo PURO a propósito (sin `three` ni JSX): lo importan tanto `RoomView.tsx`
 * (la rejilla) como `room-props.ts`/`RoomPropsView.tsx` (los decals), y antes
 * de esta extracción cada uno mantenía su PROPIA idea de "qué va en el suelo"
 * — `RoomView.tsx` tenía las familias reales, y `room-props.ts` una lista
 * `FLOOR_SCATTER_VARIANTS` de piedra fija, sin relación con la familia de la
 * sala. Bug medido en playtest 2026-08-07: en `start-hall` (suelo de MADERA,
 * sin enemigos) salían decals de PIEDRA rotos/con hierbajos, uno literalmente
 * bajo el `playerStart`. Con la familia como única fuente de verdad de "qué
 * puede aparecer en este suelo" — baldosa de rejilla y decal suelto por igual
 * — esa divergencia deja de ser posible por construcción.
 *
 * Extraído de `RoomView.tsx` (que se queda con la parte de render: `FloorGrid`,
 * materiales, alineado en Y) — este fichero solo decide QUÉ piezas hay y CUÁL
 * le toca a una sala/baldosa/decal, nunca CÓMO se pintan.
 */

import type { KitModelName } from './kit-models';

/**
 * Hash de cadena a entero no negativo — multiplicador primo 31, sin
 * pretensión criptográfica, solo repartir ids arbitrarios de forma estable
 * entre N cubos (mismo algoritmo que `room-props.ts::hashRoomId`, duplicado
 * ahí a propósito para no acoplar los dos ficheros; aquí se factoriza UNA vez
 * porque las 4 variantes que lo usan en `RoomView.tsx` — roca, suelo, muro,
 * puerta — comparten fichero con esta función). Se aplica siempre sobre
 * `"${id}:${sal}"` con un sufijo distinto por categoría (nunca el id crudo
 * repetido en dos categorías): así la variante de suelo, muro y puerta de una
 * misma sala no quedan correlacionadas por construcción (mismo id → mismo
 * hash, y con listas de longitud distinta el patrón se notaría a la larga si
 * no se salara).
 */
export function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * FAMILIAS de suelo, y dentro de cada una sus variantes. Dos niveles a
 * propósito (encargo de David, 2026-08-06: "si el suelo es de baldosas, se
 * usen las variedades de baldosas, si es de tierra, las variedades de tierra
 * con plantas o piedras pequeñas"): la FAMILIA la elige la sala y se mantiene
 * coherente en toda ella, y dentro de la sala cada baldosa sortea una variante
 * de ESA familia. Antes se elegía una sola pieza por sala y se repetía idéntica
 * — que es lo que David rechazó.
 *
 * Se usan las baldosas PEQUEÑAS del pack (2×2 de fábrica ⇒ 1.68 u a
 * `KIT_SCALE`) a su tamaño natural, en vez de estirar una grande al 50% como
 * hacía la versión anterior: da exactamente el mismo tamaño en pantalla —el ya
 * validado— y a cambio abre el catálogo de variantes, que solo existe en el
 * tamaño pequeño.
 *
 * `base` es la norma y `subtle`/`loud` son acentos con dosis distinta (ver
 * `pickFloorTile`): un suelo donde cada baldosa es distinta se lee como ruido,
 * no como suelo. `loud` son las que levantan relieve (hierbajos, decorada) y
 * además cuestan 400-600 tris frente a los ~70 de una lisa.
 */
export interface FloorFamily {
  /** Baldosa lisa: la mayoría del suelo, y la que fija la altura de la familia (ver `FloorGrid`, RoomView.tsx). */
  base: KitModelName;
  /** Mismo perfil, distinto desgaste (roturas, vetas de tierra): salpicadas sin llamar la atención. */
  subtle: readonly KitModelName[];
  /** Con relieve por encima del plano (hierbajos, decorada): muy de vez en cuando. */
  loud: readonly KitModelName[];
  /** true ⇒ atlas cálido del pack (madera de verdad); false ⇒ piedra fría (ver cabecera de RoomView.tsx). */
  warm: boolean;
  /**
   * Decals de suelo SUELTOS que `floorScatterPlacements` (room-props.ts)
   * puede colocar sobre esta familia: piezas planas y aisladas (baldosa rota/
   * con hierbajos/con rocas encima), a diferencia de `subtle`/`loud` que son
   * variantes de la REJILLA continua (`FloorGrid`) — un decal es un bulto
   * suelto en mitad del suelo, la rejilla es el suelo en sí. Lista vacía ⇒
   * esta familia no lleva decals (ver `madera`, más abajo).
   */
  scatter: readonly KitModelName[];
}

export const FLOOR_FAMILIES = {
  piedra: {
    base: 'floor_tile_small',
    subtle: ['floor_tile_small_broken_A', 'floor_tile_small_broken_B'],
    loud: ['floor_tile_small_weeds_A', 'floor_tile_small_weeds_B', 'floor_tile_small_decorated'],
    warm: false,
    scatter: [
      'floor_tile_small_broken_A',
      'floor_tile_small_broken_B',
      'floor_tile_small_weeds_A',
      'floor_tile_small_weeds_B',
      'floor_tile_large_rocks',
    ],
  },
  tierra: {
    base: 'floor_dirt_small_D',
    subtle: ['floor_dirt_small_A', 'floor_dirt_small_B', 'floor_dirt_small_C'],
    loud: ['floor_dirt_small_weeds'],
    warm: false,
    // `floor_dirt_small_weeds` YA es la variante `loud` de la rejilla continua
    // (cualquier baldosa de tierra puede salir con ella, ver arriba), así que
    // como decal suelto se lee poco: es la misma pieza que ya podía tocarle a
    // la sala. `floor_dirt_large_rocky` es el que de verdad marca — relieve de
    // piedras sueltas que no existe en ninguna variante de la rejilla.
    scatter: ['floor_dirt_small_weeds', 'floor_dirt_large_rocky'],
  },
  madera: {
    base: 'floor_wood_small',
    subtle: ['floor_wood_small_dark'],
    loud: [],
    warm: true,
    // El kit no tiene tablones rotos ni con hierbajos, y la madera es la
    // marca de las salas SEGURAS (ver `pickFloorFamily`, debajo): dejarla sin
    // decals refuerza ese mensaje en vez de contradecirlo con escombros de
    // piedra que no pintan nada sobre un suelo cálido de sala sin enemigos.
    scatter: [],
  },
} as const satisfies Record<string, FloorFamily>;

export type FloorFamilyName = keyof typeof FLOOR_FAMILIES;

/** Familias que puede tocarle a una sala PELIGROSA — la madera queda fuera a propósito, ver `pickFloorFamily`. */
export const DANGEROUS_FLOOR_FAMILIES: readonly FloorFamilyName[] = ['piedra', 'tierra'];

/**
 * Familia de suelo de una sala. La MADERA no se sortea: es la marca de las
 * salas SEGURAS (encargo de David: "el suelo de madera es buena idea, pero
 * para las salas seguras nada más"), y eso la convierte en información de
 * juego y no en decoración — al entrar, el suelo cálido dice "aquí no te van a
 * atacar" antes de que veas si hay alguien.
 *
 * "Segura" se decide por si la sala TIENE ENEMIGOS, no por su etiqueta. Es más
 * robusto y dice exactamente lo que se quiere decir: las etiquetas no son
 * excluyentes (hay salas del pool con `tags: ['inicio', 'combate']`, ver
 * rooms.ts), así que fiarse de `tags.includes('inicio')` habría puesto suelo
 * cálido —o sea, la promesa de "aquí no pasa nada"— en una sala que sí trae
 * enemigos. Sin spawns no hay pelea posible, con etiqueta o sin ella.
 *
 * El resto de salas sortean piedra o tierra por hash del id (determinista: la
 * misma sala se ve igual entre recargas, ver `hashId`).
 */
export function pickFloorFamily(room: { id: string; enemies: readonly unknown[] }): FloorFamilyName {
  if (room.enemies.length === 0) return 'madera';
  return DANGEROUS_FLOOR_FAMILIES[hashId(`${room.id}:floor`) % DANGEROUS_FLOOR_FAMILIES.length];
}

/**
 * Variante de UNA baldosa concreta dentro de su familia. Determinista por
 * sala + coordenada de la baldosa: la misma sala se ve siempre igual, pero dos
 * baldosas contiguas no se parecen por construcción.
 *
 * Dosis: ~8% llamativas, ~25% sutiles, el resto lisas. El orden de los dos
 * `if` importa — 12 es múltiplo de 3, así que comprobar primero las llamativas
 * evita que se las coma el filtro de las sutiles.
 */
export function pickFloorTile(family: FloorFamily, roomId: string, ix: number, iz: number): KitModelName {
  const hash = hashId(`${roomId}:tile:${ix}:${iz}`);
  if (family.loud.length > 0 && hash % 12 === 0) return family.loud[Math.floor(hash / 12) % family.loud.length];
  if (family.subtle.length > 0 && hash % 3 === 0) return family.subtle[Math.floor(hash / 3) % family.subtle.length];
  return family.base;
}
