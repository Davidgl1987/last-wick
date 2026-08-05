import { DOOR_WIDTH, WALL_THICKNESS } from '@/game/world/constants';
import type { RoomData } from '@/game/world/types';
import { ENEMY_COLOR, HAZARD_COLOR, ITEM_COLOR } from '@/editor/constants';
import type { PlaceKind, Selection } from '@/editor/types';

/** Lienzo 2D en SVG (vista de edición): rejilla, muros, huecos de puerta y entidades arrastrables. */
export function EditorCanvas({
  room,
  selection,
  placing,
  status,
  svgRef,
  gridLines,
  onCanvasPointerDown,
  onPointerMove,
  endDrag,
  beginDrag,
  setPlacing,
}: {
  room: RoomData;
  selection: Selection;
  placing: PlaceKind;
  status: string;
  svgRef: React.RefObject<SVGSVGElement | null>;
  gridLines: { x1: number; y1: number; x2: number; y2: number }[];
  onCanvasPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  endDrag: () => void;
  beginDrag: (e: React.PointerEvent, sel: Selection) => void;
  setPlacing: (p: PlaceKind) => void;
}) {
  const halfW = room.width / 2;
  const halfH = room.height / 2;
  const margin = 1.5;
  const t = WALL_THICKNESS;

  return (
    <div className="editor-canvas-wrap">
      <svg
        ref={svgRef}
        className="editor-canvas"
        viewBox={`${-halfW - margin} ${-halfH - margin} ${room.width + margin * 2} ${room.height + margin * 2}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Muros */}
        <rect
          x={-halfW - t}
          y={-halfH - t}
          width={room.width + 2 * t}
          height={room.height + 2 * t}
          fill="#3b4266"
        />
        {/* Suelo */}
        <rect x={-halfW} y={-halfH} width={room.width} height={room.height} fill="#20243a" />
        {/* Rejilla 1×1 */}
        {gridLines.map((l, i) => (
          <line key={i} {...l} stroke="#2c3150" strokeWidth={0.03} />
        ))}
        {/* Huecos de puerta */}
        {room.doorSlots.map((slot, i) => {
          const w = DOOR_WIDTH;
          const isH = slot.side === 'north' || slot.side === 'south';
          const x = isH ? slot.offset - w / 2 : slot.side === 'east' ? halfW : -halfW - t;
          const y = !isH ? slot.offset - w / 2 : slot.side === 'south' ? halfH : -halfH - t;
          return (
            <rect
              key={`door-${i}`}
              x={x}
              y={y}
              width={isH ? w : t}
              height={isH ? t : w}
              fill="#5a6db3"
            />
          );
        })}
        {/* Hazards (rectángulos) */}
        {room.hazards.map((h) => (
          <g key={h.id} onPointerDown={(e) => beginDrag(e, { type: 'hazard', id: h.id })}>
            <rect
              x={h.position.x - h.width / 2}
              y={h.position.y - h.height / 2}
              width={h.width}
              height={h.height}
              fill={HAZARD_COLOR[h.kind]}
              stroke={selection?.type === 'hazard' && selection.id === h.id ? 'var(--ui-accent)' : 'none'}
              strokeWidth={0.08}
            />
            {h.kind === 'boost' && h.direction && (
              <line
                x1={h.position.x}
                y1={h.position.y}
                x2={h.position.x + h.direction.x * 0.7}
                y2={h.position.y + h.direction.y * 0.7}
                stroke="#e8f6ff"
                strokeWidth={0.1}
              />
            )}
          </g>
        ))}
        {/* Items */}
        {room.items.map((i) => (
          <circle
            key={i.id}
            cx={i.position.x}
            cy={i.position.y}
            r={0.28}
            fill={ITEM_COLOR[i.kind]}
            stroke={selection?.type === 'item' && selection.id === i.id ? 'var(--ui-accent)' : '#0b0d14'}
            strokeWidth={0.07}
            onPointerDown={(e) => beginDrag(e, { type: 'item', id: i.id })}
          />
        ))}
        {/* Enemigos */}
        {room.enemies.map((en) => (
          <g key={en.id} onPointerDown={(e) => beginDrag(e, { type: 'enemy', id: en.id })}>
            {en.patrolTarget && (
              <line
                x1={en.position.x}
                y1={en.position.y}
                x2={en.patrolTarget.x}
                y2={en.patrolTarget.y}
                stroke="#aab2d4"
                strokeWidth={0.05}
                strokeDasharray="0.2 0.15"
              />
            )}
            <circle
              cx={en.position.x}
              cy={en.position.y}
              r={en.radius ?? 0.4}
              fill={ENEMY_COLOR[en.kind]}
              stroke={selection?.type === 'enemy' && selection.id === en.id ? 'var(--ui-accent)' : '#0b0d14'}
              strokeWidth={0.07}
            />
            {en.kind === 'spike' && (
              <line
                x1={en.position.x}
                y1={en.position.y}
                x2={en.position.x + (en.facing?.x ?? 0) * 0.7}
                y2={en.position.y + (en.facing?.y ?? 1) * 0.7}
                stroke="#e2e6f2"
                strokeWidth={0.12}
              />
            )}
            {/* Handle arrastrable del destino de patrulla (segundo punto en el
                lienzo, unido por la línea discontinua de arriba). Su propio
                beginDrag hace stopPropagation, así que no arrastra al enemigo. */}
            {en.patrolTarget && (
              <g onPointerDown={(e) => beginDrag(e, { type: 'patrol', id: en.id })}>
                {/* Zona táctil generosa e invisible alrededor del handle. */}
                <circle cx={en.patrolTarget.x} cy={en.patrolTarget.y} r={0.5} fill="transparent" />
                <circle
                  cx={en.patrolTarget.x}
                  cy={en.patrolTarget.y}
                  r={0.22}
                  fill="#20243a"
                  stroke={
                    selection?.type === 'patrol' && selection.id === en.id
                      ? 'var(--ui-accent)'
                      : ENEMY_COLOR[en.kind]
                  }
                  strokeWidth={0.08}
                  strokeDasharray="0.12 0.08"
                />
                <circle cx={en.patrolTarget.x} cy={en.patrolTarget.y} r={0.07} fill={ENEMY_COLOR[en.kind]} />
              </g>
            )}
          </g>
        ))}
        {/* Inicio del jugador: color propio (identifica esta entidad, igual que
            ENEMY_COLOR/HAZARD_COLOR/ITEM_COLOR) — el anillo de selección SÍ es
            un acento de UI y usa el mismo ámbar que el resto de selecciones. */}
        <circle
          cx={room.playerStart.x}
          cy={room.playerStart.y}
          r={0.38}
          fill="#54c7ff"
          stroke={selection?.type === 'start' ? 'var(--ui-accent)' : '#0b0d14'}
          strokeWidth={0.08}
          onPointerDown={(e) => beginDrag(e, { type: 'start' })}
        />
      </svg>
      {placing && (
        <div className="editor-placing-hint">
          Toca el lienzo para colocar ·{' '}
          <button type="button" className="editor-hint-cancel" onClick={() => setPlacing(null)}>
            cancelar
          </button>
        </div>
      )}
      {status && <div className="editor-status">{status}</div>}
    </div>
  );
}
