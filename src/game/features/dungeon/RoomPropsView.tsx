/**
 * Atrezzo de sala (F5, ART_KIT_PLAN.md §5): decals de suelo + bulto de
 * esquina + banderas/candelabro de jefe/tienda, calculados por
 * `room-props.ts` (puro, determinista por id de sala) y montados aquí como
 * geometría del kit. Visual PURO, sin colisión — la sim no conoce nada de
 * este fichero, mismo criterio que `TorchPropsView.tsx`/`torch-placements.ts`
 * (atrezzo de antorchas) y `torch-placements.ts` en general.
 *
 * Densidad deliberadamente baja (unas pocas piezas por sala, ver los topes en
 * `room-props.ts`): es ambientación, y el encargo pone la legibilidad
 * (encontrar al héroe/hazards de un vistazo) por encima de la decoración.
 *
 * Materiales (misma pregunta que ya resolvió el barril en `kit.ts`, "¿piedra
 * o no piedra?"):
 * - Decals de suelo (baldosa partida/con hierbajos/con rocas): `kitMaterial`
 *   — son SUELO, la piedra fría de NightA es exactamente lo que toca (mismo
 *   material que `FloorGrid` en RoomView.tsx).
 * - `rubble_half` (esquina): `kitMaterial` — escombros de mampostería, piedra
 *   por definición (mismo material que usa `QueenColumnsView.tsx` para sus
 *   restos de columna).
 * - `box_small`/`crate_small` (esquina): `kitWarmMaterial` — son madera, y con
 *   la paleta azul de NightA se fundirían con el muro de detrás, el mismo
 *   problema ya resuelto para el barril explosivo.
 * - `banner_red`/`banner_blue`: `kitWarmMaterial`, NO `kitMaterial` — son dos
 *   piezas separadas justamente para distinguir rojo de azul; con el atlas
 *   NightA (monocromo frío) esa distinción desaparecería y las dos banderas
 *   se leerían del mismo tono. El atlas ORIGINAL conserva su color real.
 * - `candle_triple`: `kitMaterial` — mismo criterio que `torch_mounted` en
 *   `TorchView.tsx` (también un soporte de fuego montado en superficie, que
 *   ya usa `kitMaterial`): es un soporte de piedra/metal, no madera. Sin
 *   llama ni luz propia (a diferencia de `torch_mounted`): es un candelabro
 *   apagado de fondo, no una fuente de luz nueva — el presupuesto de 7
 *   luces + 1 sombra no se toca.
 */

import { useMemo } from 'react';
import type { AABB } from '@/engine/geometry';
import type { HazardRuntime, RoomTag, World } from '@/game/world/types';
import { kitGeometry, kitMaterial, kitWarmMaterial } from '@/game/render/kit';
import { kitBoxSize, kitGroundOffset, kitTopAlignOffset, kitXZCenterOffset } from '@/game/render/kit-fit';
import {
  computeRoomProps,
  type FloorScatterPlacement,
  type WallClutterPlacement,
  type WallDecorPlacement,
} from './room-props';

// ── Decals de suelo ─────────────────────────────────────────────────────────

/**
 * `floor_tile_large_rocks` es la ÚNICA variante de fábrica 4×4 del catálogo de
 * `room-props.ts` (el resto ya nace 2×2, que a `KIT_SCALE` cae justo en el
 * tamaño de UNA celda de `FloorGrid`, RoomView.tsx: por eso esas 4 variantes
 * no necesitan escala aparte). Este factor la reduce al mismo tamaño de celda
 * — mismo valor y mismo motivo que `FLOOR_TILE_SCALE` en RoomView.tsx, para
 * que las 5 variantes se lean siempre como "esta baldosa en concreto está rota/
 * cubierta", nunca como un parche de tamaño suelto.
 */
const FLOOR_SCATTER_LARGE_ROCKS_SCALE = 0.5;

function FloorScatterMesh({ x, z, variant, rotationY }: FloorScatterPlacement) {
  const geometry = kitGeometry(variant);
  // Mismo criterio que `FloorGrid`/`SpikesField` (RoomView.tsx/HazardView.tsx):
  // las variantes de `floor_tile_large`/`floor_tile_small` apoyan por su cara
  // SUPERIOR (max.y), no por min.y — alinear por min.y las hundiría bajo el
  // plano y=0 donde vive el resto del juego.
  const topY = useMemo(() => kitTopAlignOffset(geometry), [geometry]);
  const scale = variant === 'floor_tile_large_rocks' ? FLOOR_SCATTER_LARGE_ROCKS_SCALE : 1;
  return (
    <mesh
      geometry={geometry}
      material={kitMaterial}
      position={[x, topY * scale, z]}
      rotation={[0, rotationY, 0]}
      scale={scale}
      receiveShadow
    />
  );
}

// ── Bulto de esquina (escombros/caja/cajón) ─────────────────────────────────

/** Escombros de esquina: mucho más bajo que la pieza de fábrica (pensada para un tramo de muro entero, ver comentario de `rubble_half` en QueenColumnsView.tsx) — una pila baja de cascotes, no un muro roto. */
const WALL_CLUTTER_RUBBLE_HEIGHT = 0.4;
/** Caja de madera: ancho objetivo comparable al footprint del poste de esquina (`column` ≈0.59×0.59, ART_KIT_PLAN §2) — cabe "dentro de su huella" (categoría (c) de la restricción de diseño). */
const WALL_CLUTTER_BOX_WIDTH = 0.55;
/** Cajón de madera: mismo criterio que la caja, por su eje largo (X). */
const WALL_CLUTTER_CRATE_WIDTH = 0.6;

