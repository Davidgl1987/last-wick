import type { EnemySpawn } from '@/game/world/types';
import { snap } from '@/editor/utils';
import { Checkbox, Icon, TextField } from '@/ui';
import { DIRECTIONS } from '@/editor/constants';

export function EnemyProperties({ enemy, onChange }: { enemy: EnemySpawn; onChange: (e: EnemySpawn) => void }) {
  return (
    <div className="editor-stack">
      <p className="editor-hint">
        {enemy.kind} · <code>{enemy.id}</code>
      </p>
      <div className="editor-field-row">
        <TextField
          label="HP (vacío = defecto)"
          type="number"
          min={1}
          value={enemy.hp ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            const next = { ...enemy };
            if (v === '') delete next.hp;
            else next.hp = Number(v);
            onChange(next);
          }}
        />
        <TextField
          label="Radio"
          type="number"
          min={0.1}
          step={0.05}
          value={enemy.radius ?? ''}
          placeholder="0.4"
          onChange={(e) => {
            const v = e.target.value;
            const next = { ...enemy };
            if (v === '') delete next.radius;
            else next.radius = Number(v);
            onChange(next);
          }}
        />
      </div>
      <Checkbox
        label="Patrulla con destino"
        className="editor-tag"
        checked={enemy.patrolTarget !== undefined}
        onChange={(checked) => {
          const next = { ...enemy };
          if (checked) {
            next.patrolTarget = { x: snap(enemy.position.x + 2), y: enemy.position.y };
          } else {
            delete next.patrolTarget;
          }
          onChange(next);
        }}
      />
      {enemy.patrolTarget && (
        <div className="editor-field-row">
          <TextField
            label="Destino X"
            type="number"
            step={0.5}
            value={enemy.patrolTarget.x}
            onChange={(e) =>
              onChange({ ...enemy, patrolTarget: { x: Number(e.target.value), y: enemy.patrolTarget!.y } })
            }
          />
          <TextField
            label="Destino Y"
            type="number"
            step={0.5}
            value={enemy.patrolTarget.y}
            onChange={(e) =>
              onChange({ ...enemy, patrolTarget: { x: enemy.patrolTarget!.x, y: Number(e.target.value) } })
            }
          />
        </div>
      )}
      {enemy.kind === 'spike' && (
        <div className="editor-field">
          <span>Dirección de la púa</span>
          <div className="editor-field-row">
            {DIRECTIONS.map(({ label, rotate, dir }) => (
              <button
                key={label}
                type="button"
                className="editor-dir-btn"
                aria-label={`Púa hacia ${label}`}
                aria-pressed={(enemy.facing?.x ?? 0) === dir.x && (enemy.facing?.y ?? 1) === dir.y}
                onClick={() => onChange({ ...enemy, facing: { x: dir.x, y: dir.y } })}
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
