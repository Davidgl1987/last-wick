/**
 * Editor de niveles (GDD §13) — ruta #/editor.
 *
 * Lienzo 2D en SVG (funciona táctil y con ratón vía PointerEvents; mucho más
 * simple y fluido que montar un canvas R3F para una vista cenital plana):
 * rejilla 1×1, colocación con snap de 0.5 u, arrastre para mover, selección
 * con panel de propiedades, huecos de puerta y validaciones en vivo con el
 * MISMO parser (room-format.ts) que usan el juego y el generador.
 *
 * Persistencia: borrador autoguardado en localStorage; exportar descarga el
 * .json, lo copia al portapapeles y lo añade al pool local del generador;
 * en dev, "Guardar en src/game/features/dungeon/levels" hace POST /api/editor/rooms (middleware de
 * Vite) y escribe el fichero en el repo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseRoomData, parseRoomDataFromJson } from '@/game/features/dungeon/room-format';
import type { HazardSpawn, RoomData } from '@/game/world/types';
import type { Vec2 } from '@/engine/geometry';
import { addExportedRoom, loadDraft, saveDraft, savePlaytestRoom } from './storage';
import { HAZARD_DEFAULT_SIZE } from './constants';
import { defaultRoom, nextId, snap } from './utils';
import { validateLive } from './validate';
import type { PlaceKind, Selection } from './types';
import { EditorCanvas } from '@/editor/components/EditorCanvas';
import { EditorSidePanel } from '@/editor/components/EditorSidePanel';
import { Button, Frame, Icon } from '@/ui';
import './editor.css';

// ── Página ─────────────────────────────────────────────────────────────────

export function EditorPage() {
  const [room, setRoom] = useState<RoomData>(() => loadDraft() ?? defaultRoom());
  const [selection, setSelection] = useState<Selection>(null);
  const [placing, setPlacing] = useState<PlaceKind>(null);
  const [status, setStatus] = useState<string>('');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ selection: Selection; moved: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Autoguardado del borrador (GDD §13: no perder trabajo al cerrar).
  useEffect(() => {
    saveDraft(room);
  }, [room]);

  const errors = useMemo(() => validateLive(room), [room]);

  const showStatus = useCallback((text: string) => {
    setStatus(text);
    window.setTimeout(() => setStatus(''), 2500);
  }, []);

  // Conversión de coordenadas de puntero → coordenadas de sala (u de mundo).
  const pointerToWorld = useCallback((e: { clientX: number; clientY: number }): Vec2 | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const margin = 1.5;
    const viewW = room.width + margin * 2;
    const viewH = room.height + margin * 2;
    // El SVG usa preserveAspectRatio="xMidYMid meet": misma escala en ambos ejes.
    const scale = Math.min(rect.width / viewW, rect.height / viewH);
    const offsetX = (rect.width - viewW * scale) / 2;
    const offsetY = (rect.height - viewH * scale) / 2;
    const x = (e.clientX - rect.left - offsetX) / scale - viewW / 2;
    const y = (e.clientY - rect.top - offsetY) / scale - viewH / 2;
    return { x, y };
  }, [room.width, room.height]);

  // ── Mutaciones ──

  const placeAt = useCallback(
    (pos: Vec2) => {
      if (!placing) return;
      const p = { x: snap(pos.x), y: snap(pos.y) };
      if (placing.type === 'start') {
        setRoom((r) => ({ ...r, playerStart: p }));
        setSelection({ type: 'start' });
      } else if (placing.type === 'enemy') {
        setRoom((r) => {
          const id = nextId(placing.kind, r.enemies);
          setSelection({ type: 'enemy', id });
          return { ...r, enemies: [...r.enemies, { id, kind: placing.kind, position: p }] };
        });
      } else if (placing.type === 'hazard') {
        setRoom((r) => {
          const id = nextId(placing.kind, r.hazards);
          setSelection({ type: 'hazard', id });
          const size = HAZARD_DEFAULT_SIZE[placing.kind];
          const hazard: HazardSpawn = { id, kind: placing.kind, position: p, ...size };
          return { ...r, hazards: [...r.hazards, hazard] };
        });
      } else {
        setRoom((r) => {
          const id = nextId(placing.kind, r.items);
          setSelection({ type: 'item', id });
          return { ...r, items: [...r.items, { id, kind: placing.kind, position: p }] };
        });
      }
      setPlacing(null);
    },
    [placing],
  );

  const moveSelected = useCallback((sel: Selection, pos: Vec2) => {
    if (!sel) return;
    const p = { x: snap(pos.x), y: snap(pos.y) };
    setRoom((r) => {
      switch (sel.type) {
        case 'start':
          return { ...r, playerStart: p };
        case 'enemy':
          return { ...r, enemies: r.enemies.map((e) => (e.id === sel.id ? { ...e, position: p } : e)) };
        case 'patrol':
          return {
            ...r,
            enemies: r.enemies.map((e) => (e.id === sel.id ? { ...e, patrolTarget: p } : e)),
          };
        case 'hazard':
          return { ...r, hazards: r.hazards.map((h) => (h.id === sel.id ? { ...h, position: p } : h)) };
        case 'item':
          return { ...r, items: r.items.map((i) => (i.id === sel.id ? { ...i, position: p } : i)) };
      }
    });
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selection || selection.type === 'start') return;
    setRoom((r) => {
      switch (selection.type) {
        case 'enemy':
          return { ...r, enemies: r.enemies.filter((e) => e.id !== selection.id) };
        case 'patrol':
          // Borrar el handle de patrulla = quitar el destino (el enemigo queda).
          return {
            ...r,
            enemies: r.enemies.map((e) => {
              if (e.id !== selection.id) return e;
              const next = { ...e };
              delete next.patrolTarget;
              return next;
            }),
          };
        case 'hazard':
          return { ...r, hazards: r.hazards.filter((h) => h.id !== selection.id) };
        case 'item':
          return { ...r, items: r.items.filter((i) => i.id !== selection.id) };
        default:
          return r;
      }
    });
    setSelection(null);
  }, [selection]);

  const duplicateSelected = useCallback(() => {
    if (!selection || selection.type === 'start' || selection.type === 'patrol') return;
    setRoom((r) => {
      const shift = (p: Vec2): Vec2 => ({ x: snap(p.x + 1), y: snap(p.y + 1) });
      switch (selection.type) {
        case 'enemy': {
          const src = r.enemies.find((e) => e.id === selection.id);
          if (!src) return r;
          const id = nextId(src.kind, r.enemies);
          setSelection({ type: 'enemy', id });
          return { ...r, enemies: [...r.enemies, { ...src, id, position: shift(src.position) }] };
        }
        case 'hazard': {
          const src = r.hazards.find((h) => h.id === selection.id);
          if (!src) return r;
          const id = nextId(src.kind, r.hazards);
          setSelection({ type: 'hazard', id });
          return { ...r, hazards: [...r.hazards, { ...src, id, position: shift(src.position) }] };
        }
        case 'item': {
          const src = r.items.find((i) => i.id === selection.id);
          if (!src) return r;
          const id = nextId(src.kind, r.items);
          setSelection({ type: 'item', id });
          return { ...r, items: [...r.items, { ...src, id, position: shift(src.position) }] };
        }
        default:
          return r;
      }
    });
  }, [selection]);

  // ── Puntero sobre el lienzo ──

  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const pos = pointerToWorld(e);
      if (!pos) return;
      if (placing) {
        placeAt(pos);
        return;
      }
      // Sin modo de colocación: clic en vacío deselecciona (la selección de
      // entidades se hace en los onPointerDown de cada figura, que hacen
      // stopPropagation).
      setSelection(null);
    },
    [placing, placeAt, pointerToWorld],
  );

  const beginDrag = useCallback(
    (e: React.PointerEvent, sel: Selection) => {
      e.stopPropagation();
      setSelection(sel);
      dragRef.current = { selection: sel, moved: false };
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // Puntero sin captura disponible (sintético/perdido): el drag sigue
        // funcionando vía los listeners del propio SVG.
      }
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || !drag.selection) return;
      const pos = pointerToWorld(e);
      if (!pos) return;
      drag.moved = true;
      moveSelected(drag.selection, pos);
    },
    [moveSelected, pointerToWorld],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Acciones de fichero ──

  const exportRoom = useCallback(async () => {
    const result = parseRoomData(room);
    if (!result.valid || !result.room) {
      showStatus('La sala tiene errores: corrígelos antes de exportar.');
      return;
    }
    const json = JSON.stringify(result.room, null, 2);
    // Descarga.
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.room.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    // Portapapeles (best-effort) + pool local del generador.
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      // Sin permiso de portapapeles: la descarga ya cubre el export.
    }
    addExportedRoom(result.room);
    showStatus('Exportada: descargada, copiada y añadida al pool.');
  }, [room, showStatus]);

  const importRoom = useCallback(
    (file: File) => {
      void file.text().then((text) => {
        const result = parseRoomDataFromJson(text);
        if (!result.valid || !result.room) {
          showStatus(`Import inválido: ${result.errors[0] ?? 'formato desconocido'}`);
          return;
        }
        setRoom(result.room);
        setSelection(null);
        showStatus(`Importada "${result.room.name}".`);
      });
    },
    [showStatus],
  );

  const saveToDevServer = useCallback(async () => {
    const result = parseRoomData(room);
    if (!result.valid || !result.room) {
      showStatus('La sala tiene errores: corrígelos antes de guardar.');
      return;
    }
    try {
      const response = await fetch('/api/editor/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.room),
      });
      showStatus(response.ok ? `Guardada en src/game/features/dungeon/levels/${result.room.id}.json` : 'Error del servidor al guardar.');
    } catch {
      showStatus('No se pudo contactar con el dev server.');
    }
  }, [room, showStatus]);

  const playtest = useCallback(() => {
    if (errors.length > 0) {
      showStatus('La sala tiene errores: corrígelos antes de probar.');
      return;
    }
    if (savePlaytestRoom(room)) {
      window.location.hash = '#/playtest';
    } else {
      showStatus('No se pudo preparar el playtest.');
    }
  }, [room, errors, showStatus]);

  // ── Derivados de render ──

  const halfW = room.width / 2;
  const halfH = room.height / 2;
  const selectedEnemy =
    selection?.type === 'enemy' || selection?.type === 'patrol'
      ? room.enemies.find((e) => e.id === selection.id)
      : undefined;
  const selectedHazard = selection?.type === 'hazard' ? room.hazards.find((h) => h.id === selection.id) : undefined;
  const selectedItem = selection?.type === 'item' ? room.items.find((i) => i.id === selection.id) : undefined;

  const gridLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let x = Math.ceil(-halfW); x <= Math.floor(halfW); x++) {
      lines.push({ x1: x, y1: -halfH, x2: x, y2: halfH });
    }
    for (let y = Math.ceil(-halfH); y <= Math.floor(halfH); y++) {
      lines.push({ x1: -halfW, y1: y, x2: halfW, y2: y });
    }
    return lines;
  }, [halfW, halfH]);

  return (
    <div className="editor-root">
      <Frame as="header" variant="plain" className="editor-header">
        <Button variant="secondary" href="#/" className="editor-back-btn">
          <Icon name="chevron" size={14} style={{ transform: 'rotate(-90deg)' }} />
          Juego
        </Button>
        <h1 className="editor-title">Editor de niveles</h1>
        <div className="editor-header-actions">
          <Button variant="primary" className="editor-probar-btn" onClick={playtest}>
            <Icon name="play" size={16} />
            Probar
          </Button>
        </div>
      </Frame>

      <div className="editor-body">
        <EditorCanvas
          room={room}
          selection={selection}
          placing={placing}
          status={status}
          svgRef={svgRef}
          gridLines={gridLines}
          onCanvasPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          endDrag={endDrag}
          beginDrag={beginDrag}
          setPlacing={setPlacing}
        />

        <EditorSidePanel
          room={room}
          setRoom={setRoom}
          placing={placing}
          setPlacing={setPlacing}
          selection={selection}
          selectedEnemy={selectedEnemy}
          selectedHazard={selectedHazard}
          selectedItem={selectedItem}
          duplicateSelected={duplicateSelected}
          deleteSelected={deleteSelected}
          onEnemyChange={(updated) =>
            setRoom({
              ...room,
              enemies: room.enemies.map((e) => (e.id === updated.id ? updated : e)),
            })
          }
          onHazardChange={(updated) =>
            setRoom({
              ...room,
              hazards: room.hazards.map((h) => (h.id === updated.id ? updated : h)),
            })
          }
          exportRoom={exportRoom}
          importRoom={importRoom}
          saveToDevServer={saveToDevServer}
          fileInputRef={fileInputRef}
          errors={errors}
        />
      </div>
    </div>
  );
}
