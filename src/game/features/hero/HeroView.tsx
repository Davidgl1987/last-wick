/**
 * Héroe = vela: cilindro de cera + llama + blob shadow (SIN sombras
 * dinámicas). Lee la sim en useFrame y muta los object3D directamente, con
 * interpolación entre ticks.
 *
 * El modelo de la vela en sí (cuerpo, silueta de oclusión, ojos y llama) se
 * pinta con `<CandleModel>` (`./CandleModel.tsx`), COMPARTIDO con Lumora
 * (`TitleScreenScene.tsx`) — este fichero le pasa refs para seguir animando
 * las piezas que le son propias (squash/estiramiento, i-frames, mirada) y le
 * añade como `children` los adornos exclusivos del héroe (pinchos, escudo).
 *
 * Feedback visual:
 * - Parpadeo durante los i-frames (GDD §6) y caída al foso (fase 2).
 * - Squash & stretch vertical (SOLO render): estiramiento con la velocidad,
 *   aplastamiento breve al detectar una frenada brusca (impacto). La sim
 *   nunca se entera.
 * - Rastro de CERA (playtest ronda 5-7): deposita puntos en la capa
 *   persistente `session.effects.wax` por distancia recorrida, ver
 *   WAX_TRAIL_COLOR más abajo.
 * - Identificador visual de mejoras (F5, docs/plans/ECONOMY_PLAN.md): pinchos
 *   del Erizo de Acero, estiramiento amplificado de la Estela de Cometa,
 *   escala extra del Canto Rodado y burbuja de la Burbuja de Cuarzo. Pinchos
 *   y burbuja viven como HIJOS del mesh del héroe (bodyRef) para heredar
 *   gratis su squash/stretch/escala y su parpadeo de i-frames — solo su
 *   posición/orientación se fija una vez al montar (son estáticos relativos
 *   a la bola); useFrame solo cambia visibilidad/opacidad, nunca su pose.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Color, Quaternion, Vector3, type Group, type Mesh } from 'three';
import { dampAngleTowards } from '@/engine/geometry';
import { CANDLE_HALF_HEIGHT } from '@/game/render/hero-candle';
import { HERO_RADIUS } from './constants';
import { CandleModel, CANDLE_FLAME_ANCHOR_Y, heroSilhouetteMaterial } from './CandleModel';
import { PIT_FALL_DURATION } from '@/game/features/hazards/constants';
import { HERO_WAX_EMIT_DISTANCE, WAX_TYPE_ARCANE, WAX_TYPE_FROST, WAX_TYPE_WAX } from '@/game/features/effects/wax';
import { getUpgradeLevel } from '@/game/session/upgrades';
import type { GameSession } from '@/game/session/session';
import type { WeaponMode } from '@/game/world/types';
import {
  aimDotMaterial,
  blobShadowMaterial,
  heroShieldMaterial,
  heroSpikeGeometry,
  heroSpikeMaterial,
  unitCircle,
  unitSphere,
  WEAPON_COLOR,
} from '@/game/render/assets';
import { HERO_WAX_COLOR, heroFlameMaterial, heroFlameSilhouetteMaterial, WEAPON_COLOR_FLAME_HDR } from '@/game/render/assets-dark';
import { boulderScaleFactor, cometStretchFactor, shieldBubbleOpacity, spikeCountForLevel } from './upgrade-visuals';

/** Frecuencia del parpadeo de invulnerabilidad (alternancias por segundo). */
const IFRAME_BLINK_HZ = 12;

/**
 * Color del héroe por arma (punto 1 de playtest ronda 3): rigidez del lerp
 * de color (mayor = transición más rápida, pero siempre suave, nunca un
 * corte brusco) y tuning del burst de partículas al cambiar de arma.
 */
const WEAPON_COLOR_LERP_STIFFNESS = 10;
const WEAPON_SWITCH_BURST_COUNT = 14;
const WEAPON_SWITCH_BURST_SPEED = 2.4;
const WEAPON_SWITCH_BURST_SIZE = 0.08;
const WEAPON_SWITCH_BURST_LIFE = 0.32;

/** Base para la inclinación/estiramiento de la vela (CANDLE_TILT_* / CANDLE_VERTICAL_STRETCH_* más abajo): tope de +35% a velocidad alta. */
const STRETCH_PER_SPEED = 0.028;
const STRETCH_MAX = 0.35;
/** Frenada (u/s perdidos entre frames) que dispara el squash de impacto. */
const SQUASH_DECEL_THRESHOLD = 3.5;
const SQUASH_DURATION = 0.12;
/** Aplastamiento del squash: escala vertical 0.62, horizontal compensada. */
const SQUASH_FLATTEN = 0.62;

/** Escala uniforme de la Burbuja de Cuarzo (F5) respecto al radio del héroe: envuelve la bola, no la toca. */
const SHIELD_BUBBLE_SCALE = 1.4;

/**
 * Inclinación de la vela hacia la dirección de movimiento (punto 1 de
 * playtest ronda 4: "podría estirar la parte de arriba de la vela hacia
 * donde se está tirando"): ángulo objetivo proporcional a la velocidad,
 * reutilizando el mismo tope/ratio que ya usaba el estiramiento de la esfera
 * clásica (STRETCH_MAX/STRETCH_PER_SPEED — velocidades ya calibradas para
 * este juego, y el tope de 0.35 rad es justo el que pide David), amortiguado con
 * el mismo criterio 1-exp(-k·dt) que el lerp de color de arma de arriba
 * (WEAPON_COLOR_LERP_STIFFNESS) para que nunca dé un tirón. Se suaviza el
 * VECTOR de inclinación entero (no solo su magnitud) para que un cambio
 * brusco de dirección tampoco “salte”, solo se re-oriente con la misma
 * suavidad.
 */
const CANDLE_TILT_MAX = STRETCH_MAX;
const CANDLE_TILT_PER_SPEED = STRETCH_PER_SPEED;
const CANDLE_TILT_LERP_STIFFNESS = 9;

