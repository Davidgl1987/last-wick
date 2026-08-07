/**
 * Hazards estáticos de la sala (GDD §8): foso, pinchos, barro, acelerador
 * (no cambian de tamaño/posición durante la sala, se construyen una vez).
 * Los barriles son vivos (pueden explotar) y se gestionan aparte con
 * BarrelViews, que sí lee la sim cada frame.
 *
 * Piezas del kit KayKit desde F3 (docs/plans/ART_KIT_PLAN.md §4/§5): el
 * barril y el campo de pinchos pasan a geometría real del kit; el foso se
 * queda en su quad negro (legibilidad, ver más abajo). Barro/acelerador se
 * QUEDAN como quads emisivos (no hay pieza equivalente en el kit, fuera de
 * alcance de F3).
 *
 * Legibilidad (feedback de playtest):
 * - El foso (ronda 3, punto 6: "quita el borde al foso") es un único quad
 *   negro casi absoluto sobre el suelo claro: el contraste suelo/agujero ya
 *   es inconfundible por sí solo. F3 le añadió un reborde de piezas de
 *   fundación (`PitRim`, ya eliminado) pensado para quedar POR FUERA del
 *   rectángulo del hazard y no invadir el quad — pero en pantalla se leía
 *   igual que un bordillo de piedra levantado alrededor del agujero
 *   (playtest de David, 2026-08-06: "para los fosos, ahora aparecen unos
 *   bordes que no debería"), justo el ruido visual que el punto 6 de la
 *   ronda 3 ya había pedido quitar una vez. Retirado sin sustituto: el foso
 *   vuelve a ser exactamente el quad negro de antes de F3.
 * - El barril usa `barrel_small`/`barrel_large` del kit (elegido por el radio
 *   declarado del hazard); al explotar desaparece y deja una mancha
 *   chamuscada en el suelo, igual que antes.
 * - Los pinchos (playtest 2026-08-05: "se ven enormes. Además, deberían
 *   estar escondidos... y cuando pases por encima que salgan y te pinchen")
 *   separan `floor_tile_big_spikes` en sus DOS nodos (`kitGeometryPart`,
 *   render/kit.ts): la losa con agujeros (`SpikesFloorSlab`) se queda fija y
 *   siempre visible como pista de la trampa; las púas (`SpikesNeedles`) se
 *   esconden bajo ella y solo asoman mientras algo pisa el área del hazard
 *   (ver cabecera de `SpikesField` para el detalle). Sigue tileado para
 *   cubrir EXACTAMENTE el área que hace daño: ni una púa fuera de esa área.
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
import { barrelInAir, type HazardSpawn, type World } from '@/game/world/types';
import { blobShadowMaterial, pitMaterial, scorchMaterial, unitCircle, unitPlane } from '@/game/render/assets';
import { kitGeometry, kitGeometryPart, kitMaterial, kitWarmMaterial } from '@/game/render/kit';
import { kitBoxSize, kitGroundOffset, kitTopAlignOffset } from '@/game/render/kit-fit';
import { useKnownRoomIds } from '@/game/render/known-rooms';

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
 * Altura asomada de las púas cuando están completamente fuera (u) — playtest
 * de David 2026-08-05: "los pinchos se ven enormes". Con la geometría íntegra
 * del nodo `spikes` (altura natural ≈1.68 u tras `KIT_SCALE`, más alta que el
 * propio héroe) la trampa se leía como un bosque de lanzas, no como pinchos de
 * suelo. Elegida 0.34 u, dentro del rango pedido (0.3-0.4): claramente por
 * debajo del diámetro del héroe (`HERO_RADIUS`×2 = 0.48 u, la referencia que
 * dio David en el encargo), con cuerpo suficiente para leerse como una púa
 * real y no un simple bulto.
 *
 * Subida de 0.34 a 0.42 en la segunda ronda de este mismo playtest ("no se ven
 * los pinchos salir"): 0.34 quedaba por debajo del umbral en el que el
 * movimiento se aprecia desde la cámara cenital. Sigue bajo el diámetro del
 * héroe, que es el techo que puso David.
 */
