/**
 * Pantalla de presentación (GDD, Feature de pantalla de título): primera
 * pantalla del juego, antes de montar `GameRoot`/crear la sesión. Móvil
 * primero: botón grande "▶ Jugar" usable con el pulgar. Enlace discreto al
 * editor (`#/editor`), consistente con `.editor-link` de game-root.css.
 *
 * El modo playtest (`#/playtest`) y el debug `?boss=` NO pasan por aquí (ver
 * App.tsx): son herramientas de desarrollo, no el flujo de juego normal.
 */

import './title-screen.css';

export function TitleScreen({ onPlay }: { onPlay: () => void }) {
  return (
    <div className="title-screen">
      <div className="title-screen-glow" aria-hidden="true" />
      <div className="title-screen-content">
        <h1 className="title-screen-title">LAST WICK</h1>
        <p className="title-screen-subtitle">Un roguelite de tirachinas</p>
        <button type="button" className="title-screen-play-btn" onClick={onPlay}>
          ▶ Jugar
        </button>
      </div>
      <a className="title-screen-editor-link" href="#/editor">
        ✎ Editor
      </a>
    </div>
  );
}
