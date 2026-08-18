/**
 * Vestíbulo 3D de la pantalla de título. Es una escena de presentación
 * aislada: no crea `GameSession`, no ejecuta sim y no conoce el flujo de la
 * run. Reutiliza las geometrías precargadas del KayKit y los materiales de
 * Lumora/enemigos del juego.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Preload } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Group, PointLight, Points } from 'three';
import { kitGeometry, kitGeometryPart, kitMaterial, kitWarmMaterial } from '@/game/render/kit';
import { kitBoxSize, kitGroundOffset, kitTopAlignOffset, kitXZCenteredGeometry } from '@/game/render/kit-fit';
import { CANDLE_HALF_HEIGHT } from '@/game/render/hero-candle';
import {
  blobShadowMaterial,
  chaserMaterial,
  dummyMaterial,
  smallDotGeometry,
  unitCircle,
  unitCone,
  unitPlane,
  unitSphere,
} from '@/game/render/assets';
import {
  chaserEyeGlowMaterial,
  dummyEyeGlowMaterial,
  dummySkirtMaterial,
  heroFlameMaterial,
  titleDustGeometry,
  titleDustMaterial,
  titleVoidMaterial,
  WEAPON_COLOR_FLAME_HDR,
} from '@/game/render/assets-dark';
import type { KitModelName } from '@/game/render/kit-models';
import { TitlePostEffects } from '@/game/render/PostEffects';
import { CandleModel } from '@/game/features/hero/CandleModel';

const ENTRY_DURATION = 1.35;
const DOOR_OPENING_WIDTH = 3.35;
const DOOR_Y_SCALE = 1.05;
const DOOR_Z = -3.15;

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function GroundedKitProp({
  model,
  position,
  rotationY = 0,
  scale = 1,
  warm = false,
}: {
  model: KitModelName;
  position: readonly [number, number, number];
  rotationY?: number;
  scale?: number;
  warm?: boolean;
}) {
  const geometry = useMemo(() => kitXZCenteredGeometry(kitGeometry(model)), [model]);
  const groundY = kitGroundOffset(geometry) * scale;
  return (
    <mesh
      geometry={geometry}
      material={warm ? kitWarmMaterial : kitMaterial}
      position={[position[0], position[1] + groundY, position[2]]}
      rotation-y={rotationY}
      scale={scale}
    />
  );
}

function WoodenFloor() {
  const geometry = useMemo(() => kitXZCenteredGeometry(kitGeometry('floor_wood_large')), []);
  const size = useMemo(() => kitBoxSize(geometry), [geometry]);
  return (
    <mesh
      geometry={geometry}
      material={kitWarmMaterial}
      position={[0, kitTopAlignOffset(geometry), 0.35]}
      scale={[9.4 / size.x, 1, 12 / size.z]}
    />
  );
}

interface DoorFit {
  frame: THREE.BufferGeometry;
  leaf: THREE.BufferGeometry;
  frameScaleX: number;
  leafScaleX: number;
  frameX: number;
  frameY: number;
  frameZ: number;
  leafY: number;
  leafZ: number;
  leafCenterX: number;
}

function doorFit(): DoorFit {
  const frame = kitGeometryPart('wall_doorway', 'wall_doorway');
  const leaf = kitGeometryPart('wall_doorway', 'wall_doorway_door');
  const frameBox = frame.boundingBox;
  const leafBox = leaf.boundingBox;
  if (!frameBox || !leafBox) throw new Error('la puerta del kit no trae boundingBox calculado');

  const leafWidth = leafBox.max.x - leafBox.min.x;
  const frameScaleX = DOOR_OPENING_WIDTH / leafWidth;
  const leafScaleX = frameScaleX / 2;
  return {
    frame,
    leaf,
    frameScaleX,
    leafScaleX,
    frameX: -((frameBox.min.x + frameBox.max.x) / 2) * frameScaleX,
    frameY: -frameBox.min.y * DOOR_Y_SCALE,
    frameZ: -((frameBox.min.z + frameBox.max.z) / 2),
    leafY: -leafBox.min.y * DOOR_Y_SCALE,
    leafZ: -((leafBox.min.z + leafBox.max.z) / 2),
    leafCenterX: ((leafBox.min.x + leafBox.max.x) / 2) * leafScaleX,
  };
}

function MansionDoor({ entering }: { entering: boolean }) {
  const leftRef = useRef<Group>(null);
  const rightRef = useRef<Group>(null);
  const progress = useRef(0);
  const fit = useMemo(doorFit, []);
  const half = DOOR_OPENING_WIDTH / 2;

  useFrame((_, delta) => {
    const target = entering ? 1 : 0;
    const step = delta / ENTRY_DURATION;
    progress.current += (target - progress.current) * Math.min(1, step * 4.2);
    const open = smoothstep(progress.current) * 1.3;
    if (leftRef.current) leftRef.current.rotation.y = open;
    if (rightRef.current) rightRef.current.rotation.y = -open;
  });

  return (
    <group position={[0, 0, DOOR_Z]}>
      {/* El vacío es mayor que el vano: al cruzar el umbral no queda ningún borde iluminado. */}
      <mesh geometry={unitPlane} material={titleVoidMaterial} position={[0, 3.15, -0.48]} scale={[9, 7, 1]} />
      <mesh
        geometry={fit.frame}
        material={kitMaterial}
        position={[fit.frameX, fit.frameY, fit.frameZ]}
        scale={[fit.frameScaleX, DOOR_Y_SCALE, 1]}
      />
      <group ref={leftRef} position={[-half, 0, 0]}>
        <mesh
          geometry={fit.leaf}
          material={kitWarmMaterial}
          position={[half / 2 - fit.leafCenterX, fit.leafY, fit.leafZ - 0.02]}
          scale={[fit.leafScaleX, DOOR_Y_SCALE, 1]}
        />
      </group>
      <group ref={rightRef} position={[half, 0, 0]}>
        <mesh
          geometry={fit.leaf}
          material={kitWarmMaterial}
          position={[-half / 2 - fit.leafCenterX, fit.leafY, fit.leafZ - 0.025]}
          // La pieza original lleva la anilla desplazada hacia su derecha.
          // Al reutilizarla para la segunda hoja hay que espejarla: así las
          // dos anillas quedan juntas junto a la costura central, no una en
          // el centro de cada mitad como ocurría en la primera versión.
          scale={[-fit.leafScaleX, DOOR_Y_SCALE, 1]}
        />
      </group>
    </group>
  );
}

