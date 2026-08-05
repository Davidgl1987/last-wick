/**
 * Columnas de la Reina del Enjambre + sus cuerdas (T2 render, rediseño
 * 2026-07-10, GDD §15.3, docs/plans/QUEEN_REDESIGN_PLAN.md; piezas del kit
 * KayKit desde F3, docs/plans/ART_KIT_PLAN.md §5).
 *
 * `queenState(world).columns` (sim, `queen/columns.ts`, leído del slot opaco
 * `world.bossState`) es la fuente de verdad de su vida: cada columna vale
 * `QUEEN_COLUMN_HP` (3, playtest 2026-07-10) hp intacta → 2 (leve) → 1 (grave,
 * cada golpe de embestida resta 1) → 0 con `broken=true` (rota, restos). El
 * `Obstacle` sólido correspondiente se retira de `world.obstacles` al romperse
 * (`stepQueenColumns`, `queen/columns.ts`) — por eso `RoomView.tsx` EXCLUYE del
 * pintado genérico de rocas cualquier obstáculo cuyo id local empiece por
 * `column` (mismo criterio que `queen/pattern.ts::queenOnInit` usa para poblar
 * el estado de la Reina, ver
 * `QUEEN_COLUMN_ID_PREFIX`): este fichero es el ÚNICO que pinta las
 * columnas, en sus 4 estados (intacta/leve/grave/restos), evitando el
 * doble-render.
 *
 * Patrón: igual que `PuddleView.tsx` — pool de InstancedMesh preasignado
 * (uno POR ESTADO, ya que un InstancedMesh solo admite un material), leído
 * cada frame en `useFrame` y mutado vía matrices; nunca `setState` por
 * frame, nunca se crean/destruyen meshes. Solo el estado que aplica a cada
 * columna queda con escala > 0 en su mesh; el resto se oculta (escala 0,
 * mismo truco que los charcos inactivos). Los 3 niveles de daño (hp=3/2/1)
 * degradan progresivamente inclinación + oscurecimiento + grieta, para que
 * se lea de un vistazo cuántos golpes le quedan a cada columna.
 *
 * F3 (ART_KIT_PLAN §5): intacta/leve/grave pintan la MISMA geometría
 * `column` del kit (footprint escalado al AABB real de la columna, altura
 * natural del kit) con un clon de `kitMaterial` teñido más oscuro por
 * estado — mismo patrón que `doorKeyGateMaterial` en RoomView.tsx (JAMÁS se
 * muta `kitMaterial`, que comparte todo el kit). El requisito de playtest
 * ("debe leerse de un golpe cuántos golpes le quedan") ya estaba resuelto en
 * los 3 tonos de gris de las materiales antiguas — se REUTILIZAN esos mismos
 * tonos exactos como tinte sobre la geometría real del kit, así que el
 * contraste ya validado no cambia, solo gana el detalle de la piedra del
 * atlas. Los restos usan `rubble_half` aplastada contra el suelo (con su
 * propio tinte, el más oscuro de los cuatro).
 *
 * `QueenTethersView` pinta la "cuerda" (GDD §15.3, feedback de playtest
 * 2026-07-10) que une a la Reina con cada columna AÚN EN PIE (intacta o
 * agrietada): un cilindro fino que se recalcula cada frame desde la
 * posición REAL de la Reina (persigue) hasta la columna. Al romperse una
 * columna, su cuerda no desaparece de golpe: se retrae (latigazo corto hacia
 * la Reina) durante `TETHER_RETRACT_DURATION` y luego se oculta.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { GameSession } from '@/game/session/session';
import { kitGeometry, kitMaterial } from '@/game/render/kit';
import { kitBoxSize, kitGroundOffset } from '@/game/render/kit-fit';
import {
  queenColumnCrackStripeMaterial,
  queenTetherGeometry,
  queenTetherMaterial,
  unitBox,
} from '@/game/render/assets';
import { queenState } from './columns';
import { QUEEN_COLUMN_HP } from './constants';

/** Restos/escombros: mucho más bajo que una columna en pie, aplastado contra el suelo (marca, no obstáculo). */
const DEBRIS_HEIGHT = 0.35;
/** Los escombros se extienden un poco más allá de la huella original de la columna (efecto "se desparramó"). */
const DEBRIS_FOOTPRINT_SCALE = 1.2;
/** Inclinación de una columna hp=1 (grave, feedback de director 2026-07-10: "debe leerse que le queda un golpe"). Alterna de lado por índice para que no se vean clonadas. */
const CRACKED_TILT = 0.11;
/** La columna hp=1 se hunde/acorta ligeramente (parece parcialmente partida, no solo repintada). */
const CRACKED_HEIGHT_SCALE = 0.92;
/** Inclinación de una columna hp=2 (leve): mitad que la de hp=1, primer aviso sutil de daño. */
const CRACKED_LIGHT_TILT = CRACKED_TILT * 0.5;
/** La columna hp=2 apenas se hunde (bastante menos que hp=1): daño incipiente, no crítico todavía. */
const CRACKED_LIGHT_HEIGHT_SCALE = 0.97;
/** Altura del centro del cordón sobre el suelo (ni al ras ni a la altura de la corona: lee como "atadura", no como aro). */
const TETHER_HEIGHT = 0.55;
/** Duración del latigazo de retracción al romper una columna: la cuerda encoge rápido hacia la Reina en vez de cortarse en seco. */
const TETHER_RETRACT_DURATION = 0.18;

