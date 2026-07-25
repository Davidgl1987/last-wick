/**
 * Rig de luces MÓVILES de enemigo (rama `estilo-oscuro`; extraído de
 * `EnemyViews.tsx` en la pasada pre-release: constantes + JSX + cálculo de
 * puntería de la linterna, todo lo que compone "el enemigo emite su propia
 * luz débil"). El `useFrame` de `EnemyMesh` sigue siendo el único que muta
 * estos refs (mismo orden exacto que antes de la extracción, para no alterar
 * el resultado frame a frame) — este módulo solo aporta las constantes, la
 * función pura `applyLanternAim` y el componente de JSX `EnemyLightsRig`.
 *
 * Punto 1 de playtest ronda 2 de penumbra: "que lo que dé la luz fueran los
 * ojos, como linternas muy débiles, ahora es como si tuvieran una bombilla"
 * — sustituye la pointLight omnidireccional original por una `spotLight`
 * débil que sale de los ojos, orientada hacia donde MIRA el enemigo, + una
 * pointLight MUY tenue para que el cuerpo no quede negro del todo. Mismo
 * color que los ojos/acentos emisivos ya existentes de cada arquetipo
 * (assets-dark.ts), para que la luz se lea como "el brillo de sus ojos
 * alcanza el entorno", no como un añadido aparte. `boss` conserva su
 * pointLight de siempre (sin linterna: punto 2 de playtest le da más luz
 * propia) y usa un ámbar genérico (no distingue por bossId: los acentos de
 * cada jefe ya tienen su propio idioma visual, esta luz solo necesita
 * delatar "algo grande se mueve ahí").
 */

import type { RefObject } from 'react';
import type { Group, Object3D, PointLight, SpotLight } from 'three';
import type { Enemy, EnemyKind } from '@/game/world/types';

export const ENEMY_LIGHT_COLOR: Record<EnemyKind, string> = {
  dummy: '#ffc169',
  chaser: '#b18cff',
  spike: '#ffb36b',
  trail: '#c9bce8',
  shooter: '#7cc7ff',
  boss: '#e0b56a',
};
/** Altura LOCAL de la luz del jefe/relleno sobre el centro del cuerpo del enemigo (el `group` ya vive a `bodyRadius` del suelo). */
export const ENEMY_LIGHT_HEIGHT = 0.5;
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
 * no dentro: a la altura genérica (0.5) quedaba embebida en la esfera y ni el
 * propio cuerpo ni el suelo alrededor recibían luz apreciable (verificado en
 * arena ?boss=b1) — el Lambert solo ilumina caras orientadas HACIA la luz.
 */
export const ENEMY_LIGHT_HEIGHT_BOSS = 1.7;
export const ENEMY_LIGHT_DECAY = 2;

/**
 * Linterna de ojos (spotLight, no-boss): altura LOCAL a la que viven los ojos
 * de cada arquetipo (0.3-0.4, bastante más abajo que la vieja "bombilla" a
 * 0.5). Parámetros de linterna DÉBIL (los spots concentran, lucen menos que
 * una point a igual intensidad): alcance corto, cono estrecho, penumbra
 * suave. CON sombra desde playtest de David ("hay luces que parece que
 * traspasan las paredes"): mapa pequeño, ver `ENEMY_LANTERN_SHADOW_MAP_SIZE`
 * más abajo (antes SIN sombra — solo la vela del héroe bloqueaba luz).
 *
 * Punto 6 de playtest ronda 4 ("apuntan hacia donde miran, y un poco abajo
 * para que dejen el rastro de luz"): el punto-objetivo (target) de la
 * spotLight ya NO vive a la misma altura que la luz (eso apuntaba el cono en
 * horizontal, paralelo al suelo, sin proyectar ningún charco) — su altura
 * LOCAL se fija cada frame a `-group.position.y` (ver `applyLanternAim`),
 * que cancela exactamente la altura a la que `lightsGroupRef` (el padre, que
 * solo TRASLADA, mirroreando `group.position`) vive sobre el suelo, así el
 * target cae siempre en el PLANO DEL SUELO (y=0 de mundo) sea cual sea el
 * radio del enemigo. `ENEMY_LANTERN_TARGET_DISTANCE` (antes 1, alcance corto
 * para no degenerar la dirección) pasa a marcar cuánto por DELANTE cae ese
 * charco.
 */
