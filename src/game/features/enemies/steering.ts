/**
 * Navegación de enemigos: steering local con evitación de obstáculos/hazards
 * (raycast corto contra AABBs + desvío angular), compartida por todos los
 * arquetipos (GDD §7). No hay pathfinding global (A*): con las salas de
 * referencia (obstáculos dispersos, no laberínticas) el steering local
 * resuelve rodear rocas/fosos/pinchos sin atascarse en esquinas; si el
 * contenido futuro lo exige, este módulo es el punto de extensión natural
 * para añadir un fallback A* sobre una rejilla de sala.
 *
 * Contrato de rendimiento: cero asignaciones por tick. Todo opera sobre
 * escalares; los AABBs recorridos son los arrays ya existentes del mundo.
 */

import { AI_AVOID_LOOKAHEAD, AI_AVOID_SKIN, AI_AVOID_STEER_ANGLE } from './constants';
import type { AABB } from '@/engine/geometry';
import type { Enemy, World } from '@/game/world/types';

const PATROL_ARRIVE_EPS = 0.12;

/** Comprueba si un punto cae dentro de un AABB con margen de piel. */
function pointInAabb(x: number, y: number, box: AABB, skin: number): boolean {
  return x >= box.minX - skin && x <= box.maxX + skin && y >= box.minY - skin && y <= box.maxY + skin;
}

/**
 * Steering local: comprueba un punto de sondeo por delante del enemigo en la
 * dirección deseada; si cae dentro de un obstáculo sólido o de un hazard que
 * el enemigo debe esquivar (pit/spikes), rota la dirección deseada un ángulo
 * fijo (alterna izquierda/derecha según el signo de una función determinista
 * de la posición, para que el desvío sea consistente, no errático).
 */
function steerAwayFromHazards(world: World, enemy: Enemy, desiredX: number, desiredY: number): Vec2Out {
  const len = Math.sqrt(desiredX * desiredX + desiredY * desiredY);
  if (len < 1e-6) {
    steerScratch.x = 0;
    steerScratch.y = 0;
    return steerScratch;
  }
  let dx = desiredX / len;
  let dy = desiredY / len;

  const probeDist = AI_AVOID_LOOKAHEAD;

  if (isBlocked(world, enemy, dx, dy, probeDist)) {
    // Lado de giro: si ya venía esquivando, mantiene el mismo lado (evita
    // oscilar entre izquierda/derecha y quedarse vibrando en el sitio); si
    // no, lo decide una función determinista de su posición (sin RNG:
    // consistente y legible).
    const turnSign =
      enemy.steerBias !== 0
        ? enemy.steerBias
        : (enemy.position.x * 7.13 + enemy.position.y * 3.71) % 2 < 1
          ? 1
          : -1;
    // Escalera de ángulos crecientes, primero el lado preferido: encuentra
    // una dirección despejada aunque el objetivo esté justo detrás del hazard.
    for (let step = 1; step <= 5; step++) {
      const magnitude = AI_AVOID_STEER_ANGLE * (0.5 + step * 0.5); // 60°, 90°, …, 180°
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? turnSign : -turnSign;
        const angle = magnitude * sign;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        if (!isBlocked(world, enemy, rx, ry, probeDist)) {
          enemy.steerBias = sign;
          steerScratch.x = rx;
          steerScratch.y = ry;
          return steerScratch;
        }
      }
    }
    // Sin salida despejada: mantiene el bias para reintentar el mismo lado.
  } else {
    enemy.steerBias = 0;
  }

  steerScratch.x = dx;
  steerScratch.y = dy;
  return steerScratch;
}

interface Vec2Out {
  x: number;
  y: number;
}

/** Scratch reutilizado por steerAwayFromHazards (cero asignaciones por tick). */
const steerScratch: Vec2Out = { x: 0, y: 0 };

/**
 * true si el punto (px,py) cae en un hazard que los enemigos deben esquivar
 * (foso, pinchos o barril sin explotar), con margen de piel. Los barriles
 * cuentan: la IA nunca debe inmolarse sola (GDD §7) — esto es solo la capa de
 * evitación "suave" (steering); el contacto de un enemigo con un barril YA NO
 * detona en ningún caso (fix playtest de David: ver `stepBarrels`,
 * hazards.ts), el barril es para él un sólido más (`stepEnemyCollisions`,
 * physics.ts), así que esta función es puramente de navegación, no la última
 * línea de defensa contra la autoinmolación.
 * Solo escalares: cero asignaciones.
 */
function pointInAvoidHazard(
  world: World,
  px: number,
  py: number,
  skin: number,
  bodyRadius: number,
): boolean {
  const barrels = world.barrels;
  for (let i = 0; i < barrels.length; i++) {
    const barrel = barrels[i];
    if (barrel.exploded) continue;
    // El barril detona por solape de radios (barril + cuerpo), no por centro:
    // la zona vetada debe incluir el radio del cuerpo que navega.
    const reach = barrel.radius + bodyRadius + skin;
    const dx = px - barrel.position.x;
    const dy = py - barrel.position.y;
    if (dx * dx + dy * dy <= reach * reach) return true;
  }
  const hazards = world.hazards;
  for (let i = 0; i < hazards.length; i++) {
    const hazard = hazards[i];
    if (hazard.kind !== 'pit' && hazard.kind !== 'spikes') continue;
    const hw = hazard.width / 2 + skin;
    const hh = hazard.height / 2 + skin;
    if (
      px >= hazard.position.x - hw &&
      px <= hazard.position.x + hw &&
      py >= hazard.position.y - hh &&
      py <= hazard.position.y + hh
    ) {
      return true;
    }
  }
  return false;
}