/**
 * Tintes de columna agrietada (leve/grave), clones de `kitMaterial` — mismo
 * patrón que `doorKeyGateMaterial` de RoomView.tsx: se clona UNA vez a nivel
 * de módulo y se le cambia solo el color, nunca se muta `kitMaterial` en sí.
 * Los tonos son EXACTAMENTE los de las materiales planas que sustituyen
 * (`queenColumnCrackedLightMaterial`/`queenColumnCrackedMaterial` de
 * assets.ts, ya validadas en el playtest de 2026-07-10 que exige distinguir
 * los 3 niveles de daño de un vistazo): el contraste no cambia, solo se
 * aplica ahora sobre la piedra texturizada del kit en vez de una caja lisa.
 */
const queenColumnLightCrackMaterial = kitMaterial.clone();
queenColumnLightCrackMaterial.color = new THREE.Color('#63667f');
const queenColumnGraveCrackMaterial = kitMaterial.clone();
queenColumnGraveCrackMaterial.color = new THREE.Color('#4a4a56');
/** Tinte de los restos/escombros: el más oscuro de los cuatro (mismo tono que la antigua `queenColumnDebrisMaterial`). */
const queenColumnDebrisTintMaterial = kitMaterial.clone();
queenColumnDebrisTintMaterial.color = new THREE.Color('#2e2e38');

const scratch = new THREE.Object3D();

/** Oculta la instancia `i` de `mesh` escalándola a 0 (mismo truco que los charcos inactivos de PuddleView). */
function hideInstance(mesh: THREE.InstancedMesh, i: number): void {
  scratch.position.set(0, 0, 0);
  scratch.rotation.set(0, 0, 0);
  scratch.scale.set(0, 0, 0);
  scratch.updateMatrix();
  mesh.setMatrixAt(i, scratch.matrix);
}

/**
 * `rubble_half` NO tiene el pivote centrado en XZ como el resto de piezas del
 * kit que usa este fichero (verificado contra su `.gltf`: su X real va de 0 a
 * 4, no de -2 a 2 — es una pieza de escombros pensada para encajar por un
 * borde, no para plantarse por su centro). Sin corregir este desfase, cada
 * resto de columna aparecería desplazado respecto al centro real de la
 * columna que representa. Se calcula sobre el `boundingBox` REAL (mismo
 * espíritu que `kitBoxSize`/`kitGroundOffset` de `kit-fit.ts`: nunca un
 * número a mano) y se resta, ya escalado, a la posición de cada instancia.
 */
function kitXZCenterOffset(geometry: THREE.BufferGeometry): { x: number; z: number } {
  const box = geometry.boundingBox;
  if (!box) throw new Error('geometría del kit sin boundingBox calculado');
  return { x: -(box.min.x + box.max.x) / 2, z: -(box.min.z + box.max.z) / 2 };
}

