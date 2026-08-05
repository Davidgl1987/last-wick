/**
 * Estructura estática del escenario, construida con piezas del KayKit Dungeon
 * Pack (docs/plans/ART_KIT_PLAN.md, F2). Capa de render PURA: no toca la
 * simulación — los `Obstacle`/AABB de `world/` siguen siendo la única fuente
 * de verdad de colisión, esto solo decide QUÉ malla dibujar sobre cada uno.
 *
 * Modo sala única (world.dungeon === null, playtest del editor): suelo, 4
 * paredes, postes de esquina y rocas.
 *
 * Modo mazmorra (GDD §10): renderiza TODAS las salas colocadas en el plano —
 * un suelo por sala (rejilla de `floor_tile_large` + parches de
 * `floor_tile_small` bajo los huecos de puerta), muros/rocas instanciados Y
 * AGRUPADOS POR SALA (antes se dibujaba la mazmorra entera en 2 InstancedMesh
 * globales; agrupar por sala devuelve el frustum culling automático de
 * three.js — con un instanced global el culling sería todo-o-nada, ver
 * ART_KIT_PLAN §5 F2), postes de esquina, y los portones de puerta cerrados.
 * Los muros son estáticos; los portones se reconstruyen solo cuando
 * `world.wallVersion` cambia (abrir una puerta, evento raro).
 *
 * Todas las piezas comparten `kitMaterial` (1 material/1 textura para todo el
 * kit, ver kit.ts) salvo el portón de llave, que usa un clon teñido de
 * dorado — nunca se muta `kitMaterial` en sí, que lo comparte todo lo demás.
 */

import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { DOOR_WIDTH, WALL_THICKNESS } from '@/game/world/constants';
import type { DoorConnection } from '@/game/features/dungeon/dungeon';
import { QUEEN_COLUMN_ID_PREFIX } from '@/game/features/bosses/queen/constants';
import { DOOR_GATE_ID_PREFIX } from '@/game/features/dungeon/dungeon-world';
import type { Obstacle, World } from '@/game/world/types';
import { kitGeometry, kitMaterial } from './kit';
import { kitBoxSize, kitGroundOffset, kitTopAlignOffset } from './kit-fit';
import { wallModuleLayout } from './wall-modules';

function isWallObstacle(o: Obstacle): boolean {
  return o.id.includes('-wall-');
}

function isGateObstacle(o: Obstacle): boolean {
  return o.id.startsWith(DOOR_GATE_ID_PREFIX);
}

/**
 * true si este `Obstacle` es una columna destructible de la Reina del
 * Enjambre (T2 render, GDD §15.3): su id LOCAL (tras el `roomId:` opcional)
 * empieza por `column` — mismo criterio que `queen/pattern.ts::queenOnInit`
 * usa para poblar el estado de la Reina. Se excluyen del pintado genérico de
 * rocas para que NO se dibujen dos veces: `QueenColumnsView` (montado desde
 * GameRoot) es el único que las pinta, en sus 3 estados (intacta/agrietada/
 * escombros) leyendo `queenState(world).columns`, que sigue siendo la fuente
 * de verdad incluso tras romperse (cuando ya no queda `Obstacle`).
 */
function isQueenColumnObstacle(o: Obstacle): boolean {
  const local = o.id.includes(':') ? o.id.slice(o.id.lastIndexOf(':') + 1) : o.id;
  return local.startsWith(QUEEN_COLUMN_ID_PREFIX);
}

// ── Suelo: rejilla de floor_tile_large por sala ────────────────────────────

/**
 * Fracción del tamaño natural de la baldosa que se usa como tamaño objetivo
 * en pantalla. El kit está modelado para un personaje humano de pie (§2 del
 * plan) y su baldosa "grande" mide 3.36 u — SIETE veces el diámetro del héroe
 * (0.48 u): a tamaño natural la sala se leía como un suelo gigantesco con un
 * bicho encima (playtest de David, 2026-08-05). A la mitad, cada baldosa es
 * ~3.5 veces la bola, que es la proporción que se lee bien desde la cámara
 * cenital. Se estira la MISMA pieza en vez de usar `floor_tile_small`
 * (1.68 u de fábrica) a propósito: la pequeña es una losa lisa y perdería el
 * relieve octogonal, que es justo lo que hace que el suelo se lea como suelo.
 */