const SPIKE_EXPOSED_HEIGHT = 0.42;

/**
 * Cuánto se hunden las púas por debajo de la cara INFERIOR real de la losa
 * (no de y=0 — ver `slabThickness` en `SpikesNeedles`, que mide esa cara)
 * cuando están totalmente escondidas (u). No basta con bajarlas justo hasta
 * esa cara (la punta quedaría a ras de los agujeros, aún visible): este
 * margen adicional las deja claramente por debajo, invisibles del todo
 * mientras están retraídas.
 */
const SPIKE_HIDE_DEPTH = 0.15;

/**
 * Duración (s) del disparo hacia arriba al detectar algo sobre el hazard —
 * pedido de playtest: "salen RÁPIDO... es la reacción a pisar". Bastante más
 * corta que `SPIKE_RETRACT_DURATION` para que se lea como una trampa
 * reactiva y no como decoración que sube sola.
 */
const SPIKE_RISE_DURATION = 0.1;

/**
 * Duración (s) de la retracción al dejar de detectar nada sobre el hazard —
 * pedido de playtest: "se retraen más despacio". 3× `SPIKE_RISE_DURATION`: la
 * amenaza se retira de forma perceptible, no de golpe.
 */
const SPIKE_RETRACT_DURATION = 0.3;

/**
 * Igual que el criterio de daño de la sim (`circleOverlapsHazardRect`,
 * features/hazards/hazards.ts — no exportada) pero duplicada aquí a
 * propósito: es geometría pura de 6 líneas (círculo contra rectángulo, punto
 * más cercano) y así el render de la trampa no depende de un símbolo interno
 * de la sim. Usada por `isHazardTriggered` para decidir cuándo asoman las
 * púas — MISMO criterio con el que la sim decide cuándo hace daño, para que
 * "escondidas mientras algo se desangra encima" (el bug que el encargo pide
 * evitar explícitamente) no pueda ocurrir.
 */
function circleOverlapsRect(
  centerX: number,
  centerY: number,
  radius: number,
  rectX: number,
  rectY: number,
  rectW: number,
  rectH: number,
): boolean {
  const minX = rectX - rectW / 2;
  const maxX = rectX + rectW / 2;
  const minY = rectY - rectH / 2;
  const maxY = rectY + rectH / 2;
  const nearestX = centerX < minX ? minX : centerX > maxX ? maxX : centerX;
  const nearestY = centerY < minY ? minY : centerY > maxY ? maxY : centerY;
  const dx = centerX - nearestX;
  const dy = centerY - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * true si el héroe o algún enemigo vivo invade el rectángulo del hazard
 * ahora mismo (héroe y enemigos, punto 3 del encargo: la sim ya hace daño
 * periódico a un enemigo sobre pinchos, así que unas púas escondidas
 * mientras eso pasa se leerían como un bug). Lee `world.hero`/`world.enemies`
 * directamente, sin acumular estado propio — se llama una vez por frame
 * desde `SpikesNeedles`.
 */
function isHazardTriggered(hazard: HazardSpawn, world: Pick<World, 'hero' | 'enemies'>): boolean {
  const hero = world.hero;
  if (hero.hp > 0 && circleOverlapsRect(hero.position.x, hero.position.y, hero.radius, hazard.position.x, hazard.position.y, hazard.width, hazard.height)) {
    return true;
  }
  const enemies = world.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (enemy.hp <= 0) continue;
    if (circleOverlapsRect(enemy.position.x, enemy.position.y, enemy.radius, hazard.position.x, hazard.position.y, hazard.width, hazard.height)) {
      return true;
    }
  }
  return false;
}