function WallClutterMesh({ x, z, kind, rotationY }: WallClutterPlacement) {
  const geometry = kitGeometry(kind);
  const size = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const center = useMemo(() => kitXZCenterOffset(geometry), [geometry]);
  const material = kind === 'rubble_half' ? kitMaterial : kitWarmMaterial;

  let scale: number;
  if (kind === 'rubble_half') scale = WALL_CLUTTER_RUBBLE_HEIGHT / size.y;
  else if (kind === 'box_small') scale = WALL_CLUTTER_BOX_WIDTH / size.x;
  else scale = WALL_CLUTTER_CRATE_WIDTH / size.x;

  // `rubble_half` no nace centrada en XZ (su X real va de 0 a 4, ver
  // `kitXZCenterOffset`): se recoloca vía `center`, y por eso NO gira — mismo
  // motivo que `QueenColumnsView.tsx` deja sus restos sin rotar: girar aquí
  // haría que el centro visual orbitara alrededor del pivote de fábrica en
  // vez de girar sobre sí mismo. `box_small`/`crate_small` SÍ nacen centradas
  // (verificado contra su `.gltf`), así que su `rotationY` es seguro.
  const isRubble = kind === 'rubble_half';
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[x + (isRubble ? center.x * scale : 0), groundY * scale, z + (isRubble ? center.z * scale : 0)]}
      rotation={[0, isRubble ? 0 : rotationY, 0]}
      scale={scale}
      castShadow
      receiveShadow
    />
  );
}

// ── Bandera/candelabro de parapeto (solo sala de jefe/tienda) ───────────────

/** Altura de montaje — mismo valor y mismo criterio que `TORCH_BASE_Y` (torch-placements.ts/TorchView.tsx): "aplique colgado del muro", no clavado en el suelo. */
const WALL_DECOR_MOUNT_Y = 0.9;
/** Alto objetivo de la bandera: una banderola visible sobre el parapeto sin devorar la sala (de 0.9 a ≈1.9 u de altura total). */
const BANNER_TARGET_HEIGHT = 1.0;
/** Alto objetivo del candelabro: pequeño, de fondo — no compite con las antorchas reales del pool. */
const CANDLE_TARGET_HEIGHT = 0.35;

function WallDecorMesh({ x, z, kind, dirX, dirZ }: WallDecorPlacement) {
  const geometry = kitGeometry(kind);
  const size = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const material = kind === 'candle_triple' ? kitMaterial : kitWarmMaterial;
  const targetHeight = kind === 'candle_triple' ? CANDLE_TARGET_HEIGHT : BANNER_TARGET_HEIGHT;
  const scale = targetHeight / size.y;
  // Mismo patrón que `WallTorch` (TorchView.tsx): `dirX`/`dirZ` apunta desde
  // la pieza HACIA el centro de la sala, así que esta rotación deja la cara
  // "buena" de la pieza mirando adentro sea cual sea el muro del que cuelgue.
  const rotationY = Math.atan2(dirX, dirZ);
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[x, WALL_DECOR_MOUNT_Y + groundY * scale, z]}
      rotation={[0, rotationY, 0]}
      scale={scale}
      castShadow
      receiveShadow
    />
  );
}

// ── Por sala: calcula y monta las 3 categorías ──────────────────────────────

function RoomPropsGroup({
  roomId,
  bounds,
  tags,
  hazards,
}: {
  roomId: string;
  bounds: AABB;
  tags: readonly RoomTag[];
  hazards: readonly HazardRuntime[];
}) {
  const featured = tags.includes('jefe') || tags.includes('tienda');
  // La mazmorra no cambia de layout durante la partida (mismo criterio que
  // `TorchPropsView`/`collectTorchEmitters`): se calcula una sola vez por
  // sala, no en cada frame.
  const props = useMemo(
    () => computeRoomProps(roomId, bounds, featured, hazards),
    [roomId, bounds, featured, hazards],
  );

  return (
    <>
      {props.floorScatter.map((p, i) => (
        <FloorScatterMesh key={`floor-${i}`} {...p} />
      ))}
      {props.wallClutter.map((p, i) => (
        <WallClutterMesh key={`clutter-${i}`} {...p} />
      ))}
      {props.wallDecor.map((p, i) => (
        <WallDecorMesh key={`decor-${i}`} {...p} />
      ))}
    </>
  );
}

/** Agrupa hazards por sala dueña — mismo patrón que `RoomView.tsx::groupByRoomId`, redefinido aquí para no acoplar este fichero a esa vista (mismo criterio que `RimSpan` en HazardView.tsx). */
function groupHazardsByRoom(hazards: readonly HazardRuntime[]): Map<string, HazardRuntime[]> {
  const map = new Map<string, HazardRuntime[]>();
  for (const hazard of hazards) {
    const key = hazard.roomId ?? '';
    const bucket = map.get(key);
    if (bucket) bucket.push(hazard);
    else map.set(key, [hazard]);
  }
  return map;
}

/** Atrezzo de TODA la mazmorra (dungeon) o de la sala única (playtest del editor) — mismo split de modo que `RoomView.tsx`. */
export function RoomPropsView({ world }: { world: World }) {
  const dungeon = world.dungeon;
  const hazardsByRoom = useMemo(() => groupHazardsByRoom(world.hazards), [world]);

  if (dungeon) {
    return (
      <>
        {dungeon.rooms.map((placed) => (
          <RoomPropsGroup
            key={placed.room.id}
            roomId={placed.room.id}
            bounds={placed.bounds}
            tags={placed.room.tags}
            hazards={hazardsByRoom.get(placed.room.id) ?? []}
          />
        ))}
      </>
    );
  }

  return <RoomPropsGroup roomId={world.room.id} bounds={world.bounds} tags={world.room.tags} hazards={world.hazards} />;
}
