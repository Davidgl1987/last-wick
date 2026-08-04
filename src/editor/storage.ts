/**
 * Persistencia del editor (GDD §13): borrador autoguardado, sala de playtest
 * y pool de salas exportadas (que el generador procedural consume vía
 * features/dungeon/rooms.ts::getRoomPool). Todo en localStorage, todo pasado por el
 * parser del formato antes de confiar en ello.
 */

import { parseRoomData } from '@/game/features/dungeon/room-format';
import type { RoomData } from '@/game/world/types';

const DRAFT_KEY = 'last-wick-editor-draft';
const PLAYTEST_KEY = 'last-wick-editor-playtest';
/** DEBE coincidir con features/dungeon/rooms.ts (pool del generador). */
const EXPORTED_ROOMS_KEY = 'last-wick-editor-exported-rooms';

function safeRead(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Borrador en curso: se guarda TAL CUAL (puede estar a medias/inválido; el editor ya avisa). */
export function saveDraft(room: RoomData): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(room));
  } catch {
    // Cuota llena / modo privado: el autoguardado es best-effort.
  }
}

export function loadDraft(): RoomData | null {
  const raw = safeRead(DRAFT_KEY);
  if (raw === null) return null;
  const result = parseRoomData(raw);
  if (result.valid && result.room) return result.room;
  // Borrador inválido pero con estructura de objeto: lo devolvemos "en bruto"
  // para no perder trabajo a medias; el editor mostrará sus errores en vivo.
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as RoomData;
  }
  return null;
}

/** Sala que el botón "Probar" pasa al juego (ruta #/playtest). Solo salas VÁLIDAS. */
export function savePlaytestRoom(room: RoomData): boolean {
  const result = parseRoomData(room);
  if (!result.valid || !result.room) return false;
  try {
    localStorage.setItem(PLAYTEST_KEY, JSON.stringify(result.room));
    return true;
  } catch {
    return false;
  }
}

export function loadPlaytestRoom(): RoomData | null {
  const raw = safeRead(PLAYTEST_KEY);
  if (raw === null) return null;
  const result = parseRoomData(raw);
  return result.valid ? result.room : null;
}

/** Añade (o reemplaza por id) una sala exportada al pool local del generador. */
export function addExportedRoom(room: RoomData): boolean {
  const result = parseRoomData(room);
  if (!result.valid || !result.room) return false;
  const existing = safeRead(EXPORTED_ROOMS_KEY);
  const list: unknown[] = Array.isArray(existing) ? existing : [];
  const filtered = list.filter((entry) => {
    const parsed = parseRoomData(entry);
    return parsed.valid && parsed.room !== null && parsed.room.id !== result.room!.id;
  });
  filtered.push(result.room);
  try {
    localStorage.setItem(EXPORTED_ROOMS_KEY, JSON.stringify(filtered));
    return true;
  } catch {
    return false;
  }
}
