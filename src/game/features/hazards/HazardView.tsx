/**
 * Hazards estáticos de la sala (GDD §8): foso, pinchos, barro, acelerador
 * como quads planos (no cambian de tamaño/posición durante la sala, se
 * construyen una vez). Los barriles son vivos (pueden explotar) y se
 * gestionan aparte con BarrelViews, que sí lee la sim cada frame.
 *
 * Legibilidad (feedback de playtest):
 * - El foso (ronda 3, punto 6: "quita el borde al foso") es un único quad
 *   negro casi absoluto sobre el suelo claro, SIN reborde: el contraste
 *   suelo/agujero ya es inconfundible por sí solo, el marco de piedra clara
 *   de rondas anteriores sobraba.
 * - El barril es un CILINDRO con aros claros (silueta de barril); al explotar
 *   desaparece y deja una mancha chamuscada en el suelo.
 * - Los pinchos (punto 1 de playtest: "los pinchos no lo parecen") son una
 *   base + un InstancedMesh de agujas cónicas afiladas apuntando hacia arriba
 *   sobre una rejilla determinista (sin Math.random: jitter por índice, mismo
 *   layout siempre para la misma sala), color hueso claro que contrasta con
 *   el suelo. Estático, se construye una vez por hazard (useMemo), igual que
 *   el resto de hazards no vivos.
 */

import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Group, Mesh } from 'three';
import {
  GUARDIAN_BARREL_FALL_DURATION,
  GUARDIAN_BARREL_FALL_HEIGHT,
  GUARDIAN_BARREL_SHADOW_FRACTION,
} from '@/game/features/bosses/guardian/constants';
import type { GameSession } from '@/game/session/session';
import { pushEvent } from '@/engine/events';
import { barrelInAir, type HazardSpawn } from '@/game/world/types';
import { barrelHoopMaterial, barrelMaterial, blobShadowMaterial, boostMaterial, mudMaterial, pitMaterial, scorchMaterial, spikesMaterial, spikesNeedleMaterial, unitCircle, unitCylinder, unitPlane, unitSpikeNeedle } from '@/game/render/assets';

const HAZARD_QUAD_Y = 0.03;
const BARREL_HEIGHT = 0.7;
/** Rebote visual del barril al aterrizar (GDD §15.2): altura y duración del pequeño arco tras tocar suelo. Puramente de render. */
const BARREL_BOUNCE_HEIGHT = 0.28;
const BARREL_BOUNCE_DURATION = 0.22;
/** Separación aproximada entre agujas del campo de pinchos (u de mundo). */
const SPIKE_NEEDLE_SPACING = 0.32;
/** Altura de la aguja instanciada (debe coincidir con la geometría unitSpikeNeedle). */
const SPIKE_NEEDLE_HEIGHT = 0.32;

/** Hash determinista barato [0,1) por índice entero (sin Math.random: mismo layout siempre para la misma sala). */
function hash01(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Rejilla de posiciones locales (centradas en 0,0) con jitter determinista, para un campo denso de agujas. */
function buildNeedleLayout(width: number, height: number): { x: number; z: number; scale: number; rot: number }[] {
  const cols = Math.max(1, Math.round(width / SPIKE_NEEDLE_SPACING));
  const rows = Math.max(1, Math.round(height / SPIKE_NEEDLE_SPACING));
  const cellW = width / cols;
  const cellH = height / rows;
  const layout: { x: number; z: number; scale: number; rot: number }[] = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jitterX = (hash01(i * 2) - 0.5) * cellW * 0.4;
      const jitterZ = (hash01(i * 2 + 1) - 0.5) * cellH * 0.4;
      const x = -width / 2 + cellW * (c + 0.5) + jitterX;
      const z = -height / 2 + cellH * (r + 0.5) + jitterZ;
      const scale = 0.75 + hash01(i * 3 + 5) * 0.5;
      const rot = hash01(i * 5 + 7) * Math.PI * 2;
      layout.push({ x, z, scale, rot });
      i++;
    }
  }
  return layout;
}

