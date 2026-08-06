/**
 * La Tormenta (GDD §15.5, Fase B4, `bossId==='storm'`; rediseño de telegraph
 * post-playtest 2026-07-15, David: "que el anillo fuera siempre como el
 * anillo de Saturno, en horizontal, y que se iluminara por partes... de la
 * forma en la que van a salir las bolas"): extraído de `EnemyViews.tsx` en la
 * pasada pre-release. Jefe de esquive puro, cuerpo tormentoso propio
 * (gris-azulado) envuelto en un halo SIEMPRE horizontal (plano del suelo,
 * nunca inclinado — el toro-arco giratorio anterior se leía verticalizado en
 * playtest, ver comentario largo en `stormHaloSegmentGeometry`, assets.ts)
 * compuesto de `STORM_HALO_SEGMENTS` secciones fijas cuyo COLOR (nunca su
 * rotación) delata, sección por sección, POR DÓNDE va a salir el patrón
 * `enemy.bossCounter` (`stormSegmentLit`, más abajo: espiral ilumina 4
 * secciones centradas en los ángulos reales de los brazos —girando a la
 * velocidad angular real durante el telegraph—, anillos ilumina TODO el
 * anillo menos el hueco de diseño real del primer anillo, ráfaga ilumina las
 * 3 zonas con balas y apaga los 3 pasillos reales) — así el jugador lee POR
 * DÓNDE va a esquivar antes de que empiece a disparar, no solo QUE algo va a
 * pasar (el anillo ámbar genérico ya cubre eso). El patrón de CADA ciclo se
 * decide al entrar en recarga, no al empezar su telegraph propio
 * (`storm/pattern.ts::stormEnterReload` → `stormResetPatternState`, que YA
 * arranca el generador para que sus ángulos sean reales desde ya), así que el
 * aro puede empezar a insinuarlo desde la 2ª mitad de la recarga anterior
 * (secciones que se funden del verde de "ventana abierta" al color resuelto
 * del patrón, intensidad creciente) y llegar a insinuación plena en el IDLE
 * breve que sigue, antes incluso de que arranque el telegraph con lectura
 * completa. Pose de recarga (ventana de vulnerabilidad, GDD §15.5 "aviso
 * visual claro"): cuerpo sustituido por un tono pálido/apagado y anillo VERDE
 * UNIFORME (todas las secciones iguales) en su 1ª mitad — inconfundible
 * frente al resto de estados, encima del anillo verde genérico ya heredado;
 * el tinte verdoso NUNCA desaparece del todo mientras la ventana siga
 * abierta, para que insinuar el próximo patrón no camufle que sigue siendo el
 * momento de golpear.
 *
 * `applyStormBossFrame` se llama desde el ÚNICO `useFrame` de `EnemyMesh`
 * (EnemyViews.tsx), en el mismo punto exacto donde vivía este bloque antes de
 * la extracción — los refs los sigue poseyendo `EnemyMesh` (se pasan aquí por
 * parámetro) para no alterar el orden de mutación dentro del frame.
 */

import type { RefObject } from 'react';
import type { Color, InstancedMesh, Mesh, Object3D } from 'three';
import {
  stormBodyMaterial,
  STORM_HALO_DIM_COLOR,
  STORM_HALO_PATTERN_COLOR,
  STORM_HALO_SEGMENTS,
  stormHaloSegmentGeometry,
  stormHaloMaterial,
  stormHaloReloadColor,
  stormReloadCoreMaterial,
} from '@/game/render/assets';
import {
  STORM_BURST_CORRIDORS,
  STORM_CORRIDOR_SAFETY,
  STORM_MIN_EMISSION_RADIUS,
  STORM_SPIRAL_ANGULAR_SPEED,
  STORM_SPIRAL_ARMS,
  stormCorridorMinAngle,
} from '@/game/features/bosses/storm/constants';
import {
  STORM_PATTERN_RINGS,
  STORM_PATTERN_SPIRAL,
  STORM_RELOAD_DURATION_BY_PHASE,
  STORM_STAGE_EXECUTE,
  STORM_STAGE_IDLE,
  STORM_STAGE_RELOAD,
  STORM_STAGE_TELEGRAPH,
  STORM_TELEGRAPH_DURATION_BY_PHASE,
} from '@/game/features/bosses/storm/machine-constants';
import { stormState } from '@/game/features/bosses/storm/pattern';
import type { StormState } from '@/game/features/bosses/storm/patterns';
import { ENEMY_LIGHT_COLOR } from '@/game/features/enemies/EnemyLights';
import { makeSilhouetteMaterial } from '@/game/render/occlusion-silhouette';
import type { Enemy, World } from '@/game/world/types';

