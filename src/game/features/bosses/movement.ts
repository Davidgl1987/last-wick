/**
 * Movimiento genérico de jefes: sala dueña del jefe, avance hacia un punto con
 * evitación por circunnavegación tangencial, y detección de colisión contra
 * sólidos. Compartido por Guardián y Reina (generalizado TAREA 5 del rediseño
 * de la Reina, docs/plans/QUEEN_REDESIGN_PLAN.md: antes existía una copia
 * idéntica `queenRoomBounds`, sin razón para duplicarla una vez que
 * `moveBossTowardWithAvoidance` la reutiliza desde ambos jefes).
 */

import type { AABB } from '@/engine/geometry';
import type { Enemy, World } from '@/game/world/types';

/**
 * Sala dueña del jefe (multi-sala) o `world.bounds` en el modo sala única de
 * los tests.
 */
export function bossRoomBounds(world: World, boss: Enemy): AABB {
  if (boss.roomId === undefined) return world.bounds;
  return world.roomRuntimes.get(boss.roomId)?.bounds ?? world.bounds;
}

/**
 * Movimiento genérico a una `speed` dada hacia un punto (tx,ty) con evitación
 * por circunnavegación tangencial (axis-slide, fix B1.6.1). Extraída
 * originalmente de la patrulla perimetral del Guardián (GDD §15.2, fase B1),
 * eliminada en el rediseño 2026-08-31 (ver
 * `guardian/pattern.ts::GUARDIAN_STAGE_CHASE`: ahora persigue siempre al
 * héroe en vez de patrullar ciego). La función sigue viva porque
 * `GUARDIAN_STAGE_REPOSITION` (GDD §15.2, playtest 2026-07-06 "no carga si
 * tiene una roca/muro demasiado cerca") ya la reutilizaba apuntando a un
 * objetivo distinto (el centro de la sala); con el rediseño, CHASE se suma
 * como tercer llamador, apuntando al héroe.
 *
 * Generalizada con un parámetro `speed` (TAREA 5 del rediseño de la Reina,
 * docs/plans/QUEEN_REDESIGN_PLAN.md: "debe perseguir RODEANDO columnas, no
 * atravesarlas"): antes leía un valor fijo dentro de la función, válido solo
 * para el Guardián. Ahora la Reina reutiliza EXACTAMENTE el mismo algoritmo
 * desde `queenStepMove`, pasando `QUEEN_STALK_SPEED_BY_PHASE[bossPhase-1]`; el
 * Guardián pasa `GUARDIAN_CHASE_SPEED` (antes `GUARDIAN_PATROL_SPEED`,
 * renombrada en el mismo rediseño).
 */
export function moveBossTowardWithAvoidance(world: World, boss: Enemy, tx: number, ty: number, dt: number, speed: number): void {
  const dx = tx - boss.position.x;
  const dy = ty - boss.position.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.15) {
    boss.velocity.x = 0;
    boss.velocity.y = 0;
    return;
  }
  const nx = dx / dist;
  const ny = dy / dist;
  const stepX = nx * speed * dt;
  const stepY = ny * speed * dt;
  const nextX = boss.position.x + stepX;
  const nextY = boss.position.y + stepY;

  if (!bossHitsSolid(world, boss, nextX, nextY)) {
    // Camino libre: avanza recto, como siempre.
    boss.position.x = nextX;
    boss.position.y = nextY;
    boss.velocity.x = nx * speed;
    boss.velocity.y = ny * speed;
    return;
  }

  // Camino recto bloqueado: bordea el obstáculo por su TANGENTE
  // (circunnavegación). El simple deslizamiento por eje no basta cuando el
  // boss toca una ESQUINA convexa en diagonal — mover solo-X o solo-Y HACIA
  // el objetivo lo acerca aún más al vértice y sigue chocando (era la causa
  // del atasco permanente del playtest). Se calcula la normal "hacia fuera"
  // del sólido más cercano (rock interior o muro) y se avanza por la tangente
  // que más progresa hacia el objetivo, con un pequeño empuje normal para
  // despegar del vértice; así el boss rodea la roca hasta el corredor libre.
  let normX = 0;
  let normY = 0;
  let bestDist = Infinity;
  const obstacles = world.obstacles;
  for (let i = 0; i < obstacles.length; i++) {
    const a = obstacles[i].aabb;
    const px = boss.position.x < a.minX ? a.minX : boss.position.x > a.maxX ? a.maxX : boss.position.x;
    const py = boss.position.y < a.minY ? a.minY : boss.position.y > a.maxY ? a.maxY : boss.position.y;
    const ddx = boss.position.x - px;
    const ddy = boss.position.y - py;
    const d = Math.hypot(ddx, ddy);
    if (d < bestDist) {
      bestDist = d;
      const inv = d > 1e-4 ? 1 / d : 0;
      normX = ddx * inv;
      normY = ddy * inv;
    }
  }
  const bounds = bossRoomBounds(world, boss);
  // Si ninguna roca está lo bastante cerca, el bloqueo es un muro: normal hacia
  // el centro de la sala (el boss está pegado al perímetro).
  if (bestDist > boss.radius + 0.4 || (normX === 0 && normY === 0)) {
    const ex = (bounds.minX + bounds.maxX) / 2 - boss.position.x;
    const ey = (bounds.minY + bounds.maxY) / 2 - boss.position.y;
    const elen = Math.hypot(ex, ey) || 1;
    normX = ex / elen;
    normY = ey / elen;
  }

  const step = speed * dt;
  const push = 0.05;
  // Tangente perpendicular a la normal, orientada hacia el objetivo (la que
  // tiene producto escalar positivo con la dirección deseada). Se prueba
  // primero esa, luego la opuesta, y por último solo el empuje normal
  // (despegar). Sin asignaciones: el patrón se repite con `bossTrySlide`
  // sobre escalares.
  const tanX = -normY;
  const tanY = normX;
  const sign = tanX * nx + tanY * ny >= 0 ? 1 : -1;
  if (
    bossTrySlide(world, boss, sign * tanX, sign * tanY, normX, normY, step, push, speed) ||
    bossTrySlide(world, boss, -sign * tanX, -sign * tanY, normX, normY, step, push, speed) ||
    bossTrySlide(world, boss, normX, normY, normX, normY, step, push, speed)
  ) {
    return;
  }

  // Todo bloqueado (rarísimo): sin avance este tick.
  boss.velocity.x = 0;
  boss.velocity.y = 0;
}