/**
 * Losa con agujeros del campo de pinchos (nodo `floor_tile_big_spikes` del
 * `.gltf`, SIN sus púas — ver `kitGeometryPart` en render/kit.ts): tileada
 * para cubrir el rectángulo EXACTO del hazard (`hazard.width × hazard.height`),
 * mismo patrón que `FloorGrid` de RoomView.tsx (rejilla `nx × nz` con `ceil`,
 * cada baldosa estirada para que `nx` baldosas cubran `width` exactamente) —
 * a diferencia de `wallModuleLayout` (que redondea y tolera un pequeño
 * desajuste en un sillar puntual), aquí NO se puede tolerar ni un hueco
 * colgando fuera del área que hace daño (requisito CRÍTICO del encargo: la
 * superficie visible tiene que coincidir con el área de daño). Siempre
 * visible y fija: es la ÚNICA pista de que ahí hay una trampa (punto 1 del
 * encargo), así que el jugador puede aprender a leerla.
 */
function SpikesFloorSlab({ hazard }: { hazard: HazardSpawn }) {
  const geometry = kitGeometryPart('floor_tile_big_spikes', 'floor_tile_big_spikes');
  const tileSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  // BUG playtest 2026-08-06 ("los pinchos parecen un pegado encima del
  // suelo"): esto usaba `kitGroundOffset` (apoyar el MÍNIMO en y=0), partiendo
  // de un comentario que resultó incorrecto. Verificado contra el `.gltf`
  // (accessor POSITION del nodo `floor_tile_big_spikes`): su malla va de
  // y=-0.1 a y=+0.1 (unidades Blender, SIMÉTRICA respecto a su pivote, no
  // apoyada en 0 como se afirmaba) — con `kitGroundOffset` la pieza entera
  // sube +0.1 u (×`KIT_SCALE`=0.84 → +0.084 u) y su cara superior queda en
  // +0.168 u, no en 0. El suelo de la sala (RoomView.tsx) alinea su cara
  // superior a y=0 con `kitTopAlignOffset` — con la losa 0.168 u más arriba
  // que ese plano, quedaba flotando como una plataforma pegada encima del
  // suelo, exactamente lo que describe David. Mismo criterio que el suelo:
  // `kitTopAlignOffset` (cara superior, la transitable, a y=0), para que la
  // losa quede ENRASADA con la baldosa de suelo de alrededor, sin escalón.
  const topAlignY = useMemo(() => kitTopAlignOffset(geometry), [geometry]);
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
        scratch.position.set(hazard.position.x + localX, topAlignY, hazard.position.y + localZ);
        scratch.scale.set(scaleX, 1, scaleZ);
        scratch.updateMatrix();
        mesh.setMatrixAt(index++, scratch.matrix);
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }, [hazard.width, hazard.height, hazard.position.x, hazard.position.y, nx, nz, count, tileSize, topAlignY]);

  return <instancedMesh ref={meshRef} args={[geometry, kitMaterial, count]} castShadow receiveShadow />;
}

/**
 * Púas retráctiles del campo de pinchos (nodo `spikes` del `.gltf`, SIN la
 * losa — ver `kitGeometryPart`): escondidas bajo el suelo por defecto, solo
 * asoman mientras `isHazardTriggered` es true (héroe o enemigo vivo sobre el
 * área del hazard), con disparo rápido (`SPIKE_RISE_DURATION`) y retracción
 * más lenta (`SPIKE_RETRACT_DURATION`).
 *
 * Comparte EXACTAMENTE la rejilla de `SpikesFloorSlab` (misma cuenta de
 * baldosas, misma celda, mismo estirado en X/Z), y esa es la clave de que la
 * trampa se lea. Antes cada una tenía su propia rejilla —la losa con celda
 * ~1.34 u y las púas con celda 0.55 u— y el resultado en pantalla era que la
 * placa enseñaba ~25 agujeros mientras asomaban 4 púas sueltas por en medio:
 * el disparo se perdía como ruido sobre el relieve de la losa ("no se ven los
 * pinchos salir", playtest de David 2026-08-06). Losa y púas son los DOS
 * NODOS DEL MISMO MODELO, así que tileadas igual cada púa sale por SU agujero
 * — que es como el artista las modeló, y lo que David propuso literalmente:
 * "cada baldosa con pinchos podría utilizar los dos modelos".
 *
 * Ninguna púa puede salirse del rectángulo del hazard: el nodo `spikes` ocupa
 * ±1.1 de los ±2.0 que ocupa la losa (55%), así que escalado con la MISMA
 * celda queda siempre holgadamente dentro de su baldosa — y las baldosas
 * cubren el rectángulo exacto (requisito CRÍTICO del encargo original).
 *
 * El disparo/retracción NO mueve cada instancia por separado: las `count`
 * instancias se fijan con Y local 0 al construir la rejilla, y CADA FRAME se
 * escribe un único `mesh.position.y` (el transform del InstancedMesh
 * entero) — una asignación de escalar, cero objetos nuevos, en vez de un
 * bucle de `count` escrituras de matriz por frame.
 */