/**
 * Silueta de oclusión de La Tormenta (occlusion-silhouette.ts): NO clona
 * `stormBodyMaterial.color` (mismo bug de fondo documentado en
 * EnemyViews.tsx) — `assets-dark.ts` oscurece el cuerpo a `#20242e`, casi
 * negro, invisible sobre un muro oscuro. A diferencia del Guardián/Reina, La
 * Tormenta NO tiene un acento emissive propio (ver comentario explícito en
 * assets-dark.ts: "El Prisma y La Tormenta se quedan SIN acento emissive
 * propio... a valorar aparte"), así que no hay un color "ya usado" más
 * brillante al que recurrir sin inventar uno — se reutiliza el dorado
 * genérico de jefe (`ENEMY_LIGHT_COLOR.boss`, EnemyLights.tsx, el mismo tono
 * de su propia pointLight) en su lugar. La pose de recarga
 * (`stormReloadCoreMaterial`, tono pálido) ya se lee por el halo verde
 * uniforme que la acompaña, no hace falta que la silueta también cambie de
 * color para esa misma señal.
 */
export const stormSilhouetteMaterial = makeSilhouetteMaterial(ENEMY_LIGHT_COLOR.boss);

/**
 * Opacidad "plena" del halo por patrón durante telegraph/ejecución (índice =
 * STORM_PATTERN_*) — mismos valores que antes del rediseño post-playtest
 * 2026-07-15 (espiral/anillos algo más discretos que la ráfaga, que es la más
 * súbita). Punto de llegada del fundido desde `STORM_HALO_RELOAD_OPACITY`
 * durante la insinuación de la 2ª mitad de la recarga.
 */
const STORM_HALO_FULL_OPACITY: readonly [number, number, number] = [0.6, 0.6, 0.65];
/** Opacidad del halo en la 1ª mitad de la recarga (pose quieta, sin insinuar nada todavía) y arranque del fundido hacia STORM_HALO_FULL_OPACITY. */
const STORM_HALO_RELOAD_OPACITY = 0.18;
/** Radio del anillo respecto al cuerpo (constante: la lectura ahora es espacial —qué secciones se iluminan—, no de "respiración" de tamaño). */
const STORM_HALO_RADIUS_FACTOR = 1.25;
/** Ángulo (rad) que cubre cada sección del grid FIJO del anillo (`STORM_HALO_SEGMENTS`, assets.ts). */
const STORM_HALO_SEGMENT_ANGLE = (Math.PI * 2) / STORM_HALO_SEGMENTS;
/**
 * Semiancho angular (rad) de una sección iluminada de la ESPIRAL: los brazos
 * son rayos puntuales (sin ancho de diseño propio, a diferencia de anillos/
 * ráfaga que sí tienen un hueco/pasillo REAL — ver `stormSegmentLit`), así
 * que este es un ancho de LECTURA (no toca la sim) elegido para que las 4
 * secciones se vean como 4 bloques distintos con hueco de sobra entre ellos
 * (4 · 2 · esto ≈ el 40% del anillo).
 */
const STORM_HALO_SPIRAL_ARM_HALF_WIDTH = STORM_HALO_SEGMENT_ANGLE * 1.8;

/**
 * Diferencia angular con signo mínima entre dos ángulos, en (−π, π]. Copia
 * local de utilidad de ángulos (mismo criterio que
 * `patterns.test.ts::angularDelta`; no se exporta desde sim porque es
 * puramente de lectura de render, no entra en ninguna garantía de pasillo).
 */
