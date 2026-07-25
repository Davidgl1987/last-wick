/**
 * Raíz del juego: Canvas R3F + HUD DOM superpuesto. Posee la sesión de juego
 * (objeto mutable fuera del estado de React).
 *
 * Modos:
 * - Run completa (por defecto): mazmorra procedural generada desde el pool de
 *   salas (src/game/features/dungeon/levels/*.json + salas exportadas del
 *   editor). La semilla es aleatoria por run (el parámetro `seed` de
 *   `createDungeonGameSession` sigue existiendo — lo usan los tests para
 *   determinismo — pero ya no se lee de la URL).
 * - Playtest (prop `playtestRoom`): una sola sala del editor, con botón para
 *   volver a él.
 *
 * Reinicio de run: `restartSession` recrea `session.world` (nueva referencia),
 * así que el árbol del canvas se remonta con una key de secuencia de run —
 * es un evento rarísimo (muerte/victoria), no un patrón de render por estado.
 */

import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useState } from 'react';
import type { Material, Object3D } from 'three';
import { getRoomPool } from '@/game/features/dungeon/rooms';
import { readForcedBossPhase, readForcedBossRoom, readGodMode } from './debug-params';
import { AimInput } from '@/game/features/hero/AimInput';
import { CandleLightView } from '@/game/features/hero/CandleLightView';
import { ParticleView } from '@/game/features/effects/ParticleView';
import { ShockwaveView } from '@/game/features/effects/ShockwaveView';
import { TrailView } from '@/game/features/effects/TrailView';
import { WaxView } from '@/game/features/effects/WaxView';
import { forceBossPhase } from '@/game/features/bosses/lifecycle';
import { QueenColumnsView, QueenTethersView } from '@/game/features/bosses/queen/QueenColumnsView';
import { BossCandlesView } from '@/game/features/dungeon/BossCandlesView';
import { ShopLightsView } from '@/game/features/dungeon/ShopLightsView';
import { EnemyViews } from '@/game/features/enemies/EnemyViews';
import {
  advanceToNextDungeon,
  createDungeonGameSession,
  createGameSession,
  restartSession,
  type GameSession,
} from '@/game/session/session';
import type { RoomData } from '@/game/world/types';
import { useUiStore } from '@/game/session/store';
import { BossRewardModal } from '@/game/ui/BossRewardModal';
import { DamageVignette } from '@/game/ui/DamageVignette';
import { FpsCounter } from '@/game/ui/FpsCounter';
import { GameOverModal } from '@/game/ui/GameOverModal';
import { HUD } from '@/game/ui/HUD';
import { NextDungeonModal } from '@/game/ui/NextDungeonModal';
import { PauseModal } from '@/game/ui/PauseModal';
import { ShopModal } from '@/game/ui/ShopModal';
import { VictoryModal } from '@/game/ui/VictoryModal';
import { AimIndicatorView } from '@/game/features/hero/AimIndicatorView';
import { CameraRig } from './CameraRig';
import './game-root.css';
import { BarrelViews, HazardViews } from '@/game/features/hazards/HazardView';
import { HeroView } from '@/game/features/hero/HeroView';
import { ItemViews } from '@/game/features/items/ItemView';
import { ProjectileViews } from '@/game/features/combat/ProjectileView';
import { PuddleViews } from '@/game/features/hazards/PuddleView';
import { RoomView } from './RoomView';
import { SceneLights } from './SceneLights';
import { useGameLoop } from './useGameLoop';

/** Componente-driver: registra el loop de sim ANTES que los lectores (orden de montaje). */
function SimDriver({ session }: { session: GameSession }) {
  useGameLoop(session);
  return null;
}

