/**
 * Tick del mundo: orquesta los sistemas de la simulación a timestep fijo.
 *
 * Cada llamada avanza exactamente FIXED_DT. El acumulador (frame de render →
 * N ticks) vive en el driver de render, no aquí, para que la sim sea
 * determinista y testeable sin reloj.
 *
 * Orden de sistemas por tick (importa para la consistencia de colisiones):
 * 1) física del héroe (movimiento, rebotes)
 * 2) IA de enemigos (steering + movimiento deseado)
 * 2b) patrones de jefe (fases/telegraph/ataques) + sellado de su puerta
 * 3) física de enemigos (colisión contra sólidos, fricción de knockback)
 * 4) proyectiles (movimiento + colisiones + daño)
 * 5) hazards (héroe, enemigos, charcos del Trail, barriles)
 * 6) contactos cuerpo-a-cuerpo héroe↔enemigo (embestida / daño recibido)
 * 7) recogida de items
 * 8) housekeeping: enemigos muertos sueltan moneda; ¿sala limpiada?
 *
 * Muta `world` y `events` in-place: nada de crear un mundo nuevo por tick.
 */

import { DOOR_CONTACT_MARGIN, DOOR_TOUCH_MARGIN, ROOM_CLEAR_SCORE } from './constants';
import { FIXED_DT, stepBodySeparation, stepEnemyCollisions, stepHeroPhysics } from '@/engine/physics';
import { stepBossDoorSeal, stepBosses, stepBossStates } from '@/game/features/bosses/lifecycle';
import { stepEnemyAi } from '@/game/features/enemies/ai';
import { stepHeroEnemyContacts, stepProjectiles } from '@/game/features/combat/combat';
import { openConnection } from '@/game/features/dungeon/dungeon-world';
import { pushEvent, type EventQueue } from '@/engine/events';
import { stepBarrels, stepEnemyHazards, stepHeroHazards, stepPuddles } from '@/game/features/hazards/hazards';
import { COIN_DROPS_BY_KIND, COIN_DROP_MAX_RADIUS, COIN_DROP_MIN_RADIUS } from '@/game/features/items/constants';
import { dropCoinAt, stepItems } from '@/game/features/items/items';
import type { GamePhase, World } from './types';

/**
 * Lectura de fase opaca al narrowing de TypeScript: los sistemas intermedios
 * (hazards, barriles, contactos) pueden mutar `world.phase` a 'game-over'
 * dentro del mismo tick, cosa que el control-flow analysis no modela.
 */
function currentPhase(world: World): GamePhase {
  return world.phase;
}

/**
 * Duración en tiempo de SIM (no wall-clock/setTimeout) de la fase
 * 'boss-victory-pause' (ver stepDungeonRoomClear más abajo): playtest
 * 2026-07-15 (David, run completa de 4 jefes) — "debería salir con un poco
 * de retraso, para poder ver el efecto al matar al jefe y quizá algún gesto
 * de victoria antes de la modal que lo tapa todo". 2.5s deja tiempo de sobra
 * para que se aprecien el hit-stop largo (BOSS_DEFEATED_HIT_STOP_DURATION,
 * reactToEvent.ts) + el burst de partículas doradas + el saltito de victoria
 * del héroe (HeroView.tsx) antes de que el modal lo tape todo, sin que la
 * espera se sienta como un cuelgue.
 */
export const BOSS_VICTORY_PAUSE_DURATION = 2.5;

/**
 * Enemigos con hp<=0 en el tick anterior, para no soltar moneda dos veces por
 * el mismo cadáver. Suelta `COIN_DROPS_BY_KIND[enemy.kind]` monedas esparcidas
 * en un anillo alrededor del cadáver (offsets deterministas vía `world.rng`).
 */
