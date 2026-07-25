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
 * POP al reasignar — mitigación elegida: FUNDIDO CRUZADO de intensidad, no
 * histéresis. `selectNearestInto` es una función PURA sin memoria del frame
 * anterior (recalcula el top-3 desde cero cada llamada, ver cabecera de
 * `light-pool.ts`): implementar histéresis ahí exigiría comparar la
 * asignación vigente del pool contra el nuevo top-3 y decidir cuándo negarse
 * a robar un slot — más estado, más ramas, y acoplaría una función de datos
 * pura y ya testeada a la política de un consumidor concreto. El fundido, en
 * cambio, ataca el síntoma real sin tocar la selección.
 *
 * Primera versión (solo fundido de ENTRADA): la antorcha SALIENTE cortaba en
 * seco —intensidad a 0 en el mismo frame en que el slot cambiaba de
 * emisor— mientras la ENTRANTE aparecía ya en la posición nueva y subía desde
 * 0. Con las dos cosas ocurriendo en frames contiguos se leía como "se
 * encienden/apagan" antorchas de golpe (bug reportado por David en la sala de
 * la tienda). Corregido con un fundido CRUZADO: cada slot es ahora una
 * pequeña máquina de dos fases —'exiting' / 'entering'— extraída como función
 * pura en `stepSlotFade` (`torch-pool-fade.ts`, con sus propios tests): al
 * cambiar la asignación, el slot primero BAJA la intensidad hasta 0
 * conservando posición/color/cono del emisor VIEJO (fase 'exiting'), y solo
 * cuando esa salida termina salta al emisor nuevo y sube desde 0 (fase
 * 'entering'). Cada fase dura `TORCH_POOL_FADE_PHASE_DURATION` segundos por
 * separado — el ciclo completo de un cruce puede llegar a durar el doble de
 * esa constante. El lado que PIERDE el slot, además, tampoco se queda a
 * oscuras del todo mientras dura la salida: su antorcha conserva un
 * `GlowPuddle` fijo a sus pies (Tarea 2, `TorchView.tsx`) que no depende de
 * este pool.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, type Object3D, type SpotLight } from 'three';
import type { GameSession } from '@/game/session/session';
import { selectNearestInto } from '@/game/render/light-pool';
import { createSlotFadeState, stepSlotFade, type SlotFadeState } from '@/game/render/torch-pool-fade';
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
 * Duración de CADA fase (salida y entrada por separado, ver "POP al
 * reasignar" en la cabecera y `stepSlotFade` en `torch-pool-fade.ts`) al
 * reasignar un slot: corta para no leerse como una luz "encendiéndose" a
 * cámara lenta, larga para que el cruce entre la antorcha vieja y la nueva
 * pase inadvertido — punto de tuning, calibrado a ojo contra el ritmo de
 * movimiento del héroe. El ciclo completo de un cruce (salida + entrada)
 * puede llegar a durar el doble de esta constante.
 */
const TORCH_POOL_FADE_PHASE_DURATION = 0.3;

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

  // `THREE.Color` por emisor, precalculado UNA vez (aquí, no en
  // `torch-placements.ts`: ese módulo se mantiene deliberadamente sin
  // dependencia de three.js, ver su cabecera). `emitter.color` es un string
  // (`'#ffb469'`) que otros consumidores siguen leyendo tal cual (p.ej. el
  // `GlowPuddle` de `TorchView.tsx`), así que el tipo `TorchEmitter.color` no
  // cambia — solo este pool necesita la versión ya parseada, porque es el
  // único que la asigna a una luz real CADA FRAME (`light.color.copy(...)`
  // más abajo evita que three.js reparse el string 3 veces por frame).
  const emitterColors = useMemo(() => emitters.map((e) => new Color(e.color)), [emitters]);

  const lightRefs = useRef<(SpotLight | null)[]>([]);
  const targetRefs = useRef<(Object3D | null)[]>([]);

  // Scratch reutilizado cada frame — nunca se recrea ni se reasigna la
  // referencia del array, solo se sobreescriben sus posiciones (mismo
  // patrón que el ancla de `SceneLights.tsx`).
  const nearestScratch = useMemo<number[]>(() => new Array(TORCH_LIGHT_POOL_SIZE).fill(-1), []);
  /** Máquina de dos fases (saliendo/entrando) de cada slot — ver `stepSlotFade` en `torch-pool-fade.ts` y "POP al reasignar" en la cabecera. Objetos creados UNA vez, mutados in-place cada frame. */
  const slotFades = useMemo<SlotFadeState[]>(
    () => Array.from({ length: TORCH_LIGHT_POOL_SIZE }, () => createSlotFadeState()),
    [],
  );

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

      // Avanza la máquina de dos fases del slot y obtiene la fracción de
      // intensidad [0,1] a aplicar; `slot.displayedIdx` (mutado por
      // `stepSlotFade`) es el emisor que el slot debe PINTAR este frame —
      // puede seguir siendo el emisor viejo mientras dura la fase 'exiting',
      // aunque `nearestScratch[k]` ya apunte al nuevo (ver cabecera).
      const slot = slotFades[k];
      const fade = stepSlotFade(slot, nearestScratch[k], delta, TORCH_POOL_FADE_PHASE_DURATION);
      const shownIdx = slot.displayedIdx;

      if (shownIdx === -1) {
        // INVARIANTE: nunca visible=false ni desmontado, solo apagado (ver cabecera).
        light.intensity = 0;
        continue;
      }

      const emitter = emitters[shownIdx];
      light.position.set(emitter.x, emitter.y, emitter.z);
      light.color.copy(emitterColors[shownIdx]);
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

      // Parpadeo desfasado por ÍNDICE DE EMISOR (shownIdx), no por slot (ver cabecera).
      const tp = t + shownIdx * FLICKER_PHASE_STEP;
      const flicker = FLICKER_WEIGHT_A * Math.sin(tp * FLICKER_FREQ_A) + FLICKER_WEIGHT_B * Math.sin(tp * FLICKER_FREQ_B);
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
            // todo antes de que se note — ver `UNASSIGNED_EMITTER` en
            // `torch-pool-fade.ts`.
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
