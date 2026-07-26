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
  coinMaterial,
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

// ── Bloom HDR: emissive de los emisores reales (rama post-procesado, fase 4) ──
//
// Diagnóstico de playtest (David, con Bloom activado): el bloom solo se veía
// en la llama de la vela y exagerado. Dos causas simultáneas:
//   (a) el suelo Lambert bajo la vela (luz `CANDLE_BASE_INTENSITY=55`,
//       CandleLightView.tsx) superaba el antiguo umbral (1.1) en espacio
//       lineal → todo el charco de luz floreaba, no solo la llama (arreglado
//       subiendo `BLOOM_LUMINANCE_THRESHOLD` a 2.0 en PostEffects.tsx);
//   (b) los emissive de este propio módulo (arrowMaterial, trailMaterial,
//       guardianHornMaterial, queenCrownMaterial) son LDR (sus
//       `emissiveIntensity` se calibraron para verse bien SIN bloom) →
//       nunca cruzan el nuevo umbral de 2.0, así que nunca florecen.
//
// `BLOOM_EMISSIVE_INTENSITY` es el valor HDR único que reemplaza esas
// intensidades LDR allá donde el material representa un emisor de verdad
// (llama, ojo, acento de jefe) — nunca donde el emissive es solo un rim-light
// de legibilidad sobre una superficie iluminada normalmente (ver
// `heroMaterial` más abajo, que se deja SIN tocar a propósito).
//
// OJO — efecto secundario aceptado: `emissiveIntensity` alimenta el mismo
// tonemap ACES tanto si el composer de post-proceso está montado como si no
// (PostEffects.tsx solo decide si además se APLICA el pase de Bloom sobre
// ese valor). Subir esta intensidad ilumina un poco esos materiales incluso
// con el toggle de Bloom apagado — no hay forma de que un mismo
// `emissiveIntensity` sea "LDR sin bloom, HDR con bloom" a la vez sin
// duplicar materiales (prohibido, ver informe de fase 4). Verificación
// visual del look por defecto (sin bloom) pendiente del orquestador.
// Subido 3 → 6 (playtest: "apenas se nota el bloom fuera de la vela"): la
// luminancia se pondera por canal, así que un violeta '#b18cff' a ×3 daba
// ~1.8 — POR DEBAJO del umbral 2.0 del Bloom — y los emisores fríos no
// floreaban casi nada. A ×6 hasta el canal más débil cruza el umbral con
// margen (~3.7 el violeta, ~4.5+ los cálidos) sin acercarse al núcleo del
// suelo bajo la vela (~20-30 en lineal).
export const BLOOM_EMISSIVE_INTENSITY = 6;

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

/**
 * Emissive de la flecha tras perder su pointLight propia — mismo color que su
 * cuerpo (WEAPON_COLOR.arrow). Antes tenía su propia intensidad LDR (0.6,
 * calibrada para "brillar de su propio tono" sin blanquear); fase 4 la
 * unifica a `BLOOM_EMISSIVE_INTENSITY` para que cruce el nuevo umbral de
 * bloom (2.0) — es precisamente uno de los "proyectiles" que David quería que
 * floreciera.
 */
function applyProjectileGlow(): void {
  arrowMaterial.emissive.copy(WEAPON_COLOR.arrow);
  arrowMaterial.emissiveIntensity = BLOOM_EMISSIVE_INTENSITY;
}

