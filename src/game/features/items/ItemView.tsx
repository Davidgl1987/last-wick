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
 * - Poción (punto 10): frasco del kit (`POTION_MODEL`, el más ancho del pack)
 *   en vez del frasco compuesto (esfera+cuello+tapón) de antes; escalado para
 *   ocupar exactamente la misma altura que el que sustituye.
 * - Llave: `key_gold` del kit en vez del cubo dorado; necesita una corrección
 *   de geometría ÚNICA (ver `KeyShape`) porque nace pensada para colgar de
 *   un gancho, no para verse desde la cámara cenital del juego.
 *
 * Materiales, y son tres criterios distintos a propósito (ver el bloque de
 * materiales más abajo): la LLAVE lleva material plano con su dorado de
 * siempre, porque su color es información pura; la MONEDA y la POCIÓN llevan
 * la paleta cálida del kit autoiluminada (`kitWarmGlowMaterial`), que les da
 * su oro y su cristal reales y además las hace visibles lejos de la vela; y
 * NINGUNA usa el `kitMaterial` azul de la arquitectura, que las volvería del
 * mismo color que el suelo.
 *
 * Tendero (F5, ART_KIT_PLAN.md §5): el kit NO trae personajes (§1), así que el
 * cono+esfera placeholder se sustituye por un PUESTO — `bartop_A_medium`
 * (mostrador) + `shelves_decorated` (estantería detrás) + `chest_gold` (caja),
 * ver `ShopkeeperShape`. Usa `kitWarmMaterial` (atlas ORIGINAL del pack,
 * madera/dorados), no `kitMaterial`: con la paleta nocturna azul un mostrador
 * de madera se fundía con el muro de detrás, mismo problema ya resuelto para
 * el barril (`kitWarmMaterial` en render/kit.ts). El `GlowPuddle` a los pies
 * del tendero vive en `TorchPropsView.tsx` (posicionado por `item.position`,
 * independiente de esta geometría) y no se toca.
 *
 * El grupo por item se muta en useFrame (posición de bob + rotación), cero
 * asignaciones.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Group } from 'three';
import type { GameSession } from '@/game/session/session';
import type { Item } from '@/game/world/types';
import { kitGeometry, kitWarmGlowMaterial, kitWarmMaterial } from '@/game/render/kit';
import { kitBoxSize, kitGroundOffset, kitXZCenterOffset } from '@/game/render/kit-fit';
import { useKnownRoomIds } from '@/game/render/known-rooms';
import { coinMaterial, keyMaterial } from '@/game/render/assets';
import { makeSilhouetteMaterial, SILHOUETTE_RENDER_ORDER } from '@/game/render/occlusion-silhouette';

/**
 * `coin: 0.3` sigue sirviendo tal cual tras poner la moneda DE PIE (encargo
 * de David 2026-08-17, ver `CoinShape`/`ItemMesh` más abajo) — comprobado con
 * cuenta, no a ojo: de pie la moneda ocupa ±COIN_RADIUS (0.24) en Y respecto
 * al ancla del grupo, y el bob (`ItemMesh`) suma hasta ±0.05 más. En el peor
 * caso (punto más bajo del bob) el borde inferior queda en
 * `0.3 - 0.05 - 0.24 = 0.01` — sigue por encima de y=0, así que la moneda
 * roza el suelo en el fondo del bob sin llegar a atravesarlo. No hace falta
 * tocar este número.
 */
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
/**
 * Tamaño visual objetivo de la llave, medido sobre su eje LARGO (X).
 *
 * Subido de 0.22 a 0.40 tras playtest (David, 2026-08-05: "la llave se ve
 * minúscula"). El 0.22 venía del cubo macizo anterior al kit, y al conservarlo
 * tal cual para `key_gold` se comparaban peras con manzanas: un cubo ocupa las
 * tres dimensiones enteras, mientras que la llave es una silueta larga y fina
 * (0.93 × 0.53 × 0.14 de fábrica) que a ese tamaño deja una traza de apenas
 * unos píxeles vista desde arriba. Con 0.40 en su eje largo, su masa visible
 * es comparable a la de la moneda y la poción — que es lo que importa, porque
 * la llave es el objeto MÁS crítico de la mazmorra (sin ella no se abre la
 * puerta del jefe).
 */
