/**
 * Lista ÚNICA de emisores cálidos (antorchas de muro + luz del tendero) de la
 * mazmorra, con TODO lo que hace falta para encender una spotLight sin volver
 * a consultar nada más. Extraída como pieza pura y testeable dentro de la
 * reducción de la escena de ~43 luces a 7 (rama `luces-optimizadas`): hoy
 * `BossCandlesView.tsx` y `ShopLightsView.tsx` calculan cada una su propio
 * layout de antorchas de muro (mismo `wallTorchLayout`, distinto
 * `includeMidpoints`) para MONTAR una spotLight real por antorcha (~10
 * permanentes entre ambas salas); con el pool fijo de 3 luces reasignadas por
 * cercanía al héroe (`render/light-pool.ts`), hace falta primero la lista
 * COMPLETA de emisores candidatos (aunque solo 3 tengan luz real en un frame
 * dado) en un único sitio, en vez de duplicada entre las dos vistas.
 *
 * Fuentes de cada emisor (mismo criterio que las vistas que sustituye):
 * - Antorchas de la sala del jefe: `bossRoomBounds(world, boss)` (mismo
 *   utilitario que ya usa el movimiento de jefes, `features/bosses/
 *   movement.ts`) + `wallTorchLayout(bounds, true)` — SIEMPRE con puntos
 *   medios si la sala califica por tamaño; el gating por perfil de calidad
 *   (`wallTorchMidpoints`, `render/quality.ts`) es cosa del componente de
 *   React que consuma esta lista, no de esta función de datos pura.
 * - Antorchas de la sala de tienda: mismo `wallTorchLayout`, sin puntos
 *   medios (sala pequeña y cuadrada, 4 esquinas bastan) + la luz sobre la
 *   cabeza del tendero (item `kind==='shopkeeper'`, siempre exactamente uno
 *   por mazmorra); su sala sale de `world.roomRuntimes.get(roomId)?.bounds`
 *   con fallback a `world.bounds` en el modo sala única de los tests.
 *
 * Robusta a mundos sin jefe y sin tendero (ambos casos simplemente no
 * aportan emisores): nunca lanza.
 *
 * Constantes: duplicadas desde TorchView.tsx (antorcha, hoy privadas ahí) y
 * ShopLightsView.tsx (tendero) — ver comentario de origen en cada bloque más
 * abajo. Una tarea posterior retira las originales de esos dos ficheros una
 * vez el componente de React que monta el pool de 3 luces las sustituya.
 *
 * `wallTorchLayout` en sí (aunque exportada y pura) también se duplica más
 * abajo en vez de importarse de TorchView.tsx: ese fichero es un componente
 * de React cuyo módulo crea materiales/texturas de three.js al cargarse
 * (`assets-dark.ts`, necesita `document`), así que importar CUALQUIER cosa
 * de ahí arrastra esos efectos y revienta en el entorno de test ('node', sin
 * DOM — ver `test.environment` en vite.config.ts, cuyo `include` además solo
 * coge `*.test.ts`, nunca `.tsx`: los componentes de render no tienen
 * cobertura de test directa en este repo). `bossRoomBounds`, en cambio, sí
 * se importa tal cual: `features/bosses/movement.ts` es TS puro sin efectos
 * de módulo y ya se usa desde tests headless (`movement.test.ts`).
 */

import { bossRoomBounds } from '@/game/features/bosses/movement';
import type { AABB } from '@/engine/geometry';
import type { World } from '@/game/world/types';

