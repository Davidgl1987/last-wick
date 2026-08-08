/**
 * Rig de luz GLOBAL de la mazmorra: sustituye el par `ambientLight` +
 * `directionalLight` que antes vivía suelto en el JSX de GameRoot. Es la capa
 * de "luz de fondo" de la escena — la vela del héroe (CandleLightView) sigue
 * siendo la protagonista, esto solo evita que el resto de la sala caiga en
 * negro absoluto y aporta la ÚNICA sombra de toda la escena (antes había
 * ~12 shadow maps repartidos entre luces sueltas; ahora solo esta).
 *
 * hemisphereLight en vez de ambientLight — física, no solo estética:
 * three.js NO reparte la luz de un hemisphereLight de forma plana como un
 * ambient. Según `getHemisphereLightIrradiance` (three/src/.../
 * lights_pars_begin.glsl.js), cada superficie recibe
 * `mix(groundColor, skyColor, 0.5·dot(normal, up) + 0.5)` — es decir, una
 * superficie cuya normal mira hacia ARRIBA recibe el color "sky" al 100%, una
 * que mira hacia ABAJO recibe "ground" al 100%, y una vertical (pared) recibe
 * la mezcla al 50%. El suelo de RoomView es un plano con `rotation-x =
 * -Math.PI/2`, o sea con la normal apuntando a +Y (arriba) — así que es el
 * color "sky" (prop `color` del elemento), NO "groundColor", el que tiñe el
 * suelo. Por eso aquí `color` lleva el cálido de piedra/tierra y
 * `groundColor` conserva el azul frío que antes llevaba el ambientLight: es
 * el único reparto que consigue lo que pide el playtest ("que el suelo no
 * quede con el mismo tinte azul plano de siempre") en vez de, contra-
 * intuitivamente, pintar el suelo de azul por asumir que "groundColor" tiñe
 * lo que está más cerca del suelo.
 *
 * directionalLight con `castShadow`: única fuente de sombra de la escena.
 * Sigue al héroe (ver más abajo) porque su cámara ortográfica de sombra
 * (±12 u) no cubre ni de lejos una mazmorra entera.
 *
 * Seguimiento del héroe (evitar redibujar el shadow map cada frame): el
 * ancla de la luz solo se recalcula cuando el héroe se aleja más de
 * `ANCHOR_MOVE_THRESHOLD` de la última ancla, y al recalcularla se
 * CUADRICULA (snap) a múltiplos exactos del tamaño de texel del shadow map
 * (`SHADOW_TEXEL_SIZE`). Sin el snap, cada reancla desplazaría la rejilla de
 * muestreo de sombra una fracción arbitraria de texel respecto al frame
 * anterior, y el borde de la sombra "hierve" al moverse (shadow shimmering,
 * clásico en shadow maps ortográficos que seguen a un objetivo continuo).
 * Cuadriculando el ancla, la rejilla de texels cae siempre en las mismas
 * coordenadas de mundo — el desplazamiento entre reanclas es un número
 * entero de texels, invisible.
 *
 * Cero asignaciones por frame: el ancla vive en un `Vector3` de scratch
 * creado una sola vez (`useMemo`), mutado in-place — mismo patrón que
 * CameraRig.tsx.
 *
 * Fogonazo de tormenta (encargo playtest 2026-08-07, "un relámpago/trueno que
 * ilumine muy fuerte por la ventana, casi blanco, durante un instante"): cada
 * frame se lee `stormFlash(world.time)` (storm.ts, lógica pura y
 * determinista) y se sube un instante la intensidad/color del
 * `hemisphereLight` que YA existe arriba — SIN añadir ninguna luz, el
 * presupuesto cerrado de la escena (7 luces/1 sombra) no se toca. El mismo
 * `stormFlash` sobre el mismo `world.time` también muta en `RoomView.tsx` el
 * material compartido de las ventanas (`WindowStormFlash`): los dos quedan en
 * fase sin que ninguno de los dos ficheros conozca al otro, porque la función
 * es determinista. La intensidad/color SIEMPRE se recalculan desde la base
 * (`HEMI_INTENSITY`/`hemiSkyBase`/`hemiGroundBase`) en vez de acumularse, así
 * que "restaurar tras el fogonazo" no es un caso especial: en cuanto
 * `stormFlash` vuelve a 0, la luz vuelve a su valor base en ese mismo frame.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { GameSession } from '@/game/session/session';
import { stormFlash } from './storm';

/**
 * Color "sky" del hemisphereLight (ilumina las normales hacia ARRIBA, o sea
 * el suelo — ver razonamiento de física arriba): cálido apagado de
 * piedra/tierra, para que el suelo no repita el mismo azul frío del resto de
 * la sala.
 */
