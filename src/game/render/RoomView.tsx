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
 * ART_KIT_PLAN §5 F2), postes de esquina, y los marcos/hojas de puerta.
 * Los muros son estáticos; las hojas de puerta se reconstruyen solo cuando
 * `world.wallVersion` cambia (abrir una puerta, evento raro) — los marcos NO,
 * se pintan siempre, puerta abierta o cerrada (ver `DoorFrame`).
 *
 * Muros: MURO COMPLETO (`wall`, no el parapeto `barrier` del F2 original —
 * encargo de David, playtest 2026-08-06: "para las paredes me gusta más la
 * opción del muro"), a su altura de fábrica (3.36 u, KIT_SCALE, ver kit.ts).
 * Suelo, muro y puerta llevan además una VARIANTE elegida POR SALA de forma
 * determinista (hash del id, mismo patrón que `pickRockVariant` — nunca
 * `Math.random()`, la sala debe verse igual entre recargas) — ver
 * `pickFloorVariant`/`pickWallVariant`/`pickDoorVariant` más abajo.
 *
 * Todas las piezas comparten `kitMaterial` (1 material/1 textura para todo el
 * kit, ver kit.ts) salvo: la madera (suelo de madera, hoja de puerta), que va
 * en `kitWarmMaterial` (si no, se funde con el muro azul — mismo fallo que ya
 * se corrigió con los barriles), y la hoja de puerta de llave, que usa un
 * clon teñido de dorado de ESE material cálido — nunca se muta ni
 * `kitMaterial` ni `kitWarmMaterial` en sí, que los comparte todo lo demás.
 */

import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AABB } from '@/engine/geometry';
import { DOOR_WIDTH, WALL_THICKNESS } from '@/game/world/constants';
import type { DoorConnection } from '@/game/features/dungeon/dungeon';
import { QUEEN_COLUMN_ID_PREFIX } from '@/game/features/bosses/queen/constants';
import { DOOR_GATE_ID_PREFIX, doorGateAabb } from '@/game/features/dungeon/dungeon-world';
import type { Obstacle, World } from '@/game/world/types';
import { kitGeometry, kitGeometryPart, kitMaterial, kitWarmMaterial } from './kit';
import { kitBoxSize, kitGroundOffset, kitTopAlignOffset } from './kit-fit';
import { betterModuleLength, wallModuleLayout } from './wall-modules';

/**
 * Hash de cadena a entero no negativo — multiplicador primo 31, sin
 * pretensión criptográfica, solo repartir ids arbitrarios de forma estable
 * entre N cubos (mismo algoritmo que `room-props.ts::hashRoomId`, duplicado
 * ahí a propósito para no acoplar los dos ficheros; aquí se factoriza UNA vez
 * porque las 4 variantes de esta vista — roca, suelo, muro, puerta —
 * comparten fichero). Se aplica siempre sobre `"${id}:${sal}"` con un sufijo
 * distinto por categoría (nunca el id crudo repetido en dos categorías): así
 * la variante de suelo, muro y puerta de una misma sala no quedan
 * correlacionadas por construcción (mismo id → mismo hash, y con listas de
 * longitud distinta el patrón se notaría a la larga si no se salara).
 */
function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

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