/**
 * Intenta mover al jefe por (vx,vy)·step con un empuje adicional (nX,nY)·push
 * que lo despega del vértice, a la `speed` dada (para que `boss.velocity`
 * quede coherente con el movimiento real aplicado, sea Guardián a
 * GUARDIAN_CHASE_SPEED o Reina a QUEEN_STALK_SPEED_BY_PHASE). Si el destino
 * está despejado, aplica el movimiento (posición + velocity para el render) y
 * devuelve true. Solo escalares: cero asignaciones.
 */
function bossTrySlide(
  world: World,
  boss: Enemy,
  vx: number,
  vy: number,
  nX: number,
  nY: number,
  step: number,
  push: number,
  speed: number,
): boolean {
  const tryX = boss.position.x + vx * step + nX * push;
  const tryY = boss.position.y + vy * step + nY * push;
  if (bossHitsSolid(world, boss, tryX, tryY)) return false;
  boss.position.x = tryX;
  boss.position.y = tryY;
  boss.velocity.x = vx * speed;
  boss.velocity.y = vy * speed;
  return true;
}

/**
 * true si el círculo del jefe (radio `boss.radius`: GUARDIAN_RADIUS para el
 * Guardián, QUEEN_RADIUS para la Reina) en (x,y) solapa algún obstáculo
 * sólido de SU sala o se sale del límite de la sala. Sin mutar nada (solo
 * detección: cada llamador decide qué hacer con el resultado — a diferencia
 * de `collideCircleAabb`/`collideInnerBounds` de physics.ts, que además
 * resuelven con reflexión elástica, aquí interesa solo saber SI choca, para
 * rodearlo (Guardián en persecución/reposición, Reina persiguiendo) o, en el
 * caso del Guardián cargando, detener en seco y aturdir).
 */
export function bossHitsSolid(world: World, boss: Enemy, x: number, y: number): boolean {
  const bounds = bossRoomBounds(world, boss);
  if (
    x - boss.radius < bounds.minX ||
    x + boss.radius > bounds.maxX ||
    y - boss.radius < bounds.minY ||
    y + boss.radius > bounds.maxY
  ) {
    return true;
  }
  const obstacles = world.obstacles;
  for (let i = 0; i < obstacles.length; i++) {
    const aabb = obstacles[i].aabb;
    const nearestX = x < aabb.minX ? aabb.minX : x > aabb.maxX ? aabb.maxX : x;
    const nearestY = y < aabb.minY ? aabb.minY : y > aabb.maxY ? aabb.maxY : y;
    const dx = x - nearestX;
    const dy = y - nearestY;
    if (dx * dx + dy * dy < boss.radius * boss.radius) return true;
  }
  return false;
}
