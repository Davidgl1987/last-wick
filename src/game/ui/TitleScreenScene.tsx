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
import type { Group, Mesh, PointLight, Points } from 'three';
import { kitGeometry, kitGeometryPart, kitMaterial, kitWarmMaterial } from '@/game/render/kit';
import { kitBoxSize, kitGroundOffset, kitTopAlignOffset, kitXZCenteredGeometry } from '@/game/render/kit-fit';
import {
  blobShadowMaterial,
  chaserMaterial,
  dummyMaterial,
  heroMaterial,
  smallDotGeometry,
  unitCircle,
  unitCone,
  unitPlane,
  unitSphere,
} from '@/game/render/assets';
import {
  candleEyeMaterial,
  candleFlameMaterial,
  chaserEyeGlowMaterial,
  dummyEyeGlowMaterial,
  dummySkirtMaterial,
  titleDustGeometry,
  titleDustMaterial,
  titleVoidMaterial,
} from '@/game/render/assets-dark';
import type { KitModelName } from '@/game/render/kit-models';
import { TitlePostEffects } from '@/game/render/PostEffects';

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

function Lumora() {
  const groupRef = useRef<Group>(null);
  const flameRef = useRef<Mesh>(null);
  const lightRef = useRef<PointLight>(null);
  // La misma pieza `candle_melted` que `HeroView` normaliza para Lumora.
  const candle = useMemo(() => kitXZCenteredGeometry(kitGeometry('candle_melted')), []);
  const box = candle.boundingBox;
  if (!box) throw new Error('la vela del kit no trae boundingBox calculado');
  const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const scale = 0.54 / width;
  const bodyTop = box.max.y * scale;
  const bodyGround = -box.min.y * scale;

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const pulse = 1 + Math.sin(time * 3.1) * 0.055 + Math.sin(time * 5.7) * 0.035;
    if (flameRef.current) flameRef.current.scale.set(0.16 * pulse, 0.3 * pulse, 0.16 * pulse);
    if (lightRef.current) lightRef.current.intensity = 18 + Math.sin(time * 3.1) * 1.2 + Math.sin(time * 5.7) * 0.7;
    if (groupRef.current) groupRef.current.rotation.z = Math.sin(time * 0.75) * 0.012;
  });

  return (
    <group ref={groupRef} position={[0, 0.02, 2.35]}>
      <mesh geometry={candle} material={heroMaterial} position={[0, bodyGround, 0]} scale={scale} />
      <group position={[0, bodyGround + bodyTop * 0.56, 0.265]}>
        <mesh geometry={smallDotGeometry} material={candleEyeMaterial} position={[-0.105, 0, 0]} scale={[0.065, 0.1, 0.04]} />
        <mesh geometry={smallDotGeometry} material={candleEyeMaterial} position={[0.105, 0, 0]} scale={[0.065, 0.1, 0.04]} />
      </group>
      <mesh ref={flameRef} geometry={unitCone} material={candleFlameMaterial} position={[0, bodyGround + bodyTop + 0.14, 0]} />
      <pointLight ref={lightRef} color="#ffc06c" distance={5.8} decay={2} position={[0, bodyGround + bodyTop + 0.22, 0.18]} />
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