const KEY_SIZE = 0.4;

/**
 * Frasco de la poción: el MÁS ANCHO del pack (petición de David, 2026-08-05:
 * "usar la que es más ancha"). `bottle_C_green` mide 0.74 de ancho frente a
 * los 0.37 de `bottle_A_labeled_green`, que era el que llevaba desde F4 y se
 * leía como un tubito desde la cámara cenital. Al escalarse por ALTURA (ver
 * `PotionShape`), el frasco ancho ocupa la misma altura que antes pero el
 * doble de huella en planta, que es justo lo que se ve desde arriba.
 */
const POTION_MODEL = 'bottle_C_green';

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
 * un color que la textura no lleva — rosa × turquesa da barro, no rosa. De ahí
 * las dos salidas que se usan hoy: material plano (la llave) o el atlas
 * ORIGINAL del pack, que sí trae oro y cristal (la moneda y la poción).
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
/**
 * Cuánto brilla un objeto por sí mismo, sin luz que lo alumbre (playtest de
 * David, 2026-08-05: "quizá los objetos deberían tener un poco de luz o ser
 * emissive"). Es AUTOILUMINACIÓN, no una luz: no ilumina el suelo ni proyecta
 * nada, así que el presupuesto de 7 luces + 1 sombra del render sigue intacto
 * — mismo criterio que los halos aditivos y `GlowPuddle`, que existen
 * precisamente para dar sensación de luz sin gastar una.
 *
 * Resuelve un problema concreto de esta mazmorra: la única luz real que
 * acompaña al jugador es su vela, así que un objeto a media sala quedaba casi
 * negro y solo aparecía cuando ya estabas encima. Con el emisivo, cada objeto
 * anuncia su propio color desde lejos.
 *
 * 0.45 y no 1: a tope el objeto se aplana (el emisivo es constante, no depende
 * de la normal, así que mata el sombreado que le da volumen a la geometría del
 * kit). A 0.45 sigue leyéndose el relieve y el objeto no se pierde en la
 * oscuridad.
 */
const ITEM_EMISSIVE_INTENSITY = 0.45;

function flatItemMaterial(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color,
    // El emisivo lleva el MISMO color que el material: el objeto brilla de su
    // propio color en la oscuridad, no de un blanco que lo desaturaría.
    emissive: new THREE.Color(color),
    emissiveIntensity: ITEM_EMISSIVE_INTENSITY,
  });
}
/**
 * La LLAVE sigue con material plano y su dorado de siempre: es el objeto más
 * crítico de la mazmorra (sin él no se abre la puerta del jefe) y su color es
 * información pura, no decoración.
 *
 * Moneda y poción, en cambio, pasan a la paleta CÁLIDA del kit (petición de
 * David, 2026-08-05: "la moneda tampoco hace falta tintarla, se podría
 * utilizar la misma paleta que con el barril" y "la poción podemos utilizarla
 * sin tinte"): el atlas original del pack ya trae el oro de la moneda y el
 * cristal del frasco, con más de un color por pieza — algo que un material
 * plano no puede dar. Ver `kitWarmMaterial` en render/kit.ts.
 */
const keyKitMaterial = flatItemMaterial('#ffe082');

