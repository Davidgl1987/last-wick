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
import { tRoomName, useT } from '@/i18n';
import './hud.css';
import { useShowKeyboardHints } from './useKeyboardHint';
import { WeaponBar } from './WeaponBar';

const NOTICE_DURATION_MS = 1200;

export function HUD({ session, showMicroTutorial }: { session: GameSession; showMicroTutorial: boolean }) {
  const t = useT();
  // Pistas de teclado del microtutorial de abajo (WASD/Tab) — ver cabecera de
  // useKeyboardHint.ts para las dos señales que la activan.
  const showKeyboardHints = useShowKeyboardHints();
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
  const currentRoomId = useUiStore((s) => s.currentRoomId);
  const currentRoomName = useUiStore((s) => s.currentRoomName);
  // Nombre de sala ya traducido (rooms.<id>, o el name propio si no hay
  // clave — sala del editor): calculado una vez y compartido por el banner Y
  // el aviso de 'room-entered' (ver más abajo), que siempre coinciden.
  const roomDisplayName = tRoomName(currentRoomId, currentRoomName);

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
            aria-label={t('hud.hp', { hp, maxHp })}
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
            <span className="hud-godmode-badge" aria-label={t('hud.godAria')} title={t('hud.godTitle')}>
              {t('hud.godBadge')}
            </span>
          )}
        </div>
        <div className="hud-top-right">
          {hasKey && (
            <span className="hud-key" aria-label={t('hud.key')} title={t('hud.key')}>
              <Icon name="key" size={22} />
            </span>
          )}
          <div className="hud-coins" aria-label={t('hud.coins', { coins })}>
            <span className="hud-coin-icon" />
            {coins}
          </div>
          <Button
            variant="secondary"
            className="hud-pause-btn"
            aria-label={t('hud.pause')}
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
        <div className="hud-room-banner" aria-label={t('hud.roomAria', { i: roomIndex, n: totalRooms, name: roomDisplayName })}>
          <span className="hud-room-progress">{t('hud.roomProgress', { i: roomIndex, n: totalRooms })}</span>
          <span className="hud-room-name">{roomDisplayName}</span>
        </div>
      )}
      {notice !== null && (
        <div className="hud-notice">
          {/* 'notice.roomEntered' no tiene plantilla propia (ver el comentario
              gemelo en useGameLoop.ts): el aviso de entrada siempre coincide
              con la sala que el store acaba de sincronizar este mismo frame,
              así que se pinta el nombre de sala ya traducido en vez de t(). */}
          {notice.key === 'notice.roomEntered' ? roomDisplayName : t(notice.key, notice.params)}
        </div>
      )}
      {showMicroTutorial && phase === 'playing' && (
        <div className="hud-microtutorial" role="status">
          <div className="hud-microtutorial-gesture" aria-hidden="true">
            <span className="hud-microtutorial-pull" />
            {/* La mano se pinta DESPUÉS de la estela y su punto de agarre (que
                van antes en el DOM) y con relleno OPACO — no el rgba(...,0.9)
                de antes: así cualquier tramo del gesto que le quede por detrás
                queda tapado por construcción. El `d` es un ÚNICO subpath
                CERRADO (un solo M...Z, sin `m`/`M` intermedios): antes cada
                dedo se dibujaba como un subpath aparte (encadenados con "m"),
                y los lados que quedaban DENTRO de la silueta rellena (los
                tramos verticales del borde derecho del índice y del corazón)
                se seguían trazando con stroke, así que se veían como líneas
                cruzando la mano. Al recorrer todo el contorno exterior en un
                solo trazo cerrado, cada segmento dibujado cae en el borde
                real de la silueta y no queda ninguna línea interna (David,
                2026-08-17).

                Los dedos plegados son DOS ARCOS convexos tangentes (`a`), no
                una línea quebrada: el primer intento de contorno cerrado los
                dibujó como zigzag de segmentos rectos y David lo leyó como
                "una sierra" (2026-08-17, misma ronda). Con arcos de radio ~4
                — el mismo que la yema del índice — el borde superior del puño
                queda ondulado como en cualquier icono de mano, y el trazo de
                2.2 no los empasta (comparado en pantalla a 1×, 2× y 4× contra
                una variante de tres nudillos más pequeños, que sí se empastaba
                al tamaño real de 40×52 px). */}
            <svg className="hud-microtutorial-finger" viewBox="0 0 40 52" fill="none">
              <path
                d="M15.5 25V8.5a4 4 0 0 1 8 0V19.5a4 4 0 0 1 7.9.7a3.7 3.7 0 0 1 7.1 2.3v13C39 44 33 50 24.5 50h-4.8c-5.2 0-8.1-2.7-10.8-7L2.5 33.2a4.2 4.2 0 0 1 6.7-5l6.3 6.1V25Z"
                fill="#121522"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className={frameClass('plain', 'hud-microtutorial-text')}>
            <span>{t('hud.microTutorial')}</span>
            {/* Pistas de teclado (encargo 2026-08-31): solo en escritorio o
                en cuanto se detecte uso real de WASD/flechas/Tab — ver
                useKeyboardHint.ts. En táctil puro no se pintan, el cartel
                queda igual que antes de esta feature. */}
            {showKeyboardHints && (
              <>
                <span className="hud-microtutorial-hint">{t('hud.microTutorialMove')}</span>
                <span className="hud-microtutorial-hint">{t('hud.microTutorialWeapon')}</span>
              </>
            )}
          </div>
        </div>
      )}
      <BossHealthBar session={session} />
      <WeaponBar session={session} />
    </div>
  );
}