function SpikesNeedles({ hazard, world }: { hazard: HazardSpawn; world: Pick<World, 'hero' | 'enemies'> }) {
  const geometry = kitGeometryPart('floor_tile_big_spikes', 'spikes');
  const naturalSize = useMemo(() => kitBoxSize(geometry), [geometry]);
  // Escala NO uniforme, a propósito y al revés que en BarrelMesh: en X/Z se
  // usa la de la losa (para que cada púa caiga en su agujero, ver cabecera) y
  // en Y la que deja la punta asomando `SPIKE_EXPOSED_HEIGHT`. La púa queda
  // más rechoncha que de fábrica — que es justo lo que se quiere aquí: una
  // trampa de suelo, no las lanzas de 1.68 u que David rechazó.
  const heightScale = useMemo(() => SPIKE_EXPOSED_HEIGHT / naturalSize.y, [naturalSize]);
  // Grosor real de la losa (nodo `floor_tile_big_spikes`, el mismo que dibuja
  // `SpikesFloorSlab`) — leído de SU boundingBox, no hardcodeado: con
  // `kitTopAlignOffset` la cara superior de la losa siempre queda en y=0 y su
  // cara inferior en `-slabThickness` (≈0.168 u), así que el "debajo de la
  // losa" que necesita el useFrame de más abajo depende del grosor real de
  // ESTA pieza, no de un número fijo. Necesario tras el fix del suelo
  // flotante (playtest 2026-08-06): antes la losa (con el bug) apoyaba su
  // base en y=0, así que "escondida bajo y=0" coincidía por accidente con
  // "escondida bajo la losa" — ahora que la losa cuelga por debajo de y=0,
  // ambas cosas ya no son lo mismo y hay que sumar este grosor.
  const slabGeometry = kitGeometryPart('floor_tile_big_spikes', 'floor_tile_big_spikes');
  const slabThickness = useMemo(() => kitBoxSize(slabGeometry).y, [slabGeometry]);

  // MISMA rejilla que la losa: se calcula con el tamaño natural de la LOSA y
  // el mismo `SPIKES_TILE_SCALE`/`ceil` que usa `SpikesFloorSlab`.
  const slabSize = useMemo(() => kitBoxSize(slabGeometry), [slabGeometry]);
  const targetTile = slabSize.x * SPIKES_TILE_SCALE;
  const nx = Math.max(1, Math.ceil(hazard.width / targetTile));
  const nz = Math.max(1, Math.ceil(hazard.height / (slabSize.z * SPIKES_TILE_SCALE)));
  const count = nx * nz;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // Fracción [0,1] de "asomado": 0 = completamente escondida bajo la losa, 1
  // = plenamente afuera. Vive en un ref, no en estado de React: `useFrame`
  // la muta cada frame, y un `setState` aquí forzaría un re-render de React
  // a 60 Hz — justo lo que el encargo prohíbe explícitamente.
  const raisedRef = useRef(0);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const scratch = new THREE.Object3D();
    // Celda EXACTA sin estirar (a diferencia de la losa): width/nx y
    // height/nz son siempre >= SPIKE_CELL_SIZE (nx/nz se calcularon con
    // `floor`), así que el margen entre el centro de cada celda y su borde
    // nunca es menor que el que ya deja `SPIKE_CELL_SIZE` sobre el diámetro
    // encogido de la púa (ver comentario de la constante) — ninguna púa se
    // sale de su celda ni, por tanto, del rectángulo exacto del hazard.
    const cellW = hazard.width / nx;
    const cellH = hazard.height / nz;
    // Mismo estirado en X/Z que la losa (celda real / tamaño natural), para
    // que el racimo de púas quede clavado sobre los agujeros de SU baldosa.
    const scaleX = cellW / slabSize.x;
    const scaleZ = cellH / slabSize.z;
    let index = 0;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const localX = -hazard.width / 2 + (ix + 0.5) * cellW;
        const localZ = -hazard.height / 2 + (iz + 0.5) * cellH;
        // Y local siempre 0: el disparo/escondite lo controla el useFrame de
        // abajo escribiendo `mesh.position.y` (transform del InstancedMesh
        // entero), no la matriz de cada instancia.
        scratch.position.set(hazard.position.x + localX, 0, hazard.position.y + localZ);
        scratch.scale.set(scaleX, heightScale, scaleZ);
        scratch.updateMatrix();
        mesh.setMatrixAt(index++, scratch.matrix);
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }, [hazard.width, hazard.height, hazard.position.x, hazard.position.y, nx, nz, count, heightScale, slabSize]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const occupied = isHazardTriggered(hazard, world);
    const target = occupied ? 1 : 0;
    const rate = occupied ? 1 / SPIKE_RISE_DURATION : 1 / SPIKE_RETRACT_DURATION;
    const current = raisedRef.current;
    const next = target > current ? Math.min(target, current + rate * delta) : Math.max(target, current - rate * delta);
    raisedRef.current = next;
    // next=0 (escondida del todo): el conjunto se hunde
    // `SPIKE_EXPOSED_HEIGHT + slabThickness + SPIKE_HIDE_DEPTH` bajo y=0 —
    // los dos primeros términos bajan la punta hasta la cara INFERIOR real de
    // la losa (que cuelga `slabThickness` por debajo de y=0 desde el fix de
    // alineación, ver comentario de `slabThickness` arriba) y el tercero
    // añade el margen de siempre por debajo de esa cara, para que quede
    // invisible del todo y no a ras de los agujeros. next=1 (afuera del
    // todo): offset 0, la base queda a ras de suelo (y de la cara superior de
    // la losa, ambas en y=0) y la punta asoma exactamente
    // `SPIKE_EXPOSED_HEIGHT` por encima (ya fijado al construir las
    // instancias, arriba).
    mesh.position.y = -(SPIKE_EXPOSED_HEIGHT + slabThickness + SPIKE_HIDE_DEPTH) * (1 - next);
  });

  // Púas en `kitWarmMaterial` (atlas ORIGINAL del pack: metal), no en el azul
  // de la piedra. Es el mismo arreglo que ya hizo falta con los barriles: bajo
  // la paleta NightA una púa gris-azulada sobre una losa gris-azulada era casi
  // invisible al salir — "no se ven los pinchos salir" (playtest de David,
  // 2026-08-06). El acero cálido contra la piedra fría hace que el disparo se
  // lea de un vistazo, que es justo lo que una trampa tiene que conseguir.
  return <instancedMesh ref={meshRef} args={[geometry, kitWarmMaterial, count]} castShadow receiveShadow />;
}