/** true si el punto de sondeo (posición + dir·dist) cae en un obstáculo sólido o hazard a esquivar. */
function isBlocked(world: World, enemy: Enemy, dx: number, dy: number, dist: number): boolean {
  const skin = AI_AVOID_SKIN;
  // Sondea varios puntos a lo largo del rayo (no solo la punta): evita que
  // el probe "salte" el borde de un hazard en trayectorias tangenciales.
  for (let step = 1; step <= 3; step++) {
    const d = (dist * step) / 3;
    const px = enemy.position.x + dx * d;
    const py = enemy.position.y + dy * d;

    const obstacles = world.obstacles;
    for (let i = 0; i < obstacles.length; i++) {
      if (pointInAabb(px, py, obstacles[i].aabb, skin)) return true;
    }
    if (pointInAvoidHazard(world, px, py, skin, enemy.radius)) return true;

    // No salirse de SU sala (mazmorra multi-sala: cada enemigo se limita a la
    // sala en la que vive, no a la sala actual del héroe).
    const b = enemy.roomId !== undefined ? (world.roomRuntimes.get(enemy.roomId)?.bounds ?? world.bounds) : world.bounds;
    if (px < b.minX + skin || px > b.maxX - skin || py < b.minY + skin || py > b.maxY - skin) {
      return true;
    }
  }
  return false;
}

/**
 * Mueve un enemigo hacia (targetX,targetY) a `speed`, con evitación de
 * hazards en dos capas: steering (desvío suave anticipado) + invariante duro
 * (el centro de un enemigo NUNCA acaba un tick dentro de un foso/pinchos:
 * si el movimiento le metería, desliza por el eje libre o se detiene).
 * Muta velocity/position.
 */
export function moveToward(
  world: World,
  enemy: Enemy,
  targetX: number,
  targetY: number,
  speed: number,
  dt: number,
): void {
  const dx = targetX - enemy.position.x;
  const dy = targetY - enemy.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) {
    enemy.velocity.x = 0;
    enemy.velocity.y = 0;
    return;
  }
  const steered = steerAwayFromHazards(world, enemy, dx, dy);
  let vx = steered.x * speed;
  let vy = steered.y * speed;

  const guard = AI_AVOID_SKIN;
  const nextX = enemy.position.x + vx * dt;
  const nextY = enemy.position.y + vy * dt;
  if (pointInAvoidHazard(world, nextX, nextY, guard, enemy.radius)) {
    // Invariante duro: intenta deslizar por un solo eje; si ambos bloquean, se para.
    if (!pointInAvoidHazard(world, nextX, enemy.position.y, guard, enemy.radius)) {
      vy = 0;
    } else if (!pointInAvoidHazard(world, enemy.position.x, nextY, guard, enemy.radius)) {
      vx = 0;
    } else {
      vx = 0;
      vy = 0;
    }
  }

  enemy.velocity.x = vx;
  enemy.velocity.y = vy;
  enemy.position.x += vx * dt;
  enemy.position.y += vy * dt;
}

export function heroDistance(world: World, enemy: Enemy): number {
  const dx = world.hero.position.x - enemy.position.x;
  const dy = world.hero.position.y - enemy.position.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Contención de aggro por sala (GDD §10.2, punto 7 de playtest ronda 3): un
 * enemigo solo puede perseguir/disparar/cargar contra el héroe cuando el
 * héroe está FÍSICAMENTE en su misma sala. Fuera de eso (sala del enemigo no
 * visitada, o visitada pero el héroe ya se ha ido a otra) el enemigo sigue
 * vivo y patrulla con normalidad — solo se le niega la agresión. En modo sala
 * única (roomId undefined, tests de fase 1-2) no hay restricción: siempre
 * puede agredir.
 */
export function canAggro(world: World, enemy: Enemy): boolean {
  if (enemy.roomId === undefined) return true;
  return world.currentRoomId === enemy.roomId;
}

/** Patrulla ida/vuelta entre patrolFrom y patrolTo, compartida por Dummy/Spike/Trail. */
export function stepPatrol(world: World, enemy: Enemy, speed: number, dt: number): void {
  const target = enemy.patrolForward ? enemy.patrolTo : enemy.patrolFrom;
  const dist = Math.hypot(target.x - enemy.position.x, target.y - enemy.position.y);
  if (dist < PATROL_ARRIVE_EPS) {
    enemy.patrolForward = !enemy.patrolForward;
    enemy.velocity.x = 0;
    enemy.velocity.y = 0;
    return;
  }
  moveToward(world, enemy, target.x, target.y, speed, dt);
}
