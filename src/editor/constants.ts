import type { DoorSide, EnemyKind, HazardKind, ItemKind, RoomTag } from '@/game/world/types';

export const ENEMY_KINDS: EnemyKind[] = ['dummy', 'chaser', 'spike', 'trail', 'shooter'];
export const HAZARD_KINDS: HazardKind[] = ['pit', 'spikes', 'barrel', 'rock', 'slow', 'boost'];
export const ITEM_KINDS: ItemKind[] = ['coin', 'potion', 'key'];
export const ALL_TAGS: RoomTag[] = ['inicio', 'combate', 'llave', 'recompensa', 'jefe'];
export const SIDES: DoorSide[] = ['north', 'south', 'east', 'west'];

export const ENEMY_COLOR: Record<EnemyKind, string> = {
  dummy: '#ff5964',
  chaser: '#ff9f45',
  spike: '#9aa1bd',
  trail: '#4dd68a',
  shooter: '#2b2f42',
  // 'boss' no es colocable desde el editor por ahora (GDD §15: los jefes se
  // definen por sala en features/bosses/registry.ts + src/game/features/dungeon/levels/boss-*.json, no
  // pieza a pieza); el color solo satisface la exhaustividad del Record.
  boss: '#7a3fd6',
};
export const HAZARD_COLOR: Record<HazardKind, string> = {
  pit: '#05060a',
  spikes: '#8d94ad',
  barrel: '#c0442b',
  rock: '#767d99',
  slow: '#6b4a2f',
  boost: '#3fd0ff',
};
export const ITEM_COLOR: Record<ItemKind, string> = {
  coin: '#ffd166',
  potion: '#ff6bcb',
  key: '#ffe082',
  // 'shopkeeper' no es colocable desde el editor por ahora (docs/plans/ECONOMY_PLAN.md
  // F4: la sala de tienda de serie ya lo trae en su JSON, mismo espíritu que
  // 'boss' en ENEMY_COLOR); el color solo satisface la exhaustividad del Record.
  shopkeeper: '#7bd88f',
};
export const SIDE_LABEL: Record<DoorSide, string> = { north: 'Norte', south: 'Sur', east: 'Este', west: 'Oeste' };

/** Las 4 direcciones cardinales de los selectores de dirección del editor
 * (púa del enemigo `spike` en EnemyProperties, impulso del hazard `boost` en
 * HazardProperties): comparten un único icono `chevron` (apunta arriba, ver
 * src/ui/Icon.tsx) rotado por CSS con `rotate` en vez de registrar 4 iconos
 * casi idénticos en el kit. */
export const DIRECTIONS: { label: string; rotate: number; dir: { x: number; y: number } }[] = [
  { label: 'arriba', rotate: 0, dir: { x: 0, y: -1 } },
  { label: 'abajo', rotate: 180, dir: { x: 0, y: 1 } },
  { label: 'izquierda', rotate: -90, dir: { x: -1, y: 0 } },
  { label: 'derecha', rotate: 90, dir: { x: 1, y: 0 } },
];

export const HAZARD_DEFAULT_SIZE: Record<HazardKind, { width: number; height: number }> = {
  pit: { width: 1.6, height: 1.6 },
  spikes: { width: 1.4, height: 1.4 },
  barrel: { width: 0.8, height: 0.8 },
  rock: { width: 1.2, height: 1.2 },
  slow: { width: 2, height: 1.6 },
  boost: { width: 1.2, height: 2 },
};