/**
 * Campo de pinchos completo (playtest 2026-08-05): la losa fija de
 * `SpikesFloorSlab` como pista visual permanente + las púas retráctiles de
 * `SpikesNeedles` que solo asoman con algo encima. Ver cabecera de cada una
 * para el detalle de rejilla/animación.
 */
function SpikesField({ hazard, world }: { hazard: HazardSpawn; world: Pick<World, 'hero' | 'enemies'> }) {
  return (
    <>
      <SpikesFloorSlab hazard={hazard} />
      <SpikesNeedles hazard={hazard} world={world} />
    </>
  );
}

/**
 * Foso (punto 6 de playtest ronda 3: "quita el borde al foso", y de nuevo
 * playtest 2026-08-06: "para los fosos, ahora aparecen unos bordes que no
 * debería"): un único quad negro casi absoluto sobre el suelo claro, SIN
 * ningún reborde alrededor. El contraste suelo-claro/agujero-negro ya es
 * inconfundible por sí solo — F3 le añadió un reborde de fundación
 * (`PitRim`) que se leía en pantalla como un bordillo de piedra levantado
 * alrededor del agujero, y se ha quitado sin sustituto (ver cabecera del
 * fichero): el foso vuelve a ser exactamente este quad.
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

/**
 * `barrel`/`rock` nunca llegan aquí: `buildRoomEntities` (world/create.ts) los
 * convierte en `Barrel`/`Obstacle` y no los añade a `world.hazards` — este
 * componente solo ve `pit`/`spikes` en la práctica.
 */
