/**
 * Barriles rodantes del Guardián de Canto (GDD §15.2, playtest 2026-07-06):
 * cadencia de aparición en puntos fijos centrales, y consulta de barril vivo
 * en un punto (para resolver si una carga en curso arrolla uno).
 */

import { pushEvent, type EventQueue } from '@/engine/events';
import { barrelInAir, type Enemy, type World } from '@/game/world/types';
import type { AABB } from '@/engine/geometry';
import { bossRoomBounds } from '@/game/features/bosses/movement';
import { GUARDIAN_BARREL_FALL_DURATION, GUARDIAN_BARREL_MAX_ACTIVE, GUARDIAN_BARREL_RADIUS, GUARDIAN_BARREL_SPAWN_INTERVAL } from './constants';

/** Nº de barriles rodantes vivos (sin explotar) de la sala del Guardián (GDD §15.2: cap `GUARDIAN_BARREL_MAX_ACTIVE`). */
function guardianLiveBarrelCount(world: World, boss: Enemy): number {
  const barrels = world.barrels;
  let count = 0;
  for (let i = 0; i < barrels.length; i++) {
    if (!barrels[i].exploded && barrels[i].roomId === boss.roomId) count++;
  }
  return count;
}

/**
 * Separación del centro de la sala a la que están los 4 huecos entre rocas
 * (mismo valor que la posición de las rocas en boss-guardian.json: ±3.2 en
 * cada eje). Las rocas miden 1.8×1.8 (medio lado 0.9), así que ocupan
 * |offset| ∈ [2.3, 4.1] en el eje perpendicular al hueco — estos puntos, con
 * 0 en ese eje, quedan siempre despejados.
 */
const GUARDIAN_BARREL_GAP_OFFSET = 3.2;
/** Separación del centro a la que están los 4 puntos interiores, hacia el centro desde cada hueco (mitad de GUARDIAN_BARREL_GAP_OFFSET). */
const GUARDIAN_BARREL_INNER_OFFSET = 1.6;

/**
 * Los 8 puntos fijos de aparición de barriles rodantes (GDD §15.2, fix
 * playtest 2026-07-10: "ponlos entre las rocas centrales mejor que en las
 * esquinas" — antes aparecían en el perímetro de la arena, lejos de la
 * acción). Ahora están en la región CENTRAL, entre las 4 rocas que forman el
 * anillo (boss-guardian.json, rocas en (±3.2,±3.2)): los 4 huecos entre rocas
 * adyacentes (a `GUARDIAN_BARREL_GAP_OFFSET` del centro, sobre cada eje) y los
 * 4 puntos interiores hacia el centro (a `GUARDIAN_BARREL_INNER_OFFSET` en
 * ambos ejes) — pero nunca el centro exacto, donde aparece el Guardián.
 * Orden fijo, sin significado semántico salvo estabilidad de tests.
 */
export function guardianBarrelSpawnPoints(bounds: AABB): { x: number; y: number }[] {
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  const gap = GUARDIAN_BARREL_GAP_OFFSET;
  const inner = GUARDIAN_BARREL_INNER_OFFSET;
  return [
    { x: midX, y: midY + gap }, // hueco norte
    { x: midX, y: midY - gap }, // hueco sur
    { x: midX + gap, y: midY }, // hueco este
    { x: midX - gap, y: midY }, // hueco oeste
    { x: midX + inner, y: midY + inner }, // interior NE
    { x: midX + inner, y: midY - inner }, // interior SE
    { x: midX - inner, y: midY - inner }, // interior SO
    { x: midX - inner, y: midY + inner }, // interior NO
  ];
}

/**
 * Punto fijo de aparición de un barril rodante (GDD §15.2, fix B1.6.1 tras
 * playtest 2026-07-06: los barriles se solapaban con 2 tiradas de RNG
 * independientes — sin relación entre ellas, podían caer casi en el mismo
 * sitio). Determinista: de los 8 puntos fijos (`guardianBarrelSpawnPoints`),
 * elige el que tiene la MAYOR distancia mínima a cualquier barril vivo
 * (`!exploded`) de la sala del Guardián — "el más alejado de los barriles
 * vivos", como pide el GDD. Sin barriles vivos, cualquier punto sirve (se usa
 * el primero, empate determinista).
 */
