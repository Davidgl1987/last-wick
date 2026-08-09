import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventType } from '@/engine/events';
import { playEventSfx, resolveEventClip, SFX_BY_EVENT, SILENT_EVENTS } from './eventSfx';

/**
 * Lista exhaustiva de GameEventType con `satisfies Record<GameEventType, true>`
 * (encargo de audio): si alguien añade un GameEventType nuevo y olvida
 * decidir su sonido, TypeScript deja de compilar ESTE fichero de test antes
 * de que el evento pueda quedar mudo por descuido.
 */
const ALL_EVENT_TYPES = {
  launch: true,
  'wall-bounce': true,
  'projectile-wall': true,
  'enemy-shot': true,
  'enemy-hit': true,
  'boss-hit': true,
  'enemy-died': true,
  'player-damaged': true,
  'player-died': true,
  'godmode-revive': true,
  'shield-block': true,
  'pit-fall': true,
  'pit-respawn': true,
  'spikes-hit': true,
  'barrel-explosion': true,
  'item-pickup': true,
  'room-cleared': true,
  'upgrade-applied': true,
  'upgrade-purchased': true,
  'shop-opened': true,
  'room-entered': true,
  'doors-open': true,
  'door-locked': true,
  victory: true,
  'dungeon-cleared': true,
  'boss-door-sealed': true,
  'boss-phase-changed': true,
  'boss-telegraph': true,
  'boss-defeated': true,
  'boss-charge-dust': true,
  'boss-shard-burst': true,
  'boss-barrel-spawn': true,
  'boss-barrel-land': true,
  'boss-barrel-charge-stun': true,
  'boss-wave-spawn': true,
  'boss-column-cracked': true,
  'boss-column-broken': true,
  'boss-columns-cleared': true,
  'boss-guardian-charge': true,
  'boss-immune-hit': true,
} satisfies Record<GameEventType, true>;

function makeEvent(type: GameEventType, overrides: Partial<GameEvent> = {}): GameEvent {
  return { type, x: 0, y: 0, intensity: 1, label: '', ...overrides };
}

describe('eventSfx (tabla evento → sonido)', () => {
  it('todo GameEventType está en SFX_BY_EVENT o en SILENT_EVENTS, nunca en ambos', () => {
    for (const type of Object.keys(ALL_EVENT_TYPES) as GameEventType[]) {
      const inTable = type in SFX_BY_EVENT;
      const inSilent = SILENT_EVENTS.includes(type);
      expect(inTable || inSilent, `${type} debería estar en SFX_BY_EVENT o SILENT_EVENTS`).toBe(true);
      expect(inTable && inSilent, `${type} no puede estar en ambos`).toBe(false);
    }
  });

  it('no hay ningún tipo fuera de la unión (SFX_BY_EVENT + SILENT_EVENTS no exceden el total)', () => {
    const tableCount = Object.keys(SFX_BY_EVENT).length;
    const silentCount = SILENT_EVENTS.length;
    expect(tableCount + silentCount).toBe(Object.keys(ALL_EVENT_TYPES).length);
  });

  describe('resolveEventClip', () => {
    it('launch: 3 armas → 3 clips distintos', () => {
      expect(resolveEventClip(makeEvent('launch'), 'body')).toBe('launch-body');
      expect(resolveEventClip(makeEvent('launch'), 'arrow')).toBe('launch-arrow');
      expect(resolveEventClip(makeEvent('launch'), 'spell')).toBe('launch-spell');
    });

    it('projectile-wall: por label de arma, null si no reconoce el label', () => {
      expect(resolveEventClip(makeEvent('projectile-wall', { label: 'arrow' }), 'body')).toBe('projectile-wall-arrow');
      expect(resolveEventClip(makeEvent('projectile-wall', { label: 'spell' }), 'body')).toBe('projectile-wall-spell');
      expect(resolveEventClip(makeEvent('projectile-wall', { label: 'huh' }), 'body')).toBeNull();
    });

    it('item-pickup: los 4 labels posibles (coin/potion/key mudo en shopkeeper)', () => {
      expect(resolveEventClip(makeEvent('item-pickup', { label: 'coin' }), 'body')).toBe('pickup-coin');
      expect(resolveEventClip(makeEvent('item-pickup', { label: 'potion' }), 'body')).toBe('pickup-potion');
      expect(resolveEventClip(makeEvent('item-pickup', { label: 'key' }), 'body')).toBe('pickup-key');
      expect(resolveEventClip(makeEvent('item-pickup', { label: 'shopkeeper' }), 'body')).toBeNull();
    });

    it('door-locked: los 3 casos (unlocked/locked/otro label mudo)', () => {
      expect(resolveEventClip(makeEvent('door-locked', { label: 'unlocked' }), 'body')).toBe('door-unlocked');
      expect(resolveEventClip(makeEvent('door-locked', { label: 'locked' }), 'body')).toBe('door-locked');
      expect(resolveEventClip(makeEvent('door-locked', { label: 'Sala del jefe' }), 'body')).toBeNull();
    });

    it('boss-telegraph: label acabado en -fire usa enemy-shot, el resto usa boss-telegraph', () => {
      expect(resolveEventClip(makeEvent('boss-telegraph', { label: 'prisma-arrow-fire' }), 'body')).toBe('enemy-shot');
      expect(resolveEventClip(makeEvent('boss-telegraph', { label: 'prisma-spell-fire' }), 'body')).toBe('enemy-shot');
      expect(resolveEventClip(makeEvent('boss-telegraph', { label: 'guardian-charge' }), 'body')).toBe('boss-telegraph');
    });

    it('tipos no dinámicos devuelven null (la tabla estática resuelve su clip)', () => {
      expect(resolveEventClip(makeEvent('wall-bounce'), 'body')).toBeNull();
      expect(resolveEventClip(makeEvent('boss-hit'), 'body')).toBeNull();
    });
  });

  describe('playEventSfx', () => {
    it('nunca lanza para ningún tipo de evento, con cualquier arma', () => {
      for (const type of Object.keys(ALL_EVENT_TYPES) as GameEventType[]) {
        for (const weapon of ['body', 'arrow', 'spell'] as const) {
          expect(() => playEventSfx(makeEvent(type, { label: 'coin' }), 0, 0, weapon)).not.toThrow();
        }
      }
    });

    it('no lanza para eventos lejanos del oyente (fuera de rango audible)', () => {
      expect(() => playEventSfx(makeEvent('enemy-hit', { x: 1000, y: 1000 }), 0, 0, 'body')).not.toThrow();
    });
  });
});