// ── Siluetas oscuras de personajes ─────────────────────────────────────────
//
// Sustituye los cuerpos-placeholder (esferas de colores planos) por siluetas
// casi negras de piedra/tela, inspiradas en concept art estilo Hollow Knight/
// vela: cuerpos oscuros + ojos/acentos emisivos — visibles incluso a oscuras,
// "es EL rasgo del concept". Placeholders: primitivas de Three combinadas, no
// modelos; importa la silueta + los ojos, no el detalle. No toca radios de
// colisión ni la sim: es render puro (JSX/materiales), igual que el resto de
// "personalidad de enemigos" de más arriba.
//
// Bloom (fase 4): los ojos/detalles PUNTUALES (dummyEyeGlowMaterial,
// chaserEyeGlowMaterial, spikeEyeGlowMaterial, shooterTubeGlowMaterial,
// candleFlameMaterial, bossCandleFlameMaterial) pasaron de `MeshBasicMaterial`
// a `MeshLambertMaterial` con color negro + emissive HDR (ver sus
// declaraciones más abajo) precisamente para poder florecer — Basic no tiene
// canal emissive. Los acentos de jefe (guardianHornMaterial/
// queenCrownMaterial) YA eran Lambert-con-emissive de antes; aquí solo se les
// sube la intensidad a `BLOOM_EMISSIVE_INTENSITY`.

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
/**
 * Llama del cirio de jefe (reutilizada también por `WallTorch`, ver
 * TorchView.tsx): mismo cálido que `CandleLightView`/`candleFlameMaterial`.
 *
 * Bloom (fase 4): ANTES `MeshBasicMaterial` (autoiluminada, ignora la luz de
 * escena) — pero Basic NO tiene canal `emissive`/`emissiveIntensity`, así que
 * no hay forma de subirla por encima del umbral de bloom sin escribir
 * `.color` con componentes >1 directamente (más frágil: se pierde el punto
 * de comparación con el resto de materiales HDR de este fichero). Convertida
 * a `MeshLambertMaterial` con `color` NEGRO — sin contribución difusa, el
 * resultado es IDÉNTICO a Basic (invariante a la luz de escena, "no depende
 * de si una cara mira hacia una luz") — y todo el brillo vía `emissive`, que
 * sí admite intensidad HDR. Esta llama es ESTÁTICA (nunca se lerpea su
 * color en runtime, solo su escala por el parpadeo de `TorchView.tsx`), así
 * que basta con fijar la intensidad HDR una vez en el constructor.
 */
export const bossCandleFlameMaterial = new THREE.MeshLambertMaterial({
  color: 0x000000,
  emissive: '#ffb469',
  emissiveIntensity: BLOOM_EMISSIVE_INTENSITY,
});

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
 * cada frame con la misma rigidez (`WEAPON_COLOR_LERP_STIFFNESS`).
 *
 * Bloom (fase 4): igual que `bossCandleFlameMaterial` de arriba, convertida de
 * `MeshBasicMaterial` a `MeshLambertMaterial` con `color` NEGRO + todo el
 * brillo en `emissive` (Basic no tiene canal emissive, no hay forma de
 * llevarla a HDR sin esta conversión). DIFERENCIA IMPORTANTE con la del
 * jefe/antorcha: esta SÍ se muta cada frame (el lerp de arma de HeroView.tsx)
 * — antes el lerp escribía en `.color` (lo único que Basic tenía), ahora
 * escribe en `.emissive` (ver `HeroView.tsx`, comentario junto al lerp). La
 * intensidad HDR (`emissiveIntensity`) es constante y se fija aquí una sola
 * vez; solo el TONO del emissive cambia por frame según el arma activa.
 */
export const candleFlameMaterial = new THREE.MeshLambertMaterial({
  color: 0x000000,
  emissive: WEAPON_COLOR.body.clone(),
  emissiveIntensity: BLOOM_EMISSIVE_INTENSITY,
});
/** Ojos de la vela (carita simple del concept): óvalos negros, reutiliza smallDotGeometry escalada. */
export const candleEyeMaterial = new THREE.MeshBasicMaterial({ color: '#14121a' });