/**
 * Radio de la vela de Lumora, en las mismas unidades de mundo que antes
 * (`scale = 0.54/width` con el modelo sin normalizar equivalía a un
 * DIÁMETRO de 0.54 ⇒ radio 0.27 — ver el historial en `HeroView.tsx` de
 * `visualRadius`/`HERO_RADIUS` para el mismo concepto aplicado al héroe).
 * Ahora que Lumora monta `<CandleModel>` (radio 1 normalizado, el mismo
 * componente que el héroe — ver `features/hero/CandleModel.tsx`), este es el
 * ÚNICO número que hace falta para plantar la vela a su tamaño real — mismo
 * criterio que `scale={HERO_RADIUS}` en `HeroView.tsx`.
 *
 * ~12% mayor que `HERO_RADIUS` (0.24) A PROPÓSITO: primer plano del
 * vestíbulo del título. Antes de compartir `CandleModel`, ese 12% solo
 * garantizadamente se aplicaba al CUERPO (Lumora recomponía la llama y los
 * ojos con números propios, sin relación matemática con los del héroe); con
 * `CandleModel` escalando cuerpo, silueta, ojos y llama UNIFORMEMENTE por
 * este único `scale`, la MISMA proporción del 12% se aplica a las cuatro
 * piezas por construcción — ver la VERIFICACIÓN DE PROPORCIÓN en la cabecera
 * de `CandleModel.tsx` para la cuenta completa de que la llama ya no puede
 * descuadrarse entre título y juego.
 */
const LUMORA_CANDLE_RADIUS = 0.27;