/**
 * Inclinación al apuntar (playtest ronda 5, punto 3: "el efecto de la vela
 * al moverse (se echa para alante) ponlo también mientras se está
 * apuntando"): mientras `world.heroAiming` y el héroe está parado o casi
 * (velocidad por debajo de CANDLE_AIM_TILT_SPEED_THRESHOLD — si ya iba
 * lanzado más rápido que eso, la inclinación de vuelo por velocidad de abajo
 * ya se está mostrando y no hace falta la de apuntado), se inclina hacia la
 * DIRECCIÓN DE LANZAMIENTO prevista (`session.aim.dirX/dirY`, el mismo
 * vector que ya dibuja `AimIndicatorView`), con ángulo proporcional a la
 * fuerza del arrastre (`session.aim.force`, [0,1]) y tope menor que el de
 * vuelo (CANDLE_TILT_MAX = 0.35). Reutiliza el MISMO `candleLean`/`tiltK` de
 * abajo (nunca un lerp aparte): al soltar, el target simplemente pasa a
 * depender de la velocidad en vez del aim en el frame siguiente, y como el
 * lerp nunca salta de golpe a un valor nuevo, el relevo entre ambos es
 * continuo (sin salto), tal como pide el encargo.
 */
const CANDLE_AIM_TILT_MAX = 0.18;
/** Por debajo de esta velocidad (u/s) se considera "parado o casi" a efectos de la inclinación de apuntado. */
const CANDLE_AIM_TILT_SPEED_THRESHOLD = 0.6;

/**
 * Estiramiento VERTICAL de la vela con la velocidad (mismo punto de
 * playtest): sustituye al estiramiento horizontal que usaba la esfera
 * clásica — alargar un cilindro fino tumbado en el plano del suelo no se lee
 * como "lanzada" (queda como un cilindro acostado), así que aquí se alarga
 * verticalmente en su lugar. Tope más sutil que STRETCH_MAX ("ligero
 * estiramiento", pedido explícito).
 */
const CANDLE_VERTICAL_STRETCH_MAX = 0.15;
const CANDLE_VERTICAL_STRETCH_PER_SPEED = STRETCH_PER_SPEED * 0.5;

/**
 * Pivote de inclinación = "la base" de la vela (punto 1 de playtest ronda 4:
 * "la base no debe despegarse ni hundirse en el suelo"). Con la vela fina y
 * alta de ronda 7 (`heroCandleGeometry` = radio local 1, alto local 2.8, ver
 * `render/assets.ts`) la fórmula anterior (fracción = 1 − mitad-de-alto-
 * local) ya no vale: esa cuenta asumía un cilindro CHATO cuya mitad de alto
 * era menor que el radio (0.55 < 1), y con un alto local de 2.8 (mitad 1.4)
 * daría una fracción NEGATIVA — la base se hundiría bajo el suelo. En vez de
 * arrastrar esa aproximación, se fija el pivote LITERALMENTE en el suelo
 * (fracción 0 ⇒ `tiltGroup` siempre a y=0, salvo el saltito de victoria):
 * cumple el pedido original al pie de la letra y es correcto para cualquier
 * proporción de la vela, no solo la chata de antes.
 */
const CANDLE_PIVOT_HEIGHT_FRACTION = 0;

/**
 * `HERO_CANDLE_MODEL` y `CANDLE_HALF_HEIGHT` (la proporción real del modelo,
 * en espacio normalizado a radio 1) viven en `render/hero-candle.ts` junto a
 * `normalizeHeroCandleGeometry` — extraídas de aquí en un primer paso
 * (encargo de David, 2026-08-18: "debería usarse el mismo modelo y la misma
 * llama en todos sitios") para que `TitleScreenScene.tsx` (Lumora) consumiera
 * exactamente la MISMA normalización que el héroe, en vez de la suya propia.
 *
 * Segundo paso del mismo encargo, mismo día ("debería haber un componente
 * que lo pinte todo, tanto en el título como en el juego"): el cuerpo, la
 * silueta de oclusión, los ojos y el ancla de la llama —todo lo que
 * depende de esta proporción salvo los pinchos, que siguen siendo cosa
 * exclusiva del héroe— se mudaron a `./CandleModel.tsx`, montado tanto aquí
 * como en `TitleScreenScene.tsx`. `CANDLE_FLAME_ANCHOR_Y` sigue
 * IMPORTÁNDOSE aquí (este fichero todavía necesita su valor para
 * reposicionar `flameAnchorRef` cada frame según `visualRadius`, ver el
 * `useFrame` más abajo); `CANDLE_EYE_Y` y el resto de constantes de los ojos
 * ya NO se usan en este fichero en absoluto (viven enteramente dentro de
 * `CandleModel.tsx`, que no necesita reposicionarlas cada frame). Solo
 * `CANDLE_SPIKE_SURFACE_Y` se queda aquí, derivada de `CANDLE_HALF_HEIGHT`
 * igual que antes: los pinchos son un adorno exclusivo del héroe que cuelga
 * de `bodyRef` como `children` de `CandleModel`, nunca de Lumora.
 */

/**
 * Ojos de la vela: constantes de posición/tamaño/separación
 * (`CANDLE_EYE_SEPARATION`/`_X`/`_Y`/`_Z`/`_SCALE`) y todo su historial de
 * playtest se mudaron a `./CandleModel.tsx` (encargo de David, 2026-08-18:
 * "un componente que lo pinte todo, tanto en el título como en el juego") —
 * este fichero ya no las necesita: `eyeGroupRef`, más abajo, solo fija cada
 * frame la ROTACIÓN en Y (la mirada), nunca la posición/tamaño de la carita,
 * que ahora es enteramente cosa del componente.
 */