function guardianBarrelSpawnPoint(world: World, boss: Enemy): { x: number; y: number } {
  const bounds = bossRoomBounds(world, boss);
  const points = guardianBarrelSpawnPoints(bounds);
  const barrels = world.barrels;

  let bestPoint = points[0];
  let bestMinDist = -Infinity;
  for (let p = 0; p < points.length; p++) {
    const point = points[p];
    let minDistToLiveBarrel = Infinity;
    for (let i = 0; i < barrels.length; i++) {
      const barrel = barrels[i];
      if (barrel.exploded || barrel.roomId !== boss.roomId) continue;
      const d = Math.hypot(point.x - barrel.position.x, point.y - barrel.position.y);
      if (d < minDistToLiveBarrel) minDistToLiveBarrel = d;
    }
    if (minDistToLiveBarrel > bestMinDist) {
      bestMinDist = minDistToLiveBarrel;
      bestPoint = point;
    }
  }
  return bestPoint;
}

/**
 * Activa un barril rodante en un slot ya explotado del pool (reutiliza,
 * mismo patrón que `dropCoinAt`/`dropPotionAt` de features/items/items.ts) o añade uno
 * nuevo si no hay ninguno libre (evento raro, cada ~8s, no hot path).
 *
 * Caída del cielo (GDD §15.2, playtest 2026-07-06): al spawnear fija
 * `landingAt = world.time + GUARDIAN_BARREL_FALL_DURATION`. Hasta ese
 * instante el barril está "en el aire" (sombra creciendo + cuerpo cayendo):
 * `stepBarrels`/`guardianFindLiveBarrelAt` lo ignoran (no es
 * arrollable/explotable) y el render deriva la animación de ese timestamp. El
 * evento `boss-barrel-spawn` marca el INICIO (aparición de la sombra, aviso);
 * el aterrizaje lo emite el render como `boss-barrel-land` (polvo) al detectar
 * el cruce de `landingAt`, para no acoplar el burst de polvo a un tick de sim
 * exacto (la sim corre a dt fijo, el aterrizaje visual cae entre frames).
 */
function guardianSpawnBarrel(world: World, boss: Enemy, events: EventQueue): void {
  const point = guardianBarrelSpawnPoint(world, boss);
  const landingAt = world.time + GUARDIAN_BARREL_FALL_DURATION;
  const barrels = world.barrels;
  for (let i = 0; i < barrels.length; i++) {
    if (barrels[i].exploded) {
      barrels[i].exploded = false;
      barrels[i].position.x = point.x;
      barrels[i].position.y = point.y;
      barrels[i].landingAt = landingAt;
      pushEvent(events, 'boss-barrel-spawn', point.x, point.y, 1);
      return;
    }
  }
  barrels.push({
    id: `guardian-barrel-${barrels.length}`,
    roomId: boss.roomId,
    position: { x: point.x, y: point.y },
    radius: GUARDIAN_BARREL_RADIUS,
    exploded: false,
    landingAt,
  });
  pushEvent(events, 'boss-barrel-spawn', point.x, point.y, 1);
}

/**
 * Cadencia de aparición de barriles rodantes (GDD §15.2, playtest
 * 2026-07-06): sin estado propio en el Guardián — se dispara al cruzar un
 * "slot" de `GUARDIAN_BARREL_SPAWN_INTERVAL` segundos (mismo truco que
 * `GUARDIAN_DUST_INTERVAL` en la carga), respetando el cap de vivos.
 */
export function guardianStepBarrelSpawn(world: World, boss: Enemy, dt: number, events: EventQueue): void {
  const crossedSlot =
    Math.floor(world.time / GUARDIAN_BARREL_SPAWN_INTERVAL) !==
    Math.floor((world.time - dt) / GUARDIAN_BARREL_SPAWN_INTERVAL);
  if (!crossedSlot) return;
  if (guardianLiveBarrelCount(world, boss) >= GUARDIAN_BARREL_MAX_ACTIVE) return;
  guardianSpawnBarrel(world, boss, events);
}

/**
 * Barril vivo de la sala del Guardián cuyo círculo solapa (x,y) con el radio
 * del jefe (GDD §15.2: "si la carga del Guardián lo arrolla"). El Guardián NO
 * esquiva barriles (su carga es a ciegas) — este chequeo es solo para
 * resolver la colisión de la carga EN CURSO, nunca para desviarla.
 */
export function guardianFindLiveBarrelAt(world: World, boss: Enemy, x: number, y: number) {
  const barrels = world.barrels;
  for (let i = 0; i < barrels.length; i++) {
    const barrel = barrels[i];
    // Barril aún cayendo del cielo (GDD §15.2): no arrollable — la carga lo
    // atraviesa hasta que aterriza (world.time >= landingAt).
    if (barrel.exploded || barrel.roomId !== boss.roomId || barrelInAir(barrel, world.time)) continue;
    const dx = x - barrel.position.x;
    const dy = y - barrel.position.y;
    const rr = boss.radius + barrel.radius;
    if (dx * dx + dy * dy <= rr * rr) return barrel;
  }
  return null;
}