const FLOOR_TILE_SCALE = 0.5;

/**
 * Rejilla de `floor_tile_large` cubriendo un rectángulo `width × height`
 * centrado en `(originX, originY)`: `nx × nz` baldosas (`ceil`, nunca menos
 * de las que hacen falta para cubrir el rectángulo entero — a diferencia de
 * `wallModuleLayout`, que usa `round` porque un muro tolera ±15% de estirado
 * en un sillar puntual, ver wall-modules.ts) cada una ESTIRADA en X/Z (mismo
 * criterio de "escala = longitud/(nº piezas·tamaño natural)" que
 * `wallModuleLayout`, aplicado aquí directamente porque el redondeo de conteo
 * es distinto) para que la rejilla cubra el rectángulo EXACTO sin dejar
 * ningún borde de sala sin baldosa.
 */
function FloorGrid({
  width,
  height,
  originX,
  originY,
}: {
  width: number;
  height: number;
  originX: number;
  originY: number;
}) {
  const geometry = kitGeometry('floor_tile_large');
  const tileSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  const topY = useMemo(() => kitTopAlignOffset(geometry), [geometry]);
  // Objetivo de tamaño de baldosa EN PANTALLA, no el natural de la pieza (ver
  // FLOOR_TILE_SCALE): de él salen `nx`/`nz`, y el estirado de abajo hace el
  // resto — cada instancia acaba escalada ≈ FLOOR_TILE_SCALE sin ningún
  // cálculo aparte.
  const targetX = tileSize.x * FLOOR_TILE_SCALE;
  const targetZ = tileSize.z * FLOOR_TILE_SCALE;
  const nx = Math.max(1, Math.ceil(width / targetX));
  const nz = Math.max(1, Math.ceil(height / targetZ));
  const count = nx * nz;
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    const tileW = width / nx;
    const tileH = height / nz;
    const scaleX = tileW / tileSize.x;
    const scaleZ = tileH / tileSize.z;
    let index = 0;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const localX = -width / 2 + (ix + 0.5) * tileW;
        const localZ = -height / 2 + (iz + 0.5) * tileH;
        scratch.position.set(originX + localX, topY, originY + localZ);
        scratch.scale.set(scaleX, 1, scaleZ);
        scratch.updateMatrix();
        mesh.setMatrixAt(index++, scratch.matrix);
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }, [width, height, originX, originY, nx, nz, count, tileSize, topY]);

  // Solo recibe sombra (igual que el suelo antiguo): un suelo no proyecta
  // sombra sobre sí mismo, y el resto de piezas ya castean sobre él.
  return <instancedMesh ref={meshRef} args={[geometry, kitMaterial, count]} receiveShadow />;
}

/** Parche de suelo bajo un hueco de puerta (el paso entre interiores): `floor_tile_small` estirada al hueco, mismo criterio de altura que `FloorGrid`. */
function DoorFloorPatch({ conn }: { conn: DoorConnection }) {
  const geometry = kitGeometry('floor_tile_small');
  const size = useMemo(() => kitBoxSize(geometry), [geometry]);
  const topY = useMemo(() => kitTopAlignOffset(geometry), [geometry]);
  const t = WALL_THICKNESS;
  const horizontal = conn.sideOnA === 'east' || conn.sideOnA === 'west';
  const dirSign = conn.sideOnA === 'east' || conn.sideOnA === 'south' ? 1 : -1;
  const cx = conn.center.x + (horizontal ? (dirSign * t) / 2 : 0);
  const cz = conn.center.y + (horizontal ? 0 : (dirSign * t) / 2);
  const width = horizontal ? t : DOOR_WIDTH;
  const depth = horizontal ? DOOR_WIDTH : t;

  return (
    <mesh
      geometry={geometry}
      material={kitMaterial}
      position={[cx, topY, cz]}
      scale={[width / size.x, 1, depth / size.z]}
      receiveShadow
    />
  );
}

// ── Muros: módulos de barrier a lo largo del eje largo del AABB ───────────

/** Tramo de muro a cubrir con módulos: longitud a lo largo de su eje largo, centro, y si ese eje largo es X (horizontal) o Z (vertical, requiere rotar 90°). */
interface WallSpan {
  length: number;
  cx: number;
  cz: number;
  horizontal: boolean;
}

