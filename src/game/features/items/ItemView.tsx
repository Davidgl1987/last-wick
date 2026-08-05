/**
 * Objetos recogibles (GDD §9): moneda, poción, llave. Los items nuevos
 * (monedas soltadas por enemigos, ver features/items/items.ts `dropCoinAt`/`dropPotionAt`)
 * se añaden a `world.items` en runtime vía `.push`, sin pasar por setState de
 * React: `ItemViews` necesita su propio trigger de re-render por `.length`
 * (ver comentario en `ItemViews` más abajo) o esos items nacen sin mesh.
 *
 * Formas (ART_KIT_PLAN.md F4 — antes geometría primitiva propia, ver historial
 * de este fichero para la versión previa):
 * - Moneda (punto 9 de playtest): pieza `coin` del kit, escalada a
 *   `COIN_RADIUS` (no a `KIT_SCALE`: es un objeto de juego con tamaño propio
 *   ya ajustado a recogida/legibilidad, ART_KIT_PLAN.md §2). Sigue girando
 *   sobre su eje vertical con el tiempo del mundo (determinista).
 * - Poción (punto 10): `bottle_A_labeled_green` del kit en vez del frasco
 *   compuesto (esfera+cuello+tapón) de antes; escalada para ocupar
 *   exactamente la misma altura que el frasco que sustituye.
 * - Llave: `key_gold` del kit en vez del cubo dorado; necesita una corrección
 *   de geometría ÚNICA (ver `KeyShape`) porque nace pensada para colgar de
 *   un gancho, no para verse desde la cámara cenital del juego.
 *
 * Las tres formas usan la GEOMETRÍA del kit pero materiales PLANOS propios,
 * no el `kitMaterial` compartido: su color es información de juego y el atlas
 * NightA lo borraría (ver el bloque de materiales más abajo, con el porqué
 * completo). El tendero es F5 y sigue con sus materiales de `assets.ts`. El
 * grupo por item se muta en useFrame (posición de bob + rotación), cero
 * asignaciones.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Group } from 'three';
import type { GameSession } from '@/game/session/session';
import type { Item } from '@/game/world/types';
import { shopkeeperHeadMaterial, shopkeeperRobeMaterial, unitCone, unitSphere } from '@/game/render/assets';
import { kitGeometry } from '@/game/render/kit';
import { kitBoxSize, kitGroundOffset } from '@/game/render/kit-fit';

const ITEM_HEIGHT: Record<Item['kind'], number> = { coin: 0.3, potion: 0.32, key: 0.3, shopkeeper: 0 };
/** Radio visual de la moneda (antes diámetro del cilindro plano de assets.ts; se conserva igual con la pieza del kit). */
const COIN_RADIUS = 0.24;
/**
 * Altura total (u de juego) que ocupaba el frasco compuesto ANTERIOR a F4
 * (esfera radio 1 de -1 a +1, cuello de 0.6 a 1.3, tapón de 1.22 a 1.62,
 * todo bajo el antiguo `POTION_SCALE`=0.24): `(1.62 - (-1)) * 0.24 = 0.6288`.
 * Se conserva como número — NO es una medida del kit (esas se leen del
 * `boundingBox` real, ver `kitBoxSize` en `PotionShape`) — solo para que
 * `bottle_A_labeled_green` ocupe en pantalla exactamente lo mismo que la
 * forma que sustituye (encargo F4: "el objeto tiene que ocupar en pantalla
 * lo MISMO que ocupa hoy").
 */
const POTION_VISUAL_HEIGHT = 0.6288;
/**
 * Altura (Y, relativa al ancla del grupo `ITEM_HEIGHT.potion`) a la que
 * quedaba el punto más bajo de la esfera del cuerpo ANTES de F4: radio 1 sin
 * desplazamiento propio, escalado por el antiguo `POTION_SCALE`=0.24 → -0.24.
 * Igual que `POTION_VISUAL_HEIGHT`, es la huella de la forma ANTERIOR (para
 * que la poción no aparezca flotando más alta o hundida respecto a donde
 * estaba validada), no una medida de `bottle_A_labeled_green`.
 */
const POTION_BASE_OFFSET = -0.24;
/** Tamaño visual objetivo de la llave (antes cubo `unitBox` a escala uniforme 0.22, ver `KeyShape`). */
const KEY_SIZE = 0.22;

