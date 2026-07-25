/**
 * Pool FIJO de spotLights reales para las antorchas de muro + la luz del
 * tendero (rama `luces-optimizadas`, recorte de la escena de ~43 luces a 7):
 * hasta esta pasada, `BossCandlesView`/`ShopLightsView` montaban una
 * `spotLight` real POR CADA antorcha de su sala (hasta 6+4 = 10 permanentes)
 * más la `pointLight` del tendero, TODAS vivas a la vez desde que arranca la
 * run — estuviera el héroe donde estuviera. Aquí se sustituyen por un pool de
 * `TORCH_LIGHT_POOL_SIZE` spotLights reales, montado UNA sola vez desde
 * `GameRoot`, que cada frame se reasignan a los emisores más cercanos al
 * héroe (`selectNearestInto`, `render/light-pool.ts`) de entre TODOS los
 * candidatos de la mazmorra (`collectTorchEmitters`,
 * `features/dungeon/torch-placements.ts`) — jefe, tienda y tendero
 * incluidos, sin distinguir sala: el héroe siempre lleva sus 3 antorchas más
 * cercanas encendidas de verdad, estén donde estén.
 *
 * INVARIANTE CRÍTICA — el recuento de luces MONTADAS no cambia nunca: three.js
 * recompila TODOS los programas de shader de la escena cada vez que cambia el
 * Nº de luces VISIBLES, y eso provoca un tirón de frame perceptible. Un slot
 * sin emisor asignado (menos de `TORCH_LIGHT_POOL_SIZE` candidatos en toda la
 * mazmorra, o el héroe lejos de cualquier antorcha) se apaga con
 * `intensity = 0`, JAMÁS con `visible={false}` ni desmontando — igual que ya
 * hace el resto del recorte de luces del repo (p.ej. `EnemyLightsRig`, luz de
 * jefe). Los `TORCH_LIGHT_POOL_SIZE` `spotLight`/`object3D` de target de este
 * componente existen SIEMPRE, del primer al último frame de la run.
 *
 * Qué mueve el pool cada frame (todo mutación in-place, cero asignaciones):
 * - Posición del héroe, interpolada igual que `CandleLightView`/`SceneLights`
 *   (`session.renderAlpha`, `session.heroPrevX/heroPrevY`) — el pool sigue al
 *   héroe con el mismo criterio de suavizado que el resto del render.
 * - `selectNearestInto` sobre la lista COMPLETA de emisores (calculada una
 *   sola vez al montar, `useMemo`: la mazmorra no cambia de layout durante la
 *   partida) escribe en `nearestScratch` los índices de los
 *   `TORCH_LIGHT_POOL_SIZE` emisores más cercanos — scratch reutilizado cada
 *   frame, nunca recreado.
 * - Cada slot copia de su emisor asignado posición, color, alcance y
 *   orientación del cono (el `target` de una spotLight es un Object3D aparte
 *   que hay que mover y cuyo `updateMatrixWorld()` hay que forzar — three.js
 *   no lo visita en el recorrido normal de la escena si no cuelga de ella;
 *   mismo patrón que ya resolvía `WallTorch`, `dungeon/TorchView.tsx`).
 * - Parpadeo: misma suma de 2 senos inconmensurados que `WallTorch`, pero
 *   desfasada por el ÍNDICE DEL EMISOR asignado (`idx`, la posición del
 *   emisor dentro de la lista de `collectTorchEmitters`), NO por el índice
 *   del slot (`k`, el nº de spotLight del pool) — así una antorcha concreta
 *   parpadea siempre con la misma fase aunque el pool la mueva de slot al
 *   cambiar de asignación; si se desfasara por slot, la MISMA antorcha
 *   cambiaría de ritmo de parpadeo cada vez que entra/sale del top-3, un
 *   glitch visual mucho más llamativo que el que este fichero existe para
 *   evitar.
 *
 * POP al reasignar — mitigación elegida: FUNDIDO CORTO de intensidad, no
 * histéresis. `selectNearestInto` es una función PURA sin memoria del frame
 * anterior (recalcula el top-3 desde cero cada llamada, ver cabecera de
 * `light-pool.ts`): implementar histéresis ahí exigiría comparar la
 * asignación vigente del pool contra el nuevo top-3 y decidir cuándo negarse
 * a robar un slot — más estado, más ramas, y acoplaría una función de datos
 * pura y ya testeada a la política de un consumidor concreto. El fundido, en
 * cambio, ataca el síntoma real: lo que se ve mal no es que el slot cambie de
 * emisor, es que la luz APAREZCA a plena intensidad en una posición nueva de
 * golpe. Por eso cada slot recuerda (en `lastAssigned`, scratch) qué emisor
 * llevaba el frame anterior; si cambia, `fadeElapsed` vuelve a 0 y la
 * intensidad crece linealmente desde 0 hasta la plena en
 * `TORCH_POOL_FADE_DURATION` segundos (mismo criterio de suavizado barato que
 * ya usa el repo, p.ej. el lerp de color de `CandleLightView`). El lado que
 * PIERDE el slot tampoco corta en seco: su antorcha conserva un `GlowPuddle`
 * fijo a sus pies (Tarea 2, `TorchView.tsx`) que no depende de este pool, así
 * que nunca se queda completamente a oscuras, solo pierde el derrame de luz
 * real sobre las paredes cercanas.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Object3D, SpotLight } from 'three';
import type { GameSession } from '@/game/session/session';
import { selectNearestInto } from '@/game/render/light-pool';
import {
  collectTorchEmitters,
  SHOPKEEPER_LIGHT_ANGLE,
  SHOPKEEPER_LIGHT_PENUMBRA,
  TORCH_LIGHT_ANGLE,
  TORCH_LIGHT_COLOR,
  TORCH_LIGHT_DECAY,
  TORCH_LIGHT_DISTANCE,
  TORCH_LIGHT_PENUMBRA,
  type TorchEmitter,
} from '@/game/features/dungeon/torch-placements';

/** Tamaño FIJO del pool — ver INVARIANTE CRÍTICA en la cabecera: nunca cambia mientras dure la run. */
const TORCH_LIGHT_POOL_SIZE = 3;

