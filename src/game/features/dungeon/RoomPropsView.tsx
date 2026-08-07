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
import { FLOOR_FAMILIES, pickFloorFamily, type FloorFamilyName } from '@/game/render/floor-families';
import { kitGeometry, kitMaterial, kitWarmMaterial } from '@/game/render/kit';
import { kitBoxSize, kitGroundOffset, kitTopAlignOffset, kitXZCenterOffset } from '@/game/render/kit-fit';
import { useKnownRoomIds } from '@/game/render/known-rooms';
import {
  computeRoomProps,
  type FloorScatterPlacement,
  type WallClutterPlacement,
  type WallDecorPlacement,
} from './room-props';

// ── Decals de suelo ─────────────────────────────────────────────────────────

/**
 * Cuánto se levanta el decal sobre la altura EXACTA de la losa (ver
 * `FloorScatterMesh` más abajo): a esa altura exacta, la cara de la losa
 * quedaría COPLANAR con el suelo de la sala — mismo plano, dos superficies —
 * que es justo el z-fighting (parpadeo) reportado por David y medido en
 * playtest 2026-08-07. Este epsilon desempata la profundidad a favor del
 * decal sin que se note: 0.5 cm es lo mínimo para ganar el z-test de forma
 * consistente entre frames y, a la vez, demasiado poco para leerse como una
 * losa flotando sobre el suelo (el canto seguiría pareciendo a ras).
 */
const FLOOR_SCATTER_LIFT = 0.005;

/**
 * Decal de suelo suelto (baldosa rota/con hierbajos/con rocas encima) de la
 * FAMILIA real de la sala (`familyName`, prop nueva de `RoomPropsGroup` —
 * `computeRoomProps` ya solo puede devolver variantes del catálogo de esa
 * familia, ver `room-props.ts`/`floor-families.ts`, así que aquí no hace
 * falta comprobar nada, solo usar la familia para la altura y la escala).
 *
 * ALTURA: se impone el `topY` de la baldosa BASE de la familia
 * (`FLOOR_FAMILIES[familyName].base`), NUNCA el de la propia geometría del
 * decal — mismo criterio que ya resolvía este problema en `FloorGrid`
 * (RoomView.tsx): si cada variante se alineara por su PROPIO max.y, las que
 * llevan relieve por encima de la losa (hierbajos, rocas) hundirían la losa
 * varios centímetros bajo el suelo real, porque su max.y es la punta de la
 * planta/roca, no la cara de la losa (medido: floor_tile_small_weeds_A/B caían
 * 0.122 u por debajo del suelo real, floor_tile_large_rocks 0.204 u — la causa
 * exacta del parpadeo bajo el héroe en `start-hall` que reportó David). El
 * offset de la base se multiplica por `scale` (ver abajo) porque, a diferencia
 * de `FloorGrid` (que solo estira X/Z, nunca Y), aquí SÍ se aplica una escala
 * UNIFORME a la malla entera — la Y local de la losa se contrae con el resto
 * de la pieza, así que el offset de mundo tiene que contraerse con ella.
 *
 * ESCALA: por MEDIDA, no por lista de nombres (encargo de David: "hazlo por
 * MEDIDA, no por lista de nombres"). Antes solo `floor_tile_large_rocks` era
 * 4×4 de fábrica y se reducía con una constante a mano; ahora `tierra` también
 * tiene una variante grande (`floor_dirt_large_rocky`), así que se compara el
 * ancho real (`kitBoxSize(geometry).x`) contra el de la baldosa base de la
 * familia y se escala para que el decal ocupe exactamente UNA celda de
 * `FloorGrid` — funciona igual si el kit añadiera mañana otra variante grande
 * sin tocar esta función. Las variantes que ya nacen del tamaño de la base
 * (broken/weeds, 2×2) dan `scale ≈ 1` y no se tocan.
 */
