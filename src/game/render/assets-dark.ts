/**
 * Modo oscuro (antes experimento de la rama `estilo-oscuro`, hoy el ÚNICO
 * modo de render del juego — ver limpieza de flags de debug-params.ts/
 * GameRoot.tsx): materiales/geometrías de silueta (ojos, cirios, antorchas,
 * cera de la vela) y el tono oscurecido de los hazards autoemisivos
 * (charco/barro/acelerador), aplicados UNA sola vez al cargar este módulo —
 * ya no hay store ni parámetro de URL que los alterne en runtime, así que no
 * hace falta conservar snapshots del color "clásico" ni una función
 * idempotente reejecutable.
 *
 * Dirección de dependencia ÚNICA (evita el ciclo): este módulo IMPORTA los
 * materiales base clásicos de `./assets` (los mismos objetos compartidos que
 * usa el resto del juego) para mutarlos in-place; `assets.ts` nunca importa
 * de aquí — los consumidores que necesitan símbolos de este fichero
 * (silueta/cirios) los importan directamente de `@/game/render/assets-dark`.
 */

import * as THREE from 'three';
import {
  arrowMaterial,
  bossBodyMaterial,
  boostMaterial,
  chaserMaterial,
  dummyMaterial,
  guardianBodyMaterial,
  guardianHornMaterial,
  heroMaterial,
  mudMaterial,
  puddleMaterial,
  queenBodyMaterial,
  queenCrownMaterial,
  shooterMaterial,
  spikeConeMaterial,
  spikeMaterial,
  stormBodyMaterial,
  trailMaterial,
  WEAPON_COLOR,
} from './assets';

// ── Tono oscuro de hazards autoemisivos (charco/barro/acelerador) ─────────
//
// Los materiales Basic (charco/barro/acelerador) ignoran la iluminación de
// escena — son autoemisivos de facto — así que en penumbra se les baja
// directamente el COLOR en vez de depender de una luz que no reciben.
// Aplicado UNA sola vez al cargar el módulo (más abajo), sin snapshot del
// tono clásico: ya no existe ningún modo/parámetro que restaure el original.

/**
 * Charco de la Lacrimera (punto 4 de playtest: "el trail debe dejar el
 * rastro del mismo color que su modelo"): el cuerpo de la Lacrimera es
 * violeta pálido (`applySilhouettes`, `trailMaterial` '#cfc4e8'/emissive
 * '#b18cff'), así que su charco deja el verde musgo clásico y pasa a violeta
 * oscuro a juego.
 */
const TONE_DARK_COLOR = {
  puddle: new THREE.Color('#3d3355'),
  /**
   * Plataformas de velocidad / barro (punto 3 de playtest: "las plataformas
   * de velocidad siguen emitiendo luz"): tono MUY apagado, casi color de
   * suelo — antes tenían un tono más visible condicionado a un grupo de
   * `?glow=hazards` que ya no existe (David, playtest ronda 7: prefería la
   * configuración con todos los grupos de glow apagados, que es la que
   * queda como único comportamiento).
   */
  boost: new THREE.Color('#101b26'),
  mud: new THREE.Color('#1a140f'),
};

function applyHazardTones(): void {
  puddleMaterial.color.copy(TONE_DARK_COLOR.puddle);
  boostMaterial.color.copy(TONE_DARK_COLOR.boost);
  mudMaterial.color.copy(TONE_DARK_COLOR.mud);
}

// ── Emissive de proyectiles (rama `luces-optimizadas`) ─────────────────────
//
// El proyectil del héroe ya no lleva pointLight propia (`ProjectileLightPool`
// eliminado, ver `features/combat/ProjectileView.tsx`): el halo aditivo
// (`GlowPuddle`) finge la luz sobre el suelo, pero el CUERPO del proyectil
// también necesita leerse como fuente de luz en la penumbra, no solo su
// sombra proyectada. `arrowMaterial` (el cono dominante de la flecha, ver
// `ArrowShape` en ProjectileView.tsx) es Lambert: sin luz de escena cerca se
// apagaba del todo salvo por el halo. `spellBoltMaterial` NO se toca aquí —
// ya es `MeshBasicMaterial` (autoiluminado de fábrica, ignora la luz de
// escena por completo), así que ya "brilla por sí mismo" sin necesitar
// emissive.

/** Punto de tuning: emissive de la flecha tras perder su pointLight propia — mismo color que su cuerpo (WEAPON_COLOR.arrow), para que "brille de su propio tono" en vez de blanquear. */
const ARROW_EMISSIVE_INTENSITY = 0.6;

function applyProjectileGlow(): void {
  arrowMaterial.emissive.copy(WEAPON_COLOR.arrow);
  arrowMaterial.emissiveIntensity = ARROW_EMISSIVE_INTENSITY;
}

