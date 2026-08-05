/**
 * Hazards estáticos de la sala (GDD §8): foso, pinchos, barro, acelerador
 * (no cambian de tamaño/posición durante la sala, se construyen una vez).
 * Los barriles son vivos (pueden explotar) y se gestionan aparte con
 * BarrelViews, que sí lee la sim cada frame.
 *
 * Piezas del kit KayKit desde F3 (docs/plans/ART_KIT_PLAN.md §4/§5): el
 * barril y el campo de pinchos pasan a geometría real del kit; el foso
 * conserva su quad negro (legibilidad, ver más abajo) y gana un reborde de
 * piezas de fundación alrededor. Barro/acelerador se QUEDAN como quads
 * emisivos (no hay pieza equivalente en el kit, fuera de alcance de F3).
 *
 * Legibilidad (feedback de playtest):
 * - El foso (ronda 3, punto 6: "quita el borde al foso") es un único quad
 *   negro casi absoluto sobre el suelo claro: el contraste suelo/agujero ya
 *   es inconfundible por sí solo. El reborde que añade F3 (`PitRim`) se
 *   coloca POR FUERA del rectángulo exacto del hazard — jamás invade el quad
 *   negro — precisamente para no reabrir ese problema.
 * - El barril usa `barrel_small`/`barrel_large` del kit (elegido por el radio
 *   declarado del hazard); al explotar desaparece y deja una mancha
 *   chamuscada en el suelo, igual que antes.
 * - Los pinchos (punto 1 de playtest: "los pinchos no lo parecen") usan
 *   `floor_tile_big_spikes` TILEADA para cubrir EXACTAMENTE el área que hace
 *   daño (ver `SpikesField`): ni un pincho fuera de esa área.
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
import { blobShadowMaterial, boostMaterial, mudMaterial, pitMaterial, scorchMaterial, unitCircle, unitPlane } from '@/game/render/assets';
import { kitGeometry, kitMaterial } from '@/game/render/kit';
import { kitBoxSize, kitGroundOffset } from '@/game/render/kit-fit';
import { wallModuleLayout } from '@/game/render/wall-modules';

const HAZARD_QUAD_Y = 0.03;
/** Rebote visual del barril al aterrizar (GDD §15.2): altura y duración del pequeño arco tras tocar suelo. Puramente de render. */
const BARREL_BOUNCE_HEIGHT = 0.28;
const BARREL_BOUNCE_DURATION = 0.22;
/**
 * Umbral de radio (u) para elegir `barrel_large` en vez de `barrel_small`
 * (ART_KIT_PLAN §4). Hoy TODOS los barriles del juego declaran radio 0.4 —
 * los de hazard (combat-barrels.json, boss-den.json, combat-arena.json) y los
 * que lanza el Guardián (`GUARDIAN_BARREL_RADIUS`) — así que este umbral no
 * cambia nada del juego actual; solo entra en juego si algún nivel futuro
 * declarase un barril claramente más grande. Corte a medio camino entre el
 * radio estándar (0.4) y uno "claramente grande" (el doble, 0.8).
 */
const BARREL_LARGE_RADIUS_THRESHOLD = 0.6;
/**
 * Fracción del tamaño natural de `floor_tile_big_spikes` usada como "celda"
 * de la rejilla que cubre el hazard — mismo criterio que `FLOOR_TILE_SCALE`
 * de RoomView.tsx, valor más pequeño a propósito: los campos de pinchos son
 * mucho más estrechos que una sala (hay uno de 1×2.6 u en
 * combat-gauntlet.json) y una celda grande forzaría una única baldosa muy
 * estirada en el eje corto — con 0.4 la celda natural (3.36 u) se reduce a
 * ~1.34 u, lo bastante pequeña para que ambos ejes queden razonablemente
 * parejos incluso en hazards estrechos (verificado a mano contra los tamaños
 * reales de los niveles).
 */
const SPIKES_TILE_SCALE = 0.4;