// ── Antorcha de muro (duplicado de src/game/features/dungeon/TorchView.tsx,
// constantes privadas ahí: TORCH_BASE_Y, TORCH_WAX_HEIGHT, LIGHT_HEIGHT/
// INTENSITY/DISTANCE/DECAY/COLOR/ANGLE/PENUMBRA) ─────────────────────────────
/** Base de la antorcha a la altura del muro (WALL_HEIGHT=0.9 en RoomView.tsx). */
const TORCH_BASE_Y = 0.9;
/** Alto de la cera — igual que `wallTorchWaxGeometry` (render/assets-dark.ts). */
const TORCH_WAX_HEIGHT = 0.7;
/** Altura de la luz == altura de la llama (FLAME_HEIGHT en TorchView.tsx). */
export const TORCH_LIGHT_HEIGHT = TORCH_BASE_Y + TORCH_WAX_HEIGHT + 0.08;
export const TORCH_LIGHT_INTENSITY = 7.5;
export const TORCH_LIGHT_DISTANCE = 4;
export const TORCH_LIGHT_DECAY = 2;
export const TORCH_LIGHT_COLOR = '#ffb469';
/** Cono generoso y penumbra alta: ver comentario de LIGHT_ANGLE en TorchView.tsx (se lee como resplandor ambiental, no foco de teatro). */
export const TORCH_LIGHT_ANGLE = 1.0;
export const TORCH_LIGHT_PENUMBRA = 0.95;

// ── Luz de cabeza del tendero (duplicado de
// src/game/features/dungeon/ShopLightsView.tsx, constantes privadas ahí:
// SHOPKEEPER_LIGHT_HEIGHT/INTENSITY/DISTANCE/DECAY/COLOR) ───────────────────
export const SHOPKEEPER_LIGHT_HEIGHT = 1.9;
export const SHOPKEEPER_LIGHT_INTENSITY = 10;
export const SHOPKEEPER_LIGHT_DISTANCE = 5;
export const SHOPKEEPER_LIGHT_DECAY = 2;
export const SHOPKEEPER_LIGHT_COLOR = '#ffb469';
/**
 * Ángulo/penumbra del cono: NUEVOS, no duplicados — el `pointLight` original
 * de ShopLightsView.tsx era omnidireccional, sin cono. El pool de luces
 * reales monta esta luz como spotLight vertical hacia el suelo (dirX=dirZ=0,
 * ver `collectTorchEmitters` abajo), así que necesita ángulo/penumbra
 * propios; elegidos anchos + penumbra alta (mismo criterio que
 * TORCH_LIGHT_ANGLE/PENUMBRA arriba) para no perder el look omnidireccional
 * que tenía el pointLight.
 */
export const SHOPKEEPER_LIGHT_ANGLE = 1.3;
export const SHOPKEEPER_LIGHT_PENUMBRA = 0.95;

// ── Layout de antorchas de muro (duplicado de `wallTorchLayout`,
// src/game/features/dungeon/TorchView.tsx:191-219 — ver justificación de la
// duplicación en la cabecera del fichero) ────────────────────────────────────
/** Cuánto sobresale la antorcha del plano del muro (TorchView.tsx: evita que en cámara quede superpuesta al héroe). */
const TORCH_WALL_OUT = 0.25;
/** Longitud mínima del muro largo para añadir antorchas también en su punto medio (además de las 4 esquinas). */
const MIN_WALL_LENGTH_FOR_MIDPOINTS = 8;

/** Posición + dirección de una antorcha de muro (forma mínima que necesita `collectTorchEmitters`, sin el resto de props de React de `WallTorchPlacement`). */
interface WallTorchPosition {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

function wallTorchLayout(bounds: AABB, includeMidpoints: boolean): WallTorchPosition[] {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minY + bounds.maxY) / 2;
  const withDir = (x: number, z: number): WallTorchPosition => {
    const dx = centerX - x;
    const dz = centerZ - z;
    const len = Math.hypot(dx, dz) || 1;
    return { x, z, dirX: dx / len, dirZ: dz / len };
  };