/**
 * Siluetas de oclusión de los items (playtest, 2026-08-08: "deberían verse
 * las siluetas de las monedas y pociones también", igual que ya pasa con el
 * héroe y los enemigos — ver `occlusion-silhouette.ts`). La llave entra
 * aunque David solo nombrara moneda/poción: es el objetivo de la sala, y
 * perderla de vista tras un muro es peor que perder una moneda. El tendero
 * (`ShopkeeperShape`) queda FUERA a propósito: es un NPC estático de tamaño
 * mueble, no un objeto recogible que se pueda perder de vista.
 *
 * Un material POR TIPO, creado una vez a nivel de módulo (mismo criterio que
 * `heroSilhouetteMaterial`/`ENEMY_SILHOUETTE_MATERIAL` en HeroView.tsx /
 * EnemyViews.tsx):
 * - Moneda y llave reutilizan el color CANÓNICO de `assets.ts`
 *   (`coinMaterial`/`keyMaterial`), no el dorado cálido del kit
 *   (`kitWarmGlowMaterial`) que llevan hoy: ese dorado cálido varía con la luz
 *   de la escena, mientras que la silueta necesita un color de IDENTIDAD fijo
 *   y reconocible, igual que el resto de siluetas del juego.
 * - La poción NO reutiliza `potionMaterial.color` (el rosa `#ff6bcb`): David
 *   pidió expresamente que el frasco fuera SIN tinte rosa (por eso lleva
 *   `kitWarmGlowMaterial`, no `potionMaterial`), así que una silueta rosa
 *   contradiría esa decisión. `#4ade80` es un verde vivo y saturado — legible
 *   en penumbra (mismo motivo que el resto de siluetas usan colores claros) y
 *   coherente con el cristal verde de `bottle_C_green` — pero deliberadamente
 *   más "verde puro" que el verde-turquesa de `trailMaterial`/
 *   `bossVulnerableMaterial` (`#4dd68a`, ya usado como aviso de "vulnerable"),
 *   para no reciclar sin querer ese significado.
 */
const coinSilhouetteMaterial = makeSilhouetteMaterial(coinMaterial.color);
const potionSilhouetteMaterial = makeSilhouetteMaterial('#4ade80');
const keySilhouetteMaterial = makeSilhouetteMaterial(keyMaterial.color);

/**
 * Cuerpo de la moneda: clon DEDICADO de `kitWarmGlowMaterial` (no el
 * compartido, que también usa `PotionShape`), solo para poder ponerle
 * `transparent: true` sin arrastrar a la poción con él.
 *
 * Por qué (playtest, 2026-08-14: "las monedas son un poco transparentes, no
 * tienen que serlo"): MISMO bug, MISMA causa raíz que los ojos de la vela
 * arreglados un día antes (ver `CANDLE_EYE_RENDER_ORDER` en HeroView.tsx) —
 * verificado a mano en el navegador (dos monedas lado a lado, misma pose,
 * alternando temporalmente cuál de las dos llevaba la silueta: el color
 * extra seguía SIEMPRE a la copia con silueta, nunca a la posición en el
 * mundo, aislando la causa): el cuerpo opaco de la moneda
 * (`kitWarmGlowMaterial`) y su silueta
 * (`coinSilhouetteMaterial`, `depthFunc: GreaterDepth`, ver
 * `occlusion-silhouette.ts`) son la MISMA geometría en la MISMA transformada,
 * pero al salir de DOS `drawcall`s de programas de shader distintos
 * (Lambert vs Basic) su profundidad interpolada no siempre cae en el mismo
 * valor exacto del depth buffer — el margen de la GPU es mínimo, pero cuando
 * la silueta cae "un pelín más lejos" que su propio cuerpo, `GreaterDepth` la
 * da por buena y la pinta encima aunque NADA la esté tapando, restándole
 * cuerpo a la moneda (el mismo síntoma que David describe).
 *
 * Mismo arreglo que los ojos: three.js dibuja SIEMPRE toda la cola opaca
 * antes que la transparente, así que un `renderOrder` alto en un material
 * opaco nunca basta para colarse después de la silueta (que ya es
 * transparente). Pasar el cuerpo a la cola transparente (`transparent:
 * true`) + `COIN_BODY_RENDER_ORDER` (por encima de `SILHOUETTE_RENDER_ORDER`)
 * lo pinta DESPUÉS de la silueta, tape o no tape algo real — y el depthTest
 * normal (sin tocar) lo sigue ocultando correctamente detrás de un muro de
 * verdad, exactamente como antes.
 */
const coinBodyMaterial = kitWarmGlowMaterial.clone();
coinBodyMaterial.transparent = true;
const COIN_BODY_RENDER_ORDER = SILHOUETTE_RENDER_ORDER + 1;

