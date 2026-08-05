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

import { useState } from 'react';
import { Button, Divider, Frame } from '@/ui';
import { CreditsModal } from './CreditsModal';
import './title-screen.css';

export function TitleScreen({ onPlay }: { onPlay: () => void }) {
  const [showCredits, setShowCredits] = useState(false);

  return (
    <div className="title-screen">
      <div className="title-screen-glow" aria-hidden="true" />
      <Frame variant="inset" className="title-screen-frame" aria-hidden="true" />
      <div className="title-screen-content">
        <h1 className="title-screen-title">La Última Mecha</h1>
        <Divider />
        <p className="title-screen-subtitle">Lumora en la Mansión Lumbra</p>

        <nav className="title-screen-menu">
          <Button variant="primary" size="lg" onClick={onPlay}>
            Jugar
          </Button>
          <Button variant="secondary" href="#/editor">
            Editor
          </Button>
          <Button variant="secondary" onClick={() => setShowCredits(true)}>
            Créditos
          </Button>
        </nav>
      </div>

      <CreditsModal open={showCredits} onClose={() => setShowCredits(false)} />
    </div>
  );
}