function stormAngularDelta(a: number, b: number): number {
  const twoPi = Math.PI * 2;
  let d = (b - a) % twoPi;
  if (d < -Math.PI) d += twoPi;
  if (d > Math.PI) d -= twoPi;
  return d;
}

/**
 * true si la sección de grid centrada en `segAngle` (ángulo de MUNDO fijo,
 * ver comentario del bucle en `applyStormBossFrame`) cae dentro de una zona
 * con balas del patrón `pattern` en el instante actual — "lo visual promete
 * lo mecánico" (AGENTS.md): los anchos de anillos/ráfaga son los REALES de
 * `stormCorridorMinAngle`/`STORM_CORRIDOR_SAFETY` (los MISMOS que usa
 * `patterns.ts` para abrir el hueco/pasillo de verdad, nunca un número
 * inventado); el de la espiral es de lectura (ver
 * `STORM_HALO_SPIRAL_ARM_HALF_WIDTH`). `spiralAngleNow` ya trae aplicada la
 * velocidad angular REAL de los brazos (`STORM_SPIRAL_ANGULAR_SPEED`).
 */
function stormSegmentLit(segAngle: number, pattern: number, state: StormState, spiralAngleNow: number): boolean {
  if (pattern === STORM_PATTERN_SPIRAL) {
    const step = (Math.PI * 2) / STORM_SPIRAL_ARMS;
    for (let k = 0; k < STORM_SPIRAL_ARMS; k++) {
      const armAngle = spiralAngleNow + k * step;
      if (Math.abs(stormAngularDelta(segAngle, armAngle)) <= STORM_HALO_SPIRAL_ARM_HALF_WIDTH) return true;
    }
    return false;
  }
  const gapHalf = (stormCorridorMinAngle(STORM_MIN_EMISSION_RADIUS) * STORM_CORRIDOR_SAFETY) / 2;
  if (pattern === STORM_PATTERN_RINGS) {
    // Todo el anillo iluminado MENOS el hueco de diseño real (ver `emitRing`
    // en patterns.ts): así siempre acaba dejando pasar por ahí.
    return Math.abs(stormAngularDelta(segAngle, state.ringGapAngle)) > gapHalf;
  }
  // Ráfaga (STORM_PATTERN_BURST, único que queda): oscuro en cada uno de los
  // STORM_BURST_CORRIDORS huecos reales (centrados en burstBaseAngle +
  // c·sector, ver `fireRadialBurst`), iluminado en el resto (las 3 zonas con
  // balas).
  const sector = (Math.PI * 2) / STORM_BURST_CORRIDORS;
  for (let c = 0; c < STORM_BURST_CORRIDORS; c++) {
    const gapCenter = state.burstBaseAngle + c * sector;
    if (Math.abs(stormAngularDelta(segAngle, gapCenter)) <= gapHalf) return false;
  }
  return true;
}

