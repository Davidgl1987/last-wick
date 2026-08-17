/**
 * HUD (GDD §12): llamas y monedas arriba, icono de llave, botón de pausa
 * arriba a la derecha, avisos contextuales y selector de armas abajo. React
 * DOM superpuesto al canvas (nunca drei <Html>). Solo lee estado de baja
 * frecuencia del store; las barras de recarga viven en WeaponBar (rAF sobre
 * la sim, sin setState).
 *
 * Feedback visual por CSS (sin re-render por frame): las llamas parpadean
 * en rojo al recibir daño y en rosa al curar (animación retrigger por key);
 * la llave hace "pop" al aparecer (animación de montaje).
 */

import { useEffect, useRef } from 'react';
import { BossHealthBar } from '@/game/features/bosses/BossHealthBar';
import { pauseGame, type GameSession } from '@/game/session/session';
import { useUiStore } from '@/game/session/store';
import { Button, frameClass, Icon } from '@/ui';
import './hud.css';
import { WeaponBar } from './WeaponBar';

const NOTICE_DURATION_MS = 1200;

export function HUD({ session, showMicroTutorial }: { session: GameSession; showMicroTutorial: boolean }) {
  const hp = useUiStore((s) => s.hp);
  const maxHp = useUiStore((s) => s.maxHp);
  const coins = useUiStore((s) => s.coins);
  const hasKey = useUiStore((s) => s.hasKey);
  const phase = useUiStore((s) => s.phase);
  const notice = useUiStore((s) => s.notice);
  const noticeSeq = useUiStore((s) => s.noticeSeq);
  const clearNotice = useUiStore((s) => s.clearNotice);
  const roomIndex = useUiStore((s) => s.roomIndex);
  const totalRooms = useUiStore((s) => s.totalRooms);
  const currentRoomName = useUiStore((s) => s.currentRoomName);

  // Dirección del último cambio de HP, para la animación de daño/curación.
  const prevHp = useRef(hp);
  const hpDelta = hp - prevHp.current;
  useEffect(() => {
    prevHp.current = hp;
  }, [hp]);
  const flamesFlashClass = hpDelta < 0 ? ' hud-flames-damage' : hpDelta > 0 ? ' hud-flames-heal' : '';

  // Modo dios de playtest (?godmode, render/debug-params.ts): estático para
  // toda la sesión (fijado al crear/recrear `world`, session.ts), así que
  // basta leerlo directamente de `session.world` — no cambia por frame ni
  // necesita pasar por el store de baja frecuencia.
  const godMode = session.world.godMode;

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(clearNotice, NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice, noticeSeq, clearNotice]);

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-hp-group">
          <div
            key={`hp-${hp}-${maxHp}`}
            className={`hud-flames${flamesFlashClass}`}
            aria-label={`Vida: ${hp} de ${maxHp}`}
          >
            {Array.from({ length: maxHp }, (_, i) => (
              <span key={i} className={i < hp ? 'flame-full' : 'flame-empty'}>
                <Icon name="flame" size={22} />
              </span>
            ))}
          </div>
          {godMode && (
            // Hermano del div con key={hp-...}, no hijo: no debe remontarse
            // en cada cambio de HP, es un badge estático de toda la sesión.
            <span
              className="hud-godmode-badge"
              aria-label="Modo dios de playtest activo"
              title="Modo dios (?godmode): revive al máximo en vez de game-over"
            >
              GOD
            </span>
          )}
        </div>
        <div className="hud-top-right">
          {hasKey && (
            <span className="hud-key" aria-label="Llave" title="Llave">
              <Icon name="key" size={22} />
            </span>
          )}
          <div className="hud-coins" aria-label={`Monedas: ${coins}`}>
            <span className="hud-coin-icon" />
            {coins}
          </div>
          <Button
            variant="secondary"
            className="hud-pause-btn"
            aria-label="Pausa"
            disabled={phase !== 'playing'}
            onPointerDown={(e) => {
              // Evita que el gesto de puntería del canvas capture este toque.
              e.stopPropagation();
              pauseGame(session);
            }}
          >
            <Icon name="pause" size={16} />
          </Button>
        </div>
      </div>
      {roomIndex !== null && totalRooms !== null && (
        <div className="hud-room-banner" aria-label={`Sala ${roomIndex} de ${totalRooms}: ${currentRoomName}`}>
          <span className="hud-room-progress">
            Sala {roomIndex}/{totalRooms}
          </span>
          <span className="hud-room-name">{currentRoomName}</span>
        </div>
      )}
      {notice !== null && <div className="hud-notice">{notice}</div>}
      {showMicroTutorial && phase === 'playing' && (
        <div className="hud-microtutorial" role="status">
          <div className="hud-microtutorial-gesture" aria-hidden="true">
            <span className="hud-microtutorial-pull" />
            {/* La mano se pinta DESPUÉS de la estela y su punto de agarre (que
                van antes en el DOM) y con relleno OPACO — no el rgba(...,0.9)
                de antes: así cualquier tramo del gesto que le quede por detrás
                queda tapado por construcción. Con el relleno semitransparente
                se traslucía y se leía como "una línea cruzando los dedos"; tres
                intentos de reubicarla por geometría no lo resolvieron (David,
                2026-08-14). */}
            <svg className="hud-microtutorial-finger" viewBox="0 0 40 52" fill="none">
              <path
                d="M15.5 25V8.5a4 4 0 0 1 8 0V21m0-5.5a4 4 0 0 1 8 0V27m0-6a4 4 0 0 1 7.5 2v12.5C39 44 33 50 24.5 50h-4.8c-5.2 0-8.1-2.7-10.8-7L2.5 33.2a4.2 4.2 0 0 1 6.7-5l6.3 6.1V25Z"
                fill="#121522"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className={frameClass('plain', 'hud-microtutorial-text')}>
            Arrastra y suelta para lanzarte
          </span>
        </div>
      )}
      <BossHealthBar session={session} />
      <WeaponBar session={session} />
    </div>
  );
}
