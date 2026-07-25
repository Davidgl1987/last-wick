/**
 * Rig de "luz propia" de enemigo (rama `luces-optimizadas`, recorte de la
 * escena de ~43 a 7 luces reales). Hasta esta pasada, cada enemigo no-jefe
 * montaba una `spotLight` con sombra (la "linterna de ojos", orientada hacia
 * donde mira el enemigo, calculada por la extinta `applyLanternAim`) más una
 * `pointLight` de relleno muy tenue. El problema no era su coste individual:
 * `EnemyViews` monta este rig por CADA enemigo del array `world.enemies`, que
 * contiene TODA la mazmorra generada, no solo los enemigos de la sala visible
 * — en una mazmorra típica (~11 enemigos) eso son ~22 luces reales y ~11
 * shadow maps vivos a la vez, muy por encima del presupuesto de 7 luces de
 * toda la escena. Ahora los no-jefe NO montan ninguna luz real: en su lugar,
 * `EnemyLightsRig` planta un `GlowPuddle` (src/game/render/GlowPuddle.tsx) —
 * un disco aditivo pegado al suelo, mismo color que sus ojos emissive
 * (`ENEMY_LIGHT_COLOR[kind]`), coste ~0 frente a una `pointLight`/`spotLight`
 * de verdad — que basta para leer "aquí hay algo que emite luz débil" sin
 * gastar presupuesto de luz real. Los ojos emissive (`MeshBasicMaterial` en
 * cada `<kind>/Mesh.tsx`) siguen siendo los que de verdad delatan al enemigo
 * en la oscuridad: no dependen de luz y no se han tocado.
 *
 * El JEFE es la excepción: conserva su `pointLight` de siempre
 * (`ENEMY_LIGHT_*_BOSS`) tal cual, sin sombra — es el foco de luz de su
 * propia sala (una sala entera para él solo, con las velas de
 * `BossCandlesView` completando el resto), y al ser un único enemigo por
 * partida no pesa como el resto del array.
 *
 * El `useFrame` de `EnemyMesh` (EnemyViews.tsx) sigue siendo el único que
 * muta los refs de este rig — este módulo solo aporta las constantes y el
 * componente de JSX `EnemyLightsRig`.
 */

import type { RefObject } from 'react';
import type { Group, Mesh, PointLight } from 'three';
import type { EnemyKind } from '@/game/world/types';
import { GlowPuddle } from '@/game/render/GlowPuddle';

export const ENEMY_LIGHT_COLOR: Record<EnemyKind, string> = {
  dummy: '#ffc169',
  chaser: '#b18cff',
  spike: '#ffb36b',
  trail: '#c9bce8',
  shooter: '#7cc7ff',
  boss: '#e0b56a',
};
/** Jefe (punto 2a de playtest: "que el propio jefe emita [más] luz"): antes 4/3.5, ahora bastante más luminoso — las velas de sala (BossCandlesView) completan el resto. */
export const ENEMY_LIGHT_INTENSITY_BOSS = 14;
/**
 * Distancia acotada 6→5 (playtest de David, luces que atraviesan paredes):
 * la pointLight propia del jefe se queda SIN sombra a propósito (su arena es
 * una sala entera para él solo — si sangra levemente a la sala vecina apenas
 * se nota, y una sombra cúbica ×6 pasadas por jefe sí sería cara). Bajar el
 * alcance es el ajuste barato que sí reduce cuánto se cuela por los muros
 * sin pagar el coste de sombra.
 */
export const ENEMY_LIGHT_DISTANCE_BOSS = 5;
/**
 * La luz del jefe vive POR ENCIMA de su cuerpo (radio de render de jefe ~1),
 * no dentro: a la altura genérica (0.5, la que usaba el antiguo relleno
 * no-jefe) quedaba embebida en la esfera y ni el propio cuerpo ni el suelo
 * alrededor recibían luz apreciable (verificado en arena ?boss=b1) — el
 * Lambert solo ilumina caras orientadas HACIA la luz.
 */
export const ENEMY_LIGHT_HEIGHT_BOSS = 1.7;
export const ENEMY_LIGHT_DECAY = 2;