const HEMI_SKY_COLOR = new THREE.Color('#6e5c48');
/**
 * Color "ground" del hemisphereLight (ilumina las normales hacia ABAJO y se
 * mezcla al 50% en las verticales, o sea las paredes): el mismo azul frío
 * que llevaba el ambientLight anterior (#7c8fc9), reutilizado tal cual.
 */
const HEMI_GROUND_COLOR = new THREE.Color('#7c8fc9');
/**
 * Intensidad del hemisphereLight — PUNTO DE TUNING, pero razonado: un
 * ambientLight reparte `intensity × color` por igual en cualquier superficie;
 * el hemisphere reparte según normal (ver arriba), así que no hay un único
 * "intensity" comparable. Calibrado contra el suelo, que domina la pantalla
 * en esta cámara semi-cenital y recibe el color "sky" al 100% (peso 1):
 * usando el peso perceptual aproximado de luminancia sRGB (0.2126/0.7152/
 * 0.0722), el ambientLight anterior aportaba sobre cualquier superficie
 * ≈ 0.22 × luminancia(#7c8fc9 ≈ 0.56) ≈ 0.123. Para que el suelo (100% color
 * cálido, luminancia(#6e5c48) ≈ 0.36) reciba ese mismo nivel:
 * intensity ≈ 0.123 / 0.36 ≈ 0.34. Sobre las paredes (mezcla al 50%,
 * luminancia media ≈ 0.46) eso da ≈ 0.34 × 0.46 ≈ 0.16 — algo más vivas que
 * antes, lo cual está bien: rompe el plano uniforme que dejaba el ambient.
 */
const HEMI_INTENSITY = 0.34;

/** Color de la directional (sin cambios respecto al azul frío anterior). */
const DIRECTIONAL_COLOR = '#aab6e0';
/**
 * Intensidad de la directional — PUNTO DE TUNING explícito para el
 * orquestador (ajustar mirando capturas reales). Antes era 0.15: demasiado
 * tenue para que se leyera ninguna sombra (una sombra solo se percibe por el
 * CONTRASTE entre zona iluminada y zona en sombra, y con el hemisphere de
 * fondo en ~0.34 de intensidad, 0.15 apenas se distinguía de él). Subida a
 * un múltiplo claro del fill de fondo para que los volúmenes proyecten una
 * sombra legible sin que la sala deje de sentirse "a la luz de una vela"
 * (la vela sigue siendo, con diferencia, la luz más intensa de la escena:
 * CANDLE_BASE_INTENSITY = 45 en CandleLightView, aunque decae con la
 * distancia — esta directional es luz de relleno plana, no compite en pico).
 */
const DIRECTIONAL_INTENSITY = 0.9;
/** Offset fijo (u de mundo) de la luz respecto al ancla sobre el héroe: misma dirección que el directionalLight anterior. */
const DIRECTIONAL_OFFSET = new THREE.Vector3(4, 8, 3);

