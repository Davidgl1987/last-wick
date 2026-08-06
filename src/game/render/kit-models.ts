/**
 * Catálogo del KayKit Dungeon Pack (docs/plans/ART_KIT_PLAN.md, F1) — módulo
 * PURO a propósito: nada de `three` ni de DOM aquí. `kit.ts` (la capa de
 * three) importa de este fichero para no repetir la lista de nombres, y este
 * fichero se testea en el entorno `node` de vitest (ver `vite.config.ts`,
 * `test.environment: 'node'`) precisamente porque no depende de un navegador.
 *
 * La lista sale de `ls public/models/kaykit/*.gltf` (F0 ya dejó los ficheros
 * en el repo, pack completo de 283 modelos): los que aquí se registran son
 * los que el juego PRECARGA, cada uno con su `.gltf` + `.bin` hermano, todos
 * referenciando la misma `dungeon_texture.png` por URI relativa. El test de
 * este módulo (`kit-models.test.ts`) comprueba que esta lista y el contenido
 * real de la carpeta no diverjan (y que siga siendo un subconjunto — bastante
 * menor — del pack completo, ver ese test).
 */

export const KIT_MODELS = [
  'banner_blue',
  'banner_red',
  'barrel_large',
  'barrel_large_decorated',
  'barrel_small',
  'barrier_column',
  'barrier_corner',
  'barrier_half',
  'bartop_A_medium',
  'bench',
  'bookcase_single_decoratedA',
  'bottle_A_labeled_green',
  'bottle_C_green',
  'box_small',
  'candle',
  'candle_melted',
  'candle_triple',
  'chest_gold',
  'coin',
  'coin_stack_small',
  'column',
  'crate_large',
  'crate_small',
  'floor_dirt_large',
  'floor_dirt_small_A',
  'floor_dirt_small_B',
  'floor_dirt_small_C',
  'floor_dirt_small_D',
  'floor_dirt_small_weeds',
  'floor_foundation_corner',
  'floor_foundation_front',
  'floor_tile_big_spikes',
  'floor_tile_large',
  'floor_tile_large_rocks',
  'floor_tile_small',
  'floor_tile_small_broken_A',
  'floor_tile_small_broken_B',
  'floor_tile_small_decorated',
  'floor_tile_small_weeds_A',
  'floor_tile_small_weeds_B',
  'floor_wood_large',
  'floor_wood_small',
  'floor_wood_small_dark',
  'keg',
  'key_gold',
  'pillar',
  'rocks',
  'rocks_decorated',
  'rocks_small',
  'rubble_half',
  'shelves_decorated',
  'stool',
  'sword_shield',
  'table_medium',
  'torch_mounted',
  'wall',
  'wall_arched',
  'wall_archedwindow_gated',
  'wall_broken',
  'wall_cracked',
  'wall_doorway',
  'wall_doorway_scaffold',
  'wall_half',
  'wall_inset',
  'wall_inset_candles',
  'wall_inset_shelves',
  'wall_window_closed',
] as const;

export type KitModelName = (typeof KIT_MODELS)[number];

/** Carpeta del kit, relativa a la base servida (ver `kitModelUrl`). Con barra final: se concatena directamente delante del nombre de fichero. */
export const KIT_DIR = 'models/kaykit/';

/**
 * URL de un `.gltf` del kit a partir de una base servida (`baseUrl`), pasada
 * como PARÁMETRO en vez de leer `import.meta.env.BASE_URL` aquí dentro —
 * justo lo que mantiene este módulo puro y testeable en `node` (`kit.ts` es
 * quien conoce y pasa `import.meta.env.BASE_URL`, ver GDD del pipeline en
 * ART_KIT_PLAN.md §3: el proyecto se despliega con `base: './'` en GitHub
 * Pages, así que la URL SIEMPRE debe salir de ahí, nunca de una ruta
 * absoluta).
 *
 * Contrato: `baseUrl` puede venir con o sin barra final (`'./'` o `'.'`,
 * `'/'` o `''`) — aquí se normaliza a exactamente una barra entre la base y
 * `KIT_DIR`, así que da igual cómo la pase quien llama.
 */
export function kitModelUrl(name: KitModelName, baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${KIT_DIR}${name}.gltf`;
}