export const ENEMY_LANTERN_HEIGHT = 0.35;
export const ENEMY_LANTERN_TARGET_DISTANCE = 1.3;
export const ENEMY_LANTERN_INTENSITY = 10;
export const ENEMY_LANTERN_DISTANCE = 4;
export const ENEMY_LANTERN_ANGLE = 0.55;
export const ENEMY_LANTERN_PENUMBRA = 0.7;
export const ENEMY_LANTERN_DECAY = 2;
/**
 * Sombra de la linterna (playtest de David: "no sé por qué hay luces que
 * parece que traspasan las paredes... la poción no debería verse" — la
 * iluminaba el cono de la linterna A TRAVÉS de un muro): mapa PEQUEÑO (una
 * spotLight es 1 sola pasada de sombra, no las 6 de una pointLight cúbica —
 * asumible por enemigo vivo). near/far ajustados al alcance corto real de la
 * linterna (`ENEMY_LANTERN_DISTANCE`=4, con margen).
 *
 * Trade-off de recompilación de shaders (mismo problema ya resuelto para el
 * RECUENTO de luces con `lightsGroupRef`, ver `EnemyViews.tsx`): three.js
 * recompila los shaders que dependen del Nº de luces CON SOMBRA cada vez que
 * ese número cambia. Al morir un enemigo se apaga `intensity=0` Y
 * `castShadow=false` A LA VEZ (useFrame de `EnemyViews.tsx`) — eso SÍ dispara
 * una recompilación (una única vez, en el frame de la muerte, aceptable). Lo
 * que NO se hace es dejar `castShadow=true` con intensidad 0: three.js
 * seguiría rellenando el shadow map de esa luz cada frame para un enemigo
 * muerto que no aporta nada, coste puro sin beneficio. Al (re)aparecer
 * enemigos con la sala (montaje), `castShadow` nace en `true` vía JSX.
 */
export const ENEMY_LANTERN_SHADOW_MAP_SIZE = 256;
export const ENEMY_LANTERN_SHADOW_NEAR = 0.1;
export const ENEMY_LANTERN_SHADOW_FAR = 4.5;
/** Relleno MUY tenue (mismo color que la linterna) para que el cuerpo no quede negro del todo fuera del cono. */
export const ENEMY_FILL_LIGHT_INTENSITY = 0.8;
export const ENEMY_FILL_LIGHT_DISTANCE = 1.5;

/** Radio de render fijo de un enemigo no-jefe (mismo valor que `ENEMY_RADIUS_RENDER` en `EnemyViews.tsx`; duplicado aquí solo para la posición local por defecto del target en el JSX, ver más abajo). */
const ENEMY_RADIUS_RENDER = 0.4;

/**
 * Linterna de ojos (punto 1 de playtest, solo no-boss): dirección LOCAL del
 * cono de luz según arquetipo — reutiliza la MISMA matemática que ya usa
 * cada `<kind>/Mesh.tsx` para orientar sus ojos, sin duplicar constantes:
 * dummy/trail no giran nada extra (el `group` ya apunta en la dirección de
 * patrulla/velocidad vía `orientationYaw`, así que el cono mira "hacia
 * delante" en local); spike usa su `facing` fijo (misma fórmula que
 * `spikeSecondaryGroupRef` en spike/Mesh.tsx); chaser y shooter apuntan al
 * héroe (misma fórmula que `chaserFaceRef`/`shooterEyeGroupRef` en sus
 * respectivos Mesh.tsx), conservando el último ángulo válido cuando la
 * distancia al héroe degenera a ~0.
 *
 * Llamar SOLO cuando `kind !== 'boss'`, en el mismo punto del `useFrame` de
 * `EnemyMesh` donde vivía este bloque antes de la extracción (después de
 * fijar `orientationYaw` y `group.position` de este frame): el ángulo de
 * mundo final depende de ambos.
 */