function Lumora() {
  const groupRef = useRef<Group>(null);
  const lightRef = useRef<PointLight>(null);
  // Altura de la BOCA de la vela (el techo) sobre el suelo, en unidades de
  // mundo: sigue haciendo falta aquí solo para posicionar la `pointLight`
  // (más abajo) — `<CandleModel>` ya no necesita que Lumora le pase nada de
  // esto, calcula la misma cuenta internamente a partir de su propio
  // `scale`. La vela normalizada mide `2·CANDLE_HALF_HEIGHT` de alto con la
  // base en y=0 (ver `render/hero-candle.ts`), escalada aquí por
  // `LUMORA_CANDLE_RADIUS`.
  const mouthY = 2 * CANDLE_HALF_HEIGHT * LUMORA_CANDLE_RADIUS;

  // `heroFlameMaterial` es un objeto MUTABLE compartido con el juego real
  // (HeroView.tsx lerpea `.color` hacia el arma activa cada frame) — si el
  // jugador vuelve al título tras una run con flecha/hechizo activo, el
  // color quedaría teñido de azul/violeta en vez del cálido de Lumora. Se
  // fija al color de cuerpo (el mismo que ya usaba `heroMaterial` de fondo)
  // una vez al montar: aquí no hay cambio de arma que lerpear, así que basta
  // con esto (no hace falta repetirlo cada frame).
  useEffect(() => {
    heroFlameMaterial.color.copy(WEAPON_COLOR_FLAME_HDR.body);
  }, []);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (lightRef.current) lightRef.current.intensity = 18 + Math.sin(time * 3.1) * 1.2 + Math.sin(time * 5.7) * 0.7;
    if (groupRef.current) groupRef.current.rotation.z = Math.sin(time * 0.75) * 0.012;
  });

  return (
    <group ref={groupRef} position={[0, 0.02, 2.35]}>
      {/*
        Cuerpo, silueta de oclusión, ojos y llama: el MISMO componente que
        monta el héroe jugable (`<CandleModel>`, `features/hero/CandleModel.tsx`
        — encargo de David, 2026-08-18: "debería haber un componente que lo
        pinte todo, tanto en el título como en el juego"). Antes de esto,
        Lumora recomponía el cuerpo (`normalizeHeroCandleGeometry` a mano),
        los ojos (números sueltos: separación 0.105, escala [0.065, 0.1,
        0.04], Z 0.265, altura `mouthY·0.56`) y la llama (dos `<group>`
        anidados con `LUMORA_CANDLE_RADIUS` y la `CANDLE_FLAME_ANCHOR_Y`
        importada de `HeroView.tsx`) — tres recetas manuales que ya no hacen
        falta: Lumora no pasa ninguna ref (no anima squash, mirada ni
        Firmeza) ni `children` (sin pinchos ni escudo), solo decide `scale`
        —`LUMORA_CANDLE_RADIUS`— y dónde va, este `<group>` de aquí fuera con
        su balanceo en Z.
      */}
      <CandleModel scale={LUMORA_CANDLE_RADIUS} />
      <pointLight ref={lightRef} color="#ffc06c" distance={5.8} decay={2} position={[0, mouthY + 0.22, 0.18]} />
      <mesh geometry={unitCircle} material={blobShadowMaterial} rotation-x={-Math.PI / 2} position={[0, 0.005, 0]} scale={0.48} />
    </group>
  );
}

