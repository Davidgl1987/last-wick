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

import { AI_AVOID_LOOKAHEAD, AI_AVOID_SKIN, AI_AVOID_STEER_ANGLE, PATROL_TURN_RATE } from './constants';
import { rotateAngleTowards, type AABB } from '@/engine/geometry';
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

/**
 * Un paso del giro sobre sí mismo: rota `facing` hacia el waypoint objetivo
 * por el arco más corto, a velocidad angular constante (PATROL_TURN_RATE).
 * Lo comparten los dos sitios que giran: el tick de LLEGADA (que gira ya en
 * el mismo tick en que se para) y los ticks posteriores de la ventana.
 *
 * Que el tick de llegada gire también importa, y no es cosmético: hace que
 * `facing` alcance el rumbo nuevo un tick ANTES de que venza la ventana. Sin
 * eso, el último paso caería justo en el tick que la cierra, y el frame de
 * render de ese instante ya evalúa `world.time < patrolTurnUntil` como falso
 * — saldría del modo "sigue a la sim" con un paso (~10° en un giro de 180°)
 * todavía sin aplicar, y ese resto se acabaría amortiguando con el enemigo ya
 * en marcha. Girar desde el primer tick deja un tick de colchón en el que el
 * render, aún en modo giro, ve el `facing` FINAL y lo muestra exacto.
 */
function stepTurnTowardWaypoint(enemy: Enemy, targetX: number, targetY: number, dt: number): void {
  const desired = Math.atan2(targetX - enemy.position.x, targetY - enemy.position.y);
  const current = Math.atan2(enemy.facing.x, enemy.facing.y);
  const next = rotateAngleTowards(current, desired, PATROL_TURN_RATE * dt);
  enemy.facing.x = Math.sin(next);
  enemy.facing.y = Math.cos(next);
}

/**
 * Patrulla ida/vuelta entre patrolFrom y patrolTo, compartida por
 * Dummy/Spike/Trail (y, en modo sin aggro, por Chaser/Shooter). Ciclo real:
 * **llega → para en seco → gira sobre sí mismo encarando el nuevo waypoint →
 * arranca**, sin pausa extra ni antes ni después del giro.
 *
 * Al llegar a un extremo NO invierte el rumbo de golpe ni deriva hacia él:
 * se detiene por completo (velocity {0,0}, la misma x,y en todos los ticks
 * de la ventana) y arma una ventana de giro (`patrolTurnUntil`) cuya
 * duración es proporcional al ángulo real que hay que girar, a velocidad
 * angular constante `PATROL_TURN_RATE` (constants.ts) — 180° tarda
 * PATROL_HALF_TURN_DURATION, 90° la mitad. Mientras dura la ventana,
 * `enemy.facing` (no `velocity`) rota hacia el nuevo waypoint por el arco
 * más corto (`rotateAngleTowards`, `src/engine/geometry.ts`, velocidad
 * angular constante que SÍ sabe cuándo termina — a diferencia de
 * `dampAngleTowards`, que solo se acerca asintóticamente). Al vencer la
 * ventana el enemigo ya está encarado del todo y reanuda `speed` completa en
 * el MISMO tick: no espera un tick extra ni arranca con el giro a medias.
 */