function CoinShape({ receiveShadow }: { receiveShadow: boolean }) {
  const geometry = useMemo(() => {
    const base = kitGeometry('coin');
    // La moneda del kit nace TUMBADA (disco sobre el plano XZ: boundingBox
    // ±0.0625 en Y, el eje vertical, frente a ±0.18 en X/Z — verificado
    // contra el .gltf), pensada para leerse en planta, no para el vuelco
    // clásico de moneda de videojuego. Mientras la moneda giraba sobre Z
    // (rama especial que llevaba `ItemMesh`, ver su comentario) esta forma
    // tumbada bastaba tal cual. Encargo de David 2026-08-17 ("que giren de
    // la misma manera que las pociones"): la moneda pasa a girar sobre Y,
    // igual que el resto de recogibles — pero un disco tumbado girando sobre
    // su propio eje de simetría (Y) no cambiaría de aspecto en pantalla NI
    // UN PÍXEL, así que primero hay que ponerla DE PIE. Un giro de 90° en X
    // mueve el eje fino de Y a Z y dibuja la cara del disco en el plano XY —
    // mismo patrón que `KeyShape` más abajo: clonar (NUNCA mutar la
    // geometría cacheada que devuelve `kitGeometry`, que comparte cualquier
    // otro consumidor futuro del kit) y aplicar el giro UNA sola vez aquí, no
    // en cada mesh, así el cuerpo (`coinBodyMaterial`) y la silueta
    // (`coinSilhouetteMaterial`) — dos meshes con la MISMA geometría — siguen
    // coincidiendo exactamente sin duplicar la transformación.
    const corrected = base.clone().rotateX(Math.PI / 2);
    corrected.computeBoundingBox();
    return corrected;
  }, []);
  const nativeSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  // El giro de 90° en X no toca el eje X, así que `nativeSize.x` sigue siendo
  // el diámetro real del disco (0.36) tanto tumbado como de pie: esta cuenta
  // no necesita ningún ajuste por poner la moneda en pie.
  const scale = (COIN_RADIUS * 2) / nativeSize.x;
  return (
    <>
      <mesh
        geometry={geometry}
        material={coinBodyMaterial}
        scale={scale}
        receiveShadow={receiveShadow}
        renderOrder={COIN_BODY_RENDER_ORDER}
      />
      {/* Silueta de oclusión (ver comentario junto a `coinSilhouetteMaterial`): MISMA
          geometría/escala que el mesh de arriba, sin `receiveShadow` (símbolo plano). */}
      <mesh geometry={geometry} material={coinSilhouetteMaterial} scale={scale} renderOrder={SILHOUETTE_RENDER_ORDER} />
    </>
  );
}

/**
 * Ancho objetivo (eje X, u de juego) del mostrador — el punto de partida de
 * todo el resto de escalas del puesto (shelf y cofre se dimensionan relativos
 * a él, ver más abajo). Elegido para que la HUELLA total del puesto (los tres
 * props juntos, ver `ShopkeeperShape`) no supere el doble de área de la que
 * ocupaba el placeholder cónico que sustituye — nunca el triple, que es el
 * límite que puso David tras el playtest F5 ("no vale triplicar la superficie
 * sólida aparente que la bola atraviesa"): el cono medía radio 0.35 (0.7 de
 * diámetro, `unitCone` escalado [0.7,1.4,0.7] en el historial de este
 * fichero); la huella rectangular de mostrador+estantería+cofre con estos
 * tres anchos sale ≈1.13×0.72 u (≈0.81 u², frente a los ≈0.49 u² del cuadrado
 * que envolvía el cono: ×1.66, no ×3) — verificado a mano contra el
 * `boundingBox` real de las tres piezas, no una cifra de fábrica.
 */
const STALL_COUNTER_WIDTH = 0.85;
/** Ancho objetivo de la estantería, ligeramente menor que el mostrador (se lee como fondo, no como pieza principal). */
const STALL_SHELF_WIDTH = 0.8;
/** Ancho objetivo del cofre — deliberadamente pequeño (una caja de cobros junto al mostrador, no el "tesoro" que sugiere su nombre de fábrica). */
const STALL_CHEST_WIDTH = 0.4;
/** Desplazamiento en Z del mostrador respecto al ancla del puesto (el punto de interacción, GDD/ECONOMY_PLAN F4): un pelín hacia +Z para dejar sitio a la estantería detrás sin que se toquen. */
const STALL_COUNTER_OFFSET_Z = 0.15;
/** Desplazamiento en Z de la estantería: detrás del mostrador (-Z), separada lo bastante para no solaparse con su profundidad. */
const STALL_SHELF_OFFSET_Z = -0.32;
/** Desplazamiento en X/Z del cofre: al lado del mostrador, a ras de suelo. */
const STALL_CHEST_OFFSET_X = 0.5;
const STALL_CHEST_OFFSET_Z = 0.05;