// ── Siluetas oscuras de personajes ─────────────────────────────────────────
//
// Sustituye los cuerpos-placeholder (esferas de colores planos) por siluetas
// casi negras de piedra/tela, inspiradas en concept art estilo Hollow Knight/
// vela: cuerpos oscuros + ojos/acentos emisivos (MeshBasicMaterial, ignoran
// la luz de escena — visibles incluso a oscuras, "es EL rasgo del concept").
// Placeholders: primitivas de Three combinadas, no modelos; importa la
// silueta + los ojos, no el detalle. No toca radios de colisión ni la sim: es
// render puro (JSX/materiales), igual que el resto de "personalidad de
// enemigos" de más arriba.

/** Intensidad de emissive de acentos de jefe (cuernos/corona) sobre su Lambert base: se intuyen, no brillan como neón. */
const ACCENT_EMISSIVE_INTENSITY = 0.3;

/**
 * Cera pálida del cuerpo del héroe-vela: fija en dark>=1 (deja de lerpear con
 * el arma; la llama de arriba es la que cambia de color). Exportada: también
 * la usa `HeroView.tsx` para pintar el RASTRO de cera del héroe en silueta
 * (playtest 2026-07-16, "haz que la vela deje un rastro de cera al
 * moverse") — mismo tono que el propio cuerpo, coherente.
 */
export const HERO_WAX_COLOR = '#e8ddc8';

/**
 * Cuerpo del héroe-vela (punto 5 de playtest, rama `estilo-oscuro`): en
 * dark>=1 `HeroView.tsx` sustituye la esfera unitaria (`unitSphere`, radio 1)
 * por este cilindro ESTRECHO Y ALTO ("vela, no torre... pero tampoco rueda")
 * en el mismo mesh compartido (`bodyRef`) — misma convención "unit-X, se
 * escala por mesh" que el resto de geometrías de `assets.ts`: `HeroView.tsx`
 * sigue aplicando exactamente el mismo `visualRadius` de squash/stretch/
 * caída-al-foso que ya usaba con la esfera, sin tocar esa lógica. Radio local
 * = 1 (igual que la esfera: la silueta visible coincide con la hitbox real,
 * ver `HERO_RADIUS`) y alto local = 2.8 (más del doble del radio) para la
 * esbeltez pedida en ronda 7 — los pinchos del Erizo de Acero reproyectan su
 * posición a esta misma proporción en `HeroView.tsx` para no quedar flotando
 * fuera de la superficie (ver comentario allí).
 */
/*
 * Historial: radio 0.42 (fina) → 0.85 en playtest ronda 6 ("la hitbox
 * habría que ajustarla", el cilindro fino dejaba el cuerpo visible a ~42%
 * del diámetro de colisión y los golpes parecían injustos) → de vuelta a
 * fina en ronda 7 (2026-07-20, David: "la vela no me gusta así rechoncha...
 * has cambiado el modelo y no la hitbox, te pedí lo contrario"). Esta vez la
 * finura NO deja la hitbox de fuera: `HERO_RADIUS` (`hero/constants.ts`) baja
 * un ~37% junto con este cambio, así que radio local 1.0 (= la hitbox real,
 * como la esfera clásica de radio local 1) ES la silueta visible, sin
 * generosidad ni penalización — y el alto local sube a 2.8 (más del doble
 * del alto anterior) para conseguir la esbeltez pedida sin tocar el radio.
 * Todos los offsets dependientes (ojos, pinchos, llama, pivote de
 * inclinación) se recalculan en `HeroView.tsx` a partir de estos dos
 * números — ver comentario allí.
 */
export const heroCandleGeometry = new THREE.CylinderGeometry(1.0, 1.0, 2.8, 20);

/**
 * Cirios de sala de jefe (punto 2b de playtest, `BossCandlesView.tsx`, solo
 * dark>=1): atrezzo puro (sin colisión, la sim no los conoce), mismo par
 * cera/llama que el héroe-vela pero geometría/material propios (no
 * comparten mesh con el héroe: viven en varias instancias fijas a la vez por
 * sala). Cera un pelín más oscura que `HERO_WAX_COLOR` (recibe luz de
 * escena vía Lambert, a diferencia de la llama) para no competir visualmente
 * con el héroe como fuente de luz principal.
 */
export const bossCandleWaxMaterial = new THREE.MeshLambertMaterial({ color: '#d8cdb4' });
/** Llama del cirio de jefe: autoiluminada (Basic), mismo cálido que `CandleLightView`/`candleFlameMaterial`. */
export const bossCandleFlameMaterial = new THREE.MeshBasicMaterial({ color: '#ffb469' });

/**
 * Antorcha de muro (`TorchView.tsx`, playtest rama `estilo-oscuro`: "los
 * cirios de los jefes parece que puedes chocar con ellos... más pequeños y
 * pegados a la pared, como antorchas"): geometría propia, más pequeña y
 * afilada que `bossCandleWaxGeometry`, pensada para leerse pegada al muro en
 * vez de como una columna suelta en mitad de la sala. Reutiliza los MISMOS
 * materiales cera/llama que el cirio de jefe (mismo cálido, atrezzo
 * coherente en toda la mazmorra).
 */