function collectDeadDrops(world: World, alreadyDropped: Set<string>): void {
  const enemies = world.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (enemy.hp <= 0 && !alreadyDropped.has(enemy.id)) {
      alreadyDropped.add(enemy.id);
      const count = COIN_DROPS_BY_KIND[enemy.kind];
      for (let n = 0; n < count; n++) {
        const angle = world.rng() * Math.PI * 2;
        const radius = COIN_DROP_MIN_RADIUS + world.rng() * (COIN_DROP_MAX_RADIUS - COIN_DROP_MIN_RADIUS);
        dropCoinAt(world, enemy.position.x + Math.cos(angle) * radius, enemy.position.y + Math.sin(angle) * radius);
      }
    }
  }
}

/** true si todos los enemigos dados están muertos (lista vacía cuenta como limpiada). */
function allDead(enemies: World['enemies']): boolean {
  for (let i = 0; i < enemies.length; i++) {
    if (enemies[i].hp > 0) return false;
  }
  return true;
}

/**
 * Modo sala única (world.dungeon === null, tests de fase 1-2): limpiar la sala
 * puntúa y emite el evento, sin cambiar de fase (docs/plans/ECONOMY_PLAN.md:
 * la mejora-por-sala desaparece, la partida sigue en 'playing'). Sin fase
 * propia que lo bloquee, se guarda con `roomsCleared === 0`: en este modo solo
 * existe UNA sala, así que basta para no puntuar de nuevo cada tick siguiente.
 */
function stepSingleRoomClear(world: World, events: EventQueue): void {
  if (world.stats.roomsCleared === 0 && world.enemies.length > 0 && allDead(world.enemies)) {
    world.stats.roomsCleared += 1;
    world.stats.score += ROOM_CLEAR_SCORE;
    pushEvent(events, 'room-cleared', world.hero.position.x, world.hero.position.y, 1);
  }
}

/** GDD §10.2: limpiar una sala = todos sus enemigos muertos → recompensa/mejora + puertas (salvo llave). */
function stepDungeonRoomClear(world: World, events: EventQueue): void {
  const dungeon = world.dungeon;
  if (!dungeon) return;
  const runtime = world.roomRuntimes.get(world.currentRoomId);
  if (!runtime || runtime.cleared) return;

  const roomEnemies = world.enemies.filter((e) => e.roomId === runtime.id);
  if (roomEnemies.length === 0 || !allDead(roomEnemies)) return;

  runtime.cleared = true;
  world.stats.roomsCleared += 1;
  world.stats.score += ROOM_CLEAR_SCORE;
  pushEvent(events, 'room-cleared', world.hero.position.x, world.hero.position.y, 1, runtime.name);
  pushEvent(events, 'doors-open', world.hero.position.x, world.hero.position.y, 1, runtime.name);

  // Abre las conexiones de la sala (ambos lados), salvo las que requieren
  // llave (esas se abren al tocarlas con la llave, ver stepBossDoorKeyCheck).
  for (const door of runtime.doors) {
    if (door.requiresKey) continue;
    openConnection(world, door.connectionIndex);
  }

  if (runtime.id === dungeon.bossRoomId) {
    // GDD §15.1 punto 8: el jefe derrotado abre también su propia puerta
    // (sellada mientras vivía, ver stepBossDoorSeal) — la victoria no deja al
    // héroe encerrado. Se abre YA, no al final de la pausa de clímax: no hay
    // ganancia jugable en retenerla (el mundo está congelado durante la
    // pausa, ver stepWorld) y así, si algún día la pausa deja de congelar la
    // sim, la puerta ya está lista.
    for (const door of runtime.doors) {
      if (door.requiresKey) openConnection(world, door.connectionIndex);
    }
    // Run multi-mazmorra (GDD §10): si esta era la última mazmorra de la
    // secuencia de jefes, fin de la run ('victory', sin recompensa: no habría
    // mazmorra siguiente donde gastarla — docs/plans/ECONOMY_PLAN.md decisión
    // 1). Si no, hay más jefes por delante: recompensa gratis primero
    // ('boss-reward'); `chooseBossReward` (session.ts) pasa a 'dungeon-cleared'
    // tras la elección, que a su vez encadena la siguiente mazmorra
    // (advanceToNextDungeon).
    //
    // Playtest 2026-07-15 (David, run completa): "al acabar con un jefe sale
    // inmediatamente la ventana de siguiente mazmorra, debería salir con un
    // poco de retraso, para poder ver el efecto al matar al jefe y quizá
    // algún gesto de victoria antes de la modal que lo tapa todo". En vez de
    // saltar directo a 'boss-reward'/'victory' (lo que dispara el modal ese
    // mismo frame, tapando el clímax de 'boss-defeated' que apenas empieza),
    // se entra en 'boss-victory-pause': stepWorld la trata como cualquier
    // fase != 'playing' (mundo congelado, solo avanza el reloj) durante
    // BOSS_VICTORY_PAUSE_DURATION segundos de tiempo de SIM, y solo entonces
    // salta a la fase real y emite el evento 'victory'/'dungeon-cleared' (se
    // difieren junto con la fase para que ambos lleguen sincronizados al
    // frame en que el modal aparece; los effects ya reaccionan a
    // 'dungeon-cleared' aunque la fase real sea 'boss-reward').
    world.phase = 'boss-victory-pause';
    world.bossVictoryPauseUntil = world.time + BOSS_VICTORY_PAUSE_DURATION;
    world.bossVictoryNextPhase = world.isFinalDungeon ? 'victory' : 'boss-reward';
  }
}

