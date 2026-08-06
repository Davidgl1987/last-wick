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
 * `pickFloorFamily`/`pickFloorTile` (suelo) y `pickWallModule` (muro) más
 * abajo: la FAMILIA la fija la sala y la VARIANTE la sortea cada pieza.
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
import type { Obstacle, RoomTag, World } from '@/game/world/types';
import { kitGeometry, kitGeometryPart, kitMaterial, kitWarmMaterial } from './kit';
import type { KitModelName } from './kit-models';
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
 * FAMILIAS de suelo, y dentro de cada una sus variantes. Dos niveles a
 * propósito (encargo de David, 2026-08-06: "si el suelo es de baldosas, se
 * usen las variedades de baldosas, si es de tierra, las variedades de tierra
 * con plantas o piedras pequeñas"): la FAMILIA la elige la sala y se mantiene
 * coherente en toda ella, y dentro de la sala cada baldosa sortea una variante
 * de ESA familia. Antes se elegía una sola pieza por sala y se repetía idéntica
 * — que es lo que David rechazó.
 *
 * Se usan las baldosas PEQUEÑAS del pack (2×2 de fábrica ⇒ 1.68 u a
 * `KIT_SCALE`) a su tamaño natural, en vez de estirar una grande al 50% como
 * hacía la versión anterior: da exactamente el mismo tamaño en pantalla —el ya
 * validado— y a cambio abre el catálogo de variantes, que solo existe en el
 * tamaño pequeño.
 *
 * `base` es la norma y `subtle`/`loud` son acentos con dosis distinta (ver
 * `pickFloorTile`): un suelo donde cada baldosa es distinta se lee como ruido,
 * no como suelo. `loud` son las que levantan relieve (hierbajos, decorada) y
 * además cuestan 400-600 tris frente a los ~70 de una lisa.
 */
interface FloorFamily {
  /** Baldosa lisa: la mayoría del suelo, y la que fija la altura de la familia (ver `FloorGrid`). */
  base: KitModelName;
  /** Mismo perfil, distinto desgaste (roturas, vetas de tierra): salpicadas sin llamar la atención. */
  subtle: readonly KitModelName[];
  /** Con relieve por encima del plano (hierbajos, decorada): muy de vez en cuando. */
  loud: readonly KitModelName[];
  /** true ⇒ atlas cálido del pack (madera de verdad); false ⇒ piedra fría (ver cabecera). */
  warm: boolean;
}

const FLOOR_FAMILIES = {
  piedra: {
    base: 'floor_tile_small',
    subtle: ['floor_tile_small_broken_A', 'floor_tile_small_broken_B'],
    loud: ['floor_tile_small_weeds_A', 'floor_tile_small_weeds_B', 'floor_tile_small_decorated'],
    warm: false,
  },
  tierra: {
    base: 'floor_dirt_small_D',
    subtle: ['floor_dirt_small_A', 'floor_dirt_small_B', 'floor_dirt_small_C'],
    loud: ['floor_dirt_small_weeds'],
    warm: false,
  },
  madera: {
    base: 'floor_wood_small',
    subtle: ['floor_wood_small_dark'],
    loud: [],
    warm: true,
  },
} as const satisfies Record<string, FloorFamily>;

type FloorFamilyName = keyof typeof FLOOR_FAMILIES;

/** Familias que puede tocarle a una sala PELIGROSA — la madera queda fuera a propósito, ver `pickFloorFamily`. */
const DANGEROUS_FLOOR_FAMILIES: readonly FloorFamilyName[] = ['piedra', 'tierra'];

/**
 * Familia de suelo de una sala. La MADERA no se sortea: es la marca de las
 * salas seguras (encargo de David: "el suelo de madera es buena idea, pero
 * para las salas seguras nada más"), y eso la convierte en información de
 * juego y no en decoración — al entrar, el suelo cálido dice "aquí no te van a
 * atacar" antes de que veas si hay enemigos. Seguras son las dos etiquetas sin
 * enemigos del pool: `inicio` y `tienda`.
 *
 * El resto de salas sortean piedra o tierra por hash del id (determinista: la
 * misma sala se ve igual entre recargas, ver `hashId`).
 */
function pickFloorFamily(roomId: string, tags: readonly RoomTag[]): FloorFamilyName {
  if (tags.includes('inicio') || tags.includes('tienda')) return 'madera';
  return DANGEROUS_FLOOR_FAMILIES[hashId(`${roomId}:floor`) % DANGEROUS_FLOOR_FAMILIES.length];
}

/**
 * Variante de UNA baldosa concreta dentro de su familia. Determinista por
 * sala + coordenada de la baldosa: la misma sala se ve siempre igual, pero dos
 * baldosas contiguas no se parecen por construcción.
 *
 * Dosis: ~8% llamativas, ~25% sutiles, el resto lisas. El orden de los dos
 * `if` importa — 12 es múltiplo de 3, así que comprobar primero las llamativas
 * evita que se las coma el filtro de las sutiles.
 */
function pickFloorTile(family: FloorFamily, roomId: string, ix: number, iz: number): KitModelName {
  const hash = hashId(`${roomId}:tile:${ix}:${iz}`);
  if (family.loud.length > 0 && hash % 12 === 0) return family.loud[Math.floor(hash / 12) % family.loud.length];
  if (family.subtle.length > 0 && hash % 3 === 0) return family.subtle[Math.floor(hash / 3) % family.subtle.length];
  return family.base;
}

/** Una baldosa colocada: centro y estirado a su celda (el estirado es el mismo para todas las de la sala). */
interface TilePlacement {
  x: number;
  z: number;
}

/**
 * Instancias de UNA variante de baldosa. Hace falta una malla por variante
 * (un `InstancedMesh` solo admite una geometría), pero siguen siendo 2-4
 * mallas por sala en vez de una baldosa suelta por celda.
 *
 * `topY` NO se calcula aquí sino que lo impone la familia: si cada variante se
 * alineara por SU propio `max.y`, las que llevan hierbajos (max.y = 0.20, que
 * es la punta de la planta) hundirían su losa 0.2 u respecto a las lisas y el
 * suelo quedaría a escalones. Alineando todas por la altura de la losa base,
 * las losas quedan coplanares y las plantas asoman por encima, que es justo lo
 * que se quiere.
 */
function FloorTileInstances({
  model,
  placements,
  scaleX,
  scaleZ,
  topY,
  material,
}: {
  model: KitModelName;
  placements: TilePlacement[];
  scaleX: number;
  scaleZ: number;
  topY: number;
  material: THREE.Material;
}) {
  const geometry = kitGeometry(model);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    for (let i = 0; i < placements.length; i++) {
      scratch.position.set(placements[i].x, topY, placements[i].z);
      scratch.scale.set(scaleX, 1, scaleZ);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }
    mesh.count = placements.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [placements, scaleX, scaleZ, topY]);

  if (placements.length === 0) return null;
  // Solo recibe sombra (igual que el suelo antiguo): un suelo no proyecta
  // sombra sobre sí mismo, y el resto de piezas ya castean sobre él.
  return <instancedMesh ref={meshRef} args={[geometry, material, placements.length]} receiveShadow />;
}