export function applyStormBossFrame(params: {
  enemy: Enemy;
  world: World;
  bodyRadius: number;
  flashing: boolean;
  orientationYaw: number | null;
  bodyRef: RefObject<Mesh | null>;
  stormHaloRef: RefObject<InstancedMesh | null>;
  stormHaloScratch: { obj: Object3D; color: Color };
}): void {
  const { enemy, world, bodyRadius, flashing, orientationYaw, bodyRef, stormHaloRef, stormHaloScratch } = params;
  // Anillo de Saturno segmentado (rediseño post-playtest 2026-07-15, David:
  // "que se iluminara por partes... de la forma en la que van a salir las
  // bolas"): `enemy.bossCounter` es el patrón de ESTE ciclo — decidido al
  // entrar en RELOAD (`storm/pattern.ts::stormEnterReload` →
  // `stormResetPatternState`, que YA arranca el generador), así que ya es
  // válido —y sus ÁNGULOS REALES ya están en `world.bossState`— durante IDLE
  // y la 2ª mitad de la recarga, no solo durante TELEGRAPH/EXECUTE. Aquí solo
  // se decide CUÁNTO se insinúa (`mixT`, 0..1) y si se muestra el layout real
  // del patrón (`showPatternLayout`) o un anillo uniforme (verde en recarga
  // 1ª mitad, azul neutro en el brevísimo ambiente sin patrón decidido tras
  // `onInit`/cambio de fase).
  const state = stormState(world);
  const stage = enemy.bossStage;
  const pattern = enemy.bossCounter;
  const hasPattern = pattern >= 0 && pattern < STORM_HALO_PATTERN_COLOR.length;
  const halo = stormHaloRef.current;
  if (halo) {
    let showPatternLayout = false;
    let mixT = 1; // 0 = verde de recarga puro, 1 = color resuelto del patrón puro
    let spiralAngleNow = 0;
    let uniformColor = STORM_HALO_PATTERN_COLOR[STORM_PATTERN_SPIRAL]; // ambiente por defecto
    if (stage === STORM_STAGE_RELOAD) {
      const reloadDuration = STORM_RELOAD_DURATION_BY_PHASE[enemy.bossPhase - 1];
      const remaining = Math.max(0, enemy.bossVulnerableUntil - world.time);
      const reloadFrac = reloadDuration > 0 ? 1 - remaining / reloadDuration : 1; // 0 al abrir, 1 al cerrar
      if (!hasPattern || reloadFrac < 0.5) {
        // 1ª mitad: pose de recarga pura, anillo VERDE UNIFORME, para que el
        // arranque de la insinuación en la 2ª mitad se note como un
        // "despertar" del aro.
        uniformColor = stormHaloReloadColor;
        stormHaloMaterial.opacity = STORM_HALO_RELOAD_OPACITY;
      } else {
        // 2ª mitad: insinúa YA el patrón real (secciones reales del
        // generador, arrancado desde que se decidió en `stormEnterReload`),
        // mezclado con el verde de recarga (nunca se despega del todo
        // mientras la ventana siga abierta) a intensidad creciente hasta el
        // cierre.
        const hintT = (reloadFrac - 0.5) / 0.5; // 0..1 dentro de la 2ª mitad
        showPatternLayout = true;
        mixT = hintT;
        spiralAngleNow = state.spiralBaseAngle; // estático: stepSpiral aún no corre (EXECUTE no ha empezado)
        const fullOpacity = STORM_HALO_FULL_OPACITY[pattern];
        stormHaloMaterial.opacity = STORM_HALO_RELOAD_OPACITY + (fullOpacity - STORM_HALO_RELOAD_OPACITY) * hintT;
      }
    } else if (stage === STORM_STAGE_IDLE && hasPattern) {
      // Brevísimo (0.2-0.35s) pero el patrón YA se decidió en la recarga
      // anterior: sin parón visual, sigue a intensidad plena hasta que
      // arranque su propio telegraph.
      showPatternLayout = true;
      mixT = 1;
      spiralAngleNow = state.spiralBaseAngle; // estático, mismo criterio que el hint de recarga
      stormHaloMaterial.opacity = STORM_HALO_FULL_OPACITY[pattern];
    } else if ((stage === STORM_STAGE_TELEGRAPH || stage === STORM_STAGE_EXECUTE) && hasPattern) {
      showPatternLayout = true;
      mixT = 1;
      if (pattern === STORM_PATTERN_SPIRAL) {
        if (stage === STORM_STAGE_TELEGRAPH) {
          // Durante el telegraph los brazos aún no giran de verdad
          // (`stepSpiral` no corre hasta EXECUTE): se avanza el ángulo
          // ANALÍTICAMENTE con la MISMA fórmula que `stepSpiral`
          // (`spiralBaseAngle += STORM_SPIRAL_ANGULAR_SPEED·dt`) para que el
          // aro "pueda rotar a la velocidad angular real de los brazos" desde
          // el propio aviso (petición explícita de David).
          const telegraphDuration = STORM_TELEGRAPH_DURATION_BY_PHASE[enemy.bossPhase - 1];
          const remaining = Math.max(0, enemy.bossTelegraphUntil - world.time);
          const elapsed = telegraphDuration > 0 ? telegraphDuration - remaining : 0;
          spiralAngleNow = state.spiralBaseAngle + STORM_SPIRAL_ANGULAR_SPEED * elapsed;
        } else {
          // EXECUTE: `stepSpiral` ya avanza `state.spiralBaseAngle` de verdad
          // cada tick — leerlo directamente es exacto.
          spiralAngleNow = state.spiralBaseAngle;
        }
      }
      stormHaloMaterial.opacity = STORM_HALO_FULL_OPACITY[pattern];
    } else {
      // Ambiente (solo el brevísimo primer IDLE tras `onInit`/cambio de
      // fase, con `bossCounter` todavía sin decidir, `-1`): anillo azul
      // neutro uniforme — NUNCA verde aquí, para no prometer una ventana de
      // vulnerabilidad que no está abierta.
      stormHaloMaterial.opacity = 0.4;
    }

    // Bucle de secciones (cero allocs: `obj`/`color` de `stormHaloScratch`,
    // reutilizados). `segAngle` es un ángulo de MUNDO fijo del grid (0..2π),
    // el MISMO sistema de ángulos que las balas reales (dx=cosθ, dy=sinθ,
    // `patterns.ts::emitBulletAtAngle`). `groupRef` (el padre, en
    // EnemyViews.tsx) ya lleva `rotation.y = orientationYaw` (yaw de
    // orientación por velocidad: La Tormenta deriva sin parar y SÍ gira) —
    // para que la sección caiga en el ángulo de MUNDO `segAngle` pese a esa
    // rotación del padre, su rotación LOCAL debe CANCELARLA:
    // `stormHaloSegmentGeometry` (assets.ts) ya deja el centro de su arco en
    // el ángulo local 0, así que colocarlo en el ángulo de mundo `segAngle`
    // con un padre rotado Ω exige `rotation.y = -segAngle - Ω` (rotaciones Y
    // componen por suma: Ry(Ω)·Ry(local) = Ry(Ω+local); se comprueba con
    // Ω=0, segAngle=0 → local=0 → sección en (1,0,0), que es justo donde cae
    // dx=cos0=1, dy=sin0=0 tras `group.position.set(x,h,y)` — sim.x↔render.x,
    // sim.y↔render.z).
    const { obj, color } = stormHaloScratch;
    const parentYaw = orientationYaw ?? 0;
    const segmentScale = bodyRadius * STORM_HALO_RADIUS_FACTOR;
    for (let i = 0; i < STORM_HALO_SEGMENTS; i++) {
      const segAngle = i * STORM_HALO_SEGMENT_ANGLE;
      if (showPatternLayout) {
        const lit = stormSegmentLit(segAngle, pattern, state, spiralAngleNow);
        color.copy(stormHaloReloadColor).lerp(lit ? STORM_HALO_PATTERN_COLOR[pattern] : STORM_HALO_DIM_COLOR, mixT);
      } else {
        color.copy(uniformColor);
      }
      obj.position.set(0, 0, 0);
      obj.rotation.set(0, -segAngle - parentYaw, 0);
      obj.scale.setScalar(segmentScale);
      obj.updateMatrix();
      halo.setMatrixAt(i, obj.matrix);
      halo.setColorAt(i, color);
    }
    halo.instanceMatrix.needsUpdate = true;
    if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
  }
  const body = bodyRef.current;
  if (body && !flashing) {
    body.material = stage === STORM_STAGE_RELOAD ? stormReloadCoreMaterial : stormBodyMaterial;
  }
}

/**
 * JSX específico de La Tormenta: `InstancedMesh` de `STORM_HALO_SEGMENTS`
 * secciones del halo, SIEMPRE plano/horizontal (nunca rota tras montarse: la
 * geometría de cada sección ya nace pre-rotada flat, ver
 * `stormHaloSegmentGeometry` en assets.ts); qué sección se ilumina se decide
 * mutando el color por instancia cada frame en `applyStormBossFrame`. Vive
 * dentro del `<group ref={groupRef}>` del padre (EnemyViews.tsx), como el
 * resto de composición específica de jefe.
 */
export function StormBossExtras({ stormHaloRef }: { stormHaloRef: RefObject<InstancedMesh | null> }) {
  return (
    <instancedMesh
      ref={stormHaloRef}
      args={[stormHaloSegmentGeometry, stormHaloMaterial, STORM_HALO_SEGMENTS]}
      frustumCulled={false}
    />
  );
}
