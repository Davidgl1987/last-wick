import { ROOM_MIN_SIZE } from '@/game/world/constants';
import type { RoomData } from '@/game/world/types';
import { ALL_TAGS } from '@/editor/constants';
import { Checkbox, TextField } from '@/ui';

/** Metadatos de la sala: id, nombre, tamaño y tags. */
export function RoomSection({ room, setRoom }: { room: RoomData; setRoom: (r: RoomData) => void }) {
  return (
    <section className="editor-section editor-stack">
      <h2>Sala</h2>
      <TextField
        label="Identificador"
        value={room.id}
        onChange={(e) => setRoom({ ...room, id: e.target.value.trim() })}
      />
      <TextField label="Nombre" value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} />
      <div className="editor-field-row">
        <TextField
          label={`Ancho (impar ≥ ${ROOM_MIN_SIZE})`}
          type="number"
          min={ROOM_MIN_SIZE}
          step={2}
          value={room.width}
          onChange={(e) => setRoom({ ...room, width: Number(e.target.value) })}
        />
        <TextField
          label={`Alto (impar ≥ ${ROOM_MIN_SIZE})`}
          type="number"
          min={ROOM_MIN_SIZE}
          step={2}
          value={room.height}
          onChange={(e) => setRoom({ ...room, height: Number(e.target.value) })}
        />
      </div>
      <div className="editor-tags">
        {ALL_TAGS.map((tag) => (
          <Checkbox
            key={tag}
            label={tag}
            className="editor-tag"
            checked={room.tags.includes(tag)}
            onChange={(checked) =>
              setRoom({
                ...room,
                tags: checked ? [...room.tags, tag] : room.tags.filter((x) => x !== tag),
              })
            }
          />
        ))}
      </div>
    </section>
  );
}