/**
 * Ojos/detalles emissive de enemigo (Bloom fase 4): mismo motivo que las
 * llamas de arriba — ANTES `MeshBasicMaterial` (autoiluminados, ignoran la
 * luz de escena), convertidos a `MeshLambertMaterial` con `color` NEGRO +
 * `emissive`/`emissiveIntensity` HDR, porque Basic no tiene canal emissive y
 * estos SÍ deben florecer: son "el mismo color que su charco" (ver
 * `EnemyLights.tsx`, `ENEMY_LIGHT_COLOR`) — el detalle puntual que representa
 * la luz del enemigo, mientras que el propio `GlowPuddle` (derrame tenue en
 * el suelo) se queda a propósito FUERA del bloom (ver informe de fase 4:
 * opacidad ~0.16, no es un emisor puntual). Todos ESTÁTICOS (ningún useFrame
 * muta su color), así que basta con fijar la intensidad en el constructor.
 * `shooterTubeRestMaterial` (estado APAGADO/en reposo) se deja SIN tocar a
 * propósito — si floreciera también, se perdería la distinción visual
 * "cargando vs. en reposo" que es la señal de telegraph del Aguaboca.
 */
export const dummyEyeGlowMaterial = new THREE.MeshLambertMaterial({
  color: 0x000000,
  emissive: '#ffc169',
  emissiveIntensity: BLOOM_EMISSIVE_INTENSITY,
});
/** Falda cónica oscura de la campana del Vigía. */
export const dummySkirtMaterial = new THREE.MeshLambertMaterial({ color: '#1c1a20' });

/** Acechador del Umbral (chaser): ojos rasgados violeta. */
export const chaserEyeGlowMaterial = new THREE.MeshLambertMaterial({
  color: 0x000000,
  emissive: '#b18cff',
  emissiveIntensity: BLOOM_EMISSIVE_INTENSITY,
});
/** Penitente de Púas (spike): un único ojo cálido grande frontal. */
export const spikeEyeGlowMaterial = new THREE.MeshLambertMaterial({
  color: 0x000000,
  emissive: '#ffb36b',
  emissiveIntensity: BLOOM_EMISSIVE_INTENSITY,
});
/** Aguaboca (shooter): interior del tubo/cañón en reposo (piedra oscura apagada, SIN emissive/bloom a propósito) y al cargar (azul brillante, sí florece). */
export const shooterTubeRestMaterial = new THREE.MeshBasicMaterial({ color: '#2a2730' });
export const shooterTubeGlowMaterial = new THREE.MeshLambertMaterial({
  color: 0x000000,
  emissive: '#7cc7ff',
  emissiveIntensity: BLOOM_EMISSIVE_INTENSITY,
});
/**
 * Ojo propio del Aguaboca (petición de David en vivo, 2026-07-26: "ponle al
 * shooter también su ojo del mismo tipo que los demás"): mismo patrón que
 * `dummyEyeGlowMaterial`/`chaserEyeGlowMaterial`/`spikeEyeGlowMaterial`
 * (Lambert + color negro + emissive HDR), mismo tono `#7cc7ff` que
 * `ENEMY_LIGHT_COLOR.shooter` y que `shooterTubeGlowMaterial` (charco/ojo/tubo
 * cargando comparten SIEMPRE el color de archetype, regla ya establecida en
 * el comentario de arriba). Este ojo va SIEMPRE encendido (no se intercambia
 * con la carga, a diferencia del tubo) — la distinción reposo/carga sigue
 * viviendo ÚNICAMENTE en `shooterTubeRestMaterial` ↔ `shooterTubeGlowMaterial`
 * (ver `shooter/Mesh.tsx`): compartir tono con el ojo no la difumina porque el
 * tubo es mucho más grande y su cambio es binario apagado→encendido, mientras
 * que el ojo, deliberadamente más pequeño y separado en la cara (por encima
 * del tubo, nunca solapado), se queda como un detalle ambiental constante, no
 * como telegraph.
 */
export const shooterEyeGlowMaterial = new THREE.MeshLambertMaterial({
  color: 0x000000,
  emissive: '#7cc7ff',
  emissiveIntensity: BLOOM_EMISSIVE_INTENSITY,
});

