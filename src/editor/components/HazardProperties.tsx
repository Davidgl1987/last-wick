import type { HazardSpawn } from '@/game/world/types';
import { Icon, TextField } from '@/ui';
import { DIRECTIONS } from '@/editor/constants';

export function HazardProperties({ hazard, onChange }: { hazard: HazardSpawn; onChange: (h: HazardSpawn) => void }) {
  return (
    <div className="editor-stack">
      <p className="editor-hint">
        {hazard.kind} · <code>{hazard.id}</code>
      </p>
      <div className="editor-field-row">
        <TextField
          label="Ancho"
          type="number"
          min={0.2}
          step={0.2}
          value={hazard.width}
          onChange={(e) => onChange({ ...hazard, width: Number(e.target.value) })}
        />
        <TextField
          label="Alto"
          type="number"
          min={0.2}
          step={0.2}
          value={hazard.height}
          onChange={(e) => onChange({ ...hazard, height: Number(e.target.value) })}
        />
      </div>
      {hazard.kind === 'boost' && (
        <div className="editor-field">
          <span>Dirección del impulso</span>
          <div className="editor-field-row">
            {DIRECTIONS.map(({ label, rotate, dir }) => (
              <button
                key={label}
                type="button"
                className="editor-dir-btn"
                aria-label={`Impulso hacia ${label}`}
                aria-pressed={(hazard.direction?.x ?? 0) === dir.x && (hazard.direction?.y ?? 1) === dir.y}
                onClick={() => onChange({ ...hazard, direction: { x: dir.x, y: dir.y } })}
              >
                <Icon name="chevron" size={16} style={{ transform: `rotate(${rotate}deg)` }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