/**
 * Orientación de la mirada (playtest ronda 8, punto 3b: "deben mirar hacia
 * donde se está apuntando, o hacia donde se está moviendo"): los ojos viven
 * en un `<group>` propio (`eyeGroupRef`, hijo de `candleGroup`) que rota
 * SOLO en Y — como `candleGroup` nunca aplica yaw propio (solo traslada), el
 * ángulo LOCAL de este grupo coincide con el ángulo de MUNDO, sin necesidad
 * de restarle la rotación de ningún ancestro (a diferencia de
 * `chaser/Mesh.tsx`, cuyo grupo padre sí yawea). Los ojos cuelgan de este
 * pivote a radio fijo `CANDLE_EYE_Z`, así que rotarlo los pasea alrededor del
 * cilindro sin recalcular su posición cada frame (mismo resultado que la
 * proyección seno/coseno del Chaser, más simple porque aquí basta un solo
 * eje). Prioridad de objetivo: apuntando > bloqueo de disparo de proyectil
 * (ver `PROJECTILE_FACE_LOCK_DURATION`) > moviéndose > último ángulo válido
 * (parado, se conserva sin más). Suavizado con `dampAngleTowards`
 * (`src/engine/geometry.ts`) por el arco más corto, mismo criterio que ya usa
 * `chaserFaceAngle` en `chaser/Mesh.tsx`.
 */
const EYE_FACE_LERP_STIFFNESS = 10;
/** Por debajo de esta velocidad (u/s) no se considera "moviéndose" a efectos de la mirada (evita que un jitter mínimo reoriente la cara). */
const EYE_FACE_SPEED_THRESHOLD = 0.5;
/**
 * Duración del bloqueo de mirada tras disparar un proyectil (arrow/spell),
 * en segundos (playtest 2026-08-13, David: "cuando lanzas cera, el
 * personaje se queda mirando hacia donde te lanzas, pero cuando lanzas
 * proyectiles, como tiene retroceso, se queda mirando hacia atrás, y
 * debería quedarse mirando hacia donde ha lanzado el proyectil"). Causa
 * raíz: `fireProjectile` (combat.ts) aplica el retroceso RESTANDO la
 * dirección de disparo a `hero.velocity` — justo tras soltar, la velocidad
 * apunta al REVÉS del disparo, y la rama "en movimiento" de más abajo (que
 * sigue a `hero.velocity`) orientaba la cara hacia atrás. Con el cuerpo
 * (`launchHero`) no pasa: ahí la velocidad SÍ queda en la dirección de
 * puntería, así que seguir a la velocidad ya es correcto — este bloqueo
 * solo se activa al detectar un disparo de arrow/spell (nunca body, ver
 * `prevLastArrowTime`/`prevLastSpellTime` más abajo), y punto 4 GDD
 * conservado: la mirada normal (moviéndose/apuntando) no cambia en nada.
 *
 * Duración calculada, no a ojo: fricción exponencial de `physics.ts`
 * (`FRICTION_FACTOR=1.42`, `v(t)=v0·e^(-1.42t)`) — de la velocidad de
 * retroceso típica (`PROJECTILE_RECOIL≈1.15` × 0.75-1.1, combat.ts) hasta
 * `EYE_FACE_SPEED_THRESHOLD` (0.5) hay ln(2)/1.42≈0.49s por fricción base
 * (la fricción extra a baja velocidad de physics.ts solo acorta ese
 * margen). 0.5s cubre ese decaimiento con margen sin dejar la mirada
 * bloqueada más de lo necesario una vez el retroceso ya se disipó.
 */
const PROJECTILE_FACE_LOCK_DURATION = 0.5;

/**
 * Rastro de CERA (playtest ronda 5, punto 4: "haz que la vela deje un
 * rastro de cera al moverse") — REDISEÑO (playtest ronda 7, David: "la cera
 * no se hace pequeña, como mucho que desaparezca poco a poco, pero tampoco
 * debería... hay que dejar un rastro de TODOS los movimientos que ha
 * hecho"): NO usa `session.effects.trail` (estela de vida corta, cadencia
 * por TIEMPO, solo mientras el héroe va rápido). La cera vive en su propia
 * capa persistente (`session.effects.wax`, `features/effects/wax.ts`):
 * puntos FIJOS que nunca se encogen ni desaparecen (se reciclan solo cuando
 * el buffer, ~2000 puntos, se llena), depositados por DISTANCIA recorrida
 * (no por tiempo ni umbral de velocidad — ver bloque de más abajo) para que
 * el rastro cubra uniformemente cualquier movimiento, no solo los sprints.
 */
/**
 * La cera del rastro es notablemente más OSCURA que la del cuerpo (playtest
 * ronda 9: "la cera, incluso si se puede, la oscurecería un poco más"): cera
 * pisada/derretida sobre piedra, que se intuye bajo la luz sin competir con
 * el suelo iluminado.
 */
const WAX_TRAIL_COLOR = new Color(HERO_WAX_COLOR).multiplyScalar(0.55);
/** Tamaño del goterón de cera (× HERO_RADIUS): más grande que el punto clásico (0.8) para que se lea sobre el suelo iluminado por la propia vela. */
const WAX_TRAIL_SIZE_FACTOR = 1.15;
/**
 * Salto de posición (u) en un solo frame por encima del cual se considera un
 * TELEPORT (caída al foso y reaparición, cambio de sala) y no un
 * desplazamiento real del héroe: evita que la cera dibuje una fila fantasma
 * conectando el punto de antes de caer con el de reaparecer. Muy por encima
 * de cualquier paso real a framerate normal (velocidad máxima del héroe muy
 * por debajo de esto × 60fps).
 */
const WAX_TELEPORT_GUARD = 3;