function StaticHazardQuad({ hazard, world }: { hazard: HazardSpawn; world: Pick<World, 'hero' | 'enemies'> }) {
  if (hazard.kind === 'pit') {
    return <PitQuad hazard={hazard} />;
  }
  if (hazard.kind === 'spikes') {
    return <SpikesField hazard={hazard} world={world} />;
  }
  return null;
}

/**
 * `world` amplía su tipo mínimo previo (`{ hazards }`) a `hazards` + `hero` +
 * `enemies` + lo que pide `useKnownRoomIds` (`dungeon`/`roomRuntimes`/
 * `wallVersion`/`currentRoomId`, known-rooms.ts): las púas retráctiles
 * (`SpikesNeedles`) necesitan leer la posición del héroe y de los enemigos
 * cada frame para decidir si asoman, y el filtro de sala CONOCIDA (encargo de
 * playtest 2026-08-06) necesita el resto. `GameRoot.tsx` ya llama a este
 * componente con `world={session.world}` (el `World` completo), así que
 * ampliar lo que este componente EXIGE no le pide ningún cambio a ese
 * llamador — sigue pasando lo mismo.
 */
export function HazardViews({
  world,
}: {
  world: Pick<World, 'hazards' | 'hero' | 'enemies' | 'dungeon' | 'roomRuntimes' | 'wallVersion' | 'currentRoomId'>;
}) {
  const knownRoomIds = useKnownRoomIds(world);
  return (
    <>
      {world.hazards
        .filter((hazard) => hazard.roomId === undefined || knownRoomIds.has(hazard.roomId))
        .map((hazard) => (
          <StaticHazardQuad key={hazard.id} hazard={hazard} world={world} />
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
        {/* Cuerpo: pieza del kit KayKit (ART_KIT_PLAN F3), elegida por tamaño y
            escalada uniformemente al diámetro real. Usa `kitWarmMaterial` (atlas
            ORIGINAL del pack, madera y metal) y no el `kitMaterial` azul del
            resto del kit: con la paleta nocturna el barril salía del mismo tono
            que el muro de detrás y desaparecía (playtest de David 2026-08-05).
            Un barril es munición del jugador, no decoración — ver el porqué
            completo en `kitWarmMaterial` (render/kit.ts). */}
        <mesh geometry={geometry} material={kitWarmMaterial} position={[0, groundY * scale, 0]} scale={scale} castShadow receiveShadow />
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
  // Sala CONOCIDA (`known-rooms.ts`, encargo de playtest 2026-08-06): mismo
  // filtro que ItemViews/EnemyViews.
  const knownRoomIds = useKnownRoomIds(session.world);
  return (
    <>
      {session.world.barrels
        .filter((barrel) => barrel.roomId === undefined || knownRoomIds.has(barrel.roomId))
        .map((barrel) => (
          <BarrelMesh key={barrel.id} session={session} barrelId={barrel.id} />
        ))}
    </>
  );
}
