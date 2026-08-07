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
 * - `candle_triple`: `kitMaterial` para la cera/soporte — mismo criterio que
 *   `torch_mounted` en `TorchView.tsx` (también un soporte de fuego montado
 *   en superficie): es piedra/metal, no madera.
 *
 * `candle_triple` SÍ da algo de luz falsa (playtest de David, 2026-08-06:
 * "si pones velas por el escenario puedes ponerles algo de luz también") —
 * antes era un candelabro apagado, geometría pura sin ninguna señal de que
 * estuviera encendido. Mismo patrón EXACTO que `WallTorch` (TorchView.tsx):
 * una llamita `unitCone` con `bossCandleFlameMaterial` (autoiluminada, el
 * MISMO material ya compartido por las antorchas de muro — cero coste de
 * material nuevo) sobre la cera, más un `GlowPuddle` a ras de suelo bajo el
 * candelabro con `TORCH_LIGHT_COLOR` — el mismo cálido que usan las
 * antorchas, para que se lea como la misma familia de luz ambiental. NINGUNA
 * luz real (`pointLight`/`spotLight`): el presupuesto de 7 luces + 1 sombra
 * sigue intacto, ver cabecera de `GlowPuddle.tsx`.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Mesh } from 'three';
import type { AABB } from '@/engine/geometry';
import type { HazardRuntime, RoomTag, World } from '@/game/world/types';
import { unitCone } from '@/game/render/assets';
import { bossCandleFlameMaterial } from '@/game/render/assets-dark';
import { TORCH_LIGHT_COLOR } from '@/game/features/dungeon/torch-placements';
import { GlowPuddle } from '@/game/render/GlowPuddle';
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

/**
 * Bandera de parapeto: geometría plana, sin luz — `kitWarmMaterial` (atlas
 * ORIGINAL, ver cabecera del fichero: con `kitMaterial` azul se perdería la
 * distinción roja/azul de las dos variantes).
 */
function BannerMesh({ x, z, kind, dirX, dirZ }: WallDecorPlacement) {
  const geometry = kitGeometry(kind);
  const size = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const scale = BANNER_TARGET_HEIGHT / size.y;
  // Mismo patrón que `WallTorch` (TorchView.tsx): `dirX`/`dirZ` apunta desde
  // la pieza HACIA el centro de la sala, así que esta rotación deja la cara
  // "buena" de la pieza mirando adentro sea cual sea el muro del que cuelgue.
  const rotationY = Math.atan2(dirX, dirZ);
  return (
    <mesh
      geometry={geometry}
      material={kitWarmMaterial}
      position={[x, WALL_DECOR_MOUNT_Y + groundY * scale, z]}
      rotation={[0, rotationY, 0]}
      scale={scale}
      castShadow
      receiveShadow
    />
  );
}

/**
 * Radio del charco de luz falso de la vela — mismo mecanismo EXACTO que
 * `TORCH_GLOW_PUDDLE_RADIUS` en `TorchView.tsx` (disco aditivo bajo el
 * emisor, ver cabecera de `GlowPuddle.tsx`), pero bastante más pequeño: el
 * candelabro es una pieza minúscula de fondo (`CANDLE_TARGET_HEIGHT`=0.35,
 * la mitad de `TORCH_WAX_HEIGHT`=0.7 de una antorcha), su charco tiene que
 * leerse a la misma escala — un derrame del tamaño del de una antorcha real
 * delataría que es más grande de lo que aparenta.
 */
const CANDLE_GLOW_PUDDLE_RADIUS = 0.8;
/**
 * Opacidad del charco de la vela — MISMO valor que `TORCH_GLOW_PUDDLE_OPACITY`
 * (TorchView.tsx) y `SHOPKEEPER_GLOW_PUDDLE_OPACITY` (TorchPropsView.tsx),
 * ambas privadas ahí, de ahí que se repita el número en vez de importarlo
 * (mismo patrón ya establecido entre esos dos ficheros). Coincidir el par
 * color+opacidad exacto con las antorchas hace que `glowPuddleMaterial`
 * (cacheado por esa clave, ver `assets.ts`) devuelva el MISMO material ya
 * creado para ellas — cero materiales nuevos por poner velas en una sala.
 */
