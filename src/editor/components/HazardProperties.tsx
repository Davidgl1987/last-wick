import type { HazardSpawn } from '@/game/world/types';
import { TextField } from '@/ui';

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
    </div>
  );
}