/**
 * Instancia módulos de `barrier` sobre una lista de tramos (`spans`), cada
 * uno subdividido por `wallModuleLayout` en `count` módulos que cubren su
 * longitud EXACTA. Un único `InstancedMesh` para TODOS los tramos que se le
 * pasen — el llamador decide el agrupamiento (por sala, en `RoomWalls`; los 4
 * tramos fijos de `SingleRoomView`).
 */
function BarrierModules({ spans }: { spans: WallSpan[] }) {
  const geometry = kitGeometry('barrier');
  const moduleLength = useMemo(() => kitBoxSize(geometry).x, [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const totalCount = useMemo(
    () => spans.reduce((sum, span) => sum + wallModuleLayout(span.length, moduleLength).count, 0),
    [spans, moduleLength],
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    let index = 0;
    for (const span of spans) {
      const { count, scale } = wallModuleLayout(span.length, moduleLength);
      const segmentLength = span.length / count;
      for (let i = 0; i < count; i++) {
        const offset = -span.length / 2 + (i + 0.5) * segmentLength;
        if (span.horizontal) {
          scratch.position.set(span.cx + offset, groundY, span.cz);
          scratch.rotation.set(0, 0, 0);
        } else {
          scratch.position.set(span.cx, groundY, span.cz + offset);
          scratch.rotation.set(0, Math.PI / 2, 0);
        }
        scratch.scale.set(scale, 1, 1);
        scratch.updateMatrix();
        mesh.setMatrixAt(index++, scratch.matrix);
      }
    }
    mesh.count = totalCount;
    mesh.instanceMatrix.needsUpdate = true;
  }, [spans, moduleLength, groundY, totalCount]);

  if (totalCount === 0) return null;
  // Sombras (playtest histórico, ver comentario largo de DoorGates más abajo): muros castean y reciben.
  return <instancedMesh ref={meshRef} args={[geometry, kitMaterial, totalCount]} castShadow receiveShadow />;
}

/** Convierte los `Obstacle` de muro de UNA sala en tramos para `BarrierModules` (eje largo = el más largo del AABB). */
function RoomWalls({ walls }: { walls: Obstacle[] }) {
  const spans = useMemo<WallSpan[]>(
    () =>
      walls.map((wall) => {
        const { minX, minY, maxX, maxY } = wall.aabb;
        const width = maxX - minX;
        const depth = maxY - minY;
        const horizontal = width >= depth;
        return {
          length: horizontal ? width : depth,
          cx: (minX + maxX) / 2,
          cz: (minY + maxY) / 2,
          horizontal,
        };
      }),
    [walls],
  );
  return <BarrierModules spans={spans} />;
}

// ── Rocas: variante determinista por id, escaladas a su AABB ──────────────

const ROCK_VARIANTS = ['rocks', 'rocks_small', 'rocks_decorated'] as const;
type RockVariant = (typeof ROCK_VARIANTS)[number];

/**
 * Variante de roca DETERMINISTA a partir del id del obstáculo (nunca
 * `Math.random()`: el render debe ser reproducible entre recargas de la
 * misma sala/semilla, igual que el resto de la sim). Hash de cadena simple
 * (multiplicador primo, mismo patrón que un `djb2`/FNV minimalista) — no
 * necesita ser criptográfico, solo repartir ids arbitrarios entre 3 cubos de
 * forma estable.
 */
function pickRockVariant(id: string): RockVariant {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return ROCK_VARIANTS[Math.abs(hash) % ROCK_VARIANTS.length];
}

/** Instancias de UNA variante de roca (mismo geometry para todas: requisito de InstancedMesh). */
function RockVariantInstances({ rocks, variant }: { rocks: Obstacle[]; variant: RockVariant }) {
  const geometry = kitGeometry(variant);
  const footprint = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    for (let i = 0; i < rocks.length; i++) {
      const { minX, minY, maxX, maxY } = rocks[i].aabb;
      scratch.position.set((minX + maxX) / 2, groundY, (minY + maxY) / 2);
      // Solo se escala el footprint (X/Z) al AABB de colisión; la altura (Y)
      // se deja natural (ya viene a KIT_SCALE, ver kit.ts) — el AABB del
      // obstáculo es 2D (sin componente de altura), así que no hay una
      // "altura objetivo" que perseguir.
      scratch.scale.set((maxX - minX) / footprint.x, 1, (maxY - minY) / footprint.z);
      scratch.rotation.set(0, 0, 0);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }
    mesh.count = rocks.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [rocks, footprint, groundY]);

  if (rocks.length === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, kitMaterial, rocks.length]} castShadow receiveShadow />;
}