/**
 * Campo de pinchos (ART_KIT_PLAN §4/F3): `floor_tile_big_spikes` tileada para
 * cubrir el rectángulo EXACTO del hazard (`hazard.width × hazard.height`),
 * mismo patrón que `FloorGrid` de RoomView.tsx (rejilla `nx × nz` con `ceil`,
 * cada baldosa estirada para que `nx` baldosas cubran `width` exactamente) —
 * a diferencia de `wallModuleLayout` (que redondea y tolera un pequeño
 * desajuste en un sillar puntual), aquí NO se puede tolerar ni un pincho
 * colgando fuera del área que hace daño (requisito CRÍTICO del encargo: la
 * superficie visible tiene que coincidir con el área de daño). Como la
 * rejilla cubre el rectángulo EXACTO y cada baldosa se estira para encajar
 * dentro de su celda, ningún pincho puede sobresalir del borde declarado del
 * hazard.
 */
function SpikesField({ hazard }: { hazard: HazardSpawn }) {
  const geometry = kitGeometry('floor_tile_big_spikes');
  const tileSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  // `floor_tile_big_spikes` SÍ apoya en su min.y (a diferencia de
  // floor_tile_large/floor_tile_small, ver comentario de kitTopAlignOffset en
  // kit-fit.ts): verificado contra su .gltf, las agujas nacen en y=0 y la
  // base de la losa va de y=-0.1 a y=+0.1 alrededor de ese mismo plano — así
  // que el offset correcto es kitGroundOffset (alinear el mínimo a 0), NO
  // kitTopAlignOffset (que hundiría toda la pieza bajo tierra, porque el
  // máximo del boundingBox aquí es la PUNTA de la aguja, no la superficie
  // caminable).
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const targetSize = tileSize.x * SPIKES_TILE_SCALE; // pieza cuadrada de fábrica (4×4): mismo objetivo en X y en Z
  const nx = Math.max(1, Math.ceil(hazard.width / targetSize));
  const nz = Math.max(1, Math.ceil(hazard.height / targetSize));
  const count = nx * nz;
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    const tileW = hazard.width / nx;
    const tileH = hazard.height / nz;
    const scaleX = tileW / tileSize.x;
    const scaleZ = tileH / tileSize.z;
    let index = 0;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const localX = -hazard.width / 2 + (ix + 0.5) * tileW;
        const localZ = -hazard.height / 2 + (iz + 0.5) * tileH;
        scratch.position.set(hazard.position.x + localX, groundY, hazard.position.y + localZ);
        scratch.scale.set(scaleX, 1, scaleZ);
        scratch.updateMatrix();
        mesh.setMatrixAt(index++, scratch.matrix);
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }, [hazard.width, hazard.height, hazard.position.x, hazard.position.y, nx, nz, count, tileSize, groundY]);

  return <instancedMesh ref={meshRef} args={[geometry, kitMaterial, count]} castShadow receiveShadow />;
}

/**
 * Foso (punto 6 de playtest ronda 3: "quita el borde al foso"): un único quad
 * negro casi absoluto sobre el suelo claro, sin reborde que INVADA el quad.
 * El contraste suelo-claro/agujero-negro ya es inconfundible por sí solo; el
 * reborde de piedra que añade `PitRim` (F3) queda por fuera del rectángulo,
 * así que no reabre el problema de ruido visual que motivó quitarlo.
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

// ── Reborde del foso: fundación de piedra alrededor del agujero ──────────

/** Tramo recto a cubrir con módulos de `floor_foundation_front` (mismo contrato que WallSpan de RoomView.tsx, redefinido aquí para no acoplar este fichero a esa vista). */
interface RimSpan {
  length: number;
  cx: number;
  cz: number;
  horizontal: boolean;
}

/** Altura del reborde del foso: un simple bordillo bajo, muy por debajo del parapeto (WALL_HEIGHT≈0.9) para no competir con el negro del agujero — es un remate, no una pared. */
const PIT_RIM_HEIGHT = 0.14;
/** Cuánto sobresale el reborde hacia FUERA del borde del foso (perpendicular al filo): un bordillo visible pero modesto, no una plataforma. */
const PIT_RIM_DEPTH = 0.35;

