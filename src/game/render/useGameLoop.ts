/**
 * Loop raíz: hace tick de la sim con acumulador de timestep fijo (60 Hz)
 * dentro de useFrame. Guarda la posición previa del héroe para que los
 * componentes de render interpolen. React NUNCA está en el hot path para la
 * sim: aquí no hay setState por frame de física, solo mutación del objeto
 * sesión. El único setState (zustand) ocurre cuando un evento discreto de
 * gameplay cambia HP/monedas/llave/fase, no una vez por frame.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { FIXED_DT } from '@/engine/physics';
import { consumeHitStop, decayTrauma } from '@/game/features/effects/effectsState';
import { reactToEvent } from '@/game/features/effects/reactToEvent';
import type { GameSession } from '@/game/session/session';
import { drainEvents, type GameEvent } from '@/engine/events';
import { stepWorld } from '@/game/world/step';
import type { GamePhase } from '@/game/world/types';
import { useUiStore } from '@/game/session/store';
import { WEAPON_COLOR } from '@/game/render/assets';

/** Tope de tiempo de frame acumulable (evita la espiral de la muerte en tabs suspendidas). */
const MAX_FRAME_TIME = 0.25;

const NOTICE_BY_EVENT: Partial<Record<GameEvent['type'], string>> = {
  'room-cleared': 'Sala limpiada',
  'pit-fall': 'Has caído al foso',
  'shield-block': 'El escudo bloquea el golpe',
  'boss-door-sealed': 'La puerta se sella',
  'boss-defeated': '¡Jefe derrotado!',
  'shop-opened': 'Tienda',
};

/** Índice 1-based de la sala actual dentro del orden de la mazmorra (orden de generación/BFS desde el inicio). */
function computeRoomProgress(world: GameSession['world']): { roomIndex: number | null; totalRooms: number | null } {
  const dungeon = world.dungeon;
  if (!dungeon) return { roomIndex: null, totalRooms: null };
  const index = dungeon.rooms.findIndex((r) => r.room.id === world.currentRoomId);
  return { roomIndex: index >= 0 ? index + 1 : null, totalRooms: dungeon.rooms.length };
}

export function useGameLoop(session: GameSession): void {
  // Snapshot de los últimos valores sincronizados al store, para no llamar
  // setState si nada de baja frecuencia cambió este frame.
  const lastSynced = useRef<{
    hp: number;
    maxHp: number;
    coins: number;
    hasKey: boolean;
    phase: GamePhase;
    roomsCleared: number;
    score: number;
    roomIndex: number | null;
    currentRoomName: string;
  }>({
    hp: -1,
    maxHp: -1,
    coins: -1,
    hasKey: false,
    phase: 'playing',
    roomsCleared: -1,
    score: -1,
    roomIndex: -2,
    currentRoomName: '',
  });

  const runFrame = (delta: number): void => {
    const world = session.world;
    const effects = session.effects.state;
    world.heroAiming = session.aim.active;
    const cappedDelta = delta > MAX_FRAME_TIME ? MAX_FRAME_TIME : delta;

    // Hit-stop (ARCHITECTURE.md "Effects (implementación)"): escala el dt que
    // alimenta el acumulador de la sim en golpes fuertes (~60-100ms), sin
    // congelar el render (rAF sigue a tasa normal, la cámara/partículas
    // siguen actualizándose con cappedDelta real).
    const timeScale = consumeHitStop(effects, cappedDelta);
    let accumulator = session.accumulator + cappedDelta * timeScale;
    while (accumulator >= FIXED_DT) {
      session.heroPrevX = world.hero.position.x;
      session.heroPrevY = world.hero.position.y;
      stepWorld(world, session.events);
      accumulator -= FIXED_DT;
    }
    session.accumulator = accumulator;
    session.renderAlpha = accumulator / FIXED_DT;

    decayTrauma(effects, cappedDelta);
    session.effects.particles.update(cappedDelta);
    session.effects.trail.update(cappedDelta);
    session.effects.shockwaves.update(cappedDelta);

    drainEvents(session.events, (event) => {
      // Color del arma activa en el momento del evento (audit playtest: el
      // burst de 'launch' cubre lanzamiento corporal Y disparo de flecha/
      // hechizo — sin esto quedaba fijo al azul viejo del cuerpo tras el
      // swap de colores, ver reactToEvent.ts).
      reactToEvent(
        event,
        session.effects.particles,
        effects,
        session.effects.shockwaves,
        Math.random,
        `#${WEAPON_COLOR[world.hero.weaponMode].getHexString()}`,
      );

      if (event.type === 'room-entered') {
        useUiStore.getState().showNotice(event.label);
        return;
      }
      if (event.type === 'door-locked') {
        if (event.label === 'unlocked') {
          useUiStore.getState().showNotice('Puerta del jefe abierta');
        } else if (event.label === 'locked') {
          useUiStore.getState().showNotice('Necesitas la llave');
        }
        // label === runtime.name (apertura por sala limpiada): sin aviso propio,
        // 'room-cleared' ya lo cubre.
        return;
      }
      const notice = NOTICE_BY_EVENT[event.type];
      if (notice) {
        useUiStore.getState().showNotice(notice);
      }
    });

    const hero = world.hero;
    const snap = lastSynced.current;
    const { roomIndex, totalRooms } = computeRoomProgress(world);
    const currentRoomName = world.room.name;
    // GDD/combat.ts acumula `stats.score` con daños fraccionarios (factor de
    // jefes fuera de ventana, ver applyDamageToEnemy). Se redondea SOLO aquí,
    // en el punto de sincronización a UI: la acumulación interna del mundo no
    // se toca, y la comparación de cambio usa el valor ya redondeado para no
    // re-renderizar por ruido decimal que el jugador nunca vería.
    const score = Math.round(world.stats.score);
    if (
      hero.hp !== snap.hp ||
      hero.maxHp !== snap.maxHp ||
      hero.coins !== snap.coins ||
      hero.hasKey !== snap.hasKey ||
      world.phase !== snap.phase ||
      world.stats.roomsCleared !== snap.roomsCleared ||
      score !== snap.score ||
      roomIndex !== snap.roomIndex ||
      currentRoomName !== snap.currentRoomName
    ) {
      snap.hp = hero.hp;
      snap.maxHp = hero.maxHp;
      snap.coins = hero.coins;
      snap.hasKey = hero.hasKey;
      snap.phase = world.phase;
      snap.roomsCleared = world.stats.roomsCleared;
      snap.score = score;
      snap.roomIndex = roomIndex;
      snap.currentRoomName = currentRoomName;
      useUiStore.getState().syncFromWorld({
        hp: hero.hp,
        maxHp: hero.maxHp,
        // Monedero gastable (docs/plans/ECONOMY_PLAN.md), no el total histórico
        // recogido (ese vive en world.stats.coinsCollected, para la puntuación).
        coins: hero.coins,
        hasKey: hero.hasKey,
        phase: world.phase,
        roomsCleared: world.stats.roomsCleared,
        score,
        roomIndex,
        totalRooms,
        currentRoomName,
      });
    }
  };

  useFrame((_, delta) => runFrame(delta));

}