/** Reparte una lista de obstáculos-roca entre sus hasta 3 variantes (una InstancedMesh por variante presente). */
function RoomRocks({ rocks }: { rocks: Obstacle[] }) {
  const byVariant = useMemo(() => {
    const map = new Map<RockVariant, Obstacle[]>();
    for (const rock of rocks) {
      const variant = pickRockVariant(rock.id);
      const bucket = map.get(variant);
      if (bucket) bucket.push(rock);
      else map.set(variant, [rock]);
    }
    return map;
  }, [rocks]);

  return (
    <>
      {ROCK_VARIANTS.map((variant) => (
        <RockVariantInstances key={variant} rocks={byVariant.get(variant) ?? []} variant={variant} />
      ))}
    </>
  );
}

// ── Postes de esquina: acento vertical puro, sin colisión ─────────────────

/** `column` en las 4 esquinas de un rectángulo `halfW×halfH` (interior de sala) centrado en `(originX, originY)`, justo donde se cruzan los muros. Visual puro: no genera `Obstacle`, la sim no lo conoce. */
function CornerColumns({
  halfW,
  halfH,
  t,
  originX,
  originY,
}: {
  halfW: number;
  halfH: number;
  t: number;
  originX: number;
  originY: number;
}) {
  const geometry = kitGeometry('column');
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const corners = useMemo(
    () => [
      [halfW + t / 2, halfH + t / 2],
      [halfW + t / 2, -(halfH + t / 2)],
      [-(halfW + t / 2), halfH + t / 2],
      [-(halfW + t / 2), -(halfH + t / 2)],
    ],
    [halfW, halfH, t],
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    corners.forEach(([dx, dz], i) => {
      scratch.position.set(originX + dx, groundY, originY + dz);
      scratch.scale.set(1, 1, 1);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    });
    mesh.count = corners.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [corners, groundY, originX, originY]);

  return <instancedMesh ref={meshRef} args={[geometry, kitMaterial, corners.length]} castShadow receiveShadow />;
}

// ── Portones de puerta ──────────────────────────────────────────────────────

/**
 * Pieza elegida para el portón cerrado (ART_KIT_PLAN §4/F2). COMPARACIÓN YA
 * HECHA, en playtest de David (2026-08-05): 'grate' (`floor_tile_grate` de
 * canto) **se veía desde un lado y desaparecía desde el otro** — sólo
 * quedaban en el suelo las sombras de los barrotes. La causa está en el
 * modelo, no en cómo se colocaba: es una rejilla de SUELO, pensada para
 * mirarse desde arriba, y reparte su superficie de forma muy asimétrica —
 * 8.28 de área en la cara Y+ (los barrotes) contra 1.32 en Y-. Puesta de
 * canto, esa cara casi vacía es justo la que ve el jugador desde el otro
 * lado del muro. `wall_gated`, en cambio, es una pieza de MURO y está
 * modelada simétrica (12.74 de área en Z- contra 12.68 en Z+): se lee igual
 * de bien por las dos caras, que es exactamente lo que un portón necesita.
 *
 * Se deja la constante (y la rama 'grate') porque el coste de mantenerla es
 * nulo y documenta la alternativa descartada con su motivo.
 */
const DOOR_GATE_STYLE: 'grate' | 'gated' = 'gated';

/**
 * Altura del portón cerrado, en unidades de juego. NO es la altura natural de
 * la pieza: `wall_gated` es un muro entero de 3.36 u (el kit está pensado
 * para un personaje de pie, ver ART_KIT_PLAN §2) y a esa altura taparía ~2.2
 * u de sala por detrás — el mismo problema de oclusión por el que los muros
 * son parapetos y no muros completos. Este valor conserva la altura que ya
 * tenía el portón de rejilla en playtest (que a David no le estorbó la
 * lectura de la sala) y deja la pieza casi sin deformar: con un hueco de
 * puerta de 2 u, las escalas salen ≈0.60 en X y 0.50 en Y/Z — un 20 % de
 * diferencia entre ejes, imperceptible en unos barrotes.
 */
