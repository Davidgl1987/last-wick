/**
 * Catálogo + carga de las texturas de VFX (docs/plans/VFX_PLAN.md, T0): 16
 * PNG de dos packs CC0 de Kenney en `public/textures/vfx/` — 8 "Light Masks"
 * (manchas de luz falsa: halos, fogonazos, ondas) y 8 "Splats" (manchas de
 * cera/hollín). Ver `public/textures/vfx/README.md` para qué usa cada uno.
 *
 * ── Regla de blending, CRÍTICA (§2 del plan) ───────────────────────────────
 * El canal alfa de las Light Masks es INCONSISTENTE dentro del propio pack:
 * `circle_c`, `circle_rings_a`, `shape_*` y `cone_composed_a` son RGB SIN
 * alfa. Por eso toda Light Mask se usa SIEMPRE con `AdditiveBlending`, que
 * trata el negro como transparente por definición y hace el alfa
 * irrelevante — con blending normal pintarían un cuadrado negro. Los Splats
 * sí tienen alfa fiable (blanco puro recortado por alfa) y van SIEMPRE con
 * blending normal. `LightMaskName`/`SplatName` son tipos DISTINTOS (no un
 * único `VfxTextureName` compartido) precisamente para que
 * `additiveVfxMaterial`/`splatVfxMaterial` no acepten un nombre del pack
 * equivocado: la regla se hace cumplir en compilación, no solo en comentario.
 *
 * ── Por qué la carga es PEREZOSA y cacheada, no eager a nivel de módulo ────
 * Este módulo tiene test propio (`vfx-textures.test.ts`) que corre en el
 * entorno `node` de vitest (sin DOM, ver `vite.config.ts`) y que importa este
 * mismo fichero para comprobar que `VFX_TEXTURE_NAMES` tiene su PNG en disco
 * — mismo patrón que `kit-models.ts`/`kit-models.test.ts`. `THREE.TextureLoader`
 * carga con `ImageLoader`, que llama a `document.createElementNS` por debajo:
 * si alguna textura se cargara en una sentencia de nivel superior (se
 * ejecutaría al EVALUAR el módulo, antes de que el test llegue a tocar
 * nada), importar este fichero reventaría en el entorno `node` con "document
 * is not defined". Por eso ninguna carga ocurre hasta que algo pide
 * explícitamente una textura o un material: `vfxTexture`/`additiveVfxMaterial`/
 * `splatVfxMaterial` son funciones normales, cacheadas en un `Map` de módulo
 * (mismo mecanismo que `glowPuddleMaterialCache` en `render/assets.ts:100`) —
 * la PRIMERA llamada real (siempre desde código que sí corre en el
 * navegador: `render/assets.ts` para `glowHaloTexture`, o un `*View.tsx`)
 * dispara la carga y la deja cacheada para siempre, así que sigue siendo
 * "una sola vez a nivel de módulo" en el sentido que importa: nunca dentro de
 * un componente ni de un `useFrame`, nunca repetida.
 *
 * ── Base URL como parámetro ─────────────────────────────────────────────
 * `vfxTextureUrl` recibe `baseUrl` como parámetro en vez de leer
 * `import.meta.env.BASE_URL` internamente, mismo contrato que
 * `kitModelUrl` (`render/kit-models.ts`) y `clipUrl` (`audio/clips.ts`): así
 * el test puede componer rutas con distintas bases sin depender de que Vite
 * resuelva nada. Quien SÍ conoce `import.meta.env.BASE_URL` es `vfxTexture`
 * (la carga perezosa de más abajo), exactamente el mismo reparto de
 * responsabilidades que `kit.ts:58` (`loadKitAtlas`) frente a
 * `kit-models.ts` — con la diferencia de que aquí ambas partes conviven en
 * un único fichero porque el plan pide un módulo solo, y la pereza de la
 * carga (ver arriba) es lo que hace posible que convivan sin romper el test.
 */

import * as THREE from 'three';

/** Carpeta de las texturas VFX, relativa a la base servida. Con barra final: se concatena directamente delante del nombre de fichero. */
export const VFX_DIR = 'textures/vfx/';

/** Light Masks (Kenney, CC0): SOLO con `additiveVfxMaterial` — ver regla de blending arriba. */
export const LIGHT_MASK_NAMES = [
  'circle_c',
  'circle_rings_a',
  'ring_a',
  'shape_c',
  'shape_e',
  'shape_g',
  'window_i_blur',
  'cone_composed_a',
  // Ampliación 2026-08-11 (playtest de David: "los barriles sueltan las mismas
  // partículas de cera... pon texturas acordes a explosiones"): una textura
  // ÚNICA para todas las partículas hacía que explosión, impacto y rastro se
  // vieran idénticos. Estas tres dan a cada familia su propia silueta.
  /** Bola con rayos radiales: partícula de brasa/fogonazo de explosión. */
  'circle_c_streaks',
  /** Aspa de 4 pétalos: copo de nieve/escarcha del arma Hielo (teñido de azul claro). */
  'fan_c',
  /** Rueda de 6 aspas: el copo más "de nieve" del pack, para el rastro helado. */
  'fan_d',
  /**
   * PROPIA, no de Kenney (`scripts/gen-vfx-textures.mjs`): lengua de fuego con
   * lóbulos, para que la llama de Lumora deje de leerse como un cono liso
   * (David 2026-08-12). Luminancia sobre negro → aditiva, como el resto de
   * Light Masks.
   */
  'flame',
] as const;
export type LightMaskName = (typeof LIGHT_MASK_NAMES)[number];