/**
 * Sincroniza `gl.shadowMap.enabled` con el renderer al montar: el prop
 * `shadows` del Canvas (más abajo) ya lo deja en `true`, pero se fuerza aquí
 * también para forzar `needsUpdate` en todos los materiales de la escena una
 * vez (activar el shadowMap exige que three.js compile los shaders de sombra
 * correctos desde el primer frame).
 *
 * Presupuesto de píxeles (playtest ronda 6: 23 FPS en ventana grande): cada
 * frame paga la escena + 6 caras de sombra cúbica de la vela — a dpr 2 en un
 * monitor grande eso hunde el framerate. Tope 1.5 (la nitidez extra de dpr 2
 * no se aprecia en penumbra).
 */
function RendererSync() {
  const { gl, scene, setDpr } = useThree();
  useEffect(() => {
    gl.shadowMap.enabled = true;
    setDpr(Math.min(window.devicePixelRatio, 1.5));
    scene.traverse((obj: Object3D) => {
      const material = (obj as unknown as { material?: Material | Material[] }).material;
      if (!material) return;
      if (Array.isArray(material)) {
        material.forEach((m) => {
          m.needsUpdate = true;
        });
      } else {
        material.needsUpdate = true;
      }
    });
  }, [gl, scene, setDpr]);
  return null;
}