/**
 * Materiales PLANOS (sin el atlas del kit) de los objetos recogibles — la
 * excepción al "un solo material para todo el kit" (`kitMaterial`), y por un
 * motivo de LEGIBILIDAD, no estético.
 *
 * Al pasar los objetos al kit heredaron su atlas, que es la variante NightA:
 * azul frío monocromo. Es justo lo que queremos para la arquitectura (piedra),
 * pero sobre los objetos borra su código de color, que aquí es INFORMACIÓN DE
 * JUEGO, no decoración — GDD §14: cada entidad se identifica por color/silueta
 * a primera vista. En la verificación de F4 la moneda y la llave (doradas
 * desde siempre) salían gris-azuladas contra un suelo gris-azulado, y la
 * poción, cuyo rosa SIGNIFICA vida, salía verde-azulada.
 *
 * Y no vale con teñir un clon de `kitMaterial` (que es lo que hace el portón
 * de llave en RoomView.tsx): `material.color` MULTIPLICA el mapa, así que
 * puede oscurecer o desaturar lo que el atlas ya tiene, pero no puede añadir
 * un color que la textura no lleva — rosa × turquesa da barro, no rosa. Por
 * eso estos tres materiales renuncian al mapa y llevan el color plano.
 *
 * Lo que se pierde con ello es menos de lo que parece: el atlas del kit es una
 * paleta de degradados planos (ART_KIT_PLAN §1), no una textura de detalle —
 * el volumen de estas piezas lo dan su geometría y el sombreado Lambert, no el
 * mapa. Un objeto pasa a leerse de UN color, que es exactamente como se leía
 * antes del kit: lo que ganamos es la silueta buena (moneda con canto, frasco
 * con cuello y etiqueta en relieve, llave con paletas y anilla).
 *
 * Los colores son EXACTAMENTE los de los materiales propios anteriores al kit
 * (`coinMaterial`/`keyMaterial`/`potionMaterial` de assets.ts): el tono ya
 * validado en playtest no cambia, solo la geometría que lo lleva.
 */
function flatItemMaterial(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}
const coinKitMaterial = flatItemMaterial('#ffd166');
const keyKitMaterial = flatItemMaterial('#ffe082');
const potionKitMaterial = flatItemMaterial('#ff6bcb');

function CoinShape({ receiveShadow }: { receiveShadow: boolean }) {
  const geometry = kitGeometry('coin');
  const nativeSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  // La moneda del kit YA nace con el mismo eje fino que el cilindro que
  // sustituye: verificado contra el .gltf, el boundingBox mide ±0.0625 en Y
  // (el eje vertical) frente a ±0.18 en X/Z — un disco tumbado sobre el
  // plano XZ, igual que el CylinderGeometry de antes. El giro de vuelco
  // sobre Z que aplica ItemMesh (canto visible al voltear) sigue
  // funcionando sin corregir nada en la geometría.
  const scale = (COIN_RADIUS * 2) / nativeSize.x;
  return <mesh geometry={geometry} material={coinKitMaterial} scale={scale} receiveShadow={receiveShadow} />;
}

/** Tendero placeholder (docs/plans/ECONOMY_PLAN.md F4): túnica cónica + cabeza esférica, estático (sin bob/giro). */
function ShopkeeperShape({ receiveShadow }: { receiveShadow: boolean }) {
  return (
    <group>
      <mesh
        geometry={unitCone}
        material={shopkeeperRobeMaterial}
        scale={[0.7, 1.4, 0.7]}
        position={[0, 0.5, 0]}
        receiveShadow={receiveShadow}
      />
      <mesh
        geometry={unitSphere}
        material={shopkeeperHeadMaterial}
        scale={0.32}
        position={[0, 1.35, 0]}
        receiveShadow={receiveShadow}
      />
    </group>
  );
}

function PotionShape({ receiveShadow }: { receiveShadow: boolean }) {
  const geometry = kitGeometry('bottle_A_labeled_green');
  const nativeSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  // Escala UNIFORME (mismo criterio que barrel_small/torch_mounted en
  // HazardView.tsx/TorchView.tsx: no romper la proporción del frasco
  // modelada) elegida para que la ALTURA total iguale la de la forma
  // anterior (`POTION_VISUAL_HEIGHT`), no `KIT_SCALE` — es un objeto de
  // juego con tamaño propio, ART_KIT_PLAN.md §2.
  const scale = POTION_VISUAL_HEIGHT / nativeSize.y;
  return (
    <mesh
      geometry={geometry}
      material={potionKitMaterial}
      // `groundY` alinea la base REAL del frasco (su boundingBox, casi 0: el
      // modelo ya apoya en su propio min.y) con el ancla del grupo; sumar
      // `POTION_BASE_OFFSET` reproduce dónde caía esa base con la forma
      // anterior, sin tener que tocar `ITEM_HEIGHT.potion` ni el useFrame de
      // `ItemMesh`.
      position={[0, POTION_BASE_OFFSET + groundY * scale, 0]}
      scale={scale}
      receiveShadow={receiveShadow}
    />
  );
}

