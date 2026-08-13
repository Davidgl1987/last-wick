/**
 * Raíz de la aplicación. Routing por hash A MANO (sin react-router):
 *
 *   (sin hash)    → pantalla de título → juego (run completa de mazmorra procedural)
 *   #/editor      → editor de niveles (GDD §13)
 *   #/playtest    → playtest de la sala en edición (sala única) + volver
 *
 * Hash y no pathname: la app se sirve desde GitHub Pages con base relativa,
 * donde las rutas de pathname devolverían 404 al recargar.
 *
 * Pantalla de título (feature de presentación): la ruta 'game' muestra
 * `TitleScreen` hasta que el jugador pulsa "Jugar" (estado `started`), que
 * monta `GameRoot` (crea la sesión). `?boss=<id>` (playtest de jefes),
 * `?room=test` (Sala de Pruebas) y `#/playtest` son herramientas de
 * desarrollo: saltan DIRECTO al juego, sin pasar por el título.
 */

import { useCallback, useEffect, useState } from 'react';
import { EditorPage } from '@/editor/EditorPage';
import { loadPlaytestRoom } from '@/editor/storage';
import { GameRoot } from '@/game/render/GameRoot';
import { preloadKit, useKitReady } from '@/game/render/kit';
import { initAudio } from '@/game/audio/sfxEngine';
import { useUiStore } from '@/game/session/store';
import { TitleScreen } from '@/game/ui/TitleScreen';

type Route = 'game' | 'editor' | 'playtest';

function currentRoute(): Route {
  const hash = window.location.hash;
  if (hash.startsWith('#/editor')) return 'editor';
  if (hash.startsWith('#/playtest')) return 'playtest';
  return 'game';
}

/**
 * Herramientas de playtest que saltan DIRECTAS al juego, sin pasar por el
 * título (ver debug-params.ts): `?boss=` (arena de jefe suelta) y `?room=`
 * (Sala de Pruebas). Con el título 3D de por medio, obligar a pulsar "Jugar"
 * y esperar la transición del portón en cada recarga hace inservible un banco
 * de pruebas que se recarga sin parar.
 */
function hasDirectPlaytestParam(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('boss') || params.has('room');
}

/**
 * Estado de carga mínimo mientras `preloadKit()` termina (docs/plans/
 * ART_KIT_PLAN.md, F1). Solo hace falta en las vías que saltan DIRECTAS al
 * juego sin pasar por el título (`#/playtest`, `?boss=`, `?room=`): la pantalla de
 * título absorbe la carga gratis mientras el jugador la mira, pero esas dos
 * herramientas de dev no le dan tiempo. Deliberadamente austero — no es un
 * sistema de loading nuevo, solo evita montar `GameRoot` (y con él, vistas
 * que en fases futuras pedirán geometría del kit) antes de que esté listo.
 */
function KitLoadingScreen() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100dvh',
        background: 'var(--ui-bg)',
        color: 'var(--ui-text-dim)',
        fontFamily: 'var(--font-body)',
        fontSize: 17,
        letterSpacing: '0.02em',
      }}
    >
      Cargando…
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  // Pantalla de título: arranca ya "jugando" si `?boss=`/`?room=` fuerzan una
  // sala concreta (herramientas de dev, no debe interponerse el título).
  const [started, setStarted] = useState(hasDirectPlaytestParam);
  // Solo el flujo normal del título usa esta cortina: conserva el negro que
  // llena el plano de la puerta sobre el primer frame ya montado del juego y
  // lo retira con el fade-in pedido. Las rutas dev siguen entrando directas.
  const [entryCurtain, setEntryCurtain] = useState(false);
  const kitReady = useKitReady();

  const handleTitleEntryComplete = useCallback((): void => {
    setEntryCurtain(true);
    setStarted(true);
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Arma el desbloqueo de audio (encargo de audio, sfxEngine.ts): NO crea el
  // AudioContext todavía (los navegadores lo bloquean sin gesto), solo deja
  // listo el listener de "primer gesto" que lo hará. Idempotente, así que da
  // igual que este efecto se repita; se llama una vez y basta para toda la
  // vida de la pestaña, cubriendo también el editor (sus propios botones ya
  // llevan 'ui-click', ver ui/Button.tsx).
  useEffect(() => {
    initAudio(import.meta.env.BASE_URL);
  }, []);

  // Precarga del kit KayKit en cuanto la ruta actual va a necesitar el juego
  // (todas menos `#/editor`, que es un canvas 2D puro y no debe esperar ni
  // disparar la carga). `preloadKit()` es idempotente, así que da igual
  // repetir el efecto en cada cambio de ruta: la carga real solo ocurre una
  // vez. Si el jugador pasa por el título, sale gratis mientras lo mira;
  // `#/playtest`, `?boss=` y `?room=` la disparan igual aunque salten el título.
  useEffect(() => {
    if (route !== 'editor') void preloadKit();
  }, [route]);

  if (route === 'editor') {
    return <EditorPage />;
  }
  if (route === 'playtest') {
    const room = loadPlaytestRoom();
    // Sin sala válida que probar: vuelve al editor en vez de romper.
    if (!room) {
      window.location.hash = '#/editor';
      return null;
    }
    if (!kitReady) return <KitLoadingScreen />;
    // key: remonta el juego si se prueba otra sala distinta.
    return <GameRoot key={`playtest-${room.id}`} playtestRoom={room} />;
  }

  if (!started) {
    return <TitleScreen onPlay={handleTitleEntryComplete} />;
  }

  if (!kitReady) return <KitLoadingScreen />;

  const handleExitToTitle = () => {
    // Evita arrastrar HUD (hp/monedas/mejoras) de la run anterior al volver al
    // título: al pulsar "Jugar" de nuevo, GameRoot se remonta y crea sesión
    // nueva desde cero.
    useUiStore.getState().resetRun();
    setEntryCurtain(false);
    setStarted(false);
  };

  return (
    <>
      <GameRoot key="game" onExitToTitle={handleExitToTitle} />
      {entryCurtain ? (
        <div className="game-entry-curtain" onAnimationEnd={() => setEntryCurtain(false)} aria-hidden="true" />
      ) : null}
    </>
  );
}