/** Aplica las siluetas oscuras de personajes. Se llama UNA sola vez al cargar el módulo (ver abajo). */
function applySilhouettes(): void {
  // Héroe = vela: cuerpo de cera pálida fijo (HeroView.tsx no lerpea
  // heroMaterial.color; el color de arma vive solo en la llama).
  heroMaterial.color.set(HERO_WAX_COLOR);
  // Emissive tenue de cera: con la luz a la altura del cuerpo (0.75, bajo
  // los muros) los laterales del cilindro reciben luz rasante y quedaban
  // negros — la vela debe leerse pálida en la oscuridad (concept art).
  //
  // Bloom (fase 4): DESCARTADO a propósito para el censo de emisores — esto
  // no es un emisor puntual como la llama, es un rim-light de legibilidad
  // repartido por TODA la superficie del cilindro. Subirlo a
  // BLOOM_EMISSIVE_INTENSITY haría florecer el CUERPO ENTERO de la vela como
  // si fuera una bombilla, exactamente el efecto "todo el charco de luz
  // floreaba" que se está corrigiendo — el objetivo es que solo la LLAMA
  // (`candleFlameMaterial`, de verdad puntual) sea el emisor.
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
  // Bloom (fase 4): este SÍ es un detalle emissive puntual (el "brillo
  // interior" del concept), a diferencia del rim-light de heroMaterial de
  // arriba — sube a BLOOM_EMISSIVE_INTENSITY (antes 0.25, LDR).
  trailMaterial.color.set('#cfc4e8');
  trailMaterial.transparent = true;
  trailMaterial.opacity = 0.85;
  trailMaterial.emissive.set('#b18cff');
  trailMaterial.emissiveIntensity = BLOOM_EMISSIVE_INTENSITY;
  // Aguaboca (shooter): pedrusco oscuro.
  shooterMaterial.color.set('#232028');

  // Jefes (GDD §15): NO se remodela su composición, solo se oscurece el
  // cuerpo y se da un pelín de emissive a acentos ya existentes para que se
  // lean en la oscuridad (prismaCoreMaterial sigue el arma, ya es legible).
  bossBodyMaterial.color.set('#26232c');
  guardianBodyMaterial.color.set('#242229');
  guardianHornMaterial.color.set('#18161c');
  guardianHornMaterial.emissive.set('#d9a531');
  guardianHornMaterial.emissiveIntensity = BLOOM_EMISSIVE_INTENSITY;
  queenBodyMaterial.color.set('#221f2a');
  queenCrownMaterial.emissive.set('#9fd65c');
  queenCrownMaterial.emissiveIntensity = BLOOM_EMISSIVE_INTENSITY;
  stormBodyMaterial.color.set('#20242e');
  // El Prisma y La Tormenta se quedan SIN acento emissive propio (censo de
  // bloom, fase 4): a diferencia de Guardián/Reina, no tienen un detalle
  // aparte (cuerno/corona) — su cuerpo ENTERO sigue el color del arma
  // (prismaCoreMaterial) o del patrón activo (stormBodyMaterial/halo), así
  // que no hay un "acento puntual" limpio que subir sin arriesgar que
  // florezca el cuerpo entero (el mismo problema que se corrigió con
  // heroMaterial). Fuera de alcance de este censo; a valorar aparte si el
  // orquestador quiere un detalle emissive dedicado para estos dos jefes.

  // Moneda (punto 9 de playtest, ver ItemView.tsx): brillo dorado — a
  // diferencia del resto de items (poción/llave, sin convención de "glow"
  // establecida), la moneda SÍ es un pickup con identidad de "objeto
  // valioso/reluciente" y no compite con ninguna luz/GlowPuddle existente
  // (los items no tienen charco propio), así que un emissive HDR aquí no
  // duplica ningún otro efecto de luz.
  coinMaterial.emissive.set('#ffd166');
  coinMaterial.emissiveIntensity = BLOOM_EMISSIVE_INTENSITY;

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
