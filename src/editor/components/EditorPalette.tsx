import type { CSSProperties } from 'react';
import { ENEMY_COLOR, ENEMY_KINDS, HAZARD_COLOR, HAZARD_KINDS, ITEM_COLOR, ITEM_KINDS } from '@/editor/constants';
import type { PlaceKind } from '@/editor/types';
import { frameClass, Icon } from '@/ui';

/** `--ui-frame-color` es una custom property: CSSProperties no la declara por defecto. */
type FrameColorStyle = CSSProperties & { '--ui-frame-color'?: string };

/**
 * Paleta de colocación: inicio del jugador, enemigos, hazards e items.
 *
 * Cada celda es un botón-toggle (elige UNO para colocar, no dispara una
 * acción), así que usa el marco `plain` del kit puesto a mano con
 * `frameClass` — mismo mecanismo que los botones de `WeaponBar`
 * (src/game/ui/weapon-bar.css) — en vez de `Button`, que fuerza tamaño de
 * bloque a 100% y no cabe en una rejilla de celdas pequeñas. El color de
 * cada celda (`ENEMY_COLOR`/`HAZARD_COLOR`/`ITEM_COLOR`) es semántico —
 * identifica el tipo de entidad del juego — así que NO se toca: solo cambia
 * de "borde CSS" a `--ui-frame-color" (la variable que lee el marco del
 * kit).
 */
export function EditorPalette({ placing, setPlacing }: { placing: PlaceKind; setPlacing: (p: PlaceKind) => void }) {
  return (
    <section className="editor-section">
      <h2>Colocar</h2>
      <div className="editor-palette">
        <button
          type="button"
          className={frameClass('plain', 'editor-palette-btn')}
          aria-pressed={placing?.type === 'start'}
          onClick={() => setPlacing({ type: 'start' })}
        >
          <Icon name="target" size={14} />
          inicio
        </button>
        {ENEMY_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={frameClass('plain', 'editor-palette-btn')}
            style={{ '--ui-frame-color': ENEMY_COLOR[kind] } as FrameColorStyle}
            aria-pressed={placing?.type === 'enemy' && placing.kind === kind}
            onClick={() => setPlacing({ type: 'enemy', kind })}
          >
            {kind}
          </button>
        ))}
        {HAZARD_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={frameClass('plain', 'editor-palette-btn')}
            style={{ '--ui-frame-color': HAZARD_COLOR[kind] } as FrameColorStyle}
            aria-pressed={placing?.type === 'hazard' && placing.kind === kind}
            onClick={() => setPlacing({ type: 'hazard', kind })}
          >
            {kind}
          </button>
        ))}
        {ITEM_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={frameClass('plain', 'editor-palette-btn')}
            style={{ '--ui-frame-color': ITEM_COLOR[kind] } as FrameColorStyle}
            aria-pressed={placing?.type === 'item' && placing.kind === kind}
            onClick={() => setPlacing({ type: 'item', kind })}
          >
            {kind}
          </button>
        ))}
      </div>
    </section>
  );
}