/**
 * Llave (ART_KIT_PLAN.md F4): `key_gold` necesita DOS correcciones de
 * geometría, aplicadas UNA sola vez sobre una copia (nunca se muta la
 * `BufferGeometry` cacheada de `kitGeometry`, que comparte cualquier otro uso
 * futuro del kit — mismo patrón que `floor_tile_grate` en RoomView.tsx):
 *
 * 1. Recentrado en X: el pivote de fábrica NO está en el centro de su
 *    boundingBox (verificado contra el .gltf: min.x=-0.265, max.x=+0.667 —
 *    a diferencia del resto de props del kit, que sí centran en X/Z). Sin
 *    recentrar, el giro por frame de `ItemMesh` (`rotation.y`) haría que la
 *    llave orbitara alrededor de un punto fuera de sí misma en vez de girar
 *    sobre su propio eje.
 * 2. Giro de 90° en X: el modelo nace con su perfil reconocible (paletas +
 *    anilla) en el plano XY y el eje FINO en Z (0.14 de profundidad frente a
 *    0.93×0.53 de perfil) — pensado para colgar de un gancho de cara al
 *    espectador, no para tumbarse en el suelo. Con la cámara cenital del
 *    juego (mira hacia -Y) ese perfil se vería de canto, casi invisible; se
 *    tumba sobre el plano XZ para que se lea igual que el resto de items.
 */
function KeyShape({ receiveShadow }: { receiveShadow: boolean }) {
  const geometry = useMemo(() => {
    const base = kitGeometry('key_gold');
    const box = base.boundingBox;
    const centerX = box ? (box.max.x + box.min.x) / 2 : 0;
    const corrected = base.clone().translate(-centerX, 0, 0).rotateX(Math.PI / 2);
    corrected.computeBoundingBox();
    return corrected;
  }, []);
  const nativeSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  // Tamaño por el eje dominante (X, el más largo con diferencia): mismo
  // criterio que COIN_RADIUS (diámetro) o TORCH_WAX_HEIGHT (altura) — la
  // dimensión que de verdad se lee en pantalla para esta pieza.
  const scale = KEY_SIZE / nativeSize.x;
  return <mesh geometry={geometry} material={keyKitMaterial} scale={scale} receiveShadow={receiveShadow} />;
}

function ItemMesh({ session, itemId }: { session: GameSession; itemId: string }) {
  // Causa REAL de la fuga de luz (playtest ronda 8, punto 4: "la poción está
  // iluminada por el lado más cercano a la vela, como si no hubiera muro"):
  // NINGÚN item llevaba `receiveShadow` (a diferencia de suelos/muros de
  // RoomView.tsx, que sí lo tenían bien puesto) — un mesh sin `receiveShadow`
  // ignora el shadow map por completo y se pinta siempre con luz directa
  // plena, exista o no un muro/portón entre él y la vela. Con esto arreglado,
  // el muro/portón que SÍ castea sombra (ver RoomView.tsx) por fin oscurece
  // la poción cuando corresponde.
  const groupRef = useRef<Group>(null);

  useFrame(() => {
    const item = session.world.items.find((i) => i.id === itemId);
    const group = groupRef.current;
    if (!item || !group) return;
    group.visible = item.active;
    if (item.active) {
      // El tendero es un NPC estático (placeholder F4): sin bob ni giro, a
      // diferencia del resto de items recogibles.
      const isShopkeeper = item.kind === 'shopkeeper';
      const bob = isShopkeeper ? 0 : Math.sin(session.world.time * 3 + item.position.x) * 0.05;
      group.position.set(item.position.x, ITEM_HEIGHT[item.kind] + bob, item.position.y);
      if (isShopkeeper) {
        group.rotation.set(0, 0, 0);
      } else if (item.kind === 'coin') {
        // Moneda (ronda 3, punto 10: "que giren en el otro eje"): gira sobre
        // el eje Z (perpendicular al que se usaba antes, X) para que se vea
        // el volteo real (canto visible) con el otro "sentido" de vuelco en
        // pantalla — rotar sobre el eje vertical Y no mostraría ningún cambio
        // visual en un disco plano (ese es el único eje descartado).
        group.rotation.set(0, 0, 0);
        group.rotation.z = session.world.time * 2.4;
      } else {
        group.rotation.set(0, session.world.time * 1.5, 0);
      }
    }
  });

  const item = session.world.items.find((i) => i.id === itemId);
  const kind = item ? item.kind : 'coin';

  return (
    <group ref={groupRef}>
      {kind === 'coin' && <CoinShape receiveShadow />}
      {kind === 'potion' && <PotionShape receiveShadow />}
      {kind === 'key' && <KeyShape receiveShadow />}
      {kind === 'shopkeeper' && <ShopkeeperShape receiveShadow />}
    </group>
  );
}

export function ItemViews({ session }: { session: GameSession }) {
  // Mismo bug/fix que BarrelViews (HazardView.tsx): `world.items` crece por
  // `.push` (dropCoinAt/dropPotionAt) sin ningún setState de React de por
  // medio, así que el `.map` de abajo nunca ve los items nuevos a menos que
  // este componente vuelva a renderizar. Trigger barato: length leída una vez
  // por frame, setState solo si cambió.
  const [count, setCount] = useState(session.world.items.length);
  useFrame(() => {
    if (session.world.items.length !== count) setCount(session.world.items.length);
  });
  return (
    <>
      {session.world.items.map((item) => (
        <ItemMesh key={item.id} session={session} itemId={item.id} />
      ))}
    </>
  );
}