function HiddenEnemies() {
  const leftRef = useRef<Group>(null);
  const rightRef = useRef<Group>(null);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (leftRef.current) {
      const left = leftRef.current;
      left.rotation.y = 0.44 + Math.sin(time * 0.36) * 0.16;
      left.rotation.z = Math.sin(time * 0.58 + 0.4) * 0.035;
      left.position.x = -2.58 + Math.sin(time * 0.31) * 0.055;
      left.position.y = 0.38 + Math.sin(time * 0.72) * 0.06;
      left.scale.setScalar(0.62 * (1 + Math.sin(time * 0.9 + 0.3) * 0.025));
    }
    if (rightRef.current) {
      const right = rightRef.current;
      right.rotation.y = -0.4 + Math.sin(time * 0.29 + 1.4) * 0.14;
      right.rotation.z = Math.sin(time * 0.51 + 1.7) * 0.03;
      right.position.x = 2.72 + Math.sin(time * 0.27 + 1.1) * 0.05;
      right.position.y = 0.5 + Math.sin(time * 0.63 + 0.8) * 0.07;
      right.scale.setScalar(0.55 * (1 + Math.sin(time * 0.82 + 1.2) * 0.03));
    }
  });

  return (
    <>
      <group ref={leftRef} position={[-2.58, 0.38, -1.45]} rotation-y={0.44} scale={0.62}>
        <mesh geometry={unitSphere} material={dummyMaterial} scale={[0.43, 0.33, 0.43]} />
        <mesh geometry={unitCone} material={dummySkirtMaterial} position={[0, -0.2, 0]} scale={[0.34, 0.25, 0.34]} />
        <group position={[0, 0.07, 0.31]}>
          <mesh geometry={smallDotGeometry} material={dummyEyeGlowMaterial} position={[-0.19, 0, 0]} scale={[0.14, 0.2, 0.08]} />
          <mesh geometry={smallDotGeometry} material={dummyEyeGlowMaterial} position={[0.19, 0, 0]} scale={[0.14, 0.2, 0.08]} />
        </group>
      </group>
      <group ref={rightRef} position={[2.72, 0.5, -1.7]} rotation-y={-0.4} scale={0.55}>
        <mesh geometry={unitSphere} material={chaserMaterial} scale={[0.31, 0.58, 0.31]} />
        <group position={[0, 0.12, 0.29]}>
          <mesh geometry={smallDotGeometry} material={chaserEyeGlowMaterial} position={[-0.17, 0, 0]} rotation-z={0.35} scale={[0.075, 0.2, 0.05]} />
          <mesh geometry={smallDotGeometry} material={chaserEyeGlowMaterial} position={[0.17, 0, 0]} rotation-z={-0.35} scale={[0.075, 0.2, 0.05]} />
        </group>
      </group>
    </>
  );
}

function Dust() {
  const ref = useRef<Points>(null);
  const motion = useMemo(() => {
    const position = titleDustGeometry.getAttribute('position') as THREE.BufferAttribute;
    const phase = new Float32Array(position.count);
    const rise = new Float32Array(position.count);
    for (let i = 0; i < position.count; i += 1) {
      phase[i] = (i * 2.399963) % (Math.PI * 2);
      rise[i] = 0.1 + (i % 7) * 0.018;
    }
    return { position, phase, rise };
  }, []);

  useFrame((state, delta) => {
    const points = ref.current;
    if (!points) return;
    const time = state.clock.elapsedTime;
    const positions = motion.position.array as Float32Array;
    for (let i = 0; i < motion.position.count; i += 1) {
      const offset = i * 3;
      const phase = motion.phase[i];
      positions[offset] += Math.sin(time * 0.46 + phase) * 0.055 * delta;
      positions[offset + 1] += motion.rise[i] * delta;
      positions[offset + 2] += Math.cos(time * 0.39 + phase * 1.17) * 0.04 * delta;
      if (positions[offset + 1] > 4.1) positions[offset + 1] -= 4;
    }
    motion.position.needsUpdate = true;
    points.rotation.y = Math.sin(time * 0.14) * 0.13;
  });
  return <points ref={ref} geometry={titleDustGeometry} material={titleDustMaterial} frustumCulled={false} />;
}