/**
 * Reborde de piedra alrededor del foso (ART_KIT_PLAN §4/F3): se coloca POR
 * FUERA del rectángulo exacto del hazard (nunca invade el quad negro de
 * `PitQuad`) — 4 tramos rectos de `floor_foundation_front`, subdivididos con
 * el MISMO helper `wallModuleLayout` que usan los muros de RoomView.tsx (para
 * que cada tramo quede cubierto exacto sin huecos ni piezas colgando), más 4
 * esquinas de `floor_foundation_corner`. Mismo patrón de agrupación que
 * `BarrierModules`/`CornerColumns`: los tramos norte/sur sellan las esquinas
 * (`width + 2·PIT_RIM_DEPTH`) y este/oeste solo cubren el hueco entre ellos
 * (`height`), igual que los 4 tramos fijos de `SingleRoomView`.
 *
 * Aplastado a `PIT_RIM_HEIGHT` y recortado a `PIT_RIM_DEPTH` en el eje
 * perpendicular: la pieza nativa del kit es mucho más alta y profunda (está
 * pensada para verse desde dentro de un hueco 3D real), y este hazard NO
 * tiene un agujero de verdad (solo el quad negro) — aquí se usa como un
 * simple remate decorativo, no como una pared.
 */
function PitRim({ hazard }: { hazard: HazardSpawn }) {
  const frontGeometry = kitGeometry('floor_foundation_front');
  const frontSize = useMemo(() => kitBoxSize(frontGeometry), [frontGeometry]);
  const frontGroundY = useMemo(() => kitGroundOffset(frontGeometry), [frontGeometry]);
  const cornerGeometry = kitGeometry('floor_foundation_corner');
  const cornerSize = useMemo(() => kitBoxSize(cornerGeometry), [cornerGeometry]);
  const cornerGroundY = useMemo(() => kitGroundOffset(cornerGeometry), [cornerGeometry]);

  const heightScale = PIT_RIM_HEIGHT / frontSize.y;
  const depthScale = PIT_RIM_DEPTH / frontSize.z;
  const cornerHeightScale = PIT_RIM_HEIGHT / cornerSize.y;
  // La esquina es aproximadamente cuadrada de fábrica (footprint ≈ frontSize.z
  // en ambos ejes): se escala UNIFORMEMENTE en XZ al mismo `PIT_RIM_DEPTH` que
  // los tramos rectos, para que el remate luzca de grosor constante en toda
  // la vuelta.
  const cornerFootprintScale = PIT_RIM_DEPTH / cornerSize.z;

  const spans = useMemo<RimSpan[]>(
    () => [
      {
        length: hazard.width + 2 * PIT_RIM_DEPTH,
        cx: hazard.position.x,
        cz: hazard.position.y - hazard.height / 2 - PIT_RIM_DEPTH / 2,
        horizontal: true,
      },
      {
        length: hazard.width + 2 * PIT_RIM_DEPTH,
        cx: hazard.position.x,
        cz: hazard.position.y + hazard.height / 2 + PIT_RIM_DEPTH / 2,
        horizontal: true,
      },
      {
        length: hazard.height,
        cx: hazard.position.x - hazard.width / 2 - PIT_RIM_DEPTH / 2,
        cz: hazard.position.y,
        horizontal: false,
      },
      {
        length: hazard.height,
        cx: hazard.position.x + hazard.width / 2 + PIT_RIM_DEPTH / 2,
        cz: hazard.position.y,
        horizontal: false,
      },
    ],
    [hazard.width, hazard.height, hazard.position.x, hazard.position.y],
  );

  const frontMeshRef = useRef<THREE.InstancedMesh>(null);
  const totalCount = useMemo(
    () => spans.reduce((sum, span) => sum + wallModuleLayout(span.length, frontSize.x).count, 0),
    [spans, frontSize.x],
  );

  useLayoutEffect(() => {
    const mesh = frontMeshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    let index = 0;
    for (const span of spans) {
      const { count, scale } = wallModuleLayout(span.length, frontSize.x);
      const segmentLength = span.length / count;
      for (let i = 0; i < count; i++) {
        const offset = -span.length / 2 + (i + 0.5) * segmentLength;
        if (span.horizontal) {
          scratch.position.set(span.cx + offset, frontGroundY * heightScale, span.cz);
          scratch.rotation.set(0, 0, 0);
        } else {
          scratch.position.set(span.cx, frontGroundY * heightScale, span.cz + offset);
          scratch.rotation.set(0, Math.PI / 2, 0);
        }
        scratch.scale.set(scale, heightScale, depthScale);
        scratch.updateMatrix();
        mesh.setMatrixAt(index++, scratch.matrix);
      }
    }
    mesh.count = totalCount;
    mesh.instanceMatrix.needsUpdate = true;
  }, [spans, frontSize.x, frontGroundY, heightScale, depthScale, totalCount]);

  const cornerMeshRef = useRef<THREE.InstancedMesh>(null);
  const corners = useMemo(
    () => [
      { dx: hazard.width / 2 + PIT_RIM_DEPTH / 2, dz: hazard.height / 2 + PIT_RIM_DEPTH / 2, rot: 0 },
      { dx: -(hazard.width / 2 + PIT_RIM_DEPTH / 2), dz: hazard.height / 2 + PIT_RIM_DEPTH / 2, rot: Math.PI / 2 },
      { dx: -(hazard.width / 2 + PIT_RIM_DEPTH / 2), dz: -(hazard.height / 2 + PIT_RIM_DEPTH / 2), rot: Math.PI },
      { dx: hazard.width / 2 + PIT_RIM_DEPTH / 2, dz: -(hazard.height / 2 + PIT_RIM_DEPTH / 2), rot: -Math.PI / 2 },
    ],
    [hazard.width, hazard.height],
  );

  useLayoutEffect(() => {
    const mesh = cornerMeshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    corners.forEach((c, i) => {
      scratch.position.set(hazard.position.x + c.dx, cornerGroundY * cornerHeightScale, hazard.position.y + c.dz);
      scratch.rotation.set(0, c.rot, 0);
      scratch.scale.set(cornerFootprintScale, cornerHeightScale, cornerFootprintScale);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    });
    mesh.count = corners.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [corners, hazard.position.x, hazard.position.y, cornerGroundY, cornerHeightScale, cornerFootprintScale]);

  return (
    <>
      <instancedMesh ref={frontMeshRef} args={[frontGeometry, kitMaterial, totalCount]} castShadow receiveShadow />
      <instancedMesh ref={cornerMeshRef} args={[cornerGeometry, kitMaterial, corners.length]} castShadow receiveShadow />
    </>
  );
}

function StaticHazardQuad({ hazard }: { hazard: HazardSpawn }) {
  if (hazard.kind === 'pit') {
    return (
      <>
        <PitQuad hazard={hazard} />
        <PitRim hazard={hazard} />
      </>
    );
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
  // Variante del kit según el radio declarado del hazard (ART_KIT_PLAN §4):
  // hoy TODOS los niveles (combat-barrels.json, boss-den.json,
  // combat-arena.json) y los barriles que lanza el Guardián
  // (GUARDIAN_BARREL_RADIUS) usan radio 0.4, así que el resultado actual es
  // siempre 'barrel_small' — el umbral solo entraría en juego si algún nivel
  // futuro declarase un barril claramente más grande. Corte a medio camino
  // entre el radio estándar (0.4) y el doble (0.8), sin más ceremonia que la
  // de un umbral redondo.
  const variant = radius >= BARREL_LARGE_RADIUS_THRESHOLD ? 'barrel_large' : 'barrel_small';
  const geometry = kitGeometry(variant);
  const naturalSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  // Escala UNIFORME (no independiente por eje) al diámetro real del hazard:
  // barrel_small/barrel_large ya tienen su propia proporción diámetro/altura
  // modelada (ART_KIT_PLAN §2, "props con tamaño de juego propio... se
  // escalan a su AABB/radio actual") — estirar solo el ancho o solo el alto
  // rompería esa proporción y el barril se vería "de pega".
  const scale = diameter / naturalSize.x;

  return (
    <>
      <group ref={groupRef}>
        {/* Cuerpo: pieza del kit KayKit (ART_KIT_PLAN F3), elegida por tamaño y escalada uniformemente al diámetro real. */}
        <mesh geometry={geometry} material={kitMaterial} position={[0, groundY * scale, 0]} scale={scale} castShadow receiveShadow />
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