/** Cadencia mínima entre avisos de "necesitas la llave" mientras el héroe sigue pegado a la puerta (s). */
const LOCKED_NOTICE_INTERVAL = 1.5;

/**
 * GDD §10.2: la puerta del jefe se abre al TOCARLA con llave (bug playtest
 * 2026-07-14: antes se abría desde `DOOR_TOUCH_MARGIN`=1.1u, mucho antes de
 * llegar al muro, dejando atacar al jefe desde la sala contigua con la
 * puerta ya abierta — ver `bossDamageOutsideWindowFactor`/contención en
 * combat.ts para la otra mitad del fix). El aviso "necesitas la llave" sigue
 * disparándose desde más lejos (`DOOR_TOUCH_MARGIN`): avisar de cerca está
 * bien, lo que no puede pasar es abrir sin llegar a tocar.
 */
function stepBossDoorKeyCheck(world: World, events: EventQueue): void {
  const dungeon = world.dungeon;
  if (!dungeon) return;
  const runtime = world.roomRuntimes.get(world.currentRoomId);
  if (!runtime) return;

  for (const door of runtime.doors) {
    if (!door.requiresKey || door.open) continue;
    const dx = world.hero.position.x - door.center.x;
    const dy = world.hero.position.y - door.center.y;
    const dist = Math.hypot(dx, dy);
    if (dist > DOOR_TOUCH_MARGIN) continue;

    if (world.hero.hasKey) {
      if (dist > DOOR_CONTACT_MARGIN) continue; // con llave: solo abre al contacto real, no antes
      openConnection(world, door.connectionIndex);
      pushEvent(events, 'door-locked', door.center.x, door.center.y, 1, 'unlocked');
    } else if (world.time >= world.lockedNoticeCooldownUntil) {
      world.lockedNoticeCooldownUntil = world.time + LOCKED_NOTICE_INTERVAL;
      pushEvent(events, 'door-locked', door.center.x, door.center.y, 0, 'locked');
    }
  }
}

/**
 * Detecta que el héroe ha cruzado a otra sala (mundo continuo, sin pantallas
 * de carga): busca la sala cuyo AABB (con margen para cubrir el hueco de
 * puerta) contiene la posición actual del héroe. Si cambia respecto a
 * `currentRoomId`, actualiza el estado y emite 'room-entered'.
 */