/** Distancia del punto-objetivo del cono hacia el interior de la sala (misma idea que `LIGHT_TARGET_DISTANCE` en `TorchView.tsx`, aquí en coordenadas de mundo directas — el pool no cuelga de ningún group local). */
const LIGHT_TARGET_DISTANCE = 3;

/** Parpadeo: mismo criterio que `WallTorch`/`CandleLightView` (2 senos inconmensurados), desfasado por ÍNDICE DE EMISOR (ver cabecera). */
const FLICKER_FREQ_A = 4.3;
const FLICKER_FREQ_B = 9.1;
const FLICKER_WEIGHT_A = 0.6;
const FLICKER_WEIGHT_B = 0.4;
const FLICKER_AMPLITUDE = 0.16;
const FLICKER_PHASE_STEP = 2.3;

/**
 * Duración del fundido al reasignar un slot (ver "POP al reasignar" en la
 * cabecera): corto para no leerse como una luz "encendiéndose" a cámara
 * lenta, largo para que la aparición en la nueva posición pase inadvertida —
 * punto de tuning, calibrado a ojo contra el ritmo de movimiento del héroe.
 */
const TORCH_POOL_FADE_DURATION = 0.3;

/**
 * Sentinela de "sin asignación previa": distinto tanto de cualquier índice
 * real (>=0) como de -1 ("slot vacío", ver `selectNearestInto`), así que la
 * primera asignación real de cada slot —incluida la del primer frame de la
 * run— siempre dispara un fundido de entrada en vez de aparecer a plena
 * intensidad de golpe.
 */
const UNASSIGNED = -2;

function coneAngleFor(kind: TorchEmitter['kind']): number {
  return kind === 'shopkeeper' ? SHOPKEEPER_LIGHT_ANGLE : TORCH_LIGHT_ANGLE;
}

function conePenumbraFor(kind: TorchEmitter['kind']): number {
  return kind === 'shopkeeper' ? SHOPKEEPER_LIGHT_PENUMBRA : TORCH_LIGHT_PENUMBRA;
}

