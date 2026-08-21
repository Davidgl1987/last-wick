/**
 * Pantalla de presentación (GDD, Feature de pantalla de título): primera
 * pantalla del juego, antes de montar `GameRoot`/crear la sesión. Móvil
 * primero: menú vertical de 3 controles usables con el pulgar (Jugar,
 * Editor, Créditos), enmarcados con los assets originales de Kenney Fantasy
 * UI Borders (`public/ui/`, ver `public/ui/README.md`) para dar ambiente de
 * mansión victoriana a la luz de una vela — de ahí el tinte ámbar del halo y
 * el título, "La Última Mecha" (el proyecto se llama "Last Wick" en el repo).
 *
 * El modo playtest (`#/playtest`) y el debug `?boss=` NO pasan por aquí (ver
 * App.tsx): son herramientas de desarrollo, no el flujo de juego normal.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Frame, Select } from '@/ui';
import { playSfx } from '@/game/audio/sfxEngine';
import { useKitReady } from '@/game/render/kit';
import { AVAILABLE_LOCALES, setLang, useLang, useT } from '@/i18n';
import { CreditsModal } from './CreditsModal';
import { TitleScreenScene } from './TitleScreenScene';
import './title-screen.css';

/**
 * Selector de idioma de la pantalla de título: esquina superior derecha, sin
 * marco ni fondo — solo la palabra y su flecha, en la tipografía y el ámbar
 * de los botones del menú (David comparó esta versión contra una centrada
 * bajo el menú y se quedó con la esquina, 2026-08-20). Componente aparte solo
 * por legibilidad de `TitleScreen`, que ya es largo.
 */
function LanguageSelect({ busy }: { busy: boolean }) {
  const t = useT();
  const lang = useLang();
  return (
    <Select
      label={t('title.language')}
      labelClassName="sr-only"
      className="title-screen-lang"
      value={lang}
      disabled={busy}
      onChange={(e) => {
        setLang(e.target.value);
        playSfx('ui-click');
      }}
    >
      {AVAILABLE_LOCALES.map(({ code, name }) => (
        <option key={code} value={code}>
          {name}
        </option>
      ))}
    </Select>
  );
}

export function TitleScreen({ onPlay }: { onPlay: () => void }) {
  const t = useT();
  const [showCredits, setShowCredits] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'entering' | 'loading'>('idle');
  const startedRef = useRef(false);
  const kitReady = useKitReady();

  const startGameOnce = useCallback((): void => {
    if (startedRef.current) return;
    startedRef.current = true;
    onPlay();
  }, [onPlay]);

  useEffect(() => {
    if (phase === 'loading' && kitReady) startGameOnce();
  }, [kitReady, phase, startGameOnce]);

  // 'level-start' (encargo de audio, bus música): arranca la partida real,
  // distinto del 'ui-click' genérico que ya lleva CUALQUIER <Button> (éste
  // suena ADEMÁS, no en su lugar).
  const handlePlay = (): void => {
    if (phase !== 'idle') return;
    playSfx('level-start', { bus: 'music' });
    setShowCredits(false);
    setPhase('entering');
  };

  const handleEntryComplete = useCallback((): void => {
    if (kitReady) {
      startGameOnce();
    } else {
      setPhase('loading');
    }
  }, [kitReady, startGameOnce]);

  const busy = phase !== 'idle';

  return (
    <div className={`title-screen title-screen-${phase}`} aria-busy={busy}>
      {kitReady ? <TitleScreenScene entering={phase === 'entering'} onComplete={handleEntryComplete} /> : null}
      <div className="title-screen-fallback" aria-hidden="true" />
      <Frame variant="inset" className="title-screen-frame" aria-hidden="true" />
      <LanguageSelect busy={busy} />
      <header className="title-screen-heading">
        <h1 className="title-screen-title">{t('title.heading')}</h1>
        <p className="title-screen-subtitle">{t('title.subtitle')}</p>
      </header>

      <nav className="title-screen-menu" aria-hidden={busy}>
        <Button variant="primary" size="lg" onClick={handlePlay} disabled={busy || !kitReady}>
          {kitReady ? t('title.play') : t('title.preparing')}
        </Button>
        <Button variant="secondary" href="#/editor" tabIndex={busy ? -1 : 0} aria-disabled={busy}>
          {t('title.editor')}
        </Button>
        <Button variant="secondary" onClick={() => setShowCredits(true)} disabled={busy}>
          {t('title.credits')}
        </Button>
      </nav>

      {phase === 'loading' ? <p className="title-screen-loading-label">{t('title.loading')}</p> : null}

      <CreditsModal open={showCredits && !busy} onClose={() => setShowCredits(false)} />
    </div>
  );
}