export function QueenColumnsView({ session }: { session: GameSession }) {
  const intactRef = useRef<THREE.InstancedMesh>(null);
  const crackedLightRef = useRef<THREE.InstancedMesh>(null);
  const crackedRef = useRef<THREE.InstancedMesh>(null);
  const crackStripeRef = useRef<THREE.InstancedMesh>(null);
  const debrisRef = useRef<THREE.InstancedMesh>(null);
  const count = queenState(session.world).columns.length;

  // Geometría/medidas del kit: se leen UNA vez (el boundingBox ya calculado
  // por kit.ts no cambia), nunca hardcodeadas — mismo criterio que
  // RoomView.tsx (ver comentario de cabecera de kit-fit.ts).
  const columnGeometry = kitGeometry('column');
  const columnSize = useMemo(() => kitBoxSize(columnGeometry), [columnGeometry]);
  const columnGroundY = useMemo(() => kitGroundOffset(columnGeometry), [columnGeometry]);
  const rubbleGeometry = kitGeometry('rubble_half');
  const rubbleSize = useMemo(() => kitBoxSize(rubbleGeometry), [rubbleGeometry]);
  const rubbleGroundY = useMemo(() => kitGroundOffset(rubbleGeometry), [rubbleGeometry]);
  const rubbleXZCenter = useMemo(() => kitXZCenterOffset(rubbleGeometry), [rubbleGeometry]);

  useFrame(() => {
    const intact = intactRef.current;
    const crackedLight = crackedLightRef.current;
    const cracked = crackedRef.current;
    const crackStripe = crackStripeRef.current;
    const debris = debrisRef.current;
    if (!intact || !crackedLight || !cracked || !crackStripe || !debris) return;

    const columns = queenState(session.world).columns;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const width = col.halfW * 2;
      const depth = col.halfH * 2;
      // Footprint de `column` escalado al AABB real de la columna (igual que
      // RockVariantInstances en RoomView.tsx): mismo footprint en los 3
      // estados en pie, solo cambia la altura (más abajo).
      const scaleX = width / columnSize.x;
      const scaleZ = depth / columnSize.z;

      if (col.broken) {
        hideInstance(intact, i);
        hideInstance(crackedLight, i);
        hideInstance(cracked, i);
        hideInstance(crackStripe, i);
        const sx = (width * DEBRIS_FOOTPRINT_SCALE) / rubbleSize.x;
        const sy = DEBRIS_HEIGHT / rubbleSize.y;
        const sz = (depth * DEBRIS_FOOTPRINT_SCALE) / rubbleSize.z;
        scratch.position.set(col.position.x + rubbleXZCenter.x * sx, rubbleGroundY * sy, col.position.y + rubbleXZCenter.z * sz);
        scratch.rotation.set(0, 0, 0);
        scratch.scale.set(sx, sy, sz);
        scratch.updateMatrix();
        debris.setMatrixAt(i, scratch.matrix);
        continue;
      }

      if (col.hp <= QUEEN_COLUMN_HP - 2) {
        // Grave (le queda 1 golpe): máxima inclinación/oscurecimiento y
        // grieta larga — el aspecto más dañado antes de romperse del todo.
        hideInstance(intact, i);
        hideInstance(crackedLight, i);
        hideInstance(debris, i);
        const tilt = (i % 2 === 0 ? 1 : -1) * CRACKED_TILT;
        const height = columnSize.y * CRACKED_HEIGHT_SCALE;
        // Pivote de `column` en su BASE (no centrado como el antiguo
        // unitBox): la inclinación gira sobre el pie de la columna, un
        // "apoyo que cede" más creíble que el balanceo alrededor del centro
        // que tenía la caja plana.
        scratch.position.set(col.position.x, columnGroundY * CRACKED_HEIGHT_SCALE, col.position.y);
        scratch.rotation.set(0, 0, tilt);
        scratch.scale.set(scaleX, CRACKED_HEIGHT_SCALE, scaleZ);
        scratch.updateMatrix();
        cracked.setMatrixAt(i, scratch.matrix);
        // Grieta: franja fina y oscura cruzando la cara sur (+Z, la que mira
        // hacia la cámara con el encuadre isométrico del juego) en diagonal.
        scratch.position.set(col.position.x, height * 0.55, col.position.y + depth / 2 + 0.01);
        scratch.rotation.set(0, 0, tilt + Math.PI / 4);
        scratch.scale.set(width * 1.3, 0.05, 0.05);
        scratch.updateMatrix();
        crackStripe.setMatrixAt(i, scratch.matrix);
        continue;
      }

      if (col.hp === QUEEN_COLUMN_HP - 1) {
        // Leve (le quedan 2 golpes): inclinación/oscurecimiento y grieta a
        // medias respecto al nivel grave — primer aviso, todavía sutil.
        hideInstance(intact, i);
        hideInstance(cracked, i);
        hideInstance(debris, i);
        const tilt = (i % 2 === 0 ? 1 : -1) * CRACKED_LIGHT_TILT;
        const height = columnSize.y * CRACKED_LIGHT_HEIGHT_SCALE;
        scratch.position.set(col.position.x, columnGroundY * CRACKED_LIGHT_HEIGHT_SCALE, col.position.y);
        scratch.rotation.set(0, 0, tilt);
        scratch.scale.set(scaleX, CRACKED_LIGHT_HEIGHT_SCALE, scaleZ);
        scratch.updateMatrix();
        crackedLight.setMatrixAt(i, scratch.matrix);
        // Grieta más corta/fina que la de hp=1: daño incipiente, aún se lee
        // como "le quedan golpes" sin confundirse con el estado grave.
        scratch.position.set(col.position.x, height * 0.55, col.position.y + depth / 2 + 0.01);
        scratch.rotation.set(0, 0, tilt + Math.PI / 4);
        scratch.scale.set(width * 0.7, 0.035, 0.035);
        scratch.updateMatrix();
        crackStripe.setMatrixAt(i, scratch.matrix);
        continue;
      }

      // Intacta (col.hp >= QUEEN_COLUMN_HP, único nivel sin agrietar): sin daño visible, misma silueta que cualquier columna del kit.
      hideInstance(crackedLight, i);
      hideInstance(cracked, i);
      hideInstance(crackStripe, i);
      hideInstance(debris, i);
      scratch.position.set(col.position.x, columnGroundY, col.position.y);
      scratch.rotation.set(0, 0, 0);
      scratch.scale.set(scaleX, 1, scaleZ);
      scratch.updateMatrix();
      intact.setMatrixAt(i, scratch.matrix);
    }
    intact.instanceMatrix.needsUpdate = true;
    crackedLight.instanceMatrix.needsUpdate = true;
    cracked.instanceMatrix.needsUpdate = true;
    crackStripe.instanceMatrix.needsUpdate = true;
    debris.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;

  return (
    <>
      <instancedMesh ref={intactRef} args={[columnGeometry, kitMaterial, count]} frustumCulled={false} castShadow receiveShadow />
      <instancedMesh
        ref={crackedLightRef}
        args={[columnGeometry, queenColumnLightCrackMaterial, count]}
        frustumCulled={false}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={crackedRef}
        args={[columnGeometry, queenColumnGraveCrackMaterial, count]}
        frustumCulled={false}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={crackStripeRef}
        args={[unitBox, queenColumnCrackStripeMaterial, count]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={debrisRef}
        args={[rubbleGeometry, queenColumnDebrisTintMaterial, count]}
        frustumCulled={false}
        castShadow
        receiveShadow
      />
    </>
  );
}

/** Escribe en `mesh[i]` un cordón desde (ax,ay) hasta (bx,by), a altura TETHER_HEIGHT. */
function setTetherMatrix(mesh: THREE.InstancedMesh, i: number, ax: number, ay: number, bx: number, by: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  scratch.position.set((ax + bx) / 2, TETHER_HEIGHT, (ay + by) / 2);
  scratch.rotation.set(0, Math.atan2(dx, dy), 0);
  scratch.scale.set(1, 1, Math.max(len, 0.001));
  scratch.updateMatrix();
  mesh.setMatrixAt(i, scratch.matrix);
}

export function QueenTethersView({ session }: { session: GameSession }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = queenState(session.world).columns.length;
  // Timestamp (world.time) en que cada columna se rompió, para animar su
  // retracción; -Infinity = aún no se ha roto. Se crea una única vez (nunca
  // cambia de tamaño: el estado de la Reina no gana/pierde columnas tras onInit).
  const brokenAtRef = useRef<Float32Array | null>(null);
  if (brokenAtRef.current === null && count > 0) {
    brokenAtRef.current = new Float32Array(count).fill(-Infinity);
  }

  useFrame(() => {
    const mesh = meshRef.current;
    const brokenAt = brokenAtRef.current;
    if (!mesh || !brokenAt) return;

    const world = session.world;
    const columns = queenState(world).columns;
    const boss = world.enemies.find((e) => e.kind === 'boss' && e.bossId === 'queen');
    if (!boss) {
      for (let i = 0; i < columns.length; i++) hideInstance(mesh, i);
      mesh.instanceMatrix.needsUpdate = true;
      return;
    }

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.broken) {
        if (brokenAt[i] === -Infinity) brokenAt[i] = world.time;
        const elapsed = world.time - brokenAt[i];
        if (elapsed >= TETHER_RETRACT_DURATION) {
          hideInstance(mesh, i);
          continue;
        }
        // Latigazo: el extremo de la columna viaja rápido hacia la Reina en
        // vez de cortarse en seco (feedback: "un latigazo/retracción rápida
        // si es fácil").
        const t = elapsed / TETHER_RETRACT_DURATION;
        const endX = col.position.x + (boss.position.x - col.position.x) * t;
        const endY = col.position.y + (boss.position.y - col.position.y) * t;
        setTetherMatrix(mesh, i, boss.position.x, boss.position.y, endX, endY);
        continue;
      }
      // El extremo de la Reina persigue: se recalcula cada frame desde su
      // posición REAL (boss.position), nunca una posición fija cacheada.
      setTetherMatrix(mesh, i, boss.position.x, boss.position.y, col.position.x, col.position.y);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;
  return <instancedMesh ref={meshRef} args={[queenTetherGeometry, queenTetherMaterial, count]} frustumCulled={false} />;
}