const DOOR_GATE_HEIGHT = 1.7;

/** Material del portón de LLAVE (dorado, distinto del normal): clon de `kitMaterial` teñido, creado UNA vez — nunca se muta `kitMaterial`, que comparte todo el kit. */
const doorKeyGateMaterial = kitMaterial.clone();
doorKeyGateMaterial.color = new THREE.Color('#d9a531');

/** Instancias de portón para un subconjunto de puertas (normales o de llave) que comparten geometría y material. */
function DoorGateInstances({
  gates,
  geometry,
  material,
  naturalSize,
  groundY,
}: {
  gates: Obstacle[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  naturalSize: THREE.Vector3;
  groundY: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    for (let i = 0; i < gates.length; i++) {
      const { minX, minY, maxX, maxY } = gates[i].aabb;
      const width = maxX - minX;
      const depth = maxY - minY;
      const horizontal = width >= depth;
      const longTarget = horizontal ? width : depth;
      const shortTarget = horizontal ? depth : width;
      // Escala vertical explícita (ver DOOR_GATE_HEIGHT): la pieza NO se deja
      // a su altura natural. El apoyo en el suelo se escala con ella —
      // `groundY` es el desplazamiento para la geometría SIN escalar, y en la
      // matriz TRS la escala se aplica antes que la traslación.
      const heightScale = DOOR_GATE_HEIGHT / naturalSize.y;
      scratch.position.set((minX + maxX) / 2, groundY * heightScale, (minY + maxY) / 2);
      scratch.rotation.set(0, horizontal ? 0 : Math.PI / 2, 0);
      scratch.scale.set(longTarget / naturalSize.x, heightScale, shortTarget / naturalSize.z);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }
    mesh.count = gates.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [gates, geometry, material, naturalSize, groundY]);

  if (gates.length === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, gates.length]} castShadow receiveShadow />;
}

/** Portones de puerta cerrados: pocos (≤ nº de conexiones), reconstruidos al abrir puertas. */
function DoorGates({ world }: { world: World }) {
  const [version, setVersion] = useState(world.wallVersion);

  // Sondeo barato por frame (una comparación de enteros); setState SOLO
  // cuando una puerta cambió de estado — evento raro, no por frame.
  useFrame(() => {
    if (world.wallVersion !== version) setVersion(world.wallVersion);
  });

  // `floor_tile_grate` es una rejilla horizontal de fábrica (pensada para
  // tumbarse en el suelo); "de canto" la ponemos en pie rotándola 90° sobre
  // su eje X UNA vez, clonada (nunca se muta la geometría cacheada de
  // `kitGeometry`, que la comparte cualquier otro uso futuro del kit) y con
  // el boundingBox recalculado tras rotar — así el resto del código puede
  // tratarla exactamente igual que cualquier otra pieza "de pie"
  // (`wall_gated` incluida), sin tener que razonar sobre la rotación en cada
  // sitio donde se usa.
  const grateGeometry = useMemo(() => {
    const rotated = kitGeometry('floor_tile_grate').clone().rotateX(Math.PI / 2);
    rotated.computeBoundingBox();
    return rotated;
  }, []);
  const gatedGeometry = kitGeometry('wall_gated');
  const geometry = DOOR_GATE_STYLE === 'grate' ? grateGeometry : gatedGeometry;
  const naturalSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);

  const gates = world.obstacles.filter(isGateObstacle);
  const keyGates = gates.filter((g) => g.id.endsWith('-key'));
  const normalGates = gates.filter((g) => !g.id.endsWith('-key'));

  return (
    <>
      <DoorGateInstances
        gates={normalGates}
        geometry={geometry}
        material={kitMaterial}
        naturalSize={naturalSize}
        groundY={groundY}
      />
      <DoorGateInstances
        gates={keyGates}
        geometry={geometry}
        material={doorKeyGateMaterial}
        naturalSize={naturalSize}
        groundY={groundY}
      />
    </>
  );
}

// ── Agrupación por sala (mazmorra) ─────────────────────────────────────────

