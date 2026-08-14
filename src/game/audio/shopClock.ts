import type { RoomData } from '@/game/world/types';

/** El reloj es ambiente de la sala física de tienda, no feedback del modal. */
export function shouldPlayShopClock(world: { room: Pick<RoomData, 'tags'> }): boolean {
  return world.room.tags.includes('tienda');
}