/**
 * Llama y ancla de la llama: `FLAME_BASE_SCALE`, `FLAME_GAP` y
 * `CANDLE_FLAME_ANCHOR_Y` (con todo su historial de playtest — cuatro etapas
 * de tuning de `FLAME_GAP` más el cambio de significado de "centro" a "base"
 * del refactor de `CandleFlame.tsx`) se mudaron a `./CandleModel.tsx`
 * (encargo de David, 2026-08-18: "un componente que lo pinte todo, tanto en
 * el título como en el juego"). `CANDLE_FLAME_ANCHOR_Y` sigue IMPORTADA aquí
 * abajo: este `useFrame` todavía necesita su valor para reposicionar
 * `flameAnchorRef` cada frame según `visualRadius` (Firmeza en vivo) —
 * `CandleModel` ya la usa internamente para el valor estático por defecto,
 * que es todo lo que necesita Lumora, pero el héroe sigue siendo dueño del
 * reescalado en vivo, ver el `useFrame` más abajo.
 */

/**
 * Gesto de victoria (playtest 2026-07-15, David: "quizá algún gesto de
 * victoria antes de la modal") durante 'boss-victory-pause' (world/step.ts,
 * BOSS_VICTORY_PAUSE_DURATION): saltitos suaves. SOLO render — no toca
 * velocity/posición de la sim, y usa `world.time` (no un reloj propio),
 * mismo patrón determinista que el bob de items (ItemView.tsx). abs(sin) da
 * un rebote que siempre sale del suelo hacia arriba (nunca se hunde por
 * debajo de la posición de reposo), corte limpio al abrirse el modal porque
 * `world.phase` deja de ser 'boss-victory-pause' ese mismo frame.
 */
const VICTORY_HOP_HEIGHT = 0.16;
const VICTORY_HOP_FREQUENCY = 6.5; // rad/s: ritmo alegre, no frenético

/**
 * Direcciones (en la esfera unitaria) de los 12 pinchos del Erizo de Acero
 * (F5): 3 "anillos ecuatoriales" de 4 pinchos, con un pequeño desfase de
 * ángulo entre anillos para que no queden alineados verticalmente. El orden
 * importa: `spikeCountForLevel` revela los índices [0,4) en nivel 1, [0,8)
 * en nivel 2 y los 12 en nivel 3 — así que el anillo 0 (ecuador puro) es el
 * primero en aparecer. Geometría pura, no se testea (sin infra de render 3D).
 */
function buildSpikeDirections(): Array<{ x: number; y: number; z: number }> {
  const RING_Y = [0, 0.5, -0.5];
  const RING_OFFSET_DEG = [0, 45, 20];
  const dirs: Array<{ x: number; y: number; z: number }> = [];
  for (let ring = 0; ring < RING_Y.length; ring++) {
    const y = RING_Y[ring];
    const xzRadius = Math.sqrt(Math.max(0, 1 - y * y));
    for (let i = 0; i < 4; i++) {
      const angle = ((i * 90 + RING_OFFSET_DEG[ring]) * Math.PI) / 180;
      dirs.push({ x: Math.sin(angle) * xzRadius, y, z: Math.cos(angle) * xzRadius });
    }
  }
  return dirs;
}

const SPIKE_DIRECTIONS = buildSpikeDirections();

/**
 * Héroe-vela (punto 5 de playtest): los 12 pinchos del Erizo de Acero se
 * posicionan con `SPIKE_DIRECTIONS` (puntos sobre la ESFERA unitaria, radio
 * 1) — pero `bodyRef` es `heroCandleGeometry` (cilindro fino y alto de ronda
 * 7, radio local 1 / alto local 2.8, ver assets.ts): el ecuador de la esfera
 * unitaria cae justo en la superficie del cilindro (el radio local coincide,
 * 1 = 1) pero los polos (y=±1) quedarían muy por encima/debajo del cilindro
 * real (semialto local 1.4) y "flotarían" fuera del cuerpo. Reproyección
 * barata: escala cada dirección unitaria por el radio/semialto reales del
 * cilindro en vez de recalcular geometría de contacto exacta — aproximado
 * pero "razonable" (mismo criterio que pide el playtest), sin tocar la
 * orientación (el quaternion de abajo sigue usando la dirección ORIGINAL sin
 * escalar, así los pinchos siguen apuntando hacia fuera).
 */
const CANDLE_SPIKE_SURFACE_XZ = 1;
/** Semialto real del cuerpo: se deriva de `CANDLE_HALF_HEIGHT` para que los pinchos sigan clavados en la superficie si cambia el modelo de vela. */
const CANDLE_SPIKE_SURFACE_Y = CANDLE_HALF_HEIGHT;

/**
 * Silueta de oclusión del cuerpo (hull convexo + cáscara) y sus
 * funciones auxiliares (`bufferGeometryVertices`, `buildHeroSilhouetteGeometry`)
 * se mudaron a `./CandleModel.tsx`, con todo su historial de playtest (los
 * cinco puntos: concavidad del cráter, primer intento fallido con
 * `CylinderGeometry`, hull convexo, z-fighting descubierto y la cáscara que
 * lo arregla) intactos — este fichero ya no construye la silueta, solo la
 * consume vía `heroSilhouetteMaterial` (importado más arriba) para lerpear
 * su color hacia el arma activa en el `useFrame` de abajo.
 */