function FloorScatterMesh({
  x,
  z,
  variant,
  rotationY,
  familyName,
}: FloorScatterPlacement & { familyName: FloorFamilyName }) {
  const geometry = kitGeometry(variant);
  const baseGeometry = kitGeometry(FLOOR_FAMILIES[familyName].base);
  const baseTopY = useMemo(() => kitTopAlignOffset(baseGeometry), [baseGeometry]);
  const baseWidth = useMemo(() => kitBoxSize(baseGeometry).x, [baseGeometry]);
  const decalWidth = useMemo(() => kitBoxSize(geometry).x, [geometry]);
  const scale = baseWidth / decalWidth;
  return (
    <mesh
      geometry={geometry}
      material={kitMaterial}
      position={[x, baseTopY * scale + FLOOR_SCATTER_LIFT, z]}
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
  floorFamily,
}: {
  roomId: string;
  bounds: AABB;
  tags: readonly RoomTag[];
  hazards: readonly HazardRuntime[];
  /**
   * Familia de suelo REAL de la sala — la calcula quien llama con
   * `pickFloorFamily`, la MISMA función y el MISMO argumento que
   * `DungeonStructureView` (RoomView.tsx) usa para elegir la rejilla de
   * baldosas de esta sala, para que decal y suelo no puedan divergir nunca
   * (ver `floor-families.ts`). Fija el catálogo de `floorScatterPlacements`
   * (`FLOOR_FAMILIES[floorFamily].scatter`) y la altura/escala con la que se
   * pinta cada decal (`FloorScatterMesh`).
   */
  floorFamily: FloorFamilyName;
}) {
  const featured = tags.includes('jefe') || tags.includes('tienda');
  // La mazmorra no cambia de layout durante la partida (mismo criterio que
  // `TorchPropsView`/`collectTorchEmitters`): se calcula una sola vez por
  // sala, no en cada frame.
  const props = useMemo(
    () => computeRoomProps(roomId, bounds, featured, hazards, FLOOR_FAMILIES[floorFamily].scatter),
    [roomId, bounds, featured, hazards, floorFamily],
  );

  return (
    <>
      {props.floorScatter.map((p, i) => (
        <FloorScatterMesh key={`floor-${i}`} {...p} familyName={floorFamily} />
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

/**
 * Atrezzo de TODA la mazmorra (dungeon) o de la sala única (playtest del
 * editor) — mismo split de modo que `RoomView.tsx`. En modo mazmorra, mismo
 * filtro de salas CONOCIDAS que `DungeonStructureView` (`known-rooms.ts`,
 * encargo de playtest 2026-08-06): el atrezzo de una sala oculta no se monta
 * hasta que la sala se vuelve conocida.
 */
export function RoomPropsView({ world }: { world: World }) {
  const dungeon = world.dungeon;
  const knownRoomIds = useKnownRoomIds(world);
  const hazardsByRoom = useMemo(() => groupHazardsByRoom(world.hazards), [world]);

  if (dungeon) {
    return (
      <>
        {dungeon.rooms
          .filter((placed) => knownRoomIds.has(placed.room.id))
          .map((placed) => (
            <RoomPropsGroup
              key={placed.room.id}
              roomId={placed.room.id}
              bounds={placed.bounds}
              tags={placed.room.tags}
              hazards={hazardsByRoom.get(placed.room.id) ?? []}
              // Misma llamada que `DungeonStructureView` (RoomView.tsx) usa
              // para elegir la rejilla de suelo de esta sala: decal y suelo
              // nunca pueden divergir porque los dos parten del mismo
              // `pickFloorFamily(placed.room)`.
              floorFamily={pickFloorFamily(placed.room)}
            />
          ))}
      </>
    );
  }

  return (
    <RoomPropsGroup
      roomId={world.room.id}
      bounds={world.bounds}
      tags={world.room.tags}
      hazards={world.hazards}
      // Mismo criterio que `SingleRoomView` (RoomView.tsx): sala única del
      // playtest del editor, misma llamada a `pickFloorFamily`.
      floorFamily={pickFloorFamily(world.room)}
    />
  );
}