export const wallTorchWaxGeometry = new THREE.CylinderGeometry(0.1, 0.12, 0.7, 10);

/**
 * Llama de la vela del héroe: MUTABLE, mismo criterio que `heroMaterial` en
 * dark=0 — HeroView.tsx interpola su color hacia `WEAPON_COLOR[weaponMode]`
 * cada frame con la misma rigidez (`WEAPON_COLOR_LERP_STIFFNESS`). Autoiluminada
 * (Basic): una llama no depende de la luz de escena.
 */
export const candleFlameMaterial = new THREE.MeshBasicMaterial({ color: WEAPON_COLOR.body.clone() });
/** Ojos de la vela (carita simple del concept): óvalos negros, reutiliza smallDotGeometry escalada. */
export const candleEyeMaterial = new THREE.MeshBasicMaterial({ color: '#14121a' });

/** Vigía de hollín (dummy): campana/farolillo — ojos cálidos ovalados. */
export const dummyEyeGlowMaterial = new THREE.MeshBasicMaterial({ color: '#ffc169' });
/** Falda cónica oscura de la campana del Vigía. */
export const dummySkirtMaterial = new THREE.MeshLambertMaterial({ color: '#1c1a20' });

/** Acechador del Umbral (chaser): ojos rasgados violeta. */
export const chaserEyeGlowMaterial = new THREE.MeshBasicMaterial({ color: '#b18cff' });
/** Penitente de Púas (spike): un único ojo cálido grande frontal. */
export const spikeEyeGlowMaterial = new THREE.MeshBasicMaterial({ color: '#ffb36b' });
/** Aguaboca (shooter): interior del tubo/cañón en reposo (piedra oscura apagada) y al cargar (azul brillante). */
export const shooterTubeRestMaterial = new THREE.MeshBasicMaterial({ color: '#2a2730' });
export const shooterTubeGlowMaterial = new THREE.MeshBasicMaterial({ color: '#7cc7ff' });

/** Aplica las siluetas oscuras de personajes. Se llama UNA sola vez al cargar el módulo (ver abajo). */
function applySilhouettes(): void {
  // Héroe = vela: cuerpo de cera pálida fijo (HeroView.tsx no lerpea
  // heroMaterial.color; el color de arma vive solo en la llama).
  heroMaterial.color.set(HERO_WAX_COLOR);
  // Emissive tenue de cera: con la luz a la altura del cuerpo (0.75, bajo
  // los muros) los laterales del cilindro reciben luz rasante y quedaban
  // negros — la vela debe leerse pálida en la oscuridad (concept art).
  heroMaterial.emissive.set('#8a7a58');
  heroMaterial.emissiveIntensity = 0.5;

  // Vigía de hollín (dummy): campana oscura.
  dummyMaterial.color.set('#242129');
  // Acechador del Umbral (chaser): figura alta y fina, casi negra.
  chaserMaterial.color.set('#0d0c12');
  // Penitente de Púas (spike): bola y conos de piedra oscura.
  spikeMaterial.color.set('#211f26');
  spikeConeMaterial.color.set('#17151b');
  // Lacrimera (trail): gota pálida translúcida con brillo interior violeta.
  trailMaterial.color.set('#cfc4e8');
  trailMaterial.transparent = true;
  trailMaterial.opacity = 0.85;
  trailMaterial.emissive.set('#b18cff');
  trailMaterial.emissiveIntensity = 0.25;
  // Aguaboca (shooter): pedrusco oscuro.
  shooterMaterial.color.set('#232028');

  // Jefes (GDD §15): NO se remodela su composición, solo se oscurece el
  // cuerpo y se da un pelín de emissive a acentos ya existentes para que se
  // lean en la oscuridad (prismaCoreMaterial sigue el arma, ya es legible).
  bossBodyMaterial.color.set('#26232c');
  guardianBodyMaterial.color.set('#242229');
  guardianHornMaterial.color.set('#18161c');
  guardianHornMaterial.emissive.set('#d9a531');
  guardianHornMaterial.emissiveIntensity = ACCENT_EMISSIVE_INTENSITY;
  queenBodyMaterial.color.set('#221f2a');
  queenCrownMaterial.emissive.set('#9fd65c');
  queenCrownMaterial.emissiveIntensity = ACCENT_EMISSIVE_INTENSITY;
  stormBodyMaterial.color.set('#20242e');

  // El `transparent=true` de arriba (trailMaterial) cambia el programa de
  // blending del material respecto al Lambert clásico con el que nace: fuerza
  // needsUpdate para que three.js compile el shader correcto desde el primer
  // frame.
  trailMaterial.needsUpdate = true;
}

// Aplicación ÚNICA al cargar el módulo: ya no hay store ni parámetro de URL
// que alterne estos materiales en runtime, así que no hace falta suscripción
// ni función reejecutable — se llama una vez y queda fijo toda la sesión.
applyHazardTones();
applyProjectileGlow();
applySilhouettes();
