import { DOOR_WIDTH } from '@/game/world/constants';
import type { RoomData } from '@/game/world/types';
import { SIDES, SIDE_LABEL } from '@/editor/constants';
import { Button, Icon, TextField } from '@/ui';

/** Huecos de puerta por lado (máx. 2 por lado). */
export function DoorsSection({ room, setRoom }: { room: RoomData; setRoom: (r: RoomData) => void }) {
  return (
    <section className="editor-section editor-stack">
      <h2>Puertas (máx. 2 por lado)</h2>
      {SIDES.map((side) => {
        const slots = room.doorSlots.filter((s) => s.side === side);
        return (
          <div key={side} className="editor-doors-side">
            <span className="editor-doors-label">{SIDE_LABEL[side]}</span>
            {slots.map((slot, i) => (
              <span key={i} className="editor-door-slot">
                <TextField
                  label={`Offset puerta ${SIDE_LABEL[side]}`}
                  hideLabel
                  type="number"
                  step={0.5}
                  value={slot.offset}
                  onChange={(e) => {
                    const offset = Number(e.target.value);
                    setRoom({
                      ...room,
                      doorSlots: room.doorSlots.map((s) =>
                        s === slot ? { side, offset } : s,
                      ),
                    });
                  }}
                />
                <button
                  type="button"
                  className="editor-door-remove"
                  aria-label={`Quitar puerta ${SIDE_LABEL[side]}`}
                  onClick={() =>
                    setRoom({ ...room, doorSlots: room.doorSlots.filter((s) => s !== slot) })
                  }
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
            {slots.length < 2 && (
              <Button
                variant="secondary"
                className="editor-add-door-btn"
                onClick={() =>
                  setRoom({
                    ...room,
                    doorSlots: [
                      ...room.doorSlots,
                      { side, offset: slots.length === 0 ? 0 : slots[0].offset + DOOR_WIDTH + 0.5 },
                    ],
                  })
                }
              >
                + puerta
              </Button>
            )}
          </div>
        );
      })}
    </section>
  );
}