const CANDLE_GLOW_PUDDLE_OPACITY = 0.16;
/** Altura de la llama sobre el suelo: justo por encima de la cera (`WALL_DECOR_MOUNT_Y + CANDLE_TARGET_HEIGHT`), un pelín más para que no quede enterrada en la punta del modelo. */
const CANDLE_FLAME_HEIGHT = WALL_DECOR_MOUNT_Y + CANDLE_TARGET_HEIGHT + 0.02;
/** Escala XZ/Y de la llama — mismas proporciones que `FLAME_SCALE_XZ`/`FLAME_SCALE_Y` de `TorchView.tsx`, reducidas a la mitad (misma proporción que `CANDLE_TARGET_HEIGHT`/`TORCH_WAX_HEIGHT` = 0.35/0.7): una llama de vela más pequeña que la de una antorcha de muro. */
const CANDLE_FLAME_SCALE_XZ = 0.05;
const CANDLE_FLAME_SCALE_Y = 0.1;
/** Parpadeo de la llama: misma suma de senos barata que `WallTorch` (TorchView.tsx), desfasada por posición (no hay índice de antorcha aquí — como mucho hay UN candelabro por sala, x+z ya basta para que dos salas no titilen en fase). */
const CANDLE_FLICKER_FREQ_A = 4.3;
const CANDLE_FLICKER_FREQ_B = 9.1;
const CANDLE_FLICKER_WEIGHT_A = 0.6;
const CANDLE_FLICKER_WEIGHT_B = 0.4;

/**
 * Candelabro de parapeto, ENCENDIDO (playtest de David, 2026-08-06: "si pones
 * velas por el escenario puedes ponerles algo de luz también"): la cera/soporte
 * sigue en `kitMaterial` sin cambios, y encima se monta una llamita
 * autoiluminada (`bossCandleFlameMaterial`, el MISMO material que ya usan las
 * antorchas de muro — cero coste de material nuevo) + un `GlowPuddle` a ras de
 * suelo bajo el candelabro. Mismo patrón EXACTO que `WallTorch`
 * (`TorchView.tsx`): grupo fijo en `(x, 0, z)`, cera montada dentro a
 * `WALL_DECOR_MOUNT_Y`, llama y charco sobre el eje local — girar el grupo no
 * perturba ninguno de los dos, ambos son de revolución. NINGUNA luz real: el
 * presupuesto de 7 luces + 1 sombra no se toca (ver cabecera del fichero).
 */
function CandleMesh({ x, z, dirX, dirZ }: WallDecorPlacement) {
  const geometry = kitGeometry('candle_triple');
  const size = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  const scale = CANDLE_TARGET_HEIGHT / size.y;
  const rotationY = Math.atan2(dirX, dirZ);
  const flameRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);

  // Desfase determinista por posición (mismo espíritu que el bob de
  // `ItemView.tsx::ItemMesh`, `Math.sin(time*3 + item.position.x)`): nunca
  // `Math.random()`, y basta con `x+z` porque como mucho hay UN candelabro
  // por sala (`wallDecorPlacements`, room-props.ts).
  const phase = x + z;
  useFrame((state) => {
    const flame = flameRef.current;
    if (!flame) return;
    const t = state.clock.elapsedTime + phase;
    const flicker =
      CANDLE_FLICKER_WEIGHT_A * Math.sin(t * CANDLE_FLICKER_FREQ_A) +
      CANDLE_FLICKER_WEIGHT_B * Math.sin(t * CANDLE_FLICKER_FREQ_B);
    const pulse = 1 + flicker * 0.1;
    flame.scale.set(CANDLE_FLAME_SCALE_XZ * pulse, CANDLE_FLAME_SCALE_Y * pulse, CANDLE_FLAME_SCALE_XZ * pulse);
  });

  return (
    <group position={[x, 0, z]} rotation={[0, rotationY, 0]}>
      <mesh
        geometry={geometry}
        material={kitMaterial}
        position={[0, WALL_DECOR_MOUNT_Y + groundY * scale, 0]}
        scale={scale}
        castShadow
        receiveShadow
      />
      <mesh
        ref={flameRef}
        geometry={unitCone}
        material={bossCandleFlameMaterial}
        position={[0, CANDLE_FLAME_HEIGHT, 0]}
        scale={[CANDLE_FLAME_SCALE_XZ, CANDLE_FLAME_SCALE_Y, CANDLE_FLAME_SCALE_XZ]}
      />
      {/* Candelabro FIJO (nunca se mueve tras montar): con la posición por defecto de GlowPuddle (0, GLOW_PUDDLE_GROUND_Y, 0 local) basta. */}
      <GlowPuddle
        meshRef={glowRef}
        color={TORCH_LIGHT_COLOR}
        radius={CANDLE_GLOW_PUDDLE_RADIUS}
        opacity={CANDLE_GLOW_PUDDLE_OPACITY}
      />
    </group>
  );
}

function WallDecorMesh(props: WallDecorPlacement) {
  return props.kind === 'candle_triple' ? <CandleMesh {...props} /> : <BannerMesh {...props} />;
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

/** Agrupa hazards por sala dueña — mismo patrón que `RoomView.tsx::groupByRoomId`, redefinido aquí para no acoplar este fichero a esa vista. */
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