function TitleCamera({ entering, onComplete }: { entering: boolean; onComplete: () => void }) {
  const { camera, size } = useThree();
  const progress = useRef(0);
  const completed = useRef(false);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const aspect = size.width / Math.max(1, size.height);
  // 0 en escritorio/apaisado; 1 en un móvil estrecho como el de la captura.
  const portrait = THREE.MathUtils.clamp((0.82 - aspect) / 0.3, 0, 1);

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.fov = THREE.MathUtils.lerp(42, 48, portrait);
    camera.updateProjectionMatrix();
  }, [camera, portrait]);

  useFrame((state, delta) => {
    if (entering) progress.current = Math.min(1, progress.current + delta / ENTRY_DURATION);
    const eased = smoothstep(progress.current);
    const idle = 1 - eased;
    const time = state.clock.elapsedTime;
    const restingY = THREE.MathUtils.lerp(2.75, 3.15, portrait);
    const restingZ = THREE.MathUtils.lerp(8.7, 12.4, portrait);
    const driftX = (Math.sin(time * 0.28) * 0.2 + Math.sin(time * 0.11 + 1.2) * 0.07) * idle;
    const driftY = Math.sin(time * 0.18 + 0.4) * 0.07 * idle;
    const driftZ = Math.cos(time * 0.15) * 0.14 * idle;
    camera.position.set(
      THREE.MathUtils.lerp(driftX, 0, eased),
      THREE.MathUtils.lerp(restingY + driftY, 1.8, eased),
      THREE.MathUtils.lerp(restingZ + driftZ, -4.3, eased),
    );
    lookTarget.set(
      Math.sin(time * 0.21 + 1) * 0.11 * idle,
      THREE.MathUtils.lerp(1.42 + Math.sin(time * 0.17) * 0.035 * idle, 1.75, eased),
      THREE.MathUtils.lerp(-1.3, -4.7, eased),
    );
    camera.lookAt(lookTarget);
    camera.rotation.z += Math.sin(time * 0.13) * 0.004 * idle;

    if (progress.current >= 1 && !completed.current) {
      completed.current = true;
      onComplete();
    }
  });
  return null;
}

function Vestibule({ entering, onComplete }: { entering: boolean; onComplete: () => void }) {
  return (
    <>
      <color attach="background" args={['#030408']} />
      <fog attach="fog" args={['#060811', 7.5, 18]} />
      <hemisphereLight color="#7185b3" groundColor="#17131a" intensity={0.5} />
      <directionalLight color="#9caed8" intensity={0.82} position={[4, 7, 5]} />
      {/* Dos rellenos fríos y baratos revelan los laterales en retrato; la
          luz cálida de Lumora sigue siendo con diferencia la protagonista. */}
      <pointLight color="#647aad" intensity={3.2} distance={4.8} decay={2} position={[-2.75, 1.55, -1.8]} />
      <pointLight color="#647aad" intensity={3.2} distance={4.8} decay={2} position={[2.75, 1.55, -1.8]} />
      <WoodenFloor />
      <MansionDoor entering={entering} />
      <GroundedKitProp model="pillar" position={[-2.48, 0, -3.05]} scale={1.02} />
      <GroundedKitProp model="pillar" position={[2.48, 0, -3.05]} scale={1.02} />
      <GroundedKitProp model="wall_inset_shelves" position={[-3.42, 0, -2.72]} scale={0.78} />
      <GroundedKitProp model="wall_inset_candles" position={[3.42, 0, -2.72]} scale={0.78} />
      <GroundedKitProp model="banner_brown" position={[-2.02, 0.42, -2.82]} scale={0.67} warm />
      <GroundedKitProp model="banner_brown" position={[2.02, 0.42, -2.82]} scale={0.67} warm />
      <GroundedKitProp model="bench" position={[-2.95, 0, 0.2]} rotationY={Math.PI / 2} scale={0.62} warm />
      <GroundedKitProp model="bench" position={[2.95, 0, 0.2]} rotationY={-Math.PI / 2} scale={0.62} warm />
      <HiddenEnemies />
      <Lumora />
      <Dust />
      <TitleCamera entering={entering} onComplete={onComplete} />
      <TitlePostEffects />
      <Preload all />
    </>
  );
}

export function TitleScreenScene({ entering, onComplete }: { entering: boolean; onComplete: () => void }) {
  return (
    <Canvas
      className="title-screen-canvas"
      dpr={[1, 1.5]}
      gl={{ powerPreference: 'high-performance', antialias: true }}
      camera={{ fov: 48, near: 0.1, far: 40, position: [0, 3.15, 12.4] }}
    >
      <Vestibule entering={entering} onComplete={onComplete} />
    </Canvas>
  );
}