/** Semi-tamaño (u de mundo) de la cámara ortográfica de sombra: cubre el entorno inmediato del héroe, no la mazmorra entera. */
const SHADOW_ORTHO_HALF_SIZE = 12;
/** Resolución del shadow map — única sombra de la escena, se lo puede permitir. */
const SHADOW_MAP_SIZE = 1024;
/** Tamaño de mundo (u) de un texel del shadow map: usado para cuadricular el ancla y evitar shimmering (ver cabecera). */
const SHADOW_TEXEL_SIZE = (SHADOW_ORTHO_HALF_SIZE * 2) / SHADOW_MAP_SIZE;
const SHADOW_CAMERA_NEAR = 1;
/** Far generoso: distancia luz→ancla (~9.4, con offset [4,8,3]) + el semi-tamaño de la caja ortográfica, con margen. */
const SHADOW_CAMERA_FAR = 30;
/**
 * `shadow-normalBias` en vez de `shadow-bias` plano: los materiales de la
 * escena son MeshLambertMaterial y hay geometría fina (agujas de pinchos,
 * heroSpikeMaterial/spikeConeMaterial en assets.ts) donde un bias a lo largo
 * de la dirección de la luz suele o bien dejar acné (bias pequeño) o
 * despegar la sombra de la base del objeto — "peter-panning" (bias grande).
 * `normalBias` desplaza el punto de muestreo a lo largo de la NORMAL de la
 * superficie en vez de la dirección de la luz, así que escala con lo
 * inclinada que esté la superficie respecto a la luz en vez de con un offset
 * fijo — funciona mucho mejor en geometría fina y esquinas que el bias plano.
 */
const SHADOW_NORMAL_BIAS = 0.05;

/** Distancia (al cuadrado, u de mundo) que debe recorrer el héroe desde la última ancla antes de reanclar la luz/sombra. */
const ANCHOR_MOVE_THRESHOLD_SQ = 1 * 1;

/**
 * Boost de intensidad del `hemisphereLight` en el PICO del fogonazo de
 * tormenta (`stormFlash === 1`) — se SUMA a `HEMI_INTENSITY`, nunca la
 * sustituye, así que fuera del fogonazo la sala nunca cae por debajo de su
 * relleno normal. ×6 sobre la base (0.34 → 2.38 en el pico): lo bastante
 * fuerte para sentirse en TODA la sala, no solo en el rectángulo de la
 * ventana (que es justo lo que pide el encargo — "que se sienta en toda la
 * sala"), apoyado en que el bloom del postproceso (PostEffects.tsx) hace
 * florecer ese pico en vez de tener que perseguir el valor final a ojo.
 */
const HEMI_STORM_INTENSITY_BOOST = HEMI_INTENSITY * 6;
/** Cuánto se tira el color del hemisphere hacia blanco en el pico (0 = nada, 1 = blanco puro): moderado para aclarar sin borrar del todo el tinte cálido/frío del rig. */
const HEMI_STORM_COLOR_MIX = 0.75;
const HEMI_STORM_WHITE = new THREE.Color('#ffffff');