export function GameRoot({
  playtestRoom = null,
  onExitToTitle,
}: {
  playtestRoom?: RoomData | null;
  onExitToTitle?: () => void;
}) {
  // useState con inicializador: la sesión se crea una sola vez y nunca causa re-render.
  const [session] = useState(() => {
    // Modo dios de playtest (?godmode, herramienta B5 de David 2026-07-15):
    // se lee UNA vez aquí y se aplica a los 3 modos por igual (run completa,
    // arena de jefe suelta vía ?boss, playtest de sala del editor).
    const godMode = readGodMode();
    let s: GameSession;
    if (playtestRoom) {
      s = createGameSession(playtestRoom, godMode);
    } else {
      const bossRoom = readForcedBossRoom();
      if (bossRoom) {
        s = createGameSession(bossRoom, godMode);
        const phase = readForcedBossPhase();
        if (phase) forceBossPhase(s.world, phase);
      } else {
        // `seed` (2º parámetro) ya no se lee de la URL (era `?seed=`, ver
        // debug-params.ts): la semilla es siempre aleatoria por run. El
        // parámetro en sí se queda en `createDungeonGameSession` — los tests
        // lo usan para determinismo.
        s = createDungeonGameSession(getRoomPool(), null, godMode);
      }
    }
    return s;
  });
  // Secuencia de run: cambia solo al reiniciar tras game-over/victoria (remonta el canvas).
  const [runSeq, setRunSeq] = useState(0);

  const handleRestart = useCallback(() => {
    restartSession(session);
    useUiStore.getState().resetRun();
    setRunSeq((n) => n + 1);
  }, [session]);

  // Run multi-mazmorra (GDD §10): jefe derrotado pero quedan más por delante
  // (fase 'dungeon-cleared'). A diferencia de handleRestart, NO se llama a
  // resetRun (hp/monedas/mejoras deben sobrevivir a la nueva mazmorra).
  const handleAdvanceDungeon = useCallback(() => {
    advanceToNextDungeon(session);
    setRunSeq((n) => n + 1);
  }, [session]);

  return (
    <div className="game-root">
      <Canvas
        key={runSeq}
        onCreated={(state) => {
          // Solo dev: expone la escena para el puente de verificación
          // (inspección de objetos huérfanos; complementa a __flingo).
          if (import.meta.env.DEV) {
            (window as unknown as { __flingoScene?: unknown }).__flingoScene = state.scene;
            // Estado R3F completo para verificación headless (?rafshim): en
            // páginas ocultas el ResizeObserver no dispara y el renderer se
            // queda en 300x150 — el driver externo llama a state.setSize().
            (window as unknown as { __flingoR3F?: unknown }).__flingoR3F = state;
          }
        }}
        dpr={[1, 2]}
        gl={{
          powerPreference: 'high-performance',
          antialias: true,
          // Solo dev+?rafshim: conserva el framebuffer tras presentar para que
          // la verificación headless pueda leer el frame con toDataURL (ver
          // shim de rAF en src/app/main.tsx). Coste de memoria irrelevante en dev.
          preserveDrawingBuffer:
            import.meta.env.DEV && new URLSearchParams(window.location.search).has('rafshim'),
        }}
        camera={{ fov: 45, near: 0.5, far: 80, position: [0, 9.5, 11] }}
        // Sombras: rig de luces rehecho a 7 luces / 1 sola sombra en toda la
        // escena (la directionalLight de SceneLights.tsx, que sigue al héroe
        // con cámara ortográfica). La vela del héroe (CandleLightView) ya NO
        // proyecta sombra por defecto (su sombra cúbica de pointLight era la
        // causa medida de los 23 FPS de la ronda 6) — solo lo hace tras
        // `?candleshadow`, flag TEMPORAL de comparación A/B, ver
        // debug-params.ts.
        shadows
      >
        <SimDriver session={session} />
        <RendererSync />
        {/* Rig de luz global (hemisphere + directional con sombra, ver
            SceneLights.tsx): la vela del héroe (CandleLightView) sigue siendo
            la fuente de luz protagonista de la sala, esto es el relleno de
            fondo + la única sombra de toda la escena. */}
        <SceneLights session={session} />
        <color attach="background" args={['#050508']} />
        {/* El fog arranca más allá de la distancia cámara→suelo (~15 u):
            solo funde los bordes lejanos de la sala, nunca el área de juego. */}
        <fog attach="fog" args={['#05050a', 20, 48]} />
        <RoomView world={session.world} />
        {/* Columnas de la Reina del Enjambre + sus cuerdas (GDD §15.3): no-op
            (return null) fuera de su sala, ver QueenColumnsView.tsx. */}
        <QueenColumnsView session={session} />
        <QueenTethersView session={session} />
        <HazardViews world={session.world} />
        <BarrelViews session={session} />
        <PuddleViews session={session} />
        <ItemViews session={session} />
        <EnemyViews session={session} />
        <ProjectileViews session={session} />
        <HeroView session={session} />
        {/* Vela del héroe: luz principal de la sala en penumbra. */}
        <CandleLightView session={session} />
        {/* Antorchas de la sala del jefe (punto 2b de playtest): no-op fuera de la mazmorra (sin boss vivo). */}
        <BossCandlesView session={session} />
        {/* Luz de la sala de tienda (playtest: "la tienda puede emitir luz"): no-op fuera de la mazmorra (sin tendero). */}
        <ShopLightsView session={session} />
        {/* Effects (GDD §12): partículas, estela y ondas expansivas, todos pools preasignados. */}
        <ParticleView pool={session.effects.particles} />
        <TrailView pool={session.effects.trail} />
        {/* Capa de cera persistente (playtest ronda 7): rastro de TODOS los
            movimientos del héroe/sus proyectiles, sin desvanecido — ver
            wax.ts. */}
        <WaxView pool={session.effects.wax} />
        <ShockwaveView pool={session.effects.shockwaves} />
        <AimIndicatorView session={session} />
        <CameraRig session={session} />
        <AimInput session={session} />
      </Canvas>
      <DamageVignette />
      <FpsCounter />
      <HUD session={session} />
      <a className="editor-link" href="#/editor">
        {playtestRoom ? '← Volver al editor' : '✎ Editor'}
      </a>
      <PauseModal session={session} onRestart={handleRestart} />
      <BossRewardModal session={session} />
      <NextDungeonModal session={session} onAdvance={handleAdvanceDungeon} />
      <ShopModal session={session} />
      <GameOverModal session={session} onRestart={handleRestart} onExitToTitle={onExitToTitle} />
      <VictoryModal session={session} onRestart={handleRestart} onExitToTitle={onExitToTitle} />
    </div>
  );
}