/** Radio de render fijo de un enemigo no-jefe (mismo valor que `ENEMY_RADIUS_RENDER` en `EnemyViews.tsx`; duplicado aquí solo para calcular el radio del charco por debajo). */
const ENEMY_RADIUS_RENDER = 0.4;
/**
 * Radio del charco de luz falso de un enemigo no-jefe: desborda bastante
 * `ENEMY_RADIUS_RENDER` para leerse como derrame de luz alrededor del cuerpo,
 * no como una peana ajustada a los pies (punto de tuning).
 */
export const ENEMY_GLOW_PUDDLE_RADIUS = ENEMY_RADIUS_RENDER * 2.5;
/** Opacidad del charco, tenue como el resto de halos aditivos del juego (proyectiles, ver `assets.ts`) — punto de tuning. */
export const ENEMY_GLOW_PUDDLE_OPACITY = 0.16;

/**
 * Rig de "luz propia" de un enemigo, montado como HERMANO de `groupRef` (el
 * group del cuerpo, que flota a `bodyRadius` del suelo y rota con la
 * orientación) — nunca dentro: tanto la pointLight del jefe como el
 * `GlowPuddle` no-jefe necesitan una posición de mundo que el `useFrame` de
 * `EnemyViews.tsx` calcula y mirrorea aparte cada frame (mismo problema que
 * ya resolvía este patrón antes de este recorte: cambiar el Nº de luces
 * VISIBLES en la escena recompila todos los shaders de three.js, así que las
 * luces reales viven en un group que nunca se desmonta ni se oculta por
 * `visible=false`, apagándose con `intensity=0` en su lugar).
 *
 * - Jefe: `bossLightGroupRef` mirrorea la posición COMPLETA de `group`
 *   (incluida la altura, `bodyRadius` sobre el suelo) — la pointLight añade
 *   `ENEMY_LIGHT_HEIGHT_BOSS` local por encima de eso. Sin sombra (ver
 *   comentario de `ENEMY_LIGHT_DISTANCE_BOSS`).
 * - No-jefe: `puddleGroupRef` mirrorea solo X/Z de `group` y fija la altura
 *   al SUELO (nunca la altura flotante del cuerpo) — el charco tiene que
 *   quedarse pegado al suelo pase lo que pase con el bamboleo/radio del
 *   enemigo. El `GlowPuddle` en su interior no necesita más ajuste: su
 *   propia posición por defecto ya vive a `GLOW_PUDDLE_GROUND_Y` sobre el
 *   origen de su padre. Se apaga con `puddleMeshRef.current.visible=false`
 *   al morir el enemigo (una malla no es una luz real: no hay recompilación
 *   de shaders que evitar aquí, a diferencia de la pointLight del jefe).
 */
export function EnemyLightsRig({
  kind,
  bossLightGroupRef,
  bossLightRef,
  puddleGroupRef,
  puddleMeshRef,
}: {
  kind: EnemyKind;
  bossLightGroupRef: RefObject<Group | null>;
  bossLightRef: RefObject<PointLight | null>;
  puddleGroupRef: RefObject<Group | null>;
  puddleMeshRef: RefObject<Mesh | null>;
}) {
  if (kind === 'boss') {
    return (
      <group ref={bossLightGroupRef}>
        <pointLight
          ref={bossLightRef}
          color={ENEMY_LIGHT_COLOR.boss}
          intensity={ENEMY_LIGHT_INTENSITY_BOSS}
          distance={ENEMY_LIGHT_DISTANCE_BOSS}
          decay={ENEMY_LIGHT_DECAY}
          position={[0, ENEMY_LIGHT_HEIGHT_BOSS, 0]}
        />
      </group>
    );
  }
  return (
    <group ref={puddleGroupRef}>
      <GlowPuddle
        meshRef={puddleMeshRef}
        color={ENEMY_LIGHT_COLOR[kind]}
        radius={ENEMY_GLOW_PUDDLE_RADIUS}
        opacity={ENEMY_GLOW_PUDDLE_OPACITY}
      />
    </group>
  );
}