export function stepPatrol(world: World, enemy: Enemy, speed: number, dt: number): void {
  // ── Girando: parado en seco (misma x,y exacta), rotando `facing` a
  // velocidad angular constante hasta encarar el nuevo waypoint. No llama a
  // moveToward: la posición no se toca ni un float mientras dura.
  if (world.time < enemy.patrolTurnUntil) {
    enemy.velocity.x = 0;
    enemy.velocity.y = 0;
    const target = enemy.patrolForward ? enemy.patrolTo : enemy.patrolFrom;
    stepTurnTowardWaypoint(enemy, target.x, target.y, dt);
    return;
  }

  // Fuera de la ventana: ¿ha llegado al extremo al que iba?
  const target = enemy.patrolForward ? enemy.patrolTo : enemy.patrolFrom;
  const dist = Math.hypot(target.x - enemy.position.x, target.y - enemy.position.y);
  if (dist < PATROL_ARRIVE_EPS) {
    enemy.patrolForward = !enemy.patrolForward;
    const back = enemy.patrolForward ? enemy.patrolTo : enemy.patrolFrom;
    const backDist = Math.hypot(back.x - enemy.position.x, back.y - enemy.position.y);
    // Captura el rumbo de llegada ANTES de poner velocity a 0: en este mismo
    // tick `enemy.velocity` es todavía la del tick anterior (esta rama corta
    // el flujo antes de volver a llamar a moveToward), así que es la
    // dirección REAL con la que el enemigo ha llegado.
    const inVx = enemy.velocity.x;
    const inVy = enemy.velocity.y;
    enemy.velocity.x = 0;
    enemy.velocity.y = 0;
    // Tramo degenerado (patrolFrom ≈ patrolTo, p. ej. patrolTarget ===
    // position): no hay rumbo nuevo al que girar, así que se conserva el
    // comportamiento de siempre (enemigo perfectamente estático) en vez de
    // armar una ventana de giro que nunca avanzaría a ningún sitio —
    // hero/walk.test.ts depende literalmente de esta quietud exacta para
    // aislar otra aserción.
    if (backDist < PATROL_ARRIVE_EPS) return;
    // Punto de partida del giro = el rumbo de marcha REAL con el que ha
    // llegado, no el `facing` que ya tuviera: Dummy/Trail/Chaser/Shooter no
    // mantienen `facing` en marcha (solo lo hace stepSpike, ver spike/ai.ts)
    // y se quedaría en el valor de spawn — partir de ahí daría un salto
    // visible al primer tick del giro. Si por lo que sea llega con velocidad
    // ~0 (no debería pasar en marcha normal), conserva el facing que ya
    // tuviera: no hay rumbo de entrada del que partir.
    const inSpeed = Math.hypot(inVx, inVy);
    if (inSpeed > 1e-6) {
      enemy.facing.x = inVx / inSpeed;
      enemy.facing.y = inVy / inSpeed;
    }
    // Ángulo real a girar: diferencia normalizada a (-π, π] entre el rumbo
    // hacia `back` y el `facing` de arranque recién fijado (mismo cálculo de
    // normalización que dampAngleTowards/rotateAngleTowards, geometry.ts;
    // aquí hace falta el VALOR del delta, no solo el resultado de un paso,
    // para fijar la duración de la ventana).
    const desired = Math.atan2(back.x - enemy.position.x, back.y - enemy.position.y);
    const current = Math.atan2(enemy.facing.x, enemy.facing.y);
    const TAU = Math.PI * 2;
    let deltaAngle = (desired - current + Math.PI) % TAU;
    if (deltaAngle < 0) deltaAngle += TAU;
    deltaAngle -= Math.PI;
    if (Math.abs(deltaAngle) < 1e-4) {
      // Nada que girar (el rumbo de llegada ya encara el nuevo waypoint):
      // armar una ventana de duración ~0 no aportaría nada — sigue
      // directamente hacia el nuevo extremo en este mismo tick.
      moveToward(world, enemy, back.x, back.y, speed, dt);
      return;
    }
    // Duración proporcional al ángulo real a girar, a velocidad angular
    // constante: el enemigo NO arranca hasta haber encarado del todo, la
    // ventana acaba exactamente cuando el giro concluye.
    enemy.patrolTurnUntil = world.time + Math.abs(deltaAngle) / PATROL_TURN_RATE;
    // Primer paso del giro en este mismo tick: la parada y el giro empiezan a
    // la vez (sin un tick muerto en medio) y el giro termina un tick antes de
    // que la ventana venza — ver la cabecera de `stepTurnTowardWaypoint` para
    // por qué ese colchón es lo que evita que el cuerpo llegue tarde.
    stepTurnTowardWaypoint(enemy, back.x, back.y, dt);
    return;
  }
  moveToward(world, enemy, target.x, target.y, speed, dt);
}