export function HeroView({ session }: { session: GameSession }) {
  // Cuerpo, silueta de oclusión, ojos y llama: normalización del kit, hull
  // convexo, y todo su montaje viven ahora en `<CandleModel>` (ver el
  // comentario grande de `./CandleModel.tsx` para el contrato completo) —
  // este componente ya no calcula ninguna geometría propia, solo le pasa las
  // refs de las piezas que necesita seguir animando cada frame.
  const candleTiltGroupRef = useRef<Group>(null);
  const bodyRef = useRef<Mesh>(null);
  const shadowRef = useRef<Mesh>(null);
  const shieldRef = useRef<Mesh>(null);
  const spikeRefs = useRef<(Mesh | null)[]>([]);
  // Héroe = vela (ver comentario grande más arriba).
  const candleGroupRef = useRef<Group>(null);
  // Ancla de la llama compartida (`CandleFlame`, ver comentario grande más
  // arriba): solo posición/escala, la propia `CandleFlame` gestiona el resto
  // por sí sola cada frame a partir de su `parent`.
  const flameAnchorRef = useRef<Group>(null);
  // Mirada de los ojos (playtest ronda 8, punto 3b): grupo que rota en Y
  // (ver EYE_FACE_LERP_STIFFNESS arriba) + último ángulo válido conservado
  // mientras el héroe está parado (mismo patrón que chaserFaceAngle en
  // chaser/Mesh.tsx).
  const eyeGroupRef = useRef<Group>(null);
  const candleFaceAngle = useRef(0);
  // Bloqueo de mirada tras disparo de proyectil (ver PROJECTILE_FACE_LOCK_DURATION
  // arriba): ángulo fijado al soltar arrow/spell + world.time hasta el que manda
  // sobre la velocidad. prevLastArrowTime/prevLastSpellTime detectan el disparo
  // comparando con el frame anterior (mismo patrón que prevWeaponMode más abajo);
  // null = "todavía no visto el primer frame", para no disparar un falso positivo
  // al montar.
  const projectileFaceLockAngle = useRef(0);
  const projectileFaceLockUntil = useRef(0);
  const prevLastArrowTime = useRef<number | null>(null);
  const prevLastSpellTime = useRef<number | null>(null);
  const prevSpeed = useRef(0);
  const squashUntil = useRef(0);
  // Cera persistente (ver WAX_TRAIL_COLOR arriba): acumulador de DISTANCIA
  // recorrida (no tiempo) + última posición conocida para calcularla frame a
  // frame; waxPrevX/Z se resincronizan SIEMPRE (incluso cuando no se acumula,
  // ver useFrame) para que un hueco (sala nueva, caída) nunca compute un
  // salto grande de una vez.
  const waxAccumulator = useRef(0);
  const waxPrevX = useRef(0);
  const waxPrevZ = useRef(0);
  // Arma del frame anterior: detecta el CAMBIO para disparar el burst de
  // partículas una sola vez (no cada frame mientras se mantiene el modo).
  const prevWeaponMode = useRef<WeaponMode | null>(null);
  // Inclinación de la vela (punto 1 de playtest ronda 4): vector 2D (x,z)
  // suavizado cuya magnitud es el ángulo actual y cuya dirección es hacia
  // dónde se inclina — suavizar el VECTOR entero (no ángulo+eje por
  // separado) evita saltos cuando la dirección de movimiento cambia bruscamente.
  const candleLean = useRef({ x: 0, z: 0 });
  // Escalares reutilizados cada frame (cero allocs en useFrame, mismo
  // criterio que el resto del render de esta rama).
  const candleTiltAxis = useRef(new Vector3());
  const candleTiltQuat = useRef(new Quaternion());

  // Pose de los pinchos (F5): fija al montar (ver CANDLE_SPIKE_SURFACE_*
  // arriba) — nunca en useFrame, son hijos estáticos del mesh del héroe
  // (heredan su transform cada frame sin recálculo propio). Usa
  // Quaternion.setFromUnitVectors para orientar el cono (eje +Y local) hacia
  // fuera, en vez de trigonometría de Euler frágil; la orientación usa
  // SIEMPRE la dirección original de la esfera (no la reproyectada), así
  // sigue apuntando "hacia fuera".
  useEffect(() => {
    const up = new Vector3(0, 1, 0);
    SPIKE_DIRECTIONS.forEach((dir, i) => {
      const mesh = spikeRefs.current[i];
      if (!mesh) return;
      const dirVec = new Vector3(dir.x, dir.y, dir.z);
      mesh.position.set(dir.x * CANDLE_SPIKE_SURFACE_XZ, dir.y * CANDLE_SPIKE_SURFACE_Y, dir.z * CANDLE_SPIKE_SURFACE_XZ);
      mesh.quaternion.setFromUnitVectors(up, dirVec);
    });
  }, []);

  useFrame((_state, delta) => {
    const world = session.world;
    const hero = world.hero;
    const alpha = session.renderAlpha;
    const x = session.heroPrevX + (hero.position.x - session.heroPrevX) * alpha;
    const z = session.heroPrevY + (hero.position.y - session.heroPrevY) * alpha;

    const tiltGroup = candleTiltGroupRef.current;
    const body = bodyRef.current;
    const shadow = shadowRef.current;
    const shield = shieldRef.current;

    // Niveles de mejora relevantes al render (F5): leídos cada frame desde
    // `hero.upgradeLevels`/`hero.modifiers` — barato (lookups en objeto
    // pequeño) y así una compra en tienda se refleja sin remontar nada.
    const firmezaLevel = getUpgradeLevel(hero, 'cuerpo-firmeza');
    const visualRadius = HERO_RADIUS * boulderScaleFactor(firmezaLevel);
    const cometFactor = cometStretchFactor(getUpgradeLevel(hero, 'cuerpo-velocidad'));
    const spikeVisibleCount = spikeCountForLevel(getUpgradeLevel(hero, 'cuerpo-dano'));
    const shieldCharges = hero.modifiers.shieldCharges;

    for (let i = 0; i < SPIKE_DIRECTIONS.length; i++) {
      const spike = spikeRefs.current[i];
      if (spike) spike.visible = i < spikeVisibleCount;
    }
    if (shield) {
      shield.visible = shieldCharges > 0;
      heroShieldMaterial.opacity = shieldBubbleOpacity(shieldCharges);
    }

    // Color del héroe según arma activa (punto 1 de playtest ronda 3): lerp
    // continuo hacia el color objetivo (nunca un corte brusco), independiente
    // del framerate. El indicador de puntería (aimDotMaterial) comparte el
    // mismo objetivo para que apunten siempre al mismo lenguaje de color.
    // Héroe = vela: el cuerpo (cera) no lerpea (queda fijo, assets-dark.ts) y
    // el lerp se aplica a la llama en su lugar.
    //
    // Bloom (fase 4) + billboard (2026-08-12): la llama pasó de
    // `candleFlameMaterial` (`MeshLambertMaterial`, color negro + brillo en
    // `emissive`, ver assets-dark.ts) a `heroFlameMaterial`
    // (`MeshBasicMaterial` aditivo con `map = flame.png`, mismo fichero) —
    // Basic no tiene canal `emissive`, así que el lerp de arma ahora escribe
    // en `.color` directamente, pero contra `WEAPON_COLOR_FLAME_HDR` (versión
    // YA escalada ×`BLOOM_EMISSIVE_INTENSITY`), no contra `targetColor` (LDR):
    // `targetColor` lo siguen usando tal cual `aimDotMaterial`/
    // `heroSilhouetteMaterial`/`heroFlameSilhouetteMaterial` más abajo, así
    // que no se puede reescalar in-place sin romperlos. `aimDotMaterial`
    // sigue siendo Basic sin `map`: su lerp sigue en `.color` LDR como
    // siempre. `heroFlameSilhouetteMaterial` (silueta de la llama tras un
    // muro, `assets-dark.ts`, encargo de David 2026-08-18) es EXACTAMENTE
    // como `heroSilhouetteMaterial`: LDR, nunca `WEAPON_COLOR_FLAME_HDR` (una
    // silueta no debe florecer, ver el comentario de ese material).
    const targetColor = WEAPON_COLOR[hero.weaponMode];
    const colorK = 1 - Math.exp(-WEAPON_COLOR_LERP_STIFFNESS * delta);
    heroFlameMaterial.color.lerp(WEAPON_COLOR_FLAME_HDR[hero.weaponMode], colorK);
    aimDotMaterial.color.lerp(targetColor, colorK);
    heroSilhouetteMaterial.color.lerp(targetColor, colorK);
    heroFlameSilhouetteMaterial.color.lerp(targetColor, colorK);

    // Cambio de arma: burst de partículas del color NUEVO alrededor del
    // héroe (feedback inmediato, independiente del lerp de color que sigue
    // en curso). Se dispara una sola vez por transición, en el frame en que
    // se detecta el cambio.
    if (prevWeaponMode.current !== null && prevWeaponMode.current !== hero.weaponMode) {
      session.effects.particles.burst(
        x,
        z,
        WEAPON_SWITCH_BURST_COUNT,
        WEAPON_SWITCH_BURST_SPEED,
        WEAPON_SWITCH_BURST_SIZE,
        WEAPON_SWITCH_BURST_LIFE,
        targetColor.r,
        targetColor.g,
        targetColor.b,
        world.rng,
      );
    }
    prevWeaponMode.current = hero.weaponMode;

    // Caída al foso: encoge y se hunde durante la animación.
    if (world.fallingUntil > 0) {
      const remaining = world.fallingUntil - world.time;
      const t = 1 - Math.max(0, remaining) / PIT_FALL_DURATION; // 0 → 1
      const scale = visualRadius * Math.max(0.05, 1 - t);
      if (tiltGroup) {
        // Sin inclinación durante la caída (nunca la tuvo): el pivote vuelve
        // a identidad y `body.position.set` de abajo, que sigue escribiendo
        // coordenadas de MUNDO como siempre, vuelve a ser válido tal cual.
        tiltGroup.position.set(0, 0, 0);
        tiltGroup.quaternion.identity();
      }
      if (body) {
        body.visible = true;
        body.position.set(x, visualRadius * (1 - t) - 0.4 * t, z);
        body.rotation.set(0, 0, 0);
        body.scale.setScalar(scale);
      }
      if (shadow) shadow.visible = false;
      if (candleGroupRef.current) candleGroupRef.current.visible = false;
      prevSpeed.current = 0;
      return;
    }

    const speed = Math.hypot(hero.velocity.x, hero.velocity.y);

    // Squash de impacto: frenada brusca entre frames (rebote/embestida).
    if (prevSpeed.current - speed > SQUASH_DECEL_THRESHOLD) {
      squashUntil.current = world.time + SQUASH_DURATION;
    }
    prevSpeed.current = speed;

    // Capa de CERA persistente (ver WAX_TRAIL_COLOR arriba): emisión por
    // DISTANCIA recorrida, SIN umbral de velocidad — "un rastro de todos los
    // movimientos que ha hecho", no solo de los sprints.
    if (world.phase === 'playing') {
      const stepDist = Math.hypot(x - waxPrevX.current, z - waxPrevZ.current);
      if (stepDist < WAX_TELEPORT_GUARD) {
        waxAccumulator.current += stepDist;
        while (waxAccumulator.current >= HERO_WAX_EMIT_DISTANCE) {
          waxAccumulator.current -= HERO_WAX_EMIT_DISTANCE;
          session.effects.wax.emit(
            x,
            z,
            HERO_RADIUS * WAX_TRAIL_SIZE_FACTOR,
            WAX_TRAIL_COLOR.r,
            WAX_TRAIL_COLOR.g,
            WAX_TRAIL_COLOR.b,
            // Tipo de rastro según el arma activa (VFX_PLAN, Problema 2:
            // "cada arma deja su propio rastro") — mismo mapeo que
            // WEAPON_COLOR/targetColor de arriba, solo que aquí decide la
            // FORMA del depósito, no su color (el color del rastro del
            // propio héroe se queda fijo en WAX_TRAIL_COLOR a propósito, ver
            // su comentario).
            hero.weaponMode === 'arrow' ? WAX_TYPE_FROST : hero.weaponMode === 'spell' ? WAX_TYPE_ARCANE : WAX_TYPE_WAX,
          );
        }
      }
    } else {
      waxAccumulator.current = 0;
    }
    waxPrevX.current = x;
    waxPrevZ.current = z;

    // Parpadeo de i-frames: alterna visibilidad a frecuencia fija.
    const invulnerable = world.time < hero.invulnerableUntil;
    const blinkOn = !invulnerable || Math.floor(world.time * IFRAME_BLINK_HZ) % 2 === 0;

    // Saltito de victoria: ver comentario de VICTORY_HOP_HEIGHT más arriba.
    const victoryHop =
      world.phase === 'boss-victory-pause' ? Math.abs(Math.sin(world.time * VICTORY_HOP_FREQUENCY)) * VICTORY_HOP_HEIGHT : 0;

    const squashing = world.time < squashUntil.current;

    // Héroe = vela inclinándose hacia la dirección de movimiento (punto 1 de
    // playtest ronda 4): `tiltGroup` vive en el PIVOTE (la base de la vela,
    // ver CANDLE_PIVOT_HEIGHT_FRACTION) y es el único que carga x/z/
    // victoryHop y la rotación de inclinación; `body` (hijo) solo recibe su
    // escala de squash/estiramiento y una posición LOCAL que mantiene su base
    // siempre pinchada al pivote, pase lo que pase con esa escala.
    if (tiltGroup) {
      tiltGroup.position.set(x, visualRadius * CANDLE_PIVOT_HEIGHT_FRACTION + victoryHop, z);

      // Inclinación de apuntado (ver CANDLE_AIM_TILT_MAX arriba) vs.
      // inclinación de vuelo por velocidad: exclusivas, la de apuntado gana
      // solo mientras se apunta parado o casi.
      const aim = session.aim;
      const aiming = world.heroAiming && speed < CANDLE_AIM_TILT_SPEED_THRESHOLD && aim.force > 0;
      let targetLeanX = 0;
      let targetLeanZ = 0;
      if (aiming) {
        // Signo INVERTIDO respecto al lanzamiento (playtest ronda 6): al
        // apuntar, la vela se echa HACIA ATRÁS como la goma de un
        // tirachinas tensándose; al soltar, la inclinación de vuelo la
        // lleva hacia delante — anticipación → acción.
        const aimAngle = CANDLE_AIM_TILT_MAX * aim.force;
        targetLeanX = -aim.dirX * aimAngle;
        targetLeanZ = -aim.dirY * aimAngle;
      } else if (speed > 1e-4) {
        const targetAngle = Math.min(CANDLE_TILT_MAX, speed * CANDLE_TILT_PER_SPEED);
        targetLeanX = (hero.velocity.x / speed) * targetAngle;
        targetLeanZ = (hero.velocity.y / speed) * targetAngle;
      }
      const tiltK = 1 - Math.exp(-CANDLE_TILT_LERP_STIFFNESS * delta);
      const lean = candleLean.current;
      lean.x += (targetLeanX - lean.x) * tiltK;
      lean.z += (targetLeanZ - lean.z) * tiltK;

      const angle = Math.hypot(lean.x, lean.z);
      if (angle > 1e-4) {
        // Eje horizontal perpendicular a la dirección de inclinación
        // (derivado con la fórmula de Rodrigues para que el TOP del
        // cilindro se incline hacia (lean.x, lean.z)): con lean = ángulo ·
        // dirección unitaria, axis = normalize(lean.z, 0, -lean.x).
        candleTiltAxis.current.set(lean.z / angle, 0, -lean.x / angle);
        candleTiltQuat.current.setFromAxisAngle(candleTiltAxis.current, angle);
        tiltGroup.quaternion.copy(candleTiltQuat.current);
      } else {
        tiltGroup.quaternion.identity();
      }
    }

    if (body) {
      body.visible = blinkOn;
      body.rotation.set(0, 0, 0); // el cilindro es de revolución: el yaw no cambia su silueta

      let scaleXZ: number;
      let scaleY: number;
      if (squashing) {
        // Mismo aplastamiento de impacto que ya existía (SQUASH_FLATTEN),
        // aplicado ahora al cilindro en vez de a la esfera.
        const widen = 1 / Math.sqrt(SQUASH_FLATTEN);
        scaleXZ = visualRadius * widen;
        scaleY = visualRadius * SQUASH_FLATTEN;
      } else {
        // Estiramiento vertical con la velocidad (punto 1 de playtest ronda
        // 4): "lanzada", sin tocar el radio. Amplificado por la Estela de
        // Cometa (F5) igual que hacía el estiramiento de la esfera clásica —
        // mismo upgrade, mismo criterio, solo cambia el eje.
        const stretchBonus =
          Math.min(CANDLE_VERTICAL_STRETCH_MAX, speed * CANDLE_VERTICAL_STRETCH_PER_SPEED) * cometFactor;
        scaleXZ = visualRadius;
        scaleY = visualRadius * (1 + stretchBonus);
      }
      body.scale.set(scaleXZ, scaleY, scaleXZ);
      // La base del cilindro (a -CANDLE_HALF_HEIGHT en su espacio local) debe
      // quedar SIEMPRE en el origen de `tiltGroup` (el pivote): se compensa
      // la posición local con la mitad de la altura ACTUAL, así ni el squash
      // ni el estiramiento la despegan del suelo ni la hunden.
      body.position.set(0, scaleY * CANDLE_HALF_HEIGHT, 0);
    }

    if (shadow) {
      shadow.visible = true;
      shadow.position.set(x, 0.02, z);
    }

    // Héroe = vela: la llama/ojos siguen al cuerpo (posición e inclinación,
    // vía `tiltGroup`, su padre común) pero NUNCA su squash/estiramiento —
    // grupo aparte, actualizado a mano.
    const candleGroup = candleGroupRef.current;
    if (candleGroup) {
      candleGroup.visible = blinkOn;
      // Local a `tiltGroup` (que ya lleva x/z/pivote e inclinación): solo
      // la altura de anclaje de la llama/ojos respecto al pivote de la
      // base, elegida para que la altura ABSOLUTA de la llama/ojos no
      // cambie ni un milímetro respecto a como se veía antes de este
      // cambio (ver comentario de CANDLE_PIVOT_HEIGHT_FRACTION).
      candleGroup.position.set(0, visualRadius * (1 - CANDLE_PIVOT_HEIGHT_FRACTION), 0);
    }
    // Ancla de la llama compartida (ver comentario grande más arriba y
    // `CandleFlame.tsx`): solo posición (la boca de la vela, escalada por
    // `visualRadius` para que suba/baje con Firmeza igual que el resto del
    // cuerpo) y escala — `CandleFlame`, dentro, resuelve billboard, adelanto
    // hacia cámara, vaivén y pulso por sí sola cada frame, así que aquí no
    // hace falta tocar nada más. Nunca hace falta `.visible`: hereda el
    // `blinkOn` de `candleGroup`, su padre, como los ojos.
    const flameAnchor = flameAnchorRef.current;
    if (flameAnchor) {
      flameAnchor.position.set(0, visualRadius * CANDLE_FLAME_ANCHOR_Y, 0);
      flameAnchor.scale.setScalar(visualRadius);
    }

    // Mirada de los ojos (punto 3b de playtest ronda 8): apuntando >
    // bloqueo de disparo de proyectil > en movimiento > último ángulo
    // válido (parado, ver comentario de EYE_FACE_LERP_STIFFNESS arriba).
    // Reutiliza `speed`/`aim` ya calculados en este mismo useFrame.
    const aimForEyes = session.aim;

    // Detecta un disparo de arrow/spell recién resuelto por la sim (ver
    // PROJECTILE_FACE_LOCK_DURATION arriba): lastArrowTime/lastSpellTime
    // cambian a world.time SOLO dentro de fireProjectile (combat.ts), nunca
    // en launchHero, así que esto nunca se activa para el cuerpo. Se fija el
    // ángulo objetivo al de `aim` en ESE MOMENTO (aim.dirX/dirY no se tocan
    // al soltar, solo aim.active — ver AimInput.tsx), la dirección real del
    // disparo, no la del retroceso.
    if (prevLastArrowTime.current !== null && hero.lastArrowTime !== prevLastArrowTime.current) {
      projectileFaceLockAngle.current = Math.atan2(aimForEyes.dirX, aimForEyes.dirY);
      projectileFaceLockUntil.current = world.time + PROJECTILE_FACE_LOCK_DURATION;
    }
    if (prevLastSpellTime.current !== null && hero.lastSpellTime !== prevLastSpellTime.current) {
      projectileFaceLockAngle.current = Math.atan2(aimForEyes.dirX, aimForEyes.dirY);
      projectileFaceLockUntil.current = world.time + PROJECTILE_FACE_LOCK_DURATION;
    }
    prevLastArrowTime.current = hero.lastArrowTime;
    prevLastSpellTime.current = hero.lastSpellTime;

    let targetFaceAngle: number | null = null;
    if (world.heroAiming && aimForEyes.force > 0) {
      targetFaceAngle = Math.atan2(aimForEyes.dirX, aimForEyes.dirY);
    } else if (world.time < projectileFaceLockUntil.current) {
      targetFaceAngle = projectileFaceLockAngle.current;
    } else if (speed > EYE_FACE_SPEED_THRESHOLD) {
      targetFaceAngle = Math.atan2(hero.velocity.x, hero.velocity.y);
    }
    if (targetFaceAngle !== null) {
      candleFaceAngle.current = dampAngleTowards(
        candleFaceAngle.current,
        targetFaceAngle,
        EYE_FACE_LERP_STIFFNESS,
        delta,
      );
    }
    if (eyeGroupRef.current) eyeGroupRef.current.rotation.y = candleFaceAngle.current;
  });

  return (
    <>
      <group ref={candleTiltGroupRef}>
        {/*
          Cuerpo, silueta de oclusión, ojos y llama: componente COMPARTIDO
          con Lumora (`./CandleModel.tsx`, encargo de David 2026-08-18:
          "debería haber un componente que lo pinte todo, tanto en el título
          como en el juego"). Se le pasan las refs porque el héroe SÍ
          necesita seguir animando estas piezas cada frame —squash/
          estiramiento y parpadeo de i-frames en el cuerpo (`bodyRef`),
          reescalado del ancla de la llama por Firmeza (`candleGroupRef`/
          `flameAnchorRef`), yaw de la mirada (`eyeGroupRef`), todo en el
          `useFrame` de arriba—; Lumora monta el mismo componente sin ninguna
          de las cuatro. `scale={HERO_RADIUS}` es solo el valor INICIAL
          (igual que antes lo era `scale={HERO_RADIUS}` en el `<mesh>` del
          cuerpo): el `useFrame` de arriba lo sobreescribe cada frame vía las
          refs con `visualRadius`, nunca con números propios — la posición
          RELATIVA de cada pieza (dónde cae la boca, dónde el ancla de la
          llama, dónde los ojos) la fija el componente, este fichero solo
          decide la escala absoluta en vivo.
        */}
        <CandleModel
          scale={HERO_RADIUS}
          bodyRef={bodyRef}
          candleGroupRef={candleGroupRef}
          flameAnchorRef={flameAnchorRef}
          eyeGroupRef={eyeGroupRef}
        >
          {/* Pinchos del Erizo de Acero (F5): 12 pre-creados, visibilidad por nivel. */}
          {SPIKE_DIRECTIONS.map((_, i) => (
            <mesh
              key={i}
              ref={(el) => {
                spikeRefs.current[i] = el;
              }}
              geometry={heroSpikeGeometry}
              material={heroSpikeMaterial}
              visible={false}
            />
          ))}
          {/* Burbuja de Cuarzo (F5): visible mientras haya cargas de escudo. */}
          <mesh ref={shieldRef} geometry={unitSphere} material={heroShieldMaterial} scale={SHIELD_BUBBLE_SCALE} visible={false} />
        </CandleModel>
      </group>
      <mesh
        ref={shadowRef}
        geometry={unitCircle}
        material={blobShadowMaterial}
        rotation-x={-Math.PI / 2}
        // Silueta: sombra blob al radio real del cilindro. Ronda 7: el radio
        // local de `heroCandleGeometry` vuelve a 1 (como la esfera clásica),
        // así que el multiplicador ×1.0 de siempre ya coincide exactamente
        // con el nuevo radio visual — no hace falta tocarlo.
        scale={HERO_RADIUS * 1.0}
      />
    </>
  );
}
