/**
 * Capa de three.js del KayKit Dungeon Pack (docs/plans/ART_KIT_PLAN.md, F1).
 *
 * Esto es SOLO carga y caché: `preloadKit()` trae los 46 `.gltf` del kit,
 * cada uno lo reduce a una `BufferGeometry` fusionada y centrada a escala de
 * juego, y `kitGeometry(name)` la sirve de forma síncrona. NADIE renderiza el
 * kit todavía (eso es F2 en adelante) — este módulo no lo monta en ninguna
 * escena, solo lo deja listo para cuando otra vista lo pida.
 */

import * as THREE from 'three';
import { useSyncExternalStore } from 'react';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WALL_THICKNESS } from '@/game/world/constants';
import { KIT_DIR, KIT_MODELS, kitModelUrl, type KitModelName } from './kit-models';

// ── Escala ──────────────────────────────────────────────────────────────

/**
 * El kit está construido sobre múltiplos de 4 unidades Blender (muro 4×4×1,
 * baldosa grande 4×4, parapeto `barrier` 4 × 1.1 × 0.5). Derivar la escala
 * del grosor de muro del juego, en vez de elegir un número redondo a ojo,
 * hace que el volumen visible del parapeto coincida EXACTAMENTE con el AABB
 * de colisión: 0.5 × 0.84 = 0.42 = `WALL_THICKNESS`, y su altura sale
 * 1.1 × 0.84 = 0.92 ≈ `WALL_HEIGHT` (0.9, ver RoomView.tsx). A partir de ahí
 * el resto de piezas del kit (suelos, columnas, props) escalan igual y
 * quedan internamente coherentes entre sí — ver ART_KIT_PLAN.md §2.
 */
export const KIT_SCALE = WALL_THICKNESS / 0.5;

// ── Textura y material compartidos ─────────────────────────────────────

/**
 * `THREE.Cache.enabled = true` ANTES de cargar nada: los 46 `.gltf` del kit
 * referencian el mismo `dungeon_texture.png`, y sin la caché de three.js
 * cada uno dispararía su propia petición de red del mismo fichero. Esto
 * ahorra las 46 descargas, pero NO ahorra memoria de GPU — cada `GLTFLoader`
 * sigue creando su propio `Material`/`Texture` a partir de esa imagen
 * cacheada, así que además hay que descartar esas copias explícitamente
 * (ver `disposeGltfMaterials` más abajo): usamos un único material/textura
 * propios para todo el kit, igual que `assets.ts`.
 */
THREE.Cache.enabled = true;

const kitTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}${KIT_DIR}dungeon_texture.png`);
kitTexture.colorSpace = THREE.SRGBColorSpace;
/**
 * CRÍTICO: el atlas del kit es una paleta de celdas (ART_KIT_PLAN.md §1), así
 * que un flip vertical hace que cada modelo muestree el color de la celda
 * equivocada (no un simple "efecto espejo" inofensivo). `flipY = false` es la
 * convención de UV que usan los `.gltf` (y la que aplica `GLTFLoader`
 * internamente al cargar sus propias texturas): como aquí cargamos la
 * textura A MANO con `TextureLoader` en vez de dejar que cada `GLTFLoader` la
 * resuelva, hay que replicar esa convención nosotros mismos.
 */
kitTexture.flipY = false;

/**
 * Tinte multiplicador del kit entero (playtest de David, 2026-08-05: "la sala
 * ha perdido oscuridad"). La paleta NightA ya es azul y fría — encaja con el
 * estilo oscuro — pero su piedra es MUCHO más clara que el suelo que tenía el
 * juego (`floorMaterial` = `#464b67` en assets.ts): con la vela encima, el
 * suelo salía casi blanco y la mazmorra dejaba de dar claustrofobia.
 *
 * Es un gris neutro a propósito (no un tinte azulado): el color ya lo pone el
 * atlas, esto solo baja el nivel. Ojo al elegir el valor — three multiplica en
 * espacio LINEAL, así que este `#9a9a9a` (0.60 en sRGB) equivale a multiplicar
 * por ~0.32 la luz reflejada, no por 0.60. Es la constante que hay que tocar
 * si el conjunto se ve claro u oscuro de más; afecta a las 46 piezas por igual.
 */
const KIT_TINT = '#9a9a9a';

/** Único material del kit entero: 1 material + 1 textura para las 46 piezas, política de `assets.ts` (nada de PBR, presupuesto de luces del render). */
export const kitMaterial = new THREE.MeshLambertMaterial({ map: kitTexture, color: KIT_TINT });

// ── Carga y caché de geometría ─────────────────────────────────────────

