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
 * Sombra (historial — YA NO por defecto): originalmente esta luz proyectaba
 * sombra (punto 1 de playtest: "la luz de la vela no debe atravesar
 * paredes"). El coste medido de esa decisión era real: al ser una pointLight,
 * la sombra es CÚBICA — 6 pasadas de render de la escena por frame, la causa
 * confirmada de los 23 FPS de la ronda 6 de playtest (ver GameRoot.tsx,
 * comentario de RendererSync). Con el rig de luces rehecho (7 luces / 1 sola
 * sombra en toda la escena, ver SceneLights.tsx) ya no podemos permitirnos
 * una segunda sombra solo para esto. Lo que compensa la ausencia de sombra:
 * (a) `CANDLE_BASE_DISTANCE` se recorta de 8.5 a 5.5 — con menos alcance la
 * luz ya no llega a colarse en la sala contigua a través de una pared, que
 * era el problema real que la sombra resolvía; (b) la `directionalLight` de
 * SceneLights.tsx sigue proyectando sombra sobre los volúmenes de la sala
 * (muros, rocas, pinchos), así que la escena no se queda sin sombra alguna.
 * `castShadow` sigue existiendo pero pasa a depender de `?candleshadow`
 * (ver debug-params.ts) — un flag TEMPORAL solo para poder comparar A/B
 * durante el playtest de esta ronda; bórralo (junto con el flag) en cuanto
 * el playtest zanje si merece la pena recuperarla.
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
import { readCandleShadow } from '@/game/render/debug-params';

// Flag TEMPORAL de comparación A/B (ver debug-params.ts): leído una sola vez
// al cargar el módulo, mismo momento que el `?rafshim` de main.tsx — no
// cambia a media partida, así que no hace falta releerlo por render/frame.
const CANDLE_SHADOW_ENABLED = readCandleShadow();

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
/**
 * Alcance base (u de mundo) del círculo iluminado alrededor del héroe.
 * Recortado de 8.5 a 5.5 (ver cabecera del fichero: ya no hay sombra que
 * detenga la luz en el muro, así que con el alcance de antes se colaba en la
 * sala contigua). Sigue siendo generoso para el radio de sala (~12-20).
 */
const CANDLE_BASE_DISTANCE = 5.5;
/**
 * Intensidad base — PUNTO DE TUNING, pero razonado: con `decay=2`, three.js
 * calcula la atenuación de una pointLight como
 * `(1/d²) × (1 − (d/distance)⁴)²` (ver `getDistanceAttenuation`,
 * three/src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js) — el
 * primer factor (1/d²) NO depende de `distance` (el corte de alcance), pero
 * el segundo factor de ventana SÍ, y se vuelve más agresivo cuanto más cerca
 * está `d` del nuevo corte, más estrecho. A una distancia de referencia
 * d=3 (bien dentro del charco, no en el borde) ese factor de ventana baja de
 * ≈0.969 con distance=8.5 a ≈0.831 con distance=5.5 — una caída de ~17% en
 * la zona que sigue siendo "cerca" del héroe. CANDLE_BASE_INTENSITY sube en
 * esa misma proporción (45 × 1.17 ≈ 53, redondeado a 55 con un pequeño
 * margen) para que el charco no se perciba más tímido cerca del héroe solo
 * por haber recortado el alcance lejano.
 */
const CANDLE_BASE_INTENSITY = 55;
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
      // Sombra DESACTIVADA por defecto (ver cabecera del fichero: coste de
      // sombra cúbica de pointLight, causa medida de los 23 FPS de la ronda
      // 6). `castShadow` solo se activa con `?candleshadow`/`?candleshadow=1`
      // (flag TEMPORAL de comparación A/B, debug-params.ts) — con el flag
      // activo se comporta EXACTAMENTE igual que antes (mismo mapa/near/far
      // de abajo, sin tocar), para que la comparación sea limpia.
      castShadow={CANDLE_SHADOW_ENABLED}
      // 512 (antes 1024, playtest ronda 6: 23 FPS): la sombra de una
      // pointLight es CÚBICA — 6 pasadas de render por frame — y a 1024² son
      // 6 M de texels/frame solo de sombra. A 512² cuesta ¼ y el borde
      // ligeramente más blando hasta favorece el look de vela. Sin efecto
      // mientras castShadow sea false (three.js no genera el shadow map).
      shadow-mapSize={[512, 512]}
      shadow-camera-near={0.3}
      shadow-camera-far={10}
    />
  );
}