/**
 * Rejilla de suelo de una sala: `nx × nz` baldosas de la familia elegida,
 * cada una sorteando su variante. `ceil` sobre el tamaño NATURAL de la baldosa
 * pequeña (1.68 u) — nunca menos de las que hacen falta para cubrir la sala —
 * y luego un estirado mínimo para que la rejilla cubra el rectángulo EXACTO
 * sin dejar borde sin baldosa (mismo criterio de "escala = longitud / (nº
 * piezas · tamaño natural)" que `wallModuleLayout`, con redondeo distinto).
 */
function FloorGrid({
  width,
  height,
  originX,
  originY,
  roomId,
  familyName,
}: {
  width: number;
  height: number;
  originX: number;
  originY: number;
  roomId: string;
  familyName: FloorFamilyName;
}) {
  const family: FloorFamily = FLOOR_FAMILIES[familyName];
  const baseGeometry = kitGeometry(family.base);
  const tileSize = useMemo(() => kitBoxSize(baseGeometry), [baseGeometry]);
  const topY = useMemo(() => kitTopAlignOffset(baseGeometry), [baseGeometry]);
  const material = family.warm ? kitWarmMaterial : kitMaterial;

  const nx = Math.max(1, Math.ceil(width / tileSize.x));
  const nz = Math.max(1, Math.ceil(height / tileSize.z));
  const tileW = width / nx;
  const tileH = height / nz;

  // Reparto de baldosas por variante, una sola vez por sala.
  const groups = useMemo(() => {
    const byModel = new Map<KitModelName, TilePlacement[]>();
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const model = pickFloorTile(family, roomId, ix, iz);
        const list = byModel.get(model) ?? [];
        list.push({
          x: originX - width / 2 + (ix + 0.5) * tileW,
          z: originY - height / 2 + (iz + 0.5) * tileH,
        });
        byModel.set(model, list);
      }
    }
    return [...byModel.entries()];
  }, [family, roomId, nx, nz, tileW, tileH, originX, originY, width, height]);

  return (
    <>
      {groups.map(([model, placements]) => (
        <FloorTileInstances
          key={model}
          model={model}
          placements={placements}
          scaleX={tileW / tileSize.x}
          scaleZ={tileH / tileSize.z}
          topY={topY}
          material={material}
        />
      ))}
    </>
  );
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
 * Módulo de muro: una pieza LISA que es la norma, y acentos que salpican
 * (encargo de David, 2026-08-06: "si es un muro de ladrillo, hay varias
 * variantes, con ventana, con hueco, sin hueco, con estanterías, con
 * barrotes"). Antes se elegía UNA variante por sala y se repetía idéntica en
 * todo el perímetro; ahora la elección es POR MÓDULO, así que un mismo muro
 * tiene tramos lisos con alguna hornacina, ventana o reja de vez en cuando.
 *
 * Los cinco acentos comparten el perfil exacto de `wall` (4×4×1 de fábrica),
 * así que tilan igual y el muro no cambia de grosor a media pared. Eso
 * descarta dos candidatas obvias, y por un motivo que no es estético:
 * `wall_cracked` mide 1.26 de profundidad (sobresaldría 0.13 u del plano del
 * muro, además de costar 2010 tris frente a 494) y `wall_shelves` cuelga sus
 * baldas 0.37 u HACIA DENTRO de la sala — un volumen visible dentro del área
 * jugable que la bola atravesaría, justo la mentira que el atrezzo tiene
 * prohibida (ver `room-props.ts`). Las hornacinas `wall_inset_*` hacen lo
 * contrario, excavan hacia dentro del muro, y por eso sí valen.
 *
 * Quedan fuera también las variantes AGUJEREADAS de verdad (`wall_broken`,
 * `wall_window_open`): por su hueco se vería el vacío negro de fuera de la
 * sala, o peor, el suelo flotante de la sala de al lado. `wall_window_closed`
 * y `wall_archedwindow_gated` dan la misma lectura de "ventana" sin abrir
 * agujero.
 */
const WALL_BASE_MODULE = 'wall';
const WALL_ACCENT_MODULES = [
  'wall_inset',
  'wall_inset_shelves',
  'wall_inset_candles',
  'wall_window_closed',
  'wall_archedwindow_gated',
] as const;

/**
 * Uno de cada cuatro módulos lleva acento. La dosis importa tanto como la
 * elección: con todos los módulos distintos el muro se lee como ruido y deja
 * de leerse como muro — y en un juego donde la pared es la superficie de
 * rebote, eso es información que se pierde, no solo estética.
 */
const WALL_ACCENT_EVERY = 4;

/** Módulo de muro para una posición concreta, determinista por sala + índice (ver `hashId`). */
function pickWallModule(roomId: string, index: number): KitModelName {
  const hash = hashId(`${roomId}:wall:${index}`);
  if (hash % WALL_ACCENT_EVERY !== 0) return WALL_BASE_MODULE;
  return WALL_ACCENT_MODULES[Math.floor(hash / WALL_ACCENT_EVERY) % WALL_ACCENT_MODULES.length];
}

/** Un módulo de muro ya colocado: dónde va, si está girado 90° y cuánto se estira a lo largo. */
interface WallPlacement {
  cx: number;
  cz: number;
  horizontal: boolean;
  scale: number;
}

/**
 * Reparte los tramos en módulos concretos (`wallModuleLayout` decide cuántos
 * caben en cada tramo y cuánto estirarlos para cubrirlo EXACTO). Se separa del
 * pintado porque ahora cada módulo puede llevar una geometría distinta: primero
 * se calcula DÓNDE va cada uno, luego se agrupan por variante.
 */
function wallPlacements(spans: WallSpan[], moduleLength: number): WallPlacement[] {
  const placements: WallPlacement[] = [];
  for (const span of spans) {
    const { count, scale } = wallModuleLayout(span.length, moduleLength);
    const segmentLength = span.length / count;
    for (let i = 0; i < count; i++) {
      const offset = -span.length / 2 + (i + 0.5) * segmentLength;
      placements.push({
        cx: span.horizontal ? span.cx + offset : span.cx,
        cz: span.horizontal ? span.cz : span.cz + offset,
        horizontal: span.horizontal,
        scale,
      });
    }
  }
  return placements;
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
function WallModuleInstances({ placements, geometry }: { placements: WallPlacement[]; geometry: THREE.BufferGeometry }) {
  const size = useMemo(() => kitBoxSize(geometry), [geometry]);
  const thicknessScale = useMemo(() => WALL_THICKNESS / size.z, [size]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i];
      scratch.position.set(placement.cx, groundY, placement.cz);
      scratch.rotation.set(0, placement.horizontal ? 0 : Math.PI / 2, 0);
      scratch.scale.set(placement.scale, 1, thicknessScale);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }
    mesh.count = placements.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [placements, groundY, thicknessScale]);

  if (placements.length === 0) return null;
  // Sombras (playtest histórico, ver comentario largo de DoorFrame/DoorLeaf más abajo): muros castean y reciben.
  return <instancedMesh ref={meshRef} args={[geometry, kitMaterial, placements.length]} castShadow receiveShadow />;
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
 * Muros de UNA sala. Dos repartos encadenados:
 *
 * 1. Por LONGITUD de tramo (`betterModuleLength`, wall-modules.ts): los tramos
 *    largos se cubren con el módulo grande (~3.36 u) y los cortos con
 *    `wall_half` (~1.68 u, siempre liso), que es el que deja menos estirado en
 *    el resto de pared corto que queda junto a un hueco de puerta.
 * 2. Por VARIANTE, solo entre los módulos grandes: cada uno sortea liso o
 *    acento (`pickWallModule`), y se agrupan por geometría porque un
 *    `InstancedMesh` solo admite una. Salen 2-4 mallas por sala en vez de una
 *    pieza suelta por módulo.
 */
function RoomWalls({ spans, roomId }: { spans: WallSpan[]; roomId: string }) {
  const fullGeometry = kitGeometry(WALL_BASE_MODULE);
  const halfGeometry = kitGeometry('wall_half');
  const fullModuleLength = useMemo(() => kitBoxSize(fullGeometry).x, [fullGeometry]);
  const halfModuleLength = useMemo(() => kitBoxSize(halfGeometry).x, [halfGeometry]);

  const { fullGroups, halfPlacements } = useMemo(() => {
    const fullSpans: WallSpan[] = [];
    const halfSpans: WallSpan[] = [];
    for (const span of spans) {
      const chosen = betterModuleLength(span.length, fullModuleLength, halfModuleLength);
      (chosen === halfModuleLength ? halfSpans : fullSpans).push(span);
    }
    const byModel = new Map<KitModelName, WallPlacement[]>();
    const placements = wallPlacements(fullSpans, fullModuleLength);
    for (let i = 0; i < placements.length; i++) {
      const model = pickWallModule(roomId, i);
      const list = byModel.get(model) ?? [];
      list.push(placements[i]);
      byModel.set(model, list);
    }
    return {
      fullGroups: [...byModel.entries()],
      halfPlacements: wallPlacements(halfSpans, halfModuleLength),
    };
  }, [spans, roomId, fullModuleLength, halfModuleLength]);

  return (
    <>
      {fullGroups.map(([model, placements]) => (
        <WallModuleInstances key={model} placements={placements} geometry={kitGeometry(model)} />
      ))}
      <WallModuleInstances placements={halfPlacements} geometry={halfGeometry} />
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
/**
 * Desplazamiento (u) de la pieza de puerta en la normal del muro. Existe solo
 * para romper el empate de profundidad con los módulos de muro que solapa (ver
 * `doorPieceLayout`): 1.2 cm sobre un muro de 0.42 de grosor es invisible, y
 * sin él las dos superficies coplanares parpadean.
 */
const DOOR_PIECE_Z_NUDGE = 0.012;

interface DoorPieceLayout {
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
}

/**
 * Coloca una pieza de puerta (marco u hoja) sobre el hueco de una conexión.
 *
 * EL FALLO QUE ESTO ARREGLA (playtest de David, 2026-08-06: "las puertas no
 * están bien puestas"): el hueco de `wall_doorway` NO está centrado en la
 * pieza. Medido en el `.gltf`, el marco ocupa x[-2.00, 2.00] pero su hueco va
 * de x[-0.18, 1.82] — el centro del hueco cae a +0.82 (natural) del centro de
 * la pieza. La versión anterior centraba LA PIEZA en el vano, así que el hueco
 * —y con él la hoja— salía desplazado casi un metro de juego a un lado, con
 * medio paso tapado por muro. Ahora se centra EL HUECO, que es lo que el
 * jugador atraviesa; dónde caiga el resto de la pieza da igual.
 *
 * Y una segunda cuenta encadenada: el vano mide `DOOR_WIDTH` (2 u) y el hueco
 * de la pieza mide 1.68 u a `KIT_SCALE`, así que la pieza se escala en su eje
 * largo hasta que el HUECO mide exactamente el paso real. La pieza entera
 * crece entonces a ~4 u y solapa ~1 u de muro a cada lado; como ambos son
 * muros idénticos en el mismo plano, el solape no se ve —pero SÍ produciría
 * z-fighting al ser coplanar, y de ahí el desplazamiento mínimo en la normal
 * (`DOOR_PIECE_Z_NUDGE`). La alternativa era recortar los tramos de muro
 * contiguos, que obliga al tileado de muro a conocer dónde hay puertas: mucho
 * más acoplamiento para un problema que un nudge de 1.2 cm resuelve entero.
 */
function doorPieceLayout(
  aabb: AABB,
  frameSize: THREE.Vector3,
  groundY: number,
  hole: { center: number; width: number },
): DoorPieceLayout {
  const width = aabb.maxX - aabb.minX;
  const depth = aabb.maxY - aabb.minY;
  const horizontal = width >= depth;
  const gapWidth = horizontal ? width : depth;
  const gapThickness = horizontal ? depth : width;
  // Escala del eje largo: la que hace que el HUECO (no la pieza) mida el paso.
  const lengthScale = gapWidth / hole.width;
  const gapCenterX = (aabb.minX + aabb.maxX) / 2;
  const gapCenterZ = (aabb.minY + aabb.maxY) / 2;
  // El centro del hueco vive a `hole.center` del origen de la pieza: se
  // desplaza la pieza justo lo contrario (ya escalado) para que el hueco caiga
  // sobre el centro del vano.
  const shift = -hole.center * lengthScale;
  return {
    position: [
      gapCenterX + (horizontal ? shift : DOOR_PIECE_Z_NUDGE),
      groundY,
      gapCenterZ + (horizontal ? DOOR_PIECE_Z_NUDGE : shift),
    ],
    rotationY: horizontal ? 0 : Math.PI / 2,
    scale: [lengthScale, 1, gapThickness / frameSize.z],
  };
}

/**
 * Centro y ancho del hueco de una pieza de puerta, leídos del boundingBox de
 * su nodo HOJA — la hoja es exactamente lo que llena el hueco, así que medirla
 * es medir el hueco. Se lee de la geometría real y no se hardcodea: si algún
 * día se añade otra variante de puerta con el hueco en otro sitio, encaja sola.
 */
function doorHoleMetrics(leafGeometry: THREE.BufferGeometry): { center: number; width: number } {
  const box = leafGeometry.boundingBox;
  if (!box) throw new Error('la hoja de puerta del kit no trae boundingBox calculado');
  return { center: (box.max.x + box.min.x) / 2, width: box.max.x - box.min.x };
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
  // La hoja se carga aunque el marco no la pinte: es lo que MIDE el hueco.
  const leafGeometry = kitGeometryPart(variant, `${variant}_door`);
  const naturalSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const hole = useMemo(() => doorHoleMetrics(leafGeometry), [leafGeometry]);
  const aabb = useMemo(() => doorGateAabb(conn.center, conn.sideOnA), [conn.center, conn.sideOnA]);
  const layout = useMemo(() => doorPieceLayout(aabb, naturalSize, groundY, hole), [aabb, naturalSize, groundY, hole]);

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
  const hole = useMemo(() => doorHoleMetrics(leafGeometry), [leafGeometry]);
  const layout = useMemo(
    () => doorPieceLayout(gate.aabb, naturalSize, groundY, hole),
    [gate.aabb, naturalSize, groundY, hole],
  );
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
          roomId={placed.room.id}
          familyName={pickFloorFamily(placed.room.id, placed.room.tags)}
        />
      ))}
      {dungeon.connections.map((conn, i) => (
        <DoorFloorPatch key={`door-floor-${i}`} conn={conn} />
      ))}
      {dungeon.rooms.map((placed) => (
        <RoomWalls
          key={`walls-${placed.room.id}`}
          spans={wallSpansFromObstacles(wallsByRoom.get(placed.room.id) ?? [])}
          roomId={placed.room.id}
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
      <FloorGrid
        width={width}
        height={height}
        originX={0}
        originY={0}
        roomId={world.room.id}
        familyName={pickFloorFamily(world.room.id, world.room.tags)}
      />
      <RoomWalls spans={wallSpans} roomId={world.room.id} />
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
