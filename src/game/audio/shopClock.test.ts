import { describe, expect, it } from 'vitest';
import type { RoomData } from '@/game/world/types';
import { shouldPlayShopClock } from './shopClock';

function room(tags: RoomData['tags']): Pick<RoomData, 'tags'> {
  return { tags };
}

describe('shouldPlayShopClock', () => {
  it('suena dentro de una room tienda', () => {
    expect(shouldPlayShopClock({ room: room(['tienda']) })).toBe(true);
  });

  it('no suena en otras rooms', () => {
    expect(shouldPlayShopClock({ room: room(['combate']) })).toBe(false);
  });
});
