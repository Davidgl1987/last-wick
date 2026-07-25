/**
 * Luz de vela del héroe: el héroe ES la fuente de luz principal de la sala.
 * Este componente mueve una `pointLight` siguiendo su posición interpolada
 * cada frame (useFrame, SIN setState de React — mismo patrón que
 * CameraRig/HeroView: la sim nunca sabe que esta luz existe).
 *
 * Color: cálido de vela base mezclado con el color del arma activa
 * (`WEAPON_COLOR`, mismo mapeo que `heroMaterial`/`aimDotMaterial` en
 * HeroView), con lerp suave al cambiar de arma — mismo criterio de
 * `WEAPON_COLOR_LERP_STIFFNESS` que usa HeroView, para que el tinte de la luz
 * nunca dé un salto brusco a la vez que el cuerpo del héroe cambia de color.
 *
 * Parpadeo: pequeña variación de intensidad/alcance con una suma de senos a
 * frecuencias inconmensuradas (barato, sin asignaciones — mismo patrón que el
 * shake de trauma de CameraRig), pensada para ser sutil y nunca
 * estroboscópica.
 *
 * Nota de tuning: las herramientas de preview/browser estaban prohibidas para
 * esta tarea, así que los valores de intensidad/distancia de abajo son un
 * punto de partida razonado (no verificado visualmente en el juego real) —
 * revísalos en un playtest real y ajusta `CANDLE_BASE_INTENSITY`/
 * `CANDLE_BASE_DISTANCE` si el círculo iluminado queda muy tímido o exagerado.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Color, type PointLight } from 'three';
import type { GameSession } from '@/game/session/session';
import { WEAPON_COLOR } from '@/game/render/assets';

/** Tono cálido base de la vela (blanco-naranja de llama), antes de mezclar con el color del arma activa. */
const CANDLE_WARM_COLOR = new Color('#ffb469');
/** Fracción del color del arma mezclada sobre el cálido base (0 = solo vela, 1 = solo arma). */
const WEAPON_TINT_FRACTION = 0.4;
/** Rigidez del lerp de color al cambiar de arma (mismo orden que HeroView: suave, nunca un corte). */
const CANDLE_COLOR_LERP_STIFFNESS = 10;

/**
 * Altura de la luz sobre el suelo: POR DEBAJO del alto de los muros
 * (WALL_HEIGHT = 0.9 en RoomView) — a 1.7 la luz les pasaba por encima e
 * iluminaba la sala contigua (punto 1 de playtest ronda 2 del modo oscuro).
 */
const CANDLE_HEIGHT = 0.75;
/** Alcance base (u de mundo) del círculo iluminado alrededor del héroe: generoso frente al radio de sala (~12-20). */
const CANDLE_BASE_DISTANCE = 8.5;
const CANDLE_BASE_INTENSITY = 45;
const CANDLE_DECAY = 2;

/** Parpadeo: frecuencias (rad/s) inconmensuradas entre sí y su peso relativo (suman 1 → variación acotada). */
const FLICKER_FREQ_A = 5.3;
const FLICKER_FREQ_B = 11.7;
const FLICKER_FREQ_C = 2.1;
const FLICKER_WEIGHT_A = 0.5;
const FLICKER_WEIGHT_B = 0.3;
const FLICKER_WEIGHT_C = 0.2;
/** Amplitud del parpadeo como fracción de la intensidad/distancia base (sutil, nunca estroboscópico). */
const FLICKER_AMPLITUDE = 0.12;
/** El parpadeo de distancia se atenúa respecto al de intensidad (el alcance no debe "respirar" tanto como el brillo). */
const FLICKER_DISTANCE_FRACTION = 0.5;

export function CandleLightView({ session }: { session: GameSession }) {
  const lightRef = useRef<PointLight>(null);
  const currentColor = useRef(CANDLE_WARM_COLOR.clone());
  const targetColorScratch = useRef(new Color());

  useFrame((state, delta) => {
    const light = lightRef.current;
    if (!light) return;

    const world = session.world;
    const hero = world.hero;
    const alpha = session.renderAlpha;
    const x = session.heroPrevX + (hero.position.x - session.heroPrevX) * alpha;
    const z = session.heroPrevY + (hero.position.y - session.heroPrevY) * alpha;
    light.position.set(x, CANDLE_HEIGHT, z);

    // Color objetivo: cálido base + tinte del arma activa, lerp suave (mismo criterio que heroMaterial en HeroView).
    targetColorScratch.current.copy(CANDLE_WARM_COLOR).lerp(WEAPON_COLOR[hero.weaponMode], WEAPON_TINT_FRACTION);
    const colorK = 1 - Math.exp(-CANDLE_COLOR_LERP_STIFFNESS * delta);
    currentColor.current.lerp(targetColorScratch.current, colorK);
    light.color.copy(currentColor.current);

    // Parpadeo sutil: suma de senos a frecuencias inconmensuradas sobre el reloj de render
    // (no el tiempo de sim: el parpadeo es puramente cosmético, no debe congelarse en hit-stop).
    const t = state.clock.elapsedTime;
    const flickerOffset =
      FLICKER_WEIGHT_A * Math.sin(t * FLICKER_FREQ_A) +
      FLICKER_WEIGHT_B * Math.sin(t * FLICKER_FREQ_B) +
      FLICKER_WEIGHT_C * Math.sin(t * FLICKER_FREQ_C);
    light.intensity = CANDLE_BASE_INTENSITY * (1 + FLICKER_AMPLITUDE * flickerOffset);
    light.distance = CANDLE_BASE_DISTANCE * (1 + FLICKER_AMPLITUDE * FLICKER_DISTANCE_FRACTION * flickerOffset);
  });

  return (
    <pointLight
      ref={lightRef}
      decay={CANDLE_DECAY}
      distance={CANDLE_BASE_DISTANCE}
      intensity={CANDLE_BASE_INTENSITY}
      color={CANDLE_WARM_COLOR}
      // Sombra (punto 1 de playtest: "la luz de la vela no debe atravesar
      // paredes"): única luz con sombra de toda la escena junto a la
      // linterna de enemigo (cúbica, al ser pointLight — 6 caras), asumible
      // en forward rendering. near/far del cubo de sombra acordes al alcance
      // real de la luz (CANDLE_BASE_DISTANCE ≈ 8.5, con margen por el
      // parpadeo que lo estira hasta ~9.5).
      castShadow
      // 512 (antes 1024, playtest ronda 6: 23 FPS): la sombra de una
      // pointLight es CÚBICA — 6 pasadas de render por frame — y a 1024² son
      // 6 M de texels/frame solo de sombra. A 512² cuesta ¼ y el borde
      // ligeramente más blando hasta favorece el look de vela.
      shadow-mapSize={[512, 512]}
      shadow-camera-near={0.3}
      shadow-camera-far={10}
    />
  );
}