export function applyLanternAim(params: {
  kind: EnemyKind;
  enemy: Enemy;
  heroPosition: { x: number; y: number };
  group: Group;
  orientationYaw: number | null;
  lanternAngle: { current: number };
  lanternTargetRef: RefObject<Object3D | null>;
  lanternRef: RefObject<SpotLight | null>;
}): void {
  const { kind, enemy, heroPosition, group, orientationYaw, lanternAngle, lanternTargetRef, lanternRef } = params;
  // Ángulo de MUNDO directo: antes se restaba `group.rotation.y` para
  // cancelar la rotación del padre (la linterna vivía dentro de `group`, que
  // rota con la orientación del enemigo). Ahora vive en `lightsGroupRef`, que
  // solo TRASLADA (nunca rota) — su espacio local YA es el mundo, así que no
  // hace falta cancelar nada. Mismo ángulo de mundo final que antes en los 3
  // casos (spike/chaser-shooter usaban la resta para compensar exactamente
  // esa rotación; dummy/trail apuntaban "hacia delante" del cuerpo, que en
  // mundo es `orientationYaw`).
  if (kind === 'spike') {
    lanternAngle.current = Math.atan2(enemy.facing.x, enemy.facing.y);
  } else if (kind === 'chaser' || kind === 'shooter') {
    const dxHero = heroPosition.x - enemy.position.x;
    const dyHero = heroPosition.y - enemy.position.y;
    if (Math.hypot(dxHero, dyHero) > 1e-4) {
      lanternAngle.current = Math.atan2(dxHero, dyHero);
    }
  } else {
    lanternAngle.current = orientationYaw ?? 0;
  }
  if (lanternTargetRef.current) {
    // Altura LOCAL = -group.position.y: `lightsGroupRef` (el padre de este
    // target) mirrorea `group.position` cada frame (en `EnemyViews.tsx`,
    // `lightsGroupRef.current.position.copy(group.position)`), así que restar
    // esa misma altura aquí cancela el offset y deja el target en el plano
    // del suelo real (y=0 de mundo) — el cono apunta hacia abajo y por
    // delante en vez de en horizontal (punto 6 de playtest ronda 4).
    lanternTargetRef.current.position.set(
      Math.sin(lanternAngle.current) * ENEMY_LANTERN_TARGET_DISTANCE,
      -group.position.y,
      Math.cos(lanternAngle.current) * ENEMY_LANTERN_TARGET_DISTANCE,
    );
  }
  // El target de una spotLight es un Object3D aparte que three.js no añade
  // solo al padre correcto: se fija UNA vez que ambas refs existen
  // (comparación de identidad, barata) en vez de depender de props JSX.
  if (lanternRef.current && lanternTargetRef.current && lanternRef.current.target !== lanternTargetRef.current) {
    lanternRef.current.target = lanternTargetRef.current;
  }
}

/**
 * Group HERMANO de `groupRef` (nunca `groupRef.visible=false` lo apaga):
 * contiene solo las luces, mirroreando la POSICIÓN de `group` cada frame
 * (nunca su rotación — ver comentario de `applyLanternAim`). Cambiar el Nº
 * de luces VISIBLES en la escena recompila todos los shaders (three.js);
 * antes las luces vivían dentro de `groupRef` y se apagaban solas al morir
 * el enemigo (`group.visible=false`), lo que recompilaba en CADA muerte
 * durante una sala con varios enemigos. Con este group aparte, el Nº de
 * luces montadas para este enemigo es constante durante toda su vida en la
 * sala (el propio componente se desmonta/monta solo al cambiar de sala) — se
 * apagan con intensity=0 al morir, en vez de `visible=false` (ver useFrame
 * de `EnemyViews.tsx`).
 *
 * No-boss: linterna de ojos (spotLight débil, dirección calculada en
 * `applyLanternAim`, CON sombra de mapa pequeño) + relleno point MUY tenue
 * SIN sombra (alcance mínimo, no le da tiempo a cruzar un muro de forma
 * visible) para que el cuerpo no quede negro del todo. Boss: conserva su
 * pointLight de siempre, más luminosa (punto 2a) y SIN sombra (su arena es
 * una sala entera, ver ENEMY_LIGHT_DISTANCE_BOSS) — las velas de sala
 * (BossCandlesView) hacen el resto.
 *
 * La linterna de ojos es, junto a la vela del héroe, una de las DOS únicas
 * fuentes de shadow map de la escena — con hasta ~5 enemigos vivos a la vez
 * eso son ~5 shadow maps extra. `silhouettes`/`enemyLanternEnabled`/
 * `enemyFillLightEnabled`/`shadowsEnabled` llegan como props desde
 * `EnemyViews.tsx` (hoy siempre `true`: el antiguo perfil de calidad
 * adaptativo por GPU se retiró, ver debug-params.ts) — se mantienen
 * parametrizadas porque un trabajo posterior (recorte de luces reales de
 * enemigo) va a decidir su valor por otro criterio.
 */
