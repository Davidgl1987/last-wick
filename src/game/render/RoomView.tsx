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
import { DOOR_WIDTH, WALL_THICKNESS } from '@/game/world/constants';
import type { AABB } from '@/engine/geometry';
import type { DoorConnection } from '@/game/features/dungeon/dungeon';
import { QUEEN_COLUMN_ID_PREFIX } from '@/game/features/bosses/queen/constants';
import { DOOR_GATE_ID_PREFIX } from '@/game/features/dungeon/dungeon-world';
import type { Obstacle, World } from '@/game/world/types';
import { kitGeometry, kitGeometryPart, kitMaterial, kitWarmMaterial } from './kit';
import type { KitModelName } from './kit-models';
import { kitBoxSize, kitGroundOffset, kitTopAlignOffset, kitXZCenteredGeometry } from './kit-fit';
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
 * salas SEGURAS (encargo de David: "el suelo de madera es buena idea, pero
 * para las salas seguras nada más"), y eso la convierte en información de
 * juego y no en decoración — al entrar, el suelo cálido dice "aquí no te van a
 * atacar" antes de que veas si hay alguien.
 *
 * "Segura" se decide por si la sala TIENE ENEMIGOS, no por su etiqueta. Es más
 * robusto y dice exactamente lo que se quiere decir: las etiquetas no son
 * excluyentes (hay salas del pool con `tags: ['inicio', 'combate']`, ver
 * rooms.ts), así que fiarse de `tags.includes('inicio')` habría puesto suelo
 * cálido —o sea, la promesa de "aquí no pasa nada"— en una sala que sí trae
 * enemigos. Sin spawns no hay pelea posible, con etiqueta o sin ella.
 *
 * El resto de salas sortean piedra o tierra por hash del id (determinista: la
 * misma sala se ve igual entre recargas, ver `hashId`).
 */
function pickFloorFamily(room: { id: string; enemies: readonly unknown[] }): FloorFamilyName {
  if (room.enemies.length === 0) return 'madera';
  return DANGEROUS_FLOOR_FAMILIES[hashId(`${room.id}:floor`) % DANGEROUS_FLOOR_FAMILIES.length];
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

/**
 * `conn.center` (`DoorConnection.center`, dungeon.ts) NO es el centro del
 * GROSOR del muro: es el punto en el borde INTERIOR de la sala A
 * (`doorSlotLocalCenter`, dungeon.ts — para el lado norte, por ejemplo, es
 * literalmente `y = -halfH`, el borde jugable, no `-halfH - t/2`). El
 * centro real del tramo de muro que atraviesa la puerta (donde
 * `buildRoomWallSegments` planta sus `sideDef.center`, y donde
 * `WallModuleInstances` coloca cada módulo) está medio grosor de muro MÁS
 * ALLÁ de ese borde, hacia FUERA de la sala — la misma corrección de `t/2`
 * que ya aplicaba `DoorFloorPatch` (más abajo) antes de que existiera esta
 * función: se factoriza aquí porque ahora también la necesitan
 * `placementUnderDoor` (para comparar la línea de muro de un módulo contra la
 * de una puerta) y `DoorFrame`/`DoorLeaf` (para plantar el marco donde de
 * verdad está el muro, no medio grosor desplazado — bug medido en playtest:
 * sin esta corrección el marco invadía 0.21 u, exactamente `t/2`, el tramo de
 * muro vecino).
 */
function doorWallCenter(conn: DoorConnection): { x: number; z: number } {
  const t = WALL_THICKNESS;
  switch (conn.sideOnA) {
    case 'north':
      return { x: conn.center.x, z: conn.center.y - t / 2 };
    case 'south':
      return { x: conn.center.x, z: conn.center.y + t / 2 };
    case 'east':
      return { x: conn.center.x + t / 2, z: conn.center.y };
    case 'west':
      return { x: conn.center.x - t / 2, z: conn.center.y };
  }
}

/** Parche de suelo bajo un hueco de puerta (el paso entre interiores): `floor_tile_small` estirada al hueco, mismo criterio de altura que `FloorGrid`. */
function DoorFloorPatch({ conn }: { conn: DoorConnection }) {
  const geometry = kitGeometry('floor_tile_small');
  const size = useMemo(() => kitBoxSize(geometry), [geometry]);
  const topY = useMemo(() => kitTopAlignOffset(geometry), [geometry]);
  const t = WALL_THICKNESS;
  const horizontal = conn.sideOnA === 'east' || conn.sideOnA === 'west';
  const { x: cx, z: cz } = doorWallCenter(conn);
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
 *
 * Corrección de CENTRO (bug playtest 2026-08-06, con captura y medición: "la
 * mitad izquierda [del hueco de puerta] se puede traspasar, la mitad derecha
 * no" — el hueco dibujado no coincidía con el de colisión, desfasados ≈0.98
 * u). Causa medida: `wall_half` no nace centrada en su origen local (su X
 * real va de 0 a 1.68, centro en 0.84, no en 0) mientras que el resto de
 * módulos de muro sí — y este componente coloca cada instancia por su CENTRO
 * (`position = cx/cz` del tramo), dando por hecho que el origen local de la
 * geometría YA es su centro. `kitXZCenteredGeometry` (kit-fit.ts) corrige
 * esto de una vez para CUALQUIER geometría que se le pase (no solo
 * `wall_half`: por si otro módulo de muro dejara de estar centrado el día de
 * mañana), recentrando la geometría ANTES de que la rotación/escala de más
 * abajo la toquen — así funciona igual en los tramos horizontales y en los
 * verticales (girados 90°) sin que la matemática de posición/rotación/escala
 * de aquí abajo tenga que saber nada del desfase.
 */
function WallModuleInstances({ placements, geometry }: { placements: WallPlacement[]; geometry: THREE.BufferGeometry }) {
  const size = useMemo(() => kitBoxSize(geometry), [geometry]);
  const thicknessScale = useMemo(() => WALL_THICKNESS / size.z, [size]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const centeredGeometry = useMemo(() => kitXZCenteredGeometry(geometry), [geometry]);
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
  return <instancedMesh ref={meshRef} args={[centeredGeometry, kitMaterial, placements.length]} castShadow receiveShadow />;
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
 * true si el lado de una conexión implica un muro cuyo eje LARGO es X
 * (norte/sur, sin rotar) — false si es Z (este/oeste, el módulo rota 90°).
 * Mismo criterio que `sideDef.horizontal` en `dungeon.ts::buildRoomWallSegments`
 * y que `WallSpan.horizontal`/`WallPlacement.horizontal` de aquí arriba: los
 * tres describen la MISMA propiedad (eje largo del muro que toca esa
 * conexión), así que comparar `placement.horizontal` contra el resultado de
 * esta función identifica sin ambigüedad si un módulo y una puerta están en
 * muros con la misma orientación. La usan tanto `placementUnderDoor` (más
 * abajo, para no dibujar muro bajo la puerta) como `DoorFrame`/`DoorLeaf` (más
 * abajo del todo, para rotar la pieza igual que rotaría un módulo de muro en
 * ese mismo sitio).
 */
function isConnectionWallHorizontal(conn: DoorConnection): boolean {
  return conn.sideOnA === 'north' || conn.sideOnA === 'south';
}

/**
 * Recorta de un tramo de muro los trozos que ocupan las piezas de puerta,
 * devolviendo los sub-tramos que quedan a los lados.
 *
 * POR QUÉ ASÍ Y NO FILTRANDO MÓDULOS (bug de playtest, David 2026-08-06: "a
 * las puertas les han salido huecos a los lados", con captura): el primer
 * intento descartaba los MÓDULOS YA COLOCADOS cuyo centro caía bajo el marco.
 * Un módulo mide hasta 3.36 u y el marco ocupa 4 u, así que quitar el módulo
 * entero se llevaba por delante hasta metro y medio de muro que el marco no
 * llegaba a tapar — de ahí los huecos negros a los lados de cada puerta.
 *
 * Restando ANTES de tilear, cada trozo de muro que sobrevive se vuelve a
 * repartir en módulos que lo cubren EXACTO (`wallModuleLayout`), y como el
 * reparto grande/pequeño (`betterModuleLength`) se decide por sub-tramo, los
 * restos cortos junto a una puerta caen de forma natural en el módulo
 * pequeño, que es justo para lo que está.
 *
 * Solo recorta puertas de la MISMA orientación y de la MISMA línea de muro
 * (la coordenada perpendicular debe coincidir, margen de milésimas): una
 * puerta del muro norte no puede recortar el muro sur aunque coincida su
 * coordenada a lo largo del eje.
 */
function subtractDoorFootprints(
  span: WallSpan,
  connections: readonly DoorConnection[],
  footprintHalfWidth: number,
): WallSpan[] {
  if (connections.length === 0 || footprintHalfWidth <= 0) return [span];

  const along = span.horizontal ? span.cx : span.cz;
  const perp = span.horizontal ? span.cz : span.cx;
  const huecos: { min: number; max: number }[] = [];
  for (const conn of connections) {
    if (span.horizontal !== isConnectionWallHorizontal(conn)) continue;
    const wallCenter = doorWallCenter(conn);
    const doorPerp = span.horizontal ? wallCenter.z : wallCenter.x;
    if (Math.abs(perp - doorPerp) > 0.01) continue;
    const doorAlong = span.horizontal ? wallCenter.x : wallCenter.z;
    huecos.push({ min: doorAlong - footprintHalfWidth, max: doorAlong + footprintHalfWidth });
  }
  if (huecos.length === 0) return [span];
  huecos.sort((a, b) => a.min - b.min);

  const inicioTramo = along - span.length / 2;
  const finTramoRef = along + span.length / 2;

  // Recorrido del eje dejando fuera cada hueco: lo que queda entre huecos (y
  // en los extremos) son los sub-tramos de muro que sí se dibujan.
  const trozos: WallSpan[] = [];
  let cursor = inicioTramo;
  const finTramo = finTramoRef;
  const MINIMO = 0.05; // restos por debajo de esto son ruido de coma flotante, no muro
  for (const hueco of huecos) {
    // Una MISMA línea de muro puede tener varias puertas (dos salas contiguas
    // comparten el bloque, y cada una pone las suyas), así que llegan aquí
    // huecos que no tocan ESTE tramo. Ignorarlos es obligatorio, no una
    // optimización: sin este descarte, un hueco posterior al final del tramo
    // empujaba el cursor más allá del final y el "resto" salía con longitud
    // NEGATIVA — que `wallModuleLayout` convierte en un módulo de escala
    // negativa, dibujado justo encima del paso (bug medido: un módulo
    // fantasma de 3 u tapando una puerta, playtest 2026-08-06).
    if (hueco.max <= inicioTramo || hueco.min >= finTramo) continue;
    if (hueco.min > cursor + MINIMO) {
      const corte = Math.min(hueco.min, finTramo);
      const centro = (cursor + corte) / 2;
      trozos.push({
        length: corte - cursor,
        cx: span.horizontal ? centro : span.cx,
        cz: span.horizontal ? span.cz : centro,
        horizontal: span.horizontal,
      });
    }
    cursor = Math.max(cursor, hueco.max);
  }
  if (finTramo > cursor + MINIMO) {
    const centro = (cursor + finTramo) / 2;
    trozos.push({
      length: finTramo - cursor,
      cx: span.horizontal ? centro : span.cx,
      cz: span.horizontal ? span.cz : centro,
      horizontal: span.horizontal,
    });
  }
  return trozos;
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
 *
 * `connections`/`doorFootprintHalfWidth` (opcionales, vacío/0 en modo sala
 * única — ese modo no tiene puertas): la huella de cada pieza de puerta se
 * RECORTA de los tramos antes de repartirlos en módulos
 * (`subtractDoorFootprints`), así que el marco reemplaza exactamente el trozo
 * de muro que ocupa, sin dejar hueco ni solapar. La pieza de puerta la pinta
 * `DoorStructures` (sección de puertas más abajo).
 */
function RoomWalls({
  spans,
  roomId,
  connections = [],
  doorFootprintHalfWidth = 0,
}: {
  spans: WallSpan[];
  roomId: string;
  connections?: readonly DoorConnection[];
  doorFootprintHalfWidth?: number;
}) {
  const fullGeometry = kitGeometry(WALL_BASE_MODULE);
  const halfGeometry = kitGeometry('wall_half');
  const fullModuleLength = useMemo(() => kitBoxSize(fullGeometry).x, [fullGeometry]);
  const halfModuleLength = useMemo(() => kitBoxSize(halfGeometry).x, [halfGeometry]);

  const { fullGroups, halfPlacements } = useMemo(() => {
    // 1) Recortar lo que ocupan las piezas de puerta ANTES de repartir en
    //    módulos (ver `subtractDoorFootprints`: filtrar módulos ya colocados
    //    dejaba huecos negros a los lados de cada puerta).
    const recortados = spans.flatMap((span) => subtractDoorFootprints(span, connections, doorFootprintHalfWidth));

    // 2) Cada sub-tramo elige módulo grande o pequeño según lo que le encaje.
    const fullSpans: WallSpan[] = [];
    const halfSpans: WallSpan[] = [];
    for (const span of recortados) {
      const chosen = betterModuleLength(span.length, fullModuleLength, halfModuleLength);
      (chosen === halfModuleLength ? halfSpans : fullSpans).push(span);
    }

    // 3) Los módulos grandes sortean además su variante decorativa.
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
  }, [spans, roomId, fullModuleLength, halfModuleLength, connections, doorFootprintHalfWidth]);

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

/**
 * Instancias de UNA variante de roca (mismo geometry para todas: requisito de InstancedMesh).
 *
 * Corrección de CENTRO (mismo bug que `wall_half`, ver comentario largo de
 * `WallModuleInstances`; medido en playtest 2026-08-06: las 3 variantes de
 * roca NO nacen centradas en su `boundingBox` — `rocks` ≈(-0.09, 0),
 * `rocks_small` ≈(-0.12, -0.13), `rocks_decorated` ≈(0.12, -0.01) — a
 * diferencia de `column` y de todas las variantes de suelo, que sí están
 * centradas). Esta función coloca cada roca por el centro de su AABB y
 * ESCALA su footprint para encajarlo — con la geometría descentrada, ese
 * desfase se multiplica por el factor de escala y la roca dibujada queda
 * corrida respecto a su volumen de colisión. `kitXZCenteredGeometry`
 * (kit-fit.ts) lo corrige una vez, antes del escalado de más abajo.
 */
function RockVariantInstances({ rocks, variant }: { rocks: Obstacle[]; variant: RockVariant }) {
  const geometry = kitGeometry(variant);
  const footprint = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const centeredGeometry = useMemo(() => kitXZCenteredGeometry(geometry), [geometry]);
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
  return <instancedMesh ref={meshRef} args={[centeredGeometry, kitMaterial, rocks.length]} castShadow receiveShadow />;
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
 * Marco + hoja de puerta: los dos nodos del `.gltf` `wall_doorway`
 * (`wall_doorway` = el marco, `wall_doorway_door` = la hoja, hija del
 * anterior — ver `kit.ts::cacheModelParts`, que cachea cada nodo por
 * separado).
 *
 * Historia de TRES intentos, porque el motivo de los dos primeros fallos no
 * es evidente y sin él alguien los reintentaría:
 *
 * 1. Primero se usó `wall_gated` (rastrillo de barrotes). David: quería una
 *    puerta, no una reja.
 * 2. Después, la pieza `wall_doorway` ENTERA (marco+hoja fusionados,
 *    `kitGeometry('wall_doorway')`) tratada como UN módulo de muro más,
 *    colocada por SU PROPIO centro dentro del vano de `DOOR_WIDTH` (2 u) que
 *    ya deja la sim. Y ahí está la trampa: esa pieza mide 3.36 u de fábrica
 *    (un módulo de muro entero, no un marco estrecho) y su hueco NATURAL —
 *    antes de cualquier escalado — no mide 2 u, mide 1.68 u. Forzar la pieza
 *    ENTERA a encajar en un vano de 2 u la comprimía entera (marco incluido),
 *    dejando el hueco visualmente pequeño y el marco desproporcionado
 *    respecto al resto de módulos de muro: "eso se supone que es una
 *    puerta..." (playtest 2026-08-06, con captura). Por eso el marco se quitó
 *    y solo quedó la hoja, sola, estirada al vano — sin marco, y sin la
 *    variedad de "el marco no aparece en algunas conexiones" que se reportó
 *    después (la hoja sola siempre se pintaba bien, lo que faltaba era SIEMPRE
 *    el marco).
 *
 * La solución (intento 3, la de aquí) parte de dos medidas del propio
 * `.gltf`, no de la pieza entera:
 *
 * - El HUECO (boundingBox de la hoja, `wall_doorway_door`) mide 1.68 u de
 *   ancho de fábrica — no 2 u. Así que `computeDoorFit` escala la pieza
 *   ENTERA (marco Y hoja, con el MISMO factor: comparten el mismo espacio
 *   local del `.gltf`, escalarlas por separado las desalinearía) en su eje
 *   largo hasta que el hueco mide exactamente `DOOR_WIDTH` — nunca al revés
 *   (forzar la pieza entera a una medida fija, que es lo que hizo el intento
 *   2). El punto de referencia para centrar esa escala es el CENTRO DEL
 *   HUECO, no el de la pieza (`centerOnDoorHole`) — en este modelo concreto
 *   ambos centros coinciden en 0 una vez compuesta la transformación del
 *   nodo (la hoja es hija del marco con una traslación que la re-centra), así
 *   que en la práctica da igual, pero medirlo así en vez de asumir "la pieza
 *   ya nace centrada" es lo que hace que otra variante de puerta del kit,
 *   con otras proporciones, encajara sola sin tocar este código.
 * - Al escalar el hueco hasta `DOOR_WIDTH`, las JAMBAS de piedra del marco
 *   (la piedra a los lados del hueco, parte de la MISMA pieza) escalan con
 *   él y acaban siendo más anchas que el propio hueco: el marco ya escalado
 *   mide más que un módulo de muro (~4 u en vez de 3.36 u) y sobresale sobre
 *   el tramo de muro vecino a cada lado del vano. Por eso el marco no se
 *   PINTA ENTRE los módulos de muro que ya calcula `RoomWalls` (eso es lo que
 *   falló en el intento 2): los REEMPLAZA. `placementUnderDoor` (sección de
 *   Muros, más arriba) descarta, de la lista de `WallPlacement` ya calculada,
 *   los módulos cuyo centro cae bajo la huella del marco YA escalado
 *   (`footprintHalfWidth`), y el marco se pinta ahí en su lugar. Cero solape
 *   coplanar, cero desplazamiento tramposo, muro visualmente continuo.
 *
 * El marco se pinta SIEMPRE (puerta abierta o cerrada: es piedra fija, parte
 * del muro); la hoja de madera solo cuando la conexión sigue cerrada
 * (`DoorStructures` sondea `world.wallVersion`, igual que antes).
 */
const DOOR_MODULE_MODEL = 'wall_doorway';

/**
 * Hoja de la puerta que exige LLAVE: clon dorado del material cálido. La
 * distinción "esta puerta necesita llave" lleva validada desde antes del kit y
 * no puede perderse — se clona una vez a nivel de módulo, nunca se muta
 * `kitWarmMaterial`, que comparte todo lo de madera del juego.
 */
const doorKeyLeafMaterial = kitWarmMaterial.clone();
doorKeyLeafMaterial.color = new THREE.Color('#d9a531');

/**
 * Geometrías de `wall_doorway` (marco y hoja) recentradas para que el CENTRO
 * DEL HUECO — no el de la pieza, ver comentario largo de arriba — caiga en su
 * origen local. Cacheada por geometría de ENTRADA (marco y hoja tienen cada
 * una su propia entrada, la caché nunca las confunde): `kitGeometryPart`
 * devuelve siempre la MISMA instancia para un mismo nodo, así que recentrar
 * dos veces desperdiciaría memoria de GPU sin motivo — mismo patrón que
 * `kitXZCenteredGeometry` (kit-fit.ts), pero deliberadamente NO es esa
 * función: `kitXZCenteredGeometry` centra una geometría por SU PROPIA caja,
 * y aquí hacen falta DOS geometrías (marco y hoja) recentradas por la MISMA
 * referencia externa (el hueco, medido solo sobre la hoja) para que sigan
 * encajando entre sí exactamente igual que en el modelo original.
 */
const doorHoleCenteredCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function centerOnDoorHole(geometry: THREE.BufferGeometry, holeCenter: { x: number; z: number }): THREE.BufferGeometry {
  const cached = doorHoleCenteredCache.get(geometry);
  if (cached) return cached;
  const centered = geometry.clone().translate(-holeCenter.x, 0, -holeCenter.z);
  centered.computeBoundingBox();
  doorHoleCenteredCache.set(geometry, centered);
  return centered;
}

/** Ajuste geométrico del módulo `wall_doorway`, igual para TODAS las puertas de la mazmorra (misma pieza) — se calcula una única vez, ver `computeDoorFit`. */
interface DoorFit {
  /** Geometría del marco, recentrada por el hueco (ver `centerOnDoorHole`). Se pinta siempre. */
  frameGeometry: THREE.BufferGeometry;
  /** Geometría de la hoja, recentrada por el MISMO punto que el marco. Solo se pinta si la conexión sigue cerrada. */
  leafGeometry: THREE.BufferGeometry;
  /** Factor de escala en X (eje largo del muro) para que el hueco mida exactamente `DOOR_WIDTH`. Se aplica IGUAL a marco y hoja. */
  scaleX: number;
  /** Factor de escala en Z (grosor) para que el marco mida `WALL_THICKNESS` — mismo cálculo que `WallModuleInstances.thicknessScale` para `wall`. Se aplica IGUAL a marco y hoja. */
  scaleZ: number;
  /** Offset en Y para apoyar el marco en el suelo (min.y del boundingBox del marco, ya recentrado en XZ — recentrar no toca Y). */
  groundY: number;
  /** Mitad del ancho TOTAL que ocupa el marco ya escalado (jambas incluidas) a lo largo del eje del muro — el radio de exclusión que usa `placementUnderDoor`. */
  footprintHalfWidth: number;
}

/**
 * Calcula `DoorFit` leyendo el `boundingBox` real del kit — nunca a mano, así
 * si el modelo cambiara de proporciones esto se sigue ajustando solo (mismo
 * principio que el resto de `kit-fit.ts`). Se llama UNA vez por montaje de
 * `DungeonStructureView` (la pieza es la misma para todas las puertas de la
 * mazmorra) y el resultado se reparte a `RoomWalls` (necesita
 * `footprintHalfWidth` para filtrar) y `DoorStructures` (necesita el resto
 * para pintar marco y hoja).
 */
function computeDoorFit(): DoorFit {
  const leafRaw = kitGeometryPart(DOOR_MODULE_MODEL, `${DOOR_MODULE_MODEL}_door`);
  const frameRaw = kitGeometryPart(DOOR_MODULE_MODEL, DOOR_MODULE_MODEL);
  const holeBox = leafRaw.boundingBox;
  if (!holeBox) throw new Error('la hoja de puerta del kit no trae boundingBox calculado');
  const holeCenter = { x: (holeBox.min.x + holeBox.max.x) / 2, z: (holeBox.min.z + holeBox.max.z) / 2 };
  const holeWidth = holeBox.max.x - holeBox.min.x;
  const frameSize = kitBoxSize(frameRaw);
  const scaleX = DOOR_WIDTH / holeWidth;
  const scaleZ = WALL_THICKNESS / frameSize.z;
  const frameGeometry = centerOnDoorHole(frameRaw, holeCenter);
  const leafGeometry = centerOnDoorHole(leafRaw, holeCenter);
  return {
    frameGeometry,
    leafGeometry,
    scaleX,
    scaleZ,
    groundY: kitGroundOffset(frameGeometry),
    footprintHalfWidth: (frameSize.x * scaleX) / 2,
  };
}

/** Marco de UNA conexión: piedra, SIEMPRE visible (puerta abierta o cerrada). */
function DoorFrame({ conn, fit }: { conn: DoorConnection; fit: DoorFit }) {
  const horizontal = isConnectionWallHorizontal(conn);
  // `doorWallCenter`, no `conn.center` crudo — ver su comentario largo (más
  // arriba, junto a `DoorFloorPatch`): `conn.center` es el borde interior de
  // la sala, medio grosor de muro más cerca de lo que hace falta.
  const { x, z } = doorWallCenter(conn);
  return (
    <mesh
      geometry={fit.frameGeometry}
      material={kitMaterial}
      position={[x, fit.groundY, z]}
      rotation={[0, horizontal ? 0 : Math.PI / 2, 0]}
      scale={[fit.scaleX, 1, fit.scaleZ]}
      castShadow
      receiveShadow
    />
  );
}

/** Hoja de UNA conexión CERRADA: madera (o dorada si exige llave), con la MISMA transformación que `DoorFrame` para que encaje justo en su hueco. */
function DoorLeaf({ conn, gate, fit }: { conn: DoorConnection; gate: Obstacle; fit: DoorFit }) {
  const horizontal = isConnectionWallHorizontal(conn);
  const isKeyDoor = gate.id.endsWith('-key');
  const { x, z } = doorWallCenter(conn);
  return (
    <mesh
      geometry={fit.leafGeometry}
      material={isKeyDoor ? doorKeyLeafMaterial : kitWarmMaterial}
      position={[x, fit.groundY, z]}
      rotation={[0, horizontal ? 0 : Math.PI / 2, 0]}
      scale={[fit.scaleX, 1, fit.scaleZ]}
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
 * Puertas de la mazmorra: un marco por CADA conexión (siempre) y una hoja por
 * conexión que sigue CERRADA. La hoja se recalcula cuando `world.wallVersion`
 * cambia (abrir una puerta, evento raro) con el mismo sondeo barato por frame
 * que ya usaba el `DoorGates` original; el marco no depende de ese estado, se
 * pinta igual abierta o cerrada.
 */
function DoorStructures({ world, fit }: { world: World; fit: DoorFit }) {
  const [version, setVersion] = useState(world.wallVersion);

  useFrame(() => {
    if (world.wallVersion !== version) setVersion(world.wallVersion);
  });

  const dungeon = world.dungeon;
  if (!dungeon) return null;

  return (
    <>
      {dungeon.connections.map((conn, i) => (
        <DoorFrame key={`door-frame-${i}`} conn={conn} fit={fit} />
      ))}
      {dungeon.connections.map((conn, i) => {
        const gate = findGateForConnection(world, i);
        return gate ? <DoorLeaf key={`door-leaf-${i}`} conn={conn} gate={gate} fit={fit} /> : null;
      })}
    </>
  );
}

// ── Deduplicado de muros compartidos entre salas contiguas ─────────────────

/**
 * Clave de un AABB redondeada a la milésima de unidad. Dos muros que
 * describen el MISMO bloque físico pueden llegar con un `double` distinto en
 * el último bit (cada uno se calcula sumando el `origin` de SU sala — con su
 * propio camino de redondeo de coma flotante durante la colocación — más un
 * offset fijo, ver `dungeon.ts::makeWallSegment`), así que comparar con
 * igualdad estricta los dejaría pasar como "distintos" por puro ruido de
 * coma flotante. La milésima de unidad sobra de margen: el propio grosor de
 * muro es 0.42 u, tres órdenes de magnitud mayor que ese ruido.
 */
function aabbKey(aabb: AABB): string {
  const round = (n: number) => Math.round(n * 1000);
  return `${round(aabb.minX)}:${round(aabb.maxX)}:${round(aabb.minY)}:${round(aabb.maxY)}`;
}

/**
 * Quita, de una lista de obstáculos-muro de TODA la mazmorra, los que
 * comparten AABB exacto con uno ya visto — el bloque físico que dos salas
 * contiguas dibujan cada una por su cuenta cuando `ROOM_GAP === WALL_THICKNESS`
 * (ver `dungeon-world.ts::doorGateAabb`: "los muros de ambas salas coinciden
 * en el mismo bloque de grosor t"). Sin deduplicar, ese bloque compartido se
 * dibuja DOS VECES exactas — dos superficies coplanares idénticas, el
 * parpadeo (z-fighting) medido en playtest 2026-08-06.
 *
 * Qué instancia "gana" cuando hay duplicado: la PRIMERA que aparece en
 * `world.obstacles`, orden estable y determinista entre recargas (los muros
 * son estáticos durante la run, nunca cambia entre frames). La sala que
 * "pierde" su copia conserva intacto su `Obstacle` de colisión — esto es
 * capa de render pura, `world.obstacles` no se toca — solo deja de dibujar
 * una malla que habría sido idéntica a la que ya dibuja la otra sala.
 *
 * LÍMITE CONOCIDO, deliberado (ver informe de la tarea, no se resuelve aquí):
 * esto solo detecta duplicados EXACTOS, que es el caso dominante medido (dos
 * salas conectadas del mismo ancho comparten el tramo entero, o un tramo
 * partido igual por la misma puerta a ambos lados). Cuando dos salas vecinas
 * NO comparten el mismo tamaño en el eje del muro compartido — dos salas de
 * anchos distintos unidas por una puerta, o dos salas que ni siquiera están
 * conectadas por puerta pero cuya rejilla las deja tocándose en una esquina —
 * cada una recorta su propio hueco de forma distinta y el solape es solo
 * PARCIAL: un AABB no es idéntico al otro, así que esta función no lo
 * detecta y esa franja parcial sigue parpadeando. Medido en el dungeon de
 * este playtest: existen (∼20 pares, casi todos esquinas de 0.42×0.42 entre
 * salas que ni siquiera están conectadas por puerta, más un puñado de tramos
 * más largos entre salas de anchos distintos) pero son un caso minoritario y
 * de área pequeña frente al de los duplicados exactos, que es el que se
 * reportó y el que se pidió arreglar. Resolverlos exigiría recortar
 * geométricamente los AABB de dos salas entre sí (una resta booleana 2D de
 * rectángulos) — una capa de complejidad nueva que no compensa para un caso
 * residual tan pequeño.
 */
function dedupeWallObstacles(walls: Obstacle[]): Obstacle[] {
  const seen = new Set<string>();
  const result: Obstacle[] = [];
  for (const wall of walls) {
    const key = aabbKey(wall.aabb);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(wall);
  }
  return result;
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
  // `dedupeWallObstacles` quita los muros que dos salas contiguas dibujarían
  // por duplicado exacto sobre el mismo bloque físico (ver su comentario:
  // bug de z-fighting playtest 2026-08-06) — ANTES de agrupar por sala, para
  // que la sala "perdedora" de un bloque compartido ya no lo tenga en su
  // lista al llegar a `RoomWalls`.
  const staticBoxes = useMemo(() => {
    return {
      walls: dedupeWallObstacles(world.obstacles.filter(isWallObstacle)),
      rocks: world.obstacles.filter((o) => !isWallObstacle(o) && !isGateObstacle(o) && !isQueenColumnObstacle(o)),
    };
  }, [world]);
  const wallsByRoom = useMemo(() => groupByRoomId(staticBoxes.walls), [staticBoxes.walls]);
  const rocksByRoom = useMemo(() => groupByRoomId(staticBoxes.rocks), [staticBoxes.rocks]);
  // Ajuste del módulo `wall_doorway` (marco+hoja): UNA vez para toda la
  // mazmorra, todas las puertas comparten la misma pieza — ver `computeDoorFit`.
  const doorFit = useMemo(() => computeDoorFit(), []);

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
          familyName={pickFloorFamily(placed.room)}
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
          connections={dungeon.connections}
          doorFootprintHalfWidth={doorFit.footprintHalfWidth}
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
      <DoorStructures world={world} fit={doorFit} />
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
        familyName={pickFloorFamily(world.room)}
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