// ── Suelo: rejilla de floor_tile_large por sala, variante por sala ─────────

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
 * Variantes de suelo elegibles por sala (encargo de David, 2026-08-06:
 * "podrías ir cambiando distintos suelos por cada sala"). Tres, no las ~10
 * losas 4×4 del catálogo:
 * - `floor_tile_large`: la baldosa por defecto (piedra lisa).
 * - `floor_dirt_large`: mismo perfil (min/max.y casi idénticos), tierra en
 *   vez de sillar — "mismo tipo con distinto detalle" (la otra mitad del
 *   encargo), sin cambiar de material: bajo `kitMaterial` la paleta NightA
 *   recolorea el atlas entero a azul-gris, así que esta variante se lee como
 *   "otro relieve de la misma piedra fría", no como tierra marrón — encaja.
 * - `floor_wood_large`: madera de verdad (piso de armería/tienda), por eso
 *   SÍ cambia de material a `kitWarmMaterial` (ver cabecera del fichero).
 *
 * Descartada `floor_tile_large_rocks` (sí en el catálogo del plan) como
 * suelo BASE: su relieve de rocas sube hasta max.y≈0.54 (vs ≈0.05-0.11 de las
 * tres de arriba), y `FloorGrid` posiciona por `kitTopAlignOffset` (la cara
 * superior a y=0): tejida como suelo completo, la parte LISA de cada baldosa
 * quedaría ~0.44 u por debajo del plano jugable, un escalón falso en toda la
 * sala. Sigue en el kit como decal SUELTO de vez en cuando (`room-props.ts`,
 * ya reescalado ahí a propósito para ese uso puntual), donde ese descuadre no
 * se nota.
 */
const FLOOR_VARIANTS = ['floor_tile_large', 'floor_dirt_large', 'floor_wood_large'] as const;
type FloorVariant = (typeof FLOOR_VARIANTS)[number];

/** Variante de suelo determinista a partir del id de sala — ver `hashId`. */
function pickFloorVariant(roomId: string): FloorVariant {
  return FLOOR_VARIANTS[hashId(`${roomId}:floor`) % FLOOR_VARIANTS.length];
}

/**
 * Rejilla de una variante de suelo cubriendo un rectángulo `width × height`
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
  variant,
}: {
  width: number;
  height: number;
  originX: number;
  originY: number;
  variant: FloorVariant;
}) {
  const geometry = kitGeometry(variant);
  // Madera → material cálido (atlas original, colores de verdad); el resto,
  // piedra/tierra → material frío compartido (ver cabecera del fichero).
  const material = variant === 'floor_wood_large' ? kitWarmMaterial : kitMaterial;
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
  return <instancedMesh ref={meshRef} args={[geometry, material, count]} receiveShadow />;
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

// ── Muros: módulos de wall a lo largo del eje largo del AABB, variante por sala ─

/** Tramo de muro a cubrir con módulos: longitud a lo largo de su eje largo, centro, y si ese eje largo es X (horizontal) o Z (vertical, requiere rotar 90°). */
interface WallSpan {
  length: number;
  cx: number;
  cz: number;
  horizontal: boolean;
}

/**
 * Variantes de MURO COMPLETO elegibles por sala (encargo de David,
 * 2026-08-06: "para las paredes me gusta más la opción del muro" — sustituye
 * al parapeto `barrier` del F2 original, ver cabecera del fichero). Cuatro
 * piezas con el MISMO perfil exterior (4×4×~1 de fábrica: ancho y alto
 * idénticos, solo cambia el detalle de superficie — grieta/rotura/arco), así
 * que tilan igual de bien que `wall` a secas y se leen como "la misma
 * mazmorra, distinto desgaste" en vez de mezclar estilos.
 */
const WALL_VARIANTS = ['wall', 'wall_cracked', 'wall_broken', 'wall_arched'] as const;
type WallVariant = (typeof WALL_VARIANTS)[number];

/** Variante de muro determinista a partir del id de sala — ver `hashId`. */
function pickWallVariant(roomId: string): WallVariant {
  return WALL_VARIANTS[hashId(`${roomId}:wall`) % WALL_VARIANTS.length];
}