export function EnemyLightsRig({
  kind,
  silhouettes,
  enemyLanternEnabled,
  enemyFillLightEnabled,
  shadowsEnabled,
  lightsGroupRef,
  lanternRef,
  lanternTargetRef,
  fillLightRef,
  bossLightRef,
}: {
  kind: EnemyKind;
  silhouettes: boolean;
  enemyLanternEnabled: boolean;
  enemyFillLightEnabled: boolean;
  shadowsEnabled: boolean;
  lightsGroupRef: RefObject<Group | null>;
  lanternRef: RefObject<SpotLight | null>;
  lanternTargetRef: RefObject<Object3D | null>;
  fillLightRef: RefObject<PointLight | null>;
  bossLightRef: RefObject<PointLight | null>;
}) {
  return (
    <group ref={lightsGroupRef}>
      {silhouettes && kind !== 'boss' && enemyLanternEnabled && (
        <>
          <spotLight
            ref={lanternRef}
            color={ENEMY_LIGHT_COLOR[kind]}
            intensity={ENEMY_LANTERN_INTENSITY}
            distance={ENEMY_LANTERN_DISTANCE}
            angle={ENEMY_LANTERN_ANGLE}
            penumbra={ENEMY_LANTERN_PENUMBRA}
            decay={ENEMY_LANTERN_DECAY}
            position={[0, ENEMY_LANTERN_HEIGHT, 0]}
            // Sombra (ver ENEMY_LANTERN_SHADOW_MAP_SIZE arriba): mapa de spot
            // pequeño, 1 sola pasada extra por enemigo vivo — el useFrame de
            // EnemyViews.tsx la apaga junto con la intensidad al morir, sin
            // superar nunca `shadowsEnabled` de vuelta a `true`.
            castShadow={shadowsEnabled}
            shadow-mapSize={[ENEMY_LANTERN_SHADOW_MAP_SIZE, ENEMY_LANTERN_SHADOW_MAP_SIZE]}
            shadow-camera-near={ENEMY_LANTERN_SHADOW_NEAR}
            shadow-camera-far={ENEMY_LANTERN_SHADOW_FAR}
          />
          <object3D ref={lanternTargetRef} position={[0, -ENEMY_RADIUS_RENDER, ENEMY_LANTERN_TARGET_DISTANCE]} />
        </>
      )}
      {silhouettes && kind !== 'boss' && enemyFillLightEnabled && (
        <pointLight
          ref={fillLightRef}
          color={ENEMY_LIGHT_COLOR[kind]}
          intensity={ENEMY_FILL_LIGHT_INTENSITY}
          distance={ENEMY_FILL_LIGHT_DISTANCE}
          decay={ENEMY_LIGHT_DECAY}
          position={[0, ENEMY_LIGHT_HEIGHT, 0]}
        />
      )}
      {silhouettes && kind === 'boss' && (
        <pointLight
          ref={bossLightRef}
          color={ENEMY_LIGHT_COLOR.boss}
          intensity={ENEMY_LIGHT_INTENSITY_BOSS}
          distance={ENEMY_LIGHT_DISTANCE_BOSS}
          decay={ENEMY_LIGHT_DECAY}
          position={[0, ENEMY_LIGHT_HEIGHT_BOSS, 0]}
        />
      )}
    </group>
  );
}