/**
 * Puesto del tendero (F5, ART_KIT_PLAN.md §5): el pack KayKit no trae
 * personajes (§1), así que el cono+esfera de antes (ver historial de este
 * fichero) se sustituye por un puesto de mercado sin figura humana —
 * mostrador + estantería + cofre, los tres con `kitWarmMaterial` (madera y
 * dorados; con la paleta nocturna del `kitMaterial` de piedra, un mostrador de
 * madera se fundía con el muro de detrás, mismo problema que ya resolvió el
 * barril explosivo, ver `kitWarmMaterial` en render/kit.ts).
 *
 * Estático (sin bob/giro, como el placeholder que sustituye): `ItemMesh` ya
 * fuerza `rotation.set(0,0,0)` para `kind==='shopkeeper'`.
 *
 * `bartop_A_medium`/`shelves_decorated` NO nacen centradas en Z (pensadas
 * para montarse contra una pared, con la cara de anclaje pegada a Z≈0 y el
 * volumen sobresaliendo hacia un lado — verificado contra su `.gltf`):
 * `kitXZCenterOffset` las recentra antes de aplicar los desplazamientos de
 * `STALL_*_OFFSET_Z` de arriba, para que esos números coloquen el CENTRO real
 * de cada pieza donde dicen, no un punto arbitrario de su malla.
 *
 * El punto de interacción (donde `stepShopkeeperContact` abre la tienda,
 * features/items/items.ts) sigue siendo `item.position` sin cambios — el
 * mostrador se centra ahí (con un pequeño offset hacia +Z, ver
 * `STALL_COUNTER_OFFSET_Z`) para que "aquí se compra" se siga leyendo de un
 * vistazo, igual que antes con el cono.
 */
function ShopkeeperShape({ receiveShadow }: { receiveShadow: boolean }) {
  const counterGeometry = kitGeometry('bartop_A_medium');
  const counterSize = useMemo(() => kitBoxSize(counterGeometry), [counterGeometry]);
  const counterGroundY = useMemo(() => kitGroundOffset(counterGeometry), [counterGeometry]);
  const counterCenter = useMemo(() => kitXZCenterOffset(counterGeometry), [counterGeometry]);
  const counterScale = STALL_COUNTER_WIDTH / counterSize.x;

  const shelfGeometry = kitGeometry('shelves_decorated');
  const shelfSize = useMemo(() => kitBoxSize(shelfGeometry), [shelfGeometry]);
  const shelfGroundY = useMemo(() => kitGroundOffset(shelfGeometry), [shelfGeometry]);
  const shelfCenter = useMemo(() => kitXZCenterOffset(shelfGeometry), [shelfGeometry]);
  const shelfScale = STALL_SHELF_WIDTH / shelfSize.x;

  const chestGeometry = kitGeometry('chest_gold');
  const chestSize = useMemo(() => kitBoxSize(chestGeometry), [chestGeometry]);
  const chestGroundY = useMemo(() => kitGroundOffset(chestGeometry), [chestGeometry]);
  const chestScale = STALL_CHEST_WIDTH / chestSize.x;

  return (
    <group>
      <mesh
        geometry={counterGeometry}
        material={kitWarmMaterial}
        position={[
          counterCenter.x * counterScale,
          counterGroundY * counterScale,
          STALL_COUNTER_OFFSET_Z + counterCenter.z * counterScale,
        ]}
        scale={counterScale}
        castShadow
        receiveShadow={receiveShadow}
      />
      <mesh
        geometry={shelfGeometry}
        material={kitWarmMaterial}
        position={[
          shelfCenter.x * shelfScale,
          shelfGroundY * shelfScale,
          STALL_SHELF_OFFSET_Z + shelfCenter.z * shelfScale,
        ]}
        scale={shelfScale}
        castShadow
        receiveShadow={receiveShadow}
      />
      <mesh
        geometry={chestGeometry}
        material={kitWarmMaterial}
        position={[STALL_CHEST_OFFSET_X, chestGroundY * chestScale, STALL_CHEST_OFFSET_Z]}
        scale={chestScale}
        castShadow
        receiveShadow={receiveShadow}
      />
    </group>
  );
}