/**
 * Instancia módulos de UNA geometría de muro sobre una lista de tramos
 * (`spans`), cada uno subdividido por `wallModuleLayout` en `count` módulos
 * que cubren su longitud EXACTA. Un único `InstancedMesh` para TODOS los
 * tramos que se le pasen — el llamador decide el agrupamiento (por sala, en
 * `RoomWalls`; los 4 tramos fijos de `SingleRoomView`) y qué geometría usar
 * (la variante elegida, o `wall_half` para los tramos cortos que encajan
 * mejor con el módulo pequeño — ver `RoomWalls`).
 *
 * Corrección de GROSOR (a diferencia del `barrier` que sustituye: su
 * profundidad de fábrica ya coincidía con `WALL_THICKNESS`, pero `wall` mide
 * 1 u de fábrica ⇒ 0.84 u a KIT_SCALE, EL DOBLE del grosor real de muro
 * (0.42 u) — sin corregirlo, el volumen visible ya no coincidiría con el AABB
 * de colisión en planta, el criterio de ART_KIT_PLAN §2). `thicknessScale`
 * se mide del propio `boundingBox` de la geometría (nunca hardcodeado: p. ej.
 * `wall_cracked` sobresale más que las demás por su grieta, 0.63 u en vez de
 * 0.5 — leer siempre el tamaño real es lo que mantiene el encaje exacto pieza
 * a pieza) y se aplica en el eje Z LOCAL del módulo (su profundidad antes de
 * rotar), igual que `scale` se aplica en su X local (longitud).
 */
function WallModuleInstances({ spans, geometry }: { spans: WallSpan[]; geometry: THREE.BufferGeometry }) {
  const size = useMemo(() => kitBoxSize(geometry), [geometry]);
  const moduleLength = size.x;
  const thicknessScale = useMemo(() => WALL_THICKNESS / size.z, [size]);
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
        scratch.scale.set(scale, 1, thicknessScale);
        scratch.updateMatrix();
        mesh.setMatrixAt(index++, scratch.matrix);
      }
    }
    mesh.count = totalCount;
    mesh.instanceMatrix.needsUpdate = true;
  }, [spans, moduleLength, groundY, thicknessScale, totalCount]);

  if (totalCount === 0) return null;
  // Sombras (playtest histórico, ver comentario largo de DoorFrame/DoorLeaf más abajo): muros castean y reciben.
  return <instancedMesh ref={meshRef} args={[geometry, kitMaterial, totalCount]} castShadow receiveShadow />;
}

/** Convierte los `Obstacle` de muro de UNA sala en tramos (`WallSpan`, eje largo = el más largo del AABB) — usado por el modo mazmorra; el modo sala única (`SingleRoomView`) ya conoce sus 4 tramos de memoria y no pasa por aquí. */
function wallSpansFromObstacles(walls: Obstacle[]): WallSpan[] {
  return walls.map((wall) => {
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
  });
}

/**
 * Reparte los tramos de muro de UNA sala entre DOS `InstancedMesh` según qué
 * módulo encaje mejor en cada tramo (`betterModuleLength`, wall-modules.ts):
 * la VARIANTE elegida para la sala (`variant`, módulo grande, ~3.36 u) para
 * los tramos largos, `wall_half` (módulo pequeño, ~1.68 u, siempre sin
 * decorar: es la única "hermana" de tamaño reducido del catálogo — encargo
 * de David, "wall_half para tramos cortos") para los que quedan mejor con
 * menos estirado — típicamente el resto de pared corto que deja un hueco de
 * puerta junto a una esquina.
 */
function RoomWalls({ spans, variant }: { spans: WallSpan[]; variant: WallVariant }) {
  const variantGeometry = kitGeometry(variant);
  const halfGeometry = kitGeometry('wall_half');
  const variantModuleLength = useMemo(() => kitBoxSize(variantGeometry).x, [variantGeometry]);
  const halfModuleLength = useMemo(() => kitBoxSize(halfGeometry).x, [halfGeometry]);

  const { fullSpans, halfSpans } = useMemo(() => {
    const fullSpans: WallSpan[] = [];
    const halfSpans: WallSpan[] = [];
    for (const span of spans) {
      const chosen = betterModuleLength(span.length, variantModuleLength, halfModuleLength);
      (chosen === halfModuleLength ? halfSpans : fullSpans).push(span);
    }
    return { fullSpans, halfSpans };
  }, [spans, variantModuleLength, halfModuleLength]);

  return (
    <>
      <WallModuleInstances spans={fullSpans} geometry={variantGeometry} />
      <WallModuleInstances spans={halfSpans} geometry={halfGeometry} />
    </>
  );
}

