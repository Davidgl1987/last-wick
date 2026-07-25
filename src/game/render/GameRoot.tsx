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
import { Preload } from '@react-three/drei';
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
import { TorchPropsView } from '@/game/features/dungeon/TorchPropsView';
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
import { TorchLightPool } from './TorchLightPool';
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
        dpr={[1, 2]}
        gl={{
          powerPreference: 'high-performance',
          antialias: true,
        }}
        camera={{ fov: 45, near: 0.5, far: 80, position: [0, 9.5, 11] }}
        // Sombras: rig de 7 luces con solo DOS que proyectan sombra — la
        // directional de SceneLights.tsx (ortográfica, sigue al héroe) y la
        // vela del héroe (CandleLightView, cúbica: no debe atravesar las
        // paredes, zanjado en playtest). Todo lo demás que brilla es emissive
        // o un charco aditivo, nunca una luz real.
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
        {/* Atrezzo de antorchas (jefe + tienda + tendero, ver TorchPropsView.tsx): geometría pura, sin luces reales propias — no-op fuera de la mazmorra (sin boss ni tendero). */}
        <TorchPropsView session={session} />
        {/* Pool FIJO de 3 spotLights reales reasignadas por cercanía al héroe entre TODAS las antorchas de la mazmorra (ver TorchLightPool.tsx): sustituye las hasta ~10 spotLight/pointLight permanentes que antes montaban BossCandlesView/ShopLightsView. */}
        <TorchLightPool session={session} />
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
        {/*
          Precompilación de shaders (diagnóstico: tirón de 55,8 ms al entrar
          en la sala de la tienda, con `renderer.info.programs.length` pasando
          de 9 a 11 en ESE mismo frame). three.js compila el programa de
          shader de un material la PRIMERA vez que uno de sus objetos pasa el
          frustum culling y se renderiza de verdad — no al montar el
          componente de React. Como toda la mazmorra se monta de golpe desde
          el arranque de la run (ver cabecera de RoomView.tsx: "renderiza
          TODAS las salas colocadas en el plano"), los materiales de salas que
          el héroe aún no ha visitado (antorchas del jefe, luz/geometría del
          tendero, etc.) quedan sin compilar hasta que la cámara los enfoca
          por primera vez — de ahí el tirón de golpe al cruzar la puerta.

          `<Preload all />` (drei) hace, en un único `useLayoutEffect` que
          corre UNA vez al montar este árbol: hace visible temporalmente todo
          el grafo de la escena, llama a `gl.compile(scene, camera)` (fuerza
          la compilación de TODOS los materiales presentes, los haya
          renderizado la cámara o no) y restaura la visibilidad original. Debe
          ir DESPUÉS de las vistas de arriba en el árbol de hijos del Canvas:
          necesita que el grafo ya exista para poder recorrerlo.

          Coste que acepta a cambio: la compilación completa se paga UNA vez,
          al arrancar la run (pequeño micro-tirón inicial, con la pantalla
          probablemente aún en transición/carga) en lugar de repartirse en
          tirones de decenas de ms cada vez que el héroe entra en una sala con
          materiales nuevos — que es precisamente lo que no molesta.
        */}
        <Preload all />
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