export function SceneLights({ session }: { session: GameSession }) {
  const directionalRef = useRef<THREE.DirectionalLight>(null);
  const hemisphereRef = useRef<THREE.HemisphereLight>(null);
  // Copias de scratch de los colores base del hemisphere (creadas UNA vez):
  // el fogonazo muta `hemisphereRef.current.color/.groundColor` in-place cada
  // frame partiendo siempre de estas bases, nunca de sí mismas — mutar a
  // partir del valor YA mutado del frame anterior iría desplazando el color
  // hacia blanco sin vuelta atrás.
  const hemiSkyBase = useMemo(() => HEMI_SKY_COLOR.clone(), []);
  const hemiGroundBase = useMemo(() => HEMI_GROUND_COLOR.clone(), []);
  // Ancla de la sombra (última posición de héroe, ya cuadriculada a texels,
  // sobre la que se centró la luz direccional). Vector de scratch creado una
  // sola vez y mutado in-place — nunca se reasigna dentro de useFrame.
  // Arranca en NaN para forzar el anclaje inicial en el primer frame (una
  // distancia NaN nunca es > ANCHOR_MOVE_THRESHOLD_SQ, así que sin este truco
  // el primer frame se saltaría el anclaje y la luz se quedaría en el origen).
  const anchor = useMemo(() => new THREE.Vector3(NaN, 0, NaN), []);

  useFrame(() => {
    const world = session.world;

    // Fogonazo de tormenta (ver cabecera del fichero): independiente del
    // resto de este useFrame (no depende de `directionalRef`), así que se
    // resuelve antes del `if (!light) return;` de más abajo y corre en TODOS
    // los frames en los que el hemisphere ya esté montado.
    const hemi = hemisphereRef.current;
    if (hemi) {
      const factor = stormFlash(world.time);
      hemi.intensity = HEMI_INTENSITY + HEMI_STORM_INTENSITY_BOOST * factor;
      hemi.color.copy(hemiSkyBase).lerp(HEMI_STORM_WHITE, factor * HEMI_STORM_COLOR_MIX);
      hemi.groundColor.copy(hemiGroundBase).lerp(HEMI_STORM_WHITE, factor * HEMI_STORM_COLOR_MIX);
    }

    const light = directionalRef.current;
    if (!light) return;

    const hero = world.hero;
    const alpha = session.renderAlpha;
    // Mismo patrón de interpolación que CandleLightView/CameraRig: posición
    // renderizada del héroe entre el tick de sim anterior y el actual.
    const heroX = session.heroPrevX + (hero.position.x - session.heroPrevX) * alpha;
    const heroZ = session.heroPrevY + (hero.position.y - session.heroPrevY) * alpha;

    const dx = heroX - anchor.x;
    const dz = heroZ - anchor.z;
    if (Number.isNaN(anchor.x) || dx * dx + dz * dz > ANCHOR_MOVE_THRESHOLD_SQ) {
      // Cuadriculado (snap) al tamaño de texel del shadow map (ver cabecera
      // del fichero): redondear a múltiplos exactos de SHADOW_TEXEL_SIZE
      // asegura que la rejilla de muestreo de sombra caiga siempre en las
      // mismas coordenadas de mundo, así el salto entre reanclas es un
      // número entero de texels en vez de una fracción arbitraria.
      anchor.x = Math.round(heroX / SHADOW_TEXEL_SIZE) * SHADOW_TEXEL_SIZE;
      anchor.z = Math.round(heroZ / SHADOW_TEXEL_SIZE) * SHADOW_TEXEL_SIZE;

      light.position.set(anchor.x + DIRECTIONAL_OFFSET.x, DIRECTIONAL_OFFSET.y, anchor.z + DIRECTIONAL_OFFSET.z);
      light.target.position.set(anchor.x, 0, anchor.z);
      // three.js no refresca solo la matriz mundial del target: al no estar
      // añadido al grafo de la escena, el recorrido normal de render nunca lo
      // visita. Sin esta llamada la sombra seguiría apuntando al ancla vieja.
      light.target.updateMatrixWorld();
    }
  });

  return (
    <>
      {/* Luz de relleno general: reemplaza al ambientLight, ver razonamiento
          de física (sky/ground según normal) en la cabecera del fichero.
          `ref`: el useFrame de arriba sube su intensidad/color un instante
          durante el fogonazo de tormenta (misma luz de siempre, nunca una
          nueva). */}
      <hemisphereLight ref={hemisphereRef} color={HEMI_SKY_COLOR} groundColor={HEMI_GROUND_COLOR} intensity={HEMI_INTENSITY} />
      {/* Única sombra de la escena. La posición/target inicial (origen) la
          corrige el primer useFrame (arranca en NaN, ver comentario de
          `anchor` arriba) — no hace falta declarar un position aquí. */}
      <directionalLight
        ref={directionalRef}
        color={DIRECTIONAL_COLOR}
        intensity={DIRECTIONAL_INTENSITY}
        castShadow
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        shadow-camera-left={-SHADOW_ORTHO_HALF_SIZE}
        shadow-camera-right={SHADOW_ORTHO_HALF_SIZE}
        shadow-camera-top={SHADOW_ORTHO_HALF_SIZE}
        shadow-camera-bottom={-SHADOW_ORTHO_HALF_SIZE}
        shadow-camera-near={SHADOW_CAMERA_NEAR}
        shadow-camera-far={SHADOW_CAMERA_FAR}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
      />
    </>
  );
}