// ── Rocas: variante determinista por id, escaladas a su AABB ──────────────

const ROCK_VARIANTS = ['rocks', 'rocks_small', 'rocks_decorated'] as const;
type RockVariant = (typeof ROCK_VARIANTS)[number];

/**
 * Variante de roca DETERMINISTA a partir del id del obstáculo (nunca
 * `Math.random()`: el render debe ser reproducible entre recargas de la
 * misma sala/semilla, igual que el resto de la sim) — `hashId` (cabecera del
 * fichero) sobre el id CRUDO de la roca, sin sufijo: aquí no hace falta
 * decorrelacionar de otra categoría, cada roca ya tiene su propio id único
 * (a diferencia de suelo/muro/puerta, que hashean el id de SALA compartido
 * entre las tres).
 */
function pickRockVariant(id: string): RockVariant {
  return ROCK_VARIANTS[hashId(id) % ROCK_VARIANTS.length];
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

// ── Puertas: marco (siempre) + hoja (solo si la conexión está cerrada) ─────

/**
 * `wall_doorway` tiene DOS nodos en su `.gltf`: `wall_doorway` (el marco,
 * pieza de muro con el hueco ya recortado) y `wall_doorway_door` (la HOJA,
 * hijo del marco — ver comentario de `kitGeometryPart`/`cacheModelParts` en
 * kit.ts). Antes (F2 original) esto quedó "pendiente" porque los muros eran
 * el parapeto `barrier` (0.92 u) y un marco a su altura NATURAL (3.36 u,
 * muro entero) habría tapado ~2.2 u de sala — el mismo problema de oclusión
 * que entonces descartó el muro completo. Con el encargo de David de pasar a
 * MURO COMPLETO (misma altura que este marco, sin escalar), ese obstáculo
 * desaparece solo: el marco es, geométricamente, "un módulo de muro con un
 * hueco", así que encaja con el resto de `WallModuleInstances` sin ningún
 * ajuste especial de altura.
 *
 * `wall_gated` (el rastrillo de barrotes que usaba el F2 original) queda
 * descartado del todo: David lo pidió explícitamente ("que parezcan puertas,
 * no rejas"), y el marco+hoja de `wall_doorway` cubre el motivo por el que
 * `wall_gated` se había elegido en su día (`floor_tile_grate` de canto se
 * veía por una cara y no por la otra, ver historial en ART_KIT_PLAN §7) sin
 * su inconveniente: la hoja tiene volumen real (no es una rejilla plana), así
 * que no hereda ese problema — verificado en el navegador desde los dos lados
 * (ver informe de la tarea).
 *
 * Variantes de marco elegidas por sala (encargo, "lo mismo para... puertas"):
 * solo DOS, no 3-4 como suelo/muro — son las únicas piezas del catálogo con
 * la MISMA estructura de 2 nodos que necesita este código (`<variante>` =
 * marco, `<variante>_door` = hoja, con la hoja YA colocada dentro del hueco
 * en el propio `.gltf`). `wall_doorway_Tsplit` es un cruce en T de 8 u
 * (pensado para un muro partido en tres direcciones, no un hueco simple) y
 * `wall_doorway_sides` no trae hoja separada (un único nodo, nada que
 * mostrar/ocultar al abrir la puerta): ninguna de las dos sirve sin
 * reescribir el resto de este bloque, así que se quedan fuera.
 */
const DOOR_VARIANTS = ['wall_doorway', 'wall_doorway_scaffold'] as const;
type DoorVariant = (typeof DOOR_VARIANTS)[number];

/** Variante de marco de puerta determinista a partir del id de la sala DE ORIGEN de la conexión (`conn.roomAId`) — ver `hashId`. Una conexión conecta dos salas; hay que elegir una sola como semilla, y `roomAId` es estable (siempre la misma sala "A" para esa conexión, nunca cambia en la partida). */
function pickDoorVariant(roomAId: string): DoorVariant {
  return DOOR_VARIANTS[hashId(`${roomAId}:door`) % DOOR_VARIANTS.length];
}

/** Material de la hoja de puerta de LLAVE (dorada, distinta de la normal): clon de `kitWarmMaterial` (madera) teñido, creado UNA vez — nunca se muta `kitWarmMaterial`, que comparte el resto de madera del kit (barriles, atrezzo). */
const doorKeyLeafMaterial = kitWarmMaterial.clone();
doorKeyLeafMaterial.color = new THREE.Color('#d9a531');

/** Transformación compartida por el marco Y la hoja de una puerta: aplicar la MISMA a las dos es lo que las mantiene encajadas (la hoja nace, en el `.gltf`, ya colocada dentro del hueco del marco — ver cabecera de esta sección), aunque el tamaño natural de cada nodo sea distinto. */
interface DoorPieceLayout {
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
}

/**
 * Calcula `DoorPieceLayout` a partir de un AABB de hueco de puerta (siempre
 * el de `doorGateAabb`, dungeon-world.ts — mismas coordenadas que el
 * `Obstacle` portón real, así que el marco, que se pinta SIEMPRE, y la hoja,
 * que solo aparece si ese `Obstacle` existe, quedan perfectamente alineados
 * sea cual sea el lado de la conexión) y el tamaño/apoyo natural del MARCO
 * (`naturalSize`/`groundY`; la hoja usa estos mismos valores aunque su propio
 * boundingBox sea distinto — ver interfaz de arriba). Ancho objetivo = el
 * AABB completo (`DOOR_WIDTH`); alto SIN escalar (el marco ya nace a la
 * altura del resto del muro, ver cabecera); grosor ajustado a
 * `WALL_THICKNESS` igual que `WallModuleInstances` — el marco de puerta ES
 * un módulo de muro con un hueco, mismo problema de grosor de fábrica
 * (1 u ⇒ 0.84 a KIT_SCALE, el doble de `WALL_THICKNESS`).
 */
function doorPieceLayout(aabb: AABB, naturalSize: THREE.Vector3, groundY: number): DoorPieceLayout {
  const width = aabb.maxX - aabb.minX;
  const depth = aabb.maxY - aabb.minY;
  const horizontal = width >= depth;
  const longTarget = horizontal ? width : depth;
  const shortTarget = horizontal ? depth : width;
  return {
    position: [(aabb.minX + aabb.maxX) / 2, groundY, (aabb.minY + aabb.maxY) / 2],
    rotationY: horizontal ? 0 : Math.PI / 2,
    scale: [longTarget / naturalSize.x, 1, shortTarget / naturalSize.z],
  };
}

/**
 * Marco de hueco de puerta: se pinta SIEMPRE, puerta abierta o cerrada — es
 * la parte de "esto es una puerta" que nunca desaparece (encargo de David).
 * Una pieza por conexión, sin instanciar: una mazmorra de F2 tiene un puñado
 * de conexiones (≤ nº de salas), muy por debajo de lo que compensaría
 * agrupar en un `InstancedMesh` (mismo criterio que `DoorFloorPatch`, ya sin
 * instanciar por el mismo motivo).
 */
function DoorFrame({ conn }: { conn: DoorConnection }) {
  const variant = useMemo(() => pickDoorVariant(conn.roomAId), [conn.roomAId]);
  const geometry = kitGeometryPart(variant, variant);
  const naturalSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const aabb = useMemo(() => doorGateAabb(conn.center, conn.sideOnA), [conn.center, conn.sideOnA]);
  const layout = useMemo(() => doorPieceLayout(aabb, naturalSize, groundY), [aabb, naturalSize, groundY]);

  return (
    <mesh
      geometry={geometry}
      material={kitMaterial}
      position={layout.position}
      rotation={[0, layout.rotationY, 0]}
      scale={layout.scale}
      castShadow
      receiveShadow
    />
  );
}

/**
 * Hoja de puerta cerrada: nodo `<variante>_door`, mismo `layout` que su
 * `DoorFrame` (misma conexión, mismo `doorGateAabb`) para quedar encajada en
 * el hueco del marco. Madera (`kitWarmMaterial`, NO `kitMaterial` — si no, se
 * funde con el muro azul de detrás, mismo fallo ya corregido con los
 * barriles, ver cabecera del fichero); dorada si la conexión exige llave
 * (distinción ya validada en playtest, se mantiene).
 */
function DoorLeaf({ conn, gate }: { conn: DoorConnection; gate: Obstacle }) {
  const variant = useMemo(() => pickDoorVariant(conn.roomAId), [conn.roomAId]);
  const frameGeometry = kitGeometryPart(variant, variant);
  const leafGeometry = kitGeometryPart(variant, `${variant}_door`);
  // Tamaño/apoyo del MARCO, no de la hoja (ver doorPieceLayout): así la hoja
  // queda encajada en el hueco exactamente igual que `DoorFrame`.
  const naturalSize = useMemo(() => kitBoxSize(frameGeometry), [frameGeometry]);
  const groundY = useMemo(() => kitGroundOffset(frameGeometry), [frameGeometry]);
  const layout = useMemo(() => doorPieceLayout(gate.aabb, naturalSize, groundY), [gate.aabb, naturalSize, groundY]);
  const isKeyDoor = gate.id.endsWith('-key');

  return (
    <mesh
      geometry={leafGeometry}
      material={isKeyDoor ? doorKeyLeafMaterial : kitWarmMaterial}
      position={layout.position}
      rotation={[0, layout.rotationY, 0]}
      scale={layout.scale}
      castShadow
      receiveShadow
    />
  );
}

/** El `Obstacle` portón de una conexión, si sigue cerrada (mismo id que arma `syncDoorGates`, dungeon-world.ts); `undefined` si está abierta. */
function findGateForConnection(world: World, connectionIndex: number): Obstacle | undefined {
  return world.obstacles.find(
    (o) => o.id === `${DOOR_GATE_ID_PREFIX}${connectionIndex}` || o.id === `${DOOR_GATE_ID_PREFIX}${connectionIndex}-key`,
  );
}

/**
 * Todas las puertas de la mazmorra: marco por CONEXIÓN (estático, se calcula
 * una vez) + hoja por conexión CERRADA (se recalcula cuando
 * `world.wallVersion` cambia — abrir una puerta, evento raro; mismo sondeo
 * barato por frame que ya usaba el `DoorGates` al que sustituye este bloque).
 */
function DoorStructures({ world }: { world: World }) {
  const [version, setVersion] = useState(world.wallVersion);

  useFrame(() => {
    if (world.wallVersion !== version) setVersion(world.wallVersion);
  });

  const dungeon = world.dungeon;
  if (!dungeon) return null;

  return (
    <>
      {dungeon.connections.map((conn, i) => (
        <DoorFrame key={`door-frame-${i}`} conn={conn} />
      ))}
      {dungeon.connections.map((conn, i) => {
        const gate = findGateForConnection(world, i);
        return gate ? <DoorLeaf key={`door-leaf-${i}`} conn={conn} gate={gate} /> : null;
      })}
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
          variant={pickFloorVariant(placed.room.id)}
        />
      ))}
      {dungeon.connections.map((conn, i) => (
        <DoorFloorPatch key={`door-floor-${i}`} conn={conn} />
      ))}
      {dungeon.rooms.map((placed) => (
        <RoomWalls
          key={`walls-${placed.room.id}`}
          spans={wallSpansFromObstacles(wallsByRoom.get(placed.room.id) ?? [])}
          variant={pickWallVariant(placed.room.id)}
        />
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
      <DoorStructures world={world} />
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
  // tramos para `WallModuleInstances`.
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
      <FloorGrid width={width} height={height} originX={0} originY={0} variant={pickFloorVariant(world.room.id)} />
      <RoomWalls spans={wallSpans} variant={pickWallVariant(world.room.id)} />
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