function stepRoomTransition(world: World, events: EventQueue): void {
  const dungeon = world.dungeon;
  if (!dungeon) return;

  const hero = world.hero;
  const margin = 1; // cubre el tramo del hueco de puerta entre salas contiguas
  for (const placed of dungeon.rooms) {
    const b = placed.bounds;
    if (
      hero.position.x < b.minX - margin ||
      hero.position.x > b.maxX + margin ||
      hero.position.y < b.minY - margin ||
      hero.position.y > b.maxY + margin
    ) {
      continue;
    }
    // Preferimos la sala cuyo interior estricto contiene al héroe; si está en
    // el hueco de puerta (fuera de todos los interiores estrictos), se queda
    // con la sala actual hasta que entre claramente en otra.
    const strictlyInside =
      hero.position.x >= b.minX && hero.position.x <= b.maxX && hero.position.y >= b.minY && hero.position.y <= b.maxY;
    if (!strictlyInside) continue;
    if (placed.room.id === world.currentRoomId) return;

    world.currentRoomId = placed.room.id;
    world.room = placed.room;
    world.bounds = placed.bounds;
    const runtime = world.roomRuntimes.get(placed.room.id);
    if (runtime) {
      const firstVisit = !runtime.visited;
      runtime.visited = true;
      pushEvent(events, 'room-entered', hero.position.x, hero.position.y, firstVisit ? 1 : 0, runtime.name);
    }
    return;
  }
}

export function stepWorld(world: World, events: EventQueue): void {
  // 'boss-victory-pause' (ver stepDungeonRoomClear/BOSS_VICTORY_PAUSE_DURATION
  // más arriba): congelada igual que cualquier fase != 'playing' de abajo,
  // pero con un reloj propio que, al cumplirse, salta a la fase real
  // ('boss-reward'/'victory') y AHORA sí emite su evento — se difiere junto
  // con la fase para que el modal y el evento lleguen sincronizados al mismo
  // frame, en vez de disparar el evento (y su burst dorado) mientras el
  // clímax de 'boss-defeated' todavía está en pantalla.
  if (world.phase === 'boss-victory-pause') {
    world.time += FIXED_DT;
    if (world.time >= world.bossVictoryPauseUntil) {
      const nextPhase = world.bossVictoryNextPhase ?? 'boss-reward';
      world.phase = nextPhase;
      world.bossVictoryNextPhase = null;
      if (nextPhase === 'victory') {
        pushEvent(events, 'victory', world.hero.position.x, world.hero.position.y, 1);
      } else {
        pushEvent(events, 'dungeon-cleared', world.hero.position.x, world.hero.position.y, 1);
      }
    }
    return;
  }

  // La sim se pausa con un modal abierto (pausa/mazmorra superada) o tras la
  // muerte/victoria: solo avanza el reloj para que los timers de UI no se
  // congelen raro al volver.
  if (world.phase !== 'playing') {
    world.time += FIXED_DT;
    return;
  }

  stepHeroPhysics(world, events);
  stepRoomTransition(world, events);
  if (world.dungeon) stepBossDoorKeyCheck(world, events);

  stepEnemyAi(world, FIXED_DT);
  stepBosses(world, FIXED_DT, events);
  if (world.dungeon) stepBossDoorSeal(world, events);
  stepEnemyCollisions(world);

  stepProjectiles(world, FIXED_DT, events);

  stepHeroHazards(world, events);
  stepEnemyHazards(world, world.spikeDamageCooldowns, events);
  stepPuddles(world, FIXED_DT, events);
  stepBarrels(world, events);

  if (currentPhase(world) !== 'game-over') {
    stepHeroEnemyContacts(world, world.contactDamageCooldowns, events);
    stepBossStates(world, world.contactDamageCooldowns, events);
  }

  // Separación de cuerpos DESPUÉS del gameplay de contacto: la embestida y el
  // daño de contacto ya se han resuelto sobre el solape de este tick; aquí
  // solo se garantiza que héroe/enemigos no se atraviesen ni se apilen.
  stepBodySeparation(world);

  stepItems(world, FIXED_DT, events);

  collectDeadDrops(world, world.deadEnemiesDropped);

  if (currentPhase(world) === 'playing') {
    if (world.dungeon) {
      stepDungeonRoomClear(world, events);
    } else {
      stepSingleRoomClear(world, events);
    }
  }

  world.time += FIXED_DT;
}