/** Instancias de agujas del campo de pinchos: matrices escritas UNA vez al montar (hazard estático, mismo patrón que InstancedBoxes de RoomView). */
function NeedleInstances({ layout }: { layout: { x: number; z: number; scale: number; rot: number }[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    for (let i = 0; i < layout.length; i++) {
      const n = layout[i];
      scratch.position.set(n.x, (SPIKE_NEEDLE_HEIGHT * n.scale) / 2, n.z);
      scratch.rotation.set(0, n.rot, 0);
      scratch.scale.setScalar(n.scale);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [layout]);

  if (layout.length === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[unitSpikeNeedle, spikesNeedleMaterial, layout.length]} frustumCulled={false} />
  );
}

/** Campo de pinchos: base plana + InstancedMesh de agujas afiladas apuntando hacia arriba. */
function SpikesField({ hazard }: { hazard: HazardSpawn }) {
  const layout = useMemo(() => buildNeedleLayout(hazard.width, hazard.height), [hazard.width, hazard.height]);

  return (
    <group position={[hazard.position.x, HAZARD_QUAD_Y, hazard.position.y]}>
      <mesh
        geometry={unitPlane}
        material={spikesMaterial}
        rotation-x={-Math.PI / 2}
        scale={[hazard.width, hazard.height, 1]}
      />
      <NeedleInstances layout={layout} />
    </group>
  );
}

/**
 * Foso (punto 6 de playtest ronda 3: "quita el borde al foso"): un único quad
 * negro casi absoluto sobre el suelo claro, sin reborde. El contraste
 * suelo-claro/agujero-negro ya es inconfundible por sí solo; el reborde de
 * piedra clara de rondas anteriores quedaba redundante y añadía un marco que
 * el usuario percibía como ruido visual.
 */
function PitQuad({ hazard }: { hazard: HazardSpawn }) {
  const x = hazard.position.x;
  const z = hazard.position.y;
  return (
    <mesh
      geometry={unitPlane}
      material={pitMaterial}
      rotation-x={-Math.PI / 2}
      position={[x, HAZARD_QUAD_Y, z]}
      scale={[hazard.width, hazard.height, 1]}
    />
  );
}

function StaticHazardQuad({ hazard }: { hazard: HazardSpawn }) {
  if (hazard.kind === 'pit') {
    return <PitQuad hazard={hazard} />;
  }
  if (hazard.kind === 'spikes') {
    return <SpikesField hazard={hazard} />;
  }
  const material = hazard.kind === 'slow' ? mudMaterial : boostMaterial;
  return (
    <mesh
      geometry={unitPlane}
      material={material}
      rotation-x={-Math.PI / 2}
      position={[hazard.position.x, HAZARD_QUAD_Y, hazard.position.y]}
      scale={[hazard.width, hazard.height, 1]}
    />
  );
}

export function HazardViews({ world }: { world: { hazards: HazardSpawn[] } }) {
  return (
    <>
      {world.hazards.map((hazard) => (
        <StaticHazardQuad key={hazard.id} hazard={hazard} />
      ))}
    </>
  );
}

/** Fracción [0,1] de la ventana de caída ya transcurrida en `time` (0 = recién spawneado, 1 = ya aterrizado o barril normal sin landingAt). */
function fallProgress(landingAt: number | undefined, time: number): number {
  if (landingAt === undefined) return 1;
  const remaining = landingAt - time;
  if (remaining <= 0) return 1;
  const p = 1 - remaining / GUARDIAN_BARREL_FALL_DURATION;
  return p < 0 ? 0 : p;
}

function BarrelMesh({ session, barrelId }: { session: GameSession; barrelId: string }) {
  const groupRef = useRef<Group>(null);
  const scorchRef = useRef<Mesh>(null);
  const shadowRef = useRef<Mesh>(null);
  // true mientras el barril actual sigue "en el aire" (aún no se emitió su
  // evento de aterrizaje); se resetea a true cuando un slot reciclado vuelve
  // a caer (guardianSpawnBarrel fija un landingAt nuevo y futuro).
  const awaitingLandingRef = useRef(true);

  useFrame(() => {
    const barrel = session.world.barrels.find((b) => b.id === barrelId);
    const group = groupRef.current;
    const scorch = scorchRef.current;
    const shadow = shadowRef.current;
    if (!barrel || !group) return;
    group.visible = !barrel.exploded;

    const inAir = barrelInAir(barrel, session.world.time);
    // Si sigue (o vuelve a estar) en el aire, hay un aterrizaje pendiente que
    // emitir cuando cruce landingAt (recicla el flag al reaparecer).
    if (inAir) awaitingLandingRef.current = true;

    if (barrel.exploded) {
      if (shadow) shadow.visible = false;
    } else if (inAir) {
      // Fase de caída (GDD §15.2): sombra creciendo de 0 al tamaño final
      // durante GUARDIAN_BARREL_SHADOW_FRACTION del total, cuerpo cayendo a
      // plomo desde GUARDIAN_BARREL_FALL_HEIGHT durante el resto — un pelín
      // solapados para que el cuerpo ya se vea entrar cuando la sombra está
      // casi a tamaño completo (se lee como "cae sobre su propia sombra").
      const p = fallProgress(barrel.landingAt, session.world.time);
      const shadowP = Math.min(1, p / GUARDIAN_BARREL_SHADOW_FRACTION);
      const fallStart = GUARDIAN_BARREL_SHADOW_FRACTION * 0.5;
      const fallP = fallStart >= 1 ? 1 : Math.min(1, Math.max(0, (p - fallStart) / (1 - fallStart)));
      // Easing cuadrático de caída (acelera al caer, como la gravedad) sin
      // asignar nada nuevo: solo aritmética escalar.
      const y = GUARDIAN_BARREL_FALL_HEIGHT * (1 - fallP * fallP);
      group.position.set(barrel.position.x, y, barrel.position.y);
      if (shadow) {
        shadow.visible = true;
        shadow.position.set(barrel.position.x, 0.025, barrel.position.y);
        shadow.scale.setScalar(barrel.radius * 1.5 * shadowP);
      }
      if (scorch) scorch.visible = false;
    } else {
      // Aterrizado: si acaba de cruzar landingAt este frame, dispara el burst
      // de polvo (evento emitido desde el render porque el instante exacto de
      // aterrizaje cae entre ticks fijos de la sim, ver comentario en
      // events.ts sobre 'boss-barrel-land').
      if (awaitingLandingRef.current) {
        awaitingLandingRef.current = false;
        pushEvent(session.events, 'boss-barrel-land', barrel.position.x, barrel.position.y, 1);
      }
      // Rebote de aterrizaje (GDD §15.2, "aterriza con rebote"): un breve
      // medio-arco hacia arriba justo tras tocar suelo, decreciente, derivado
      // de (time - landingAt) sin estado extra. Fuera de la ventana bounce=0.
      let bounceY = 0;
      if (barrel.landingAt !== undefined) {
        const since = session.world.time - barrel.landingAt;
        if (since >= 0 && since < BARREL_BOUNCE_DURATION) {
          const bt = since / BARREL_BOUNCE_DURATION; // 0..1
          bounceY = BARREL_BOUNCE_HEIGHT * Math.sin(bt * Math.PI) * (1 - bt);
        }
      }
      group.position.set(barrel.position.x, bounceY, barrel.position.y);
      if (shadow) shadow.visible = false;
      if (scorch) {
        scorch.visible = barrel.exploded;
        scorch.position.set(barrel.position.x, 0.025, barrel.position.y);
      }
    }
  });

  const barrel = session.world.barrels.find((b) => b.id === barrelId);
  const radius = barrel ? barrel.radius : 0.4;
  const diameter = radius * 2;

  return (
    <>
      <group ref={groupRef}>
        {/* Cuerpo: cilindro rojo barril. */}
        <mesh
          geometry={unitCylinder}
          material={barrelMaterial}
          position={[0, BARREL_HEIGHT / 2, 0]}
          scale={[diameter, BARREL_HEIGHT, diameter]}
        />
        {/* Aros metálicos claros (arriba y abajo): silueta de barril. */}
        <mesh
          geometry={unitCylinder}
          material={barrelHoopMaterial}
          position={[0, BARREL_HEIGHT * 0.22, 0]}
          scale={[diameter * 1.06, BARREL_HEIGHT * 0.08, diameter * 1.06]}
        />
        <mesh
          geometry={unitCylinder}
          material={barrelHoopMaterial}
          position={[0, BARREL_HEIGHT * 0.78, 0]}
          scale={[diameter * 1.06, BARREL_HEIGHT * 0.08, diameter * 1.06]}
        />
      </group>
      {/* Sombra de aviso mientras cae del cielo (GDD §15.2): crece de 0 al tamaño final. */}
      <mesh
        ref={shadowRef}
        geometry={unitCircle}
        material={blobShadowMaterial}
        rotation-x={-Math.PI / 2}
        scale={radius * 1.5}
        visible={false}
      />
      {/* Mancha chamuscada tras la explosión. */}
      <mesh
        ref={scorchRef}
        geometry={unitCircle}
        material={scorchMaterial}
        rotation-x={-Math.PI / 2}
        scale={radius * 2.2}
        visible={false}
      />
    </>
  );
}

export function BarrelViews({ session }: { session: GameSession }) {
  // `world.barrels` crece por `.push` en runtime (guardianSpawnBarrel): el
  // `.map` de abajo solo ve elementos nuevos si React vuelve a renderizar
  // este componente. Nada dispara setState al hacer push, así que sin este
  // trigger las entidades nacidas tras el montaje nunca reciben mesh (bug
  // confirmado en playtest: barriles/pociones/monedas invisibles). Se lee la
  // longitud una vez por frame (mismo patrón que useGameLoop.ts) y solo se
  // llama a setState cuando cambia, para no forzar un render de más.
  const [count, setCount] = useState(session.world.barrels.length);
  useFrame(() => {
    if (session.world.barrels.length !== count) setCount(session.world.barrels.length);
  });
  return (
    <>
      {session.world.barrels.map((barrel) => (
        <BarrelMesh key={barrel.id} session={session} barrelId={barrel.id} />
      ))}
    </>
  );
}
