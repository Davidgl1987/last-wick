/**
 * Helpers de depuración por parámetros de URL (herramientas de playtest):
 * `?boss=<id|alias>` salta directo a la arena de un jefe, `?phase=2|3` fuerza
 * su fase inicial, `?room=test` salta directo a la Sala de Pruebas (`testRoom`
 * en rooms.ts: los 5 arquetipos de enemigo, foso, pinchos, 2 barriles, 2
 * monedas, poción y llave — sin depender del azar de la mazmorra; David
 * 2026-08-11), y `?godmode` (presencia = activo; David 2026-07-15) hace que
 * el héroe reviva a vida máxima en vez de game-over al llegar a 0 hp — el
 * daño se sigue aplicando normal (hp baja, vignette, knockback) para poder
 * ver cuánto quita cada ataque durante la run completa (4 jefes + mazmorras).
 * Combina con `?boss` (arena de jefe suelta) y con `?room=test` (Sala de
 * Pruebas).
 */

import { getRoomPool, testRoom } from '@/game/features/dungeon/rooms';
import type { RoomData } from '@/game/world/types';

/**
 * Alias cortos de `?boss=` (herramienta de playtest, BOSSES_PLAN B5): salta
 * directo a la arena del jefe en modo sala única, sin recorrer la mazmorra.
 * Acepta el id del jefe (`?boss=guardian`) o el alias de fase (`?boss=b1`).
 * `b0`/`test-boss` solo existe en dev (DEV_ONLY_LEVEL_JSON de rooms.ts).
 */
const BOSS_PARAM_ALIAS: Record<string, string> = {
  b0: 'test-boss',
  test: 'test-boss',
  b1: 'guardian',
  b2: 'queen',
  b3: 'prisma',
  b4: 'storm',
};

/** Sala del jefe pedido vía ?boss=<id|alias>; null si no hay parámetro o no existe tal jefe en el pool. */
export function readForcedBossRoom(): RoomData | null {
  const raw = new URLSearchParams(window.location.search).get('boss');
  if (raw === null) return null;
  const bossId = BOSS_PARAM_ALIAS[raw.toLowerCase()] ?? raw.toLowerCase();
  return getRoomPool().find((room) => room.boss === bossId) ?? null;
}

/** Fase forzada del jefe vía `?phase=2|3` (solo con `?boss=`, herramienta de playtest); null si no aplica. */
export function readForcedBossPhase(): 2 | 3 | null {
  const raw = new URLSearchParams(window.location.search).get('phase');
  if (raw === '2') return 2;
  if (raw === '3') return 3;
  return null;
}

/**
 * Sala de pruebas vía `?room=test` (herramienta de playtest, encargo de
 * David 2026-08-11: probar todos los VFX en una sala fija con los 5
 * arquetipos de enemigo sin depender del azar de la mazmorra). Único alias
 * soportado por ahora; null si no hay parámetro o su valor no es 'test'.
 */
export function readForcedTestRoom(): RoomData | null {
  const raw = new URLSearchParams(window.location.search).get('room');
  if (raw === null) return null;
  return raw.toLowerCase() === 'test' ? testRoom : null;
}

/**
 * Modo dios de playtest vía `?godmode` (presencia = activo, sin valor; David
 * 2026-07-15: "añade un modo invulnerable para testeo [...] para ver lo que
 * quita de vida cada ataque"). Se aplica a `world.godMode` al crear/recrear
 * la sesión (session.ts); ver `applyDamageToHero`, features/combat/combat.ts.
 */
export function readGodMode(): boolean {
  return new URLSearchParams(window.location.search).has('godmode');
}
