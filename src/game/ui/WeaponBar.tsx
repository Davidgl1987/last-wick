/**
 * Selector de modo de arma (GDD §3/§5/§12): 3 botones grandes (≥48 px) abajo
 * al centro, cada uno con su barra de recarga visual.
 *
 * La barra de recarga se actualiza con un rAF propio que LEE la sim
 * (session.world) y muta `style` de los divs vía refs — NUNCA setState por
 * frame. El único estado de React es el modo seleccionado (cambia al pulsar).
 */

import { useEffect, useRef, useState } from 'react';
import { ARROW_COOLDOWN, SPELL_COOLDOWN } from '@/game/features/combat/constants';
import { BODY_LAUNCH_COOLDOWN } from '@/game/features/hero/constants';
import type { GameSession } from '@/game/session/session';
import type { WeaponMode } from '@/game/world/types';
import { frameClass, Icon, type IconName } from '@/ui';
import './weapon-bar.css';

/**
 * Nombres de la capa de presentación (Cera/Fuego/Hechizo) — los identificadores
 * internos `'body' | 'arrow' | 'spell'` (tipo `WeaponMode` del mundo simulado)
 * NO cambian, solo su etiqueta e icono aquí. Cada modo lleva el COLOR de su
 * ataque (mismo color que su proyectil/estela, feedback de playtest): cera
 * amarilla, fuego azul, hechizo violeta. Se aplica vía clase CSS
 * `weapon-btn-<mode>` (colores en weapon-bar.css).
 */
const MODES: { mode: WeaponMode; label: string; icon: IconName }[] = [
  { mode: 'body', label: 'Cera', icon: 'dot' },
  { mode: 'arrow', label: 'Fuego', icon: 'flame' },
  { mode: 'spell', label: 'Hechizo', icon: 'spark' },
];

/** Fracción [0,1] de recarga completada para un modo (1 = listo). */
function cooldownProgress(session: GameSession, mode: WeaponMode): number {
  const world = session.world;
  const hero = world.hero;
  let elapsed: number;
  let total: number;
  if (mode === 'body') {
    elapsed = world.time - hero.lastLaunchTime;
    total = BODY_LAUNCH_COOLDOWN;
  } else if (mode === 'arrow') {
    elapsed = world.time - hero.lastArrowTime;
    total = ARROW_COOLDOWN;
  } else {
    elapsed = world.time - hero.lastSpellTime;
    total = SPELL_COOLDOWN;
  }
  if (total <= 0) return 1;
  const t = elapsed / total;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** true si el foco actual está en un campo de texto editable (inputs del editor): el atajo de teclado no debe robarle las teclas 1/2/3. */
function isTypingInTextField(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function WeaponBar({ session }: { session: GameSession }) {
  const [active, setActive] = useState<WeaponMode>(session.world.hero.weaponMode);
  const overlayRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      for (let i = 0; i < MODES.length; i++) {
        const overlay = overlayRefs.current[i];
        if (overlay) {
          const progress = cooldownProgress(session, MODES[i].mode);
          // Cortina que baja: llena (recargando) → vacía (listo).
          overlay.style.transform = `scaleY(${1 - progress})`;
        }
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [session]);

  const select = (mode: WeaponMode) => {
    session.world.hero.weaponMode = mode;
    setActive(mode);
  };

  // Comodidad de PC/playtest (GDD §3): teclas 1/2/3 seleccionan directamente
  // y la rueda del ratón cicla entre las 3 (arriba = anterior, abajo =
  // siguiente). Mismo camino de selección que los botones (`select`), así
  // que WeaponBar refleja el cambio igual en ambos casos. El teclado sigue
  // sin ser necesario para jugar (sin romper táctil): son listeners extra en
  // window, no sustituyen a los botones.
  useEffect(() => {
    const KEY_TO_MODE: Record<string, WeaponMode> = { '1': 'body', '2': 'arrow', '3': 'spell' };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingInTextField()) return;
      if (session.world.phase !== 'playing') return;
      const mode = KEY_TO_MODE[e.key];
      if (mode) select(mode);
    };

    const onWheel = (e: WheelEvent) => {
      if (isTypingInTextField()) return;
      if (session.world.phase !== 'playing') return;
      const currentIndex = MODES.findIndex((m) => m.mode === session.world.hero.weaponMode);
      const step = e.deltaY > 0 ? 1 : -1; // abajo = siguiente, arriba = anterior
      const nextIndex = (currentIndex + step + MODES.length) % MODES.length;
      select(MODES[nextIndex].mode);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
    };
  }, [session]);

  return (
    <div className="weapon-bar">
      {MODES.map(({ mode, label, icon }, i) => (
        <button
          key={mode}
          type="button"
          className={frameClass('plain', `weapon-btn weapon-btn-${mode}${active === mode ? ' weapon-btn-active' : ''}`)}
          onPointerDown={(e) => {
            // Evita que el gesto de puntería del canvas capture este toque.
            e.stopPropagation();
            select(mode);
          }}
          aria-label={`Arma: ${label}`}
          aria-pressed={active === mode}
        >
          <span className="weapon-btn-icon">
            <Icon name={icon} size={20} />
          </span>
          <span className="weapon-btn-label">{label}</span>
          <div className="weapon-btn-cooldown-clip">
            <div
              className="weapon-btn-cooldown"
              ref={(el) => {
                overlayRefs.current[i] = el;
              }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}