/** Splats (Kenney, CC0): SOLO con `splatVfxMaterial` — ver regla de blending arriba. */
export const SPLAT_NAMES = [
  'splat00',
  'splat02',
  'splat05',
  'splat08',
  'splat12',
  'splat20',
  'splat26',
  'splat34',
  // ── PROPIAS, no de Kenney (generadas por `scripts/gen-vfx-textures.mjs`) ──
  // Blancas recortadas por alfa igual que los splats, así que se usan con el
  // mismo blending normal (o `alphaTest` si no deben acumular opacidad).
  /** Copo de nieve de 6 brazos con ramitas: el pack no tenía ninguno (sus `fan_*` son aspas de ventilador y no colaban). David 2026-08-12. */
  'snowflake',
  /** Rayo en zigzag con dos ramas: rastro del arma Hechizo en el suelo. */
  'bolt',
  /**
   * Estelas de proyectil, HORIZONTALES y pensadas para estirarse en X: el
   * rastro de un proyectil pasa de N marcas sueltas (confusas cuando vuelan
   * varios a la vez) a UN trazo por tramo de trayectoria, orientado en la
   * dirección del disparo. Sus detalles corren a lo LARGO del eje, así que
   * alargarlas no deforma el dibujo.
   */
  'bolt_streak',
  'frost_streak',
  /**
   * Disco liso de borde antialiasado: devuelve a una partícula billboard el
   * aspecto EXACTO de la esfera de color plano que había antes de texturizar
   * (David: las explosiones con textura "dan un aire irreal, casi prefiero los
   * círculos anteriores").
   */
  'disc',
] as const;
export type SplatName = (typeof SPLAT_NAMES)[number];

/** Los 16 nombres del catálogo, para el test de humo (calca `KIT_MODELS`/`kit-models.test.ts`) — nadie debe escribir un nombre de fichero suelto fuera de esta tabla. */
export const VFX_TEXTURE_NAMES: readonly (LightMaskName | SplatName)[] = [...LIGHT_MASK_NAMES, ...SPLAT_NAMES];

/**
 * URL de una textura VFX a partir de una base servida (`baseUrl`), pasada
 * como PARÁMETRO (ver cabecera). Contrato idéntico a `kitModelUrl`: `baseUrl`
 * puede venir con o sin barra final, aquí se normaliza a exactamente una
 * barra entre la base y `VFX_DIR`.
 */
export function vfxTextureUrl(name: LightMaskName | SplatName, baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${VFX_DIR}${name}.png`;
}

// ── Carga perezosa cacheada (ver "Por qué la carga es PEREZOSA" arriba) ────

const textureCache = new Map<string, THREE.Texture>();

/**
 * Textura cruda (sin material) para un nombre del catálogo, cargada la
 * primera vez que se pide y reutilizada siempre después. Expuesta (no solo
 * de uso interno de los helpers de material de abajo) porque `render/assets.ts`
 * la necesita directamente para `glowHaloTexture` — quiere la textura pelada,
 * no un material aditivo ya construido, para poder seguir tiñéndola con
 * `glowPuddleMaterial(color, opacity)` como hace hoy.
 */
export function vfxTexture(name: LightMaskName | SplatName): THREE.Texture {
  let texture = textureCache.get(name);
  if (!texture) {
    texture = new THREE.TextureLoader().load(vfxTextureUrl(name, import.meta.env.BASE_URL));
    texture.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(name, texture);
  }
  return texture;
}

// ── Materiales cacheados por clave (calca `glowPuddleMaterial`, assets.ts:112) ──

const additiveMaterialCache = new Map<string, THREE.MeshBasicMaterial>();

/**
 * Material ADITIVO para una Light Mask: `AdditiveBlending` + `depthWrite:
 * false`, teñido por `color` (mismo mecanismo que `glowPuddleMaterial`: la
 * textura es la misma para cualquier color, el tinte lo aporta
 * `material.color` multiplicando). Cacheado por `nombre|color|opacidad` —
 * llamar dentro de JSX o de un `useFrame` es seguro, nunca asigna memoria
 * nueva salvo la primera vez que se ve esa combinación exacta.
 *
 * SOLO para nombres de `LIGHT_MASK_NAMES` (el tipo `LightMaskName` lo obliga
 * en compilación) — ver regla de blending en la cabecera del fichero.
 */
export function additiveVfxMaterial(
  name: LightMaskName,
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshBasicMaterial {
  const key = `${name}|${new THREE.Color(color).getHexString()}|${opacity}`;
  let material = additiveMaterialCache.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      map: vfxTexture(name),
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity,
    });
    additiveMaterialCache.set(key, material);
  }
  return material;
}

const splatMaterialCache = new Map<string, THREE.MeshBasicMaterial>();

/**
 * Material de blending NORMAL para un Splat: alfa fiable del propio PNG,
 * sin tinte (blanco puro — quien instancie con `instanceColor`, como
 * `WaxView`, aporta el color por instancia). Cacheado por `nombre|opacidad`.
 *
 * SOLO para nombres de `SPLAT_NAMES` (el tipo `SplatName` lo obliga en
 * compilación) — ver regla de blending en la cabecera del fichero.
 */
export function splatVfxMaterial(name: SplatName, opacity: number): THREE.MeshBasicMaterial {
  const key = `${name}|${opacity}`;
  let material = splatMaterialCache.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      map: vfxTexture(name),
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      opacity,
    });
    splatMaterialCache.set(key, material);
  }
  return material;
}