function PotionShape({ receiveShadow }: { receiveShadow: boolean }) {
  const geometry = kitGeometry(POTION_MODEL);
  const nativeSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  const groundY = useMemo(() => kitGroundOffset(geometry), [geometry]);
  // Escala UNIFORME (mismo criterio que barrel_small/torch_mounted en
  // HazardView.tsx/TorchView.tsx: no romper la proporción del frasco
  // modelada) elegida para que la ALTURA total iguale la de la forma
  // anterior (`POTION_VISUAL_HEIGHT`), no `KIT_SCALE` — es un objeto de
  // juego con tamaño propio, ART_KIT_PLAN.md §2.
  const scale = POTION_VISUAL_HEIGHT / nativeSize.y;
  // `groundY` alinea la base REAL del frasco (su boundingBox, casi 0: el
  // modelo ya apoya en su propio min.y) con el ancla del grupo; sumar
  // `POTION_BASE_OFFSET` reproduce dónde caía esa base con la forma
  // anterior, sin tener que tocar `ITEM_HEIGHT.potion` ni el useFrame de
  // `ItemMesh`. En variable (no en el JSX) para que la silueta de abajo
  // reutilice EXACTAMENTE el mismo cálculo, sin aproximarlo a mano.
  const position: [number, number, number] = [0, POTION_BASE_OFFSET + groundY * scale, 0];
  return (
    <>
      <mesh
        geometry={geometry}
        material={kitWarmGlowMaterial}
        position={position}
        scale={scale}
        receiveShadow={receiveShadow}
      />
      {/* Silueta de oclusión (ver comentario junto a `potionSilhouetteMaterial`): MISMA
          geometría/posición/escala que el mesh de arriba, sin `receiveShadow` (símbolo plano). */}
      <mesh
        geometry={geometry}
        material={potionSilhouetteMaterial}
        position={position}
        scale={scale}
        renderOrder={SILHOUETTE_RENDER_ORDER}
      />
    </>
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
  return (
    <>
      <mesh geometry={geometry} material={keyKitMaterial} scale={scale} receiveShadow={receiveShadow} />
      {/* Silueta de oclusión (ver comentario junto a `keySilhouetteMaterial`): MISMA
          geometría (ya corregida arriba)/escala que el mesh de arriba, sin `receiveShadow`
          (símbolo plano). La llave es el objetivo de la sala — perderla de vista tras un
          muro es peor que perder una moneda. */}
      <mesh geometry={geometry} material={keySilhouetteMaterial} scale={scale} renderOrder={SILHOUETTE_RENDER_ORDER} />
    </>
  );
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
      } else {
        // Giro sobre el eje vertical Y para TODOS los recogibles (moneda,
        // poción, llave) — encargo de David 2026-08-17: "las monedas deben
        // girar de la misma manera que las pociones". Antes la moneda tenía
        // una rama propia que volteaba sobre Z (ronda 3, punto 10: "que
        // giren en el otro eje"), porque con la geometría de entonces —
        // tumbada sobre el plano XZ, ver historial de `CoinShape` — Y era el
        // ÚNICO eje que no producía ningún cambio visual. Esa geometría ya no
        // es la misma: `CoinShape` pone ahora la moneda DE PIE (giro de 90°
        // en X aplicado una vez sobre la geometría clonada, ver ese
        // comentario), así que gira sobre Y exactamente igual que el resto y
        // produce el vuelco clásico cara→canto→cara sin necesitar una rama
        // especial.
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
  // Sala CONOCIDA (`known-rooms.ts`, encargo de playtest 2026-08-06): un item
  // de una sala aún oculta sigue existiendo en la sim, solo no se monta su
  // mesh. `roomId === undefined` es el modo sala única (tests/editor).
  const knownRoomIds = useKnownRoomIds(session.world);
  return (
    <>
      {session.world.items
        .filter((item) => item.roomId === undefined || knownRoomIds.has(item.roomId))
        .map((item) => (
          <ItemMesh key={item.id} session={session} itemId={item.id} />
        ))}
    </>
  );
}