  const positions = [
    withDir(bounds.minX - TORCH_WALL_OUT, bounds.minY - TORCH_WALL_OUT),
    withDir(bounds.minX - TORCH_WALL_OUT, bounds.maxY + TORCH_WALL_OUT),
    withDir(bounds.maxX + TORCH_WALL_OUT, bounds.minY - TORCH_WALL_OUT),
    withDir(bounds.maxX + TORCH_WALL_OUT, bounds.maxY + TORCH_WALL_OUT),
  ];
  if (!includeMidpoints) return positions;

  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxY - bounds.minY;
  if (width >= depth && width >= MIN_WALL_LENGTH_FOR_MIDPOINTS) {
    const midX = (bounds.minX + bounds.maxX) / 2;
    positions.push(withDir(midX, bounds.minY - TORCH_WALL_OUT), withDir(midX, bounds.maxY + TORCH_WALL_OUT));
  } else if (depth > width && depth >= MIN_WALL_LENGTH_FOR_MIDPOINTS) {
    const midZ = (bounds.minY + bounds.maxY) / 2;
    positions.push(withDir(bounds.minX - TORCH_WALL_OUT, midZ), withDir(bounds.maxX + TORCH_WALL_OUT, midZ));
  }
  return positions;
}

/**
 * Emisor cálido con TODO lo que hace falta para encender una spotLight sin
 * volver a consultar el mundo: posición, dirección unitaria del cono
 * (dirX=dirZ=0 para el tendero: cono vertical hacia el suelo) y los
 * parámetros de la luz. `kind` distingue antorcha de tendero por si el
 * componente consumidor necesita tratarlas distinto (p. ej. elegir
 * angle/penumbra por kind entre las constantes de arriba).
 */
export interface TorchEmitter {
  x: number;
  /** Altura de la luz sobre el suelo. */
  y: number;
  z: number;
  /** Dirección unitaria hacia donde apunta el cono (0,0 = vertical hacia el suelo). */
  dirX: number;
  dirZ: number;
  intensity: number;
  distance: number;
  color: string;
  kind: 'torch' | 'shopkeeper';
}

/**
 * Devuelve la lista de emisores cálidos de la mazmorra: antorchas de la sala
 * de jefe (si hay jefe) + antorchas de la sala de tienda y la luz del
 * tendero (si hay tienda). Ninguna de las dos partes es obligatoria — un
 * mundo de test de sala única sin jefe ni tendero devuelve `[]`.
 */
export function collectTorchEmitters(world: World): TorchEmitter[] {
  const emitters: TorchEmitter[] = [];

  const boss = world.enemies.find((e) => e.kind === 'boss');
  if (boss) {
    const bounds = bossRoomBounds(world, boss);
    for (const p of wallTorchLayout(bounds, true)) {
      emitters.push({
        x: p.x,
        y: TORCH_LIGHT_HEIGHT,
        z: p.z,
        dirX: p.dirX,
        dirZ: p.dirZ,
        intensity: TORCH_LIGHT_INTENSITY,
        distance: TORCH_LIGHT_DISTANCE,
        color: TORCH_LIGHT_COLOR,
        kind: 'torch',
      });
    }
  }

  const shopkeeper = world.items.find((i) => i.kind === 'shopkeeper');
  if (shopkeeper) {
    const bounds =
      shopkeeper.roomId !== undefined ? world.roomRuntimes.get(shopkeeper.roomId)?.bounds ?? world.bounds : world.bounds;
    for (const p of wallTorchLayout(bounds, false)) {
      emitters.push({
        x: p.x,
        y: TORCH_LIGHT_HEIGHT,
        z: p.z,
        dirX: p.dirX,
        dirZ: p.dirZ,
        intensity: TORCH_LIGHT_INTENSITY,
        distance: TORCH_LIGHT_DISTANCE,
        color: TORCH_LIGHT_COLOR,
        kind: 'torch',
      });
    }
    emitters.push({
      x: shopkeeper.position.x,
      y: SHOPKEEPER_LIGHT_HEIGHT,
      z: shopkeeper.position.y,
      dirX: 0,
      dirZ: 0,
      intensity: SHOPKEEPER_LIGHT_INTENSITY,
      distance: SHOPKEEPER_LIGHT_DISTANCE,
      color: SHOPKEEPER_LIGHT_COLOR,
      kind: 'shopkeeper',
    });
  }

  return emitters;
}
