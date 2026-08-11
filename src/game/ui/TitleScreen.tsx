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
import { Button, Frame } from '@/ui';
import { playSfx } from '@/game/audio/sfxEngine';
import { useKitReady } from '@/game/render/kit';
import { CreditsModal } from './CreditsModal';
import { TitleScreenScene } from './TitleScreenScene';
import './title-screen.css';

export function TitleScreen({ onPlay }: { onPlay: () => void }) {
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
      <header className="title-screen-heading">
        <h1 className="title-screen-title">La Última Mecha</h1>
        <p className="title-screen-subtitle">Lumora en la Mansión Lumbra</p>
      </header>

      <nav className="title-screen-menu" aria-hidden={busy}>
        <Button variant="primary" size="lg" onClick={handlePlay} disabled={busy || !kitReady}>
          {kitReady ? 'Jugar' : 'Preparando…'}
        </Button>
        <Button variant="secondary" href="#/editor" tabIndex={busy ? -1 : 0} aria-disabled={busy}>
          Editor
        </Button>
        <Button variant="secondary" onClick={() => setShowCredits(true)} disabled={busy}>
          Créditos
        </Button>
      </nav>

      {phase === 'loading' ? <p className="title-screen-loading-label">Encendiendo la última mecha…</p> : null}

      <CreditsModal open={showCredits && !busy} onClose={() => setShowCredits(false)} />
    </div>
  );
}