export function TorchLightPool({ session }: { session: GameSession }) {
  // Lista completa de emisores candidatos (jefe + tienda + tendero, ver
  // `collectTorchEmitters`): la mazmorra no cambia de layout durante la
  // partida, así que se calcula una sola vez al montar.
  const emitters = useMemo(() => collectTorchEmitters(session.world), [session.world]);

  const lightRefs = useRef<(SpotLight | null)[]>([]);
  const targetRefs = useRef<(Object3D | null)[]>([]);

  // Scratch reutilizado cada frame — nunca se recrea ni se reasigna la
  // referencia del array, solo se sobreescriben sus posiciones (mismo
  // patrón que el ancla de `SceneLights.tsx`).
  const nearestScratch = useMemo<number[]>(() => new Array(TORCH_LIGHT_POOL_SIZE).fill(-1), []);
  /** Emisor que llevaba cada slot en el frame anterior — detecta el cambio de asignación que dispara el fundido (ver cabecera). */
  const lastAssigned = useMemo<number[]>(() => new Array(TORCH_LIGHT_POOL_SIZE).fill(UNASSIGNED), []);
  /** Segundos transcurridos desde la última reasignación de cada slot. */
  const fadeElapsed = useMemo<number[]>(() => new Array(TORCH_LIGHT_POOL_SIZE).fill(0), []);

  useFrame((state, delta) => {
    const world = session.world;
    const hero = world.hero;
    const alpha = session.renderAlpha;
    const heroX = session.heroPrevX + (hero.position.x - session.heroPrevX) * alpha;
    const heroZ = session.heroPrevY + (hero.position.y - session.heroPrevY) * alpha;

    selectNearestInto(emitters, heroX, heroZ, nearestScratch, TORCH_LIGHT_POOL_SIZE);

    const t = state.clock.elapsedTime;

    for (let k = 0; k < TORCH_LIGHT_POOL_SIZE; k++) {
      const light = lightRefs.current[k];
      if (!light) continue;
      const idx = nearestScratch[k];

      // Cambio de asignación (incluida la primera, ver UNASSIGNED): reinicia el fundido de este slot.
      if (idx !== lastAssigned[k]) {
        lastAssigned[k] = idx;
        fadeElapsed[k] = 0;
      } else if (fadeElapsed[k] < TORCH_POOL_FADE_DURATION) {
        fadeElapsed[k] += delta;
      }

      if (idx === -1) {
        // INVARIANTE: nunca visible=false ni desmontado, solo apagado (ver cabecera).
        light.intensity = 0;
        continue;
      }

      const emitter = emitters[idx];
      light.position.set(emitter.x, emitter.y, emitter.z);
      light.color.set(emitter.color);
      light.distance = emitter.distance;
      light.angle = coneAngleFor(emitter.kind);
      light.penumbra = conePenumbraFor(emitter.kind);

      const target = targetRefs.current[k];
      if (target) {
        // Objetivo del cono en coordenadas de mundo directas (el pool no
        // cuelga de ningún group local, a diferencia de WallTorch): hacia
        // dentro de la sala (dirX/dirZ) y sobre el plano y=0 — dirX=dirZ=0
        // para el tendero da un cono vertical hacia el suelo (ver
        // `collectTorchEmitters`).
        target.position.set(
          emitter.x + emitter.dirX * LIGHT_TARGET_DISTANCE,
          0,
          emitter.z + emitter.dirZ * LIGHT_TARGET_DISTANCE,
        );
        // three.js no refresca la matriz mundial de un target que no cuelga
        // del grafo de la escena por su cuenta (mismo problema que resuelve
        // SceneLights.tsx con la directional): forzarla a mano.
        target.updateMatrixWorld();
        if (light.target !== target) light.target = target;
      }

      // Parpadeo desfasado por ÍNDICE DE EMISOR (idx), no por slot (ver cabecera).
      const tp = t + idx * FLICKER_PHASE_STEP;
      const flicker = FLICKER_WEIGHT_A * Math.sin(tp * FLICKER_FREQ_A) + FLICKER_WEIGHT_B * Math.sin(tp * FLICKER_FREQ_B);
      const fade = Math.min(1, fadeElapsed[k] / TORCH_POOL_FADE_DURATION);
      light.intensity = emitter.intensity * (1 + FLICKER_AMPLITUDE * flicker) * fade;
    }
  });

  return (
    <>
      {Array.from({ length: TORCH_LIGHT_POOL_SIZE }, (_, i) => (
        <group key={i}>
          <spotLight
            ref={(el) => {
              lightRefs.current[i] = el;
            }}
            // Arranca apagado (intensity=0): el primer useFrame reasigna
            // todo antes de que se note — ver UNASSIGNED en la cabecera.
            intensity={0}
            distance={TORCH_LIGHT_DISTANCE}
            decay={TORCH_LIGHT_DECAY}
            angle={TORCH_LIGHT_ANGLE}
            penumbra={TORCH_LIGHT_PENUMBRA}
            color={TORCH_LIGHT_COLOR}
          />
          <object3D
            ref={(el) => {
              targetRefs.current[i] = el;
            }}
          />
        </group>
      ))}
    </>
  );
}