const gltfLoader = new GLTFLoader();
const geometryCache = new Map<KitModelName, THREE.BufferGeometry>();
let preloaded = false;
let preloadPromise: Promise<void> | null = null;
const readyListeners = new Set<() => void>();

/**
 * Descarta el material (y cualquier textura que cuelgue de él: `map`,
 * `normalMap`, etc. — se recorren las propiedades del material en vez de
 * listar los nombres a mano, así no hay que actualizar esto si el kit
 * empezara a usar más de un mapa) que trae CADA malla del `.gltf` recién
 * cargado. Los descartamos porque no los usamos: todas las mallas del kit
 * pasan a compartir `kitMaterial`. Sin este `dispose()` se quedarían 46
 * copias del atlas colgando en GPU (ver comentario de `THREE.Cache` arriba).
 */
function disposeGltfMaterials(mesh: THREE.Mesh): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    material.dispose();
  }
}

/**
 * Reduce la escena de un `.gltf` cargado a UNA `BufferGeometry`, a escala de
 * juego. La mayoría de modelos son un único nodo/malla, pero varios
 * (`chest_gold`, `wall_doorway`, `floor_tile_big_spikes`) traen 2 nodos con
 * su propia transformación (tapa+cofre, marco+puerta, baldosa+pinchos), así
 * que el procedimiento es genérico: recorre TODAS las `Mesh` de la escena,
 * hornea la matriz de mundo de su nodo en la geometría
 * (`applyMatrix4(mesh.matrixWorld)`, tras `updateWorldMatrix` para que esa
 * matriz esté al día — `GLTFLoader` no monta la escena en ningún árbol de
 * render, así que nadie más la habría actualizado) y fusiona el resultado.
 *
 * Se conservan SOLO los atributos `position`/`normal`/`uv`: son los únicos
 * que usa `kitMaterial` (Lambert, sin normal/roughness maps), y quedarse solo
 * con ellos garantiza que todas las piezas a fusionar tengan exactamente los
 * mismos atributos — `mergeGeometries` exige esa coincidencia.
 */
function extractModelGeometry(gltf: GLTF): THREE.BufferGeometry {
  gltf.scene.updateWorldMatrix(true, true);

  const parts: THREE.BufferGeometry[] = [];
  gltf.scene.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;

    const baked = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const stripped = new THREE.BufferGeometry();
    stripped.setAttribute('position', baked.getAttribute('position'));
    stripped.setAttribute('normal', baked.getAttribute('normal'));
    stripped.setAttribute('uv', baked.getAttribute('uv'));
    if (baked.index) stripped.setIndex(baked.index);
    parts.push(stripped);

    disposeGltfMaterials(mesh);
  });

  const merged = mergeGeometries(parts, false);
  merged.scale(KIT_SCALE, KIT_SCALE, KIT_SCALE);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Carga los 46 modelos del kit en paralelo, idempotente: llamarla dos veces
 * (p. ej. desde varias rutas de `App.tsx` que todas necesitan el juego) NO
 * vuelve a disparar 46 peticiones — la segunda llamada recibe la MISMA
 * promesa ya en marcha (o ya resuelta).
 */
export function preloadKit(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = Promise.all(
      KIT_MODELS.map((name) =>
        gltfLoader.loadAsync(kitModelUrl(name, import.meta.env.BASE_URL)).then((gltf) => {
          geometryCache.set(name, extractModelGeometry(gltf));
        }),
      ),
    ).then(() => {
      preloaded = true;
      for (const listener of readyListeners) listener();
    });
  }
  return preloadPromise;
}

/** Geometría ya cargada y escalada de una pieza del kit — SÍNCRONA a propósito: montar una vista antes de `preloadKit()` es un bug de orden de montaje, no un estado normal que la vista deba tolerar. */
export function kitGeometry(name: KitModelName): THREE.BufferGeometry {
  const geometry = geometryCache.get(name);
  if (!geometry) {
    throw new Error(`kitGeometry('${name}') llamado antes de que preloadKit() termine — falta esperar/gatear el montaje.`);
  }
  return geometry;
}

export function isKitLoaded(): boolean {
  return preloaded;
}

function subscribeKitReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

/**
 * Hook de React: `true` cuando el kit ya está precargado, y provoca un
 * re-render en cuanto `preloadKit()` termina. `useSyncExternalStore` en vez
 * de `useState`+`useEffect` porque el estado "¿está listo?" vive FUERA de
 * React (en `preloaded`, compartido por toda la app) — es exactamente el
 * caso que ese hook existe para cubrir, sin duplicar el booleano en cada
 * componente que lo consulta.
 */
export function useKitReady(): boolean {
  return useSyncExternalStore(subscribeKitReady, isKitLoaded);
}