function groupByRoomId(obstacles: Obstacle[]): Map<string, Obstacle[]> {
  const map = new Map<string, Obstacle[]>();
  for (const obstacle of obstacles) {
    const key = obstacle.roomId ?? '';
    const bucket = map.get(key);
    if (bucket) bucket.push(obstacle);
    else map.set(key, [obstacle]);
  }
  return map;
}

/** Mazmorra completa: suelos, parches de puerta, muros/rocas/postes AGRUPADOS POR SALA (frustum culling, ver cabecera) y portones. */
function DungeonStructureView({ world }: { world: World }) {
  const dungeon = world.dungeon;
  // Muros y rocas son estáticos durante la run: se calculan una vez por mundo.
  const staticBoxes = useMemo(() => {
    return {
      walls: world.obstacles.filter(isWallObstacle),
      rocks: world.obstacles.filter((o) => !isWallObstacle(o) && !isGateObstacle(o) && !isQueenColumnObstacle(o)),
    };
  }, [world]);
  const wallsByRoom = useMemo(() => groupByRoomId(staticBoxes.walls), [staticBoxes.walls]);
  const rocksByRoom = useMemo(() => groupByRoomId(staticBoxes.rocks), [staticBoxes.rocks]);

  if (!dungeon) return null;
  const t = WALL_THICKNESS;

  return (
    <group>
      {dungeon.rooms.map((placed) => (
        <FloorGrid
          key={`floor-${placed.room.id}`}
          width={placed.room.width}
          height={placed.room.height}
          originX={placed.origin.x}
          originY={placed.origin.y}
        />
      ))}
      {dungeon.connections.map((conn, i) => (
        <DoorFloorPatch key={`door-floor-${i}`} conn={conn} />
      ))}
      {dungeon.rooms.map((placed) => (
        <RoomWalls key={`walls-${placed.room.id}`} walls={wallsByRoom.get(placed.room.id) ?? []} />
      ))}
      {dungeon.rooms.map((placed) => (
        <RoomRocks key={`rocks-${placed.room.id}`} rocks={rocksByRoom.get(placed.room.id) ?? []} />
      ))}
      {dungeon.rooms.map((placed) => (
        <CornerColumns
          key={`columns-${placed.room.id}`}
          halfW={placed.room.width / 2}
          halfH={placed.room.height / 2}
          t={t}
          originX={placed.origin.x}
          originY={placed.origin.y}
        />
      ))}
      <DoorGates world={world} />
    </group>
  );
}

/** Sala única (modo histórico / playtest del editor). */
function SingleRoomView({ world }: { world: World }) {
  const { width, height } = world.room;
  const halfW = width / 2;
  const halfH = height / 2;
  const t = WALL_THICKNESS;

  // 4 tramos de muro fijos: norte/sur cubren TODO el ancho más las esquinas
  // (width + 2t), este/oeste solo el tramo entre ellos (height, sin +2t) —
  // así norte/sur ya sellan las esquinas y este/oeste no las vuelve a cubrir
  // por duplicado. Mismo criterio que el código anterior (cajas), ahora en
  // tramos para `BarrierModules`.
  const wallSpans = useMemo<WallSpan[]>(
    () => [
      { length: width + 2 * t, cx: 0, cz: -(halfH + t / 2), horizontal: true },
      { length: width + 2 * t, cx: 0, cz: halfH + t / 2, horizontal: true },
      { length: height, cx: -(halfW + t / 2), cz: 0, horizontal: false },
      { length: height, cx: halfW + t / 2, cz: 0, horizontal: false },
    ],
    [width, height, halfW, halfH, t],
  );

  return (
    <group>
      <FloorGrid width={width} height={height} originX={0} originY={0} />
      <BarrierModules spans={wallSpans} />
      <CornerColumns halfW={halfW} halfH={halfH} t={t} originX={0} originY={0} />
      {/* Rocas (obstáculos AABB). Las columnas de la Reina (`isQueenColumnObstacle`)
          se excluyen aquí: las pinta QueenColumnsView desde queenState(world).columns,
          con estado intacta/agrietada/escombros — ver comentario de cabecera. */}
      <RoomRocks rocks={world.obstacles.filter((o) => !isQueenColumnObstacle(o))} />
    </group>
  );
}

export function RoomView({ world }: { world: World }) {
  if (world.dungeon) {
    return <DungeonStructureView world={world} />;
  }
  return <SingleRoomView world={world} />;
}
