/**
 * Proyectiles: pool preasignado de meshes (uno por slot de `world.projectiles`,
 * nunca se crean/destruyen, solo se muestran/ocultan). Cada slot reserva de
 * antemano las tres formas posibles (flecha/hechizo/enemigo) y solo activa la
 * que toque; un slot puede reciclarse de un `kind`/`owner` a otro entre
 * disparos, así que la forma visible y su escala se deciden en useFrame,
 * nunca por props JSX estáticas (el radio del hechizo puede cambiar con la
 * mejora "Hechizo Arcano").
 *
 * Formas (feedback de playtest):
 * - Flecha/Hielo (arma `arrow`, "Hielo" en la UI desde 2026-08-11 — antes
 *   "Fuego", ver WeaponBar.tsx): CONO grande como cuerpo dominante (ronda 3,
 *   punto 3: "las flechas apenas se ven, puedes usar un cono" — mucho más
 *   ancho que el fino asta+punta de la ronda anterior, que seguía sin leerse
 *   bien en móvil) + un asta corta detrás para dar sensación de proyectil
 *   alargado, orientado según su velocidad (rotación en el plano XZ). Desde
 *   2026-08-11 (David: el proyectil siempre fue azul hielo, incoherente con
 *   "Fuego" — el concepto pasa a ser hielo) el cono usa `arrowCrystalGeometry`
 *   (5 segmentos radiales, MUY pocos) en vez del `unitCone` liso de 12, con
 *   `arrowMaterial` en `flatShading` para que se note el tallado, más 2
 *   esquirlas estáticas (`spellSparkGeometry`) incrustadas en su superficie
 *   para romper la simetría de revolución — MISMO volumen aparente que
 *   antes (sin adelgazar: la legibilidad en móvil de la ronda 3 sigue
 *   aplicando). Proporciones a radio unitario; el GRUPO se escala por
 *   `p.radius` cada frame (nunca se recrea geometría).
 * - Hechizo (ronda 3, punto 11: "quita la bola, haz el rayo más grande"): SIN
 *   núcleo esférico — solo el zigzag eléctrico (más ancho/largo que antes) +
 *   chispas violeta en la estela, jitter determinista por frame a partir de
 *   world.time + índice de slot, SIN asignaciones.
 *
 * Presupuesto: nada de `new` en useFrame; el zigzag/chispas usan un número
 * FIJO de sub-meshes por slot (creados una vez en el JSX), mutados con
 * position/rotation/scale/visible cada frame.
 *
 * Identificador visual de mejoras (F5, docs/plans/ECONOMY_PLAN.md): la flecha
 * se ensancha por nivel de Colmillo de Hierro (flecha-dano) — SOLO en la
 * escala transversal (ejes X/Y del grupo, perpendiculares al vuelo), nunca en
 * el largo. El hechizo (Orbe Voraz / hechizo-dano) NO tiene lógica propia
 * aquí: su radio de sim ya crece con `spellRadiusBonus` (`p.radius`, ver
 * combat.ts) y `spellGroup.scale.setScalar(p.radius)` de más abajo ya lo
 * refleja — añadir otro factor duplicaría el efecto.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group, Mesh } from 'three';
import type { GameSession } from '@/game/session/session';
import type { Projectile } from '@/game/world/types';
import { getUpgradeLevel } from '@/game/session/upgrades';
import { arrowCrystalGeometry, arrowMaterial, arrowShaftGeometry, arrowTipMaterial, enemyProjectileGlowHaloMaterialForTag, enemyProjectileMaterial, enemyProjectileMaterialForTag, glowPuddleMaterial, spellBoltMaterial, spellBoltSegmentGeometry, spellSparkGeometry, spellSparkMaterial, unitSphere, WEAPON_COLOR } from '@/game/render/assets';
import { GLOW_PUDDLE_GROUND_Y, GlowPuddle } from '@/game/render/GlowPuddle';
import { STREAK_TYPE_ARCANE, STREAK_TYPE_FROST } from '@/game/features/effects/streaks';
import { touchesExplodedBarrel, WALL_MARK_TYPE_ARCANE, WALL_MARK_TYPE_FROST, wallNormalAt } from '@/game/features/effects/wallmarks';
import { arrowWidthScaleForLevel } from './upgrade-visuals';

/**
 * Luz de proyectil (punto 3 de playtest: "los ataques de flecha y hechizo
 * deben emitir luz también") — ELIMINADA (rama `luces-optimizadas`, recorte
 * de luces reales de la escena de ~43 a 7): antes vivía aquí
 * `ProjectileLightPool`, un pool FIJO de 6 pointLight reasignadas cada frame
 * por prioridad (rediseño previo, playtest: "cuando el boss lanza muchos
 * proyectiles el rendimiento baja un montón" — un pool por slot recompilaba
 * shaders sin parar durante un bullet hell). Ahora NINGÚN proyectil emite luz
 * real: el halo aditivo que antes solo llevaba el proyectil ENEMIGO
 * (`glowHaloTexture` pegado al suelo, indistinguible de una luz real desde la
 * cámara cenital y coste ~0) se generaliza a TODO proyectil, incluido el del
 * héroe, vía el componente reutilizable `GlowPuddle`
 * (`render/GlowPuddle.tsx`) — ver el halo único de `ProjectileSlot` más
 * abajo. El cuerpo del proyectil compensa la pérdida de su pointLight con más
 * `emissive` propio (`arrowMaterial`, ajustado en `assets-dark.ts`;
 * `spellBoltMaterial` ya es `MeshBasicMaterial`, autoiluminado de fábrica, no
 * necesita el mismo tratamiento).
 */
const PROJECTILE_HALO_RADIUS = 0.6;
/** Opacidad del halo del proyectil del HÉROE (arrow/spell): mismo valor que ram/arrow/spell-tag en el halo de proyectil enemigo (`assets.ts`) — bajada de 0.16 a 0.13 junto con el resto de halos aditivos (VFX_PLAN T0, ver el comentario largo sobre `enemyProjectileGlowHaloMaterials` en `assets.ts`: el nuevo mapa `circle_c.png` tiene el núcleo más concentrado que el degradado de canvas anterior). */
const PROJECTILE_HERO_HALO_OPACITY = 0.13;
/**
 * Altura Y del centro del proyectil (mismo valor que `group.position.set` en
 * `ProjectileSlot`): ya no es "altura de luz" (no queda ninguna), pero el
 * halo sigue necesitando cancelarla para quedar pegado al suelo (ver abajo).
 */
const PROJECTILE_GROUP_HEIGHT = 0.3;
/**
 * Altura LOCAL del halo dentro del group del slot (que vive a
 * `PROJECTILE_GROUP_HEIGHT`=0.3 de mundo): offset negativo para dejarlo a
 * `GLOW_PUDDLE_GROUND_Y` de mundo (mismo criterio que `ItemView.tsx`).
 */
const PROJECTILE_HALO_LOCAL_Y = GLOW_PUDDLE_GROUND_Y - PROJECTILE_GROUP_HEIGHT;

/**
 * Tamaño VISUAL de los proyectiles (playtest: "los proyectiles mejor un
 * poco más pequeños"), ~20% menos — SOLO afecta a la escala del mesh de
 * render (`arrowGroup`/`spellGroup`/`enemyBody`, más abajo); `p.radius`
 * (radio de colisión de la sim, `combat.ts`) no se toca. Aplica a los 3
 * `kind` en todos los modos (dark 0/1/2).
 */
const PROJECTILE_VISUAL_SCALE = 0.8;

/**
 * Rastro de proyectiles del héroe (playtest 2026-07-20, David: "cuando
 * dispares con proyectiles, deja cera de ese color") — REDISEÑO 2026-08-13
 * (David: "el rastro de los proyectiles podría ser una sola textura
 * orientada en la dirección del disparo, [...] cuando salen varios no se ve
 * bien qué es lo que deja en el suelo, sale confuso [...] uno solo que
 * empiece en el origen del disparo y acabe donde rebota, y vuelva a empezar
 * ahí y terminar donde acaba"): ya NO deposita marcas sueltas en
 * `session.effects.wax` (esa capa sigue siendo EXCLUSIVA del rastro del
 * héroe, sin tocar — `HeroView.tsx`/`wax.ts`/`WaxView.tsx`). Flecha y hechizo
 * abren/estiran/cierran un trazo por TRAMO RECTO en `session.effects.streaks`
 * (`features/effects/streaks.ts`, pool NUEVO e independiente), con color del
 * arma activa (`WEAPON_COLOR`) — ver `STREAK_*` más abajo y la cabecera de
 * `streaks.ts` para el ciclo de vida completo open()/update(). Igual que
 * antes, todo esto ocurre aquí (render, `useFrame` de `ProjectileSlot`, mismo
 * sitio donde ya se itera cada proyectil por frame) y NUNCA en la sim
 * (combat.ts stepea física/daño, no efectos).
 */
/** Ancho BASE del trazo como fracción de `p.radius` (el pool varía esto ±25%, ver `streaks.ts`): orden de magnitud del grosor visual del proyectil (cono de Hielo/zigzag del Hechizo), para que el rastro se lea como su estela real. */
const PROJECTILE_STREAK_WIDTH_FACTOR = 1.1;

/**
 * Marca de impacto en muro (encargo de David: "añade una marca en la pared
 * donde impacten los proyectiles" — ver `features/effects/wallmarks.ts` para
 * el pool y la cabecera larga sobre por qué la normal se calcula por
 * geometría de solo lectura, `wallNormalAt`, en vez de comparar velocidad
 * antes/después: cubre por igual el REBOTE (velocidad "después" real) y el
 * IMPACTO FINAL (flecha, o el último rebote del hechizo — ahí `p.velocity`
 * ya está a (0,0) cuando el render vuelve a leer el proyectil) sin arriesgar
 * una marca flotando en mitad de la sala cuando el proyectil muere contra un
 * ENEMIGO en vez de un muro. Llamada desde DOS sitios de `ProjectileSlot` más
 * abajo: el rebote detectado por `bounced` (mismo `if` que cierra/abre el
 * trazo) y la transición activo→inactivo de un proyectil que estaba siendo
 * seguido por el trazo (streakIndex.current !== -1 en el frame anterior).
 * Función de MÓDULO (no closure dentro de useFrame) para no asignar memoria
 * por frame.
 *
 * BARRIL (playtest, David: "las manchas en los assets como piedras salen muy
 * desplazadas" — un barril, visualmente, es tan "asset con volumen" como una
 * roca): `touchesExplodedBarrel` corta ANTES de consultar `wallNormalAt`, ver
 * su docstring en wallmarks.ts. Sin este corte, un proyectil detenido por un
 * barril caía al criterio normal de `wallNormalAt` — casi siempre sin
 * ninguna superficie cerca (sin marca, inofensivo), pero si el barril estaba
 * junto a una roca o al muro exterior, encontraba ESA superficie y dejaba una
 * marca ahí, potencialmente lejos del barril real que de verdad paró el
 * proyectil (y el barril, reventado, ya no tiene volumen que la sostenga).
 */
function spawnWallMarkForImpact(session: GameSession, p: Projectile): void {
  const world = session.world;
  if (touchesExplodedBarrel(p.position.x, p.position.y, p.radius, world.barrels)) return;
  const normal = wallNormalAt(
    p.position.x,
    p.position.y,
    p.radius,
    world.obstacles,
    world.dungeon === null ? world.bounds : null,
  );
  if (!normal) return; // No tocaba ningún muro/roca: murió por otra causa (enemigo, TTL) — sin marca.
  // La marca va sobre la SUPERFICIE, no en el centro del proyectil: la física
  // deja `p.position` a `p.radius` EXACTO de la cara tocada (es lo que hace
  // `collideCircleAabb` al empujarlo fuera), así que usar esa posición tal cual
  // dejaba la mancha flotando 0.18 u por delante de la pared — el "están un
  // poco despegadas" de David (2026-08-14). Se retrocede el radio a lo largo de
  // la normal para posarla en la cara; el margen mínimo contra el z-fighting lo
  // sigue añadiendo `WALL_MARK_SURFACE_OFFSET` en la vista.
  session.effects.wallMarks.spawn(
    p.position.x - normal.x * p.radius,
    PROJECTILE_GROUP_HEIGHT,
    p.position.y - normal.z * p.radius,
    normal.x,
    normal.z,
    p.kind === 'arrow' ? WALL_MARK_TYPE_FROST : WALL_MARK_TYPE_ARCANE,
  );
}

type ProjectileKind = Projectile['kind'];

// Proporciones de la flecha a radio unitario (el grupo se escala por
// p.radius): CONO grande como cuerpo dominante (mucho más ancho que el fino
// asta+punta anterior), con un asta corta detrás para dar sentido de
// proyectil alargado en vuelo. SIN CAMBIOS al pasar a cristal de hielo
// (2026-08-11): son las medidas que ya garantizaban legibilidad en móvil
// (ronda 3 de playtest) y las esquirlas nuevas se AÑADEN sobre este volumen,
// nunca lo sustituyen — ver ARROW_SHARDS más abajo.
const ARROW_CONE_LENGTH = 2.2;
const ARROW_CONE_THICKNESS = 2.6;
const ARROW_SHAFT_LENGTH = 1.6;
const ARROW_SHAFT_THICKNESS = 0.9;

/**
 * Esquirlas del cristal de hielo: tetraedros pequeños y ESTÁTICOS (mismo
 * `spellSparkGeometry` unitario que ya usa el hechizo para sus chispas de
 * estela, ver assets.ts — aquí sin animación) incrustados en la superficie
 * del cono central, mitad dentro/mitad asomando (mismo criterio que
 * `heroSpikeGeometry`, ver su comentario en assets.ts). Su única función es
 * romper la simetría de revolución del cono con astillas irregulares —
 * "cristal tallado a mano", no un cono limpio. Coordenadas calculadas a
 * mano: el radio del cono decrece linealmente desde ARROW_CONE_THICKNESS/2
 * en la base (z=0) hasta 0 en la punta (z=ARROW_CONE_LENGTH), así que cada
 * entrada usa un (x,y) cuyo módulo ronda el radio del cono en su propia z.
 * Sin useFrame propio: giran/escalan como bloque rígido junto con el resto
 * de `arrowGroup` (orientación de vuelo + escala por nivel de mejora).
 */
const ARROW_SHARDS: { position: [number, number, number]; rotation: [number, number, number]; scale: number }[] = [
  { position: [0.85, 0.42, 0.5], rotation: [0.5, 1.1, 0.3], scale: 0.65 },
  { position: [-0.55, -0.4, 1.05], rotation: [1.3, -0.4, 0.9], scale: 0.5 },
];

/** Nº de segmentos del zigzag eléctrico por proyectil de hechizo. */
const SPELL_BOLT_SEGMENTS = 5;
/** Longitud total del zigzag a radio unitario (delante y detrás del centro): más grande (punto 11). */
const SPELL_BOLT_LENGTH = 3.2;
/** Amplitud del jitter lateral del zigzag a radio unitario: más ancho (punto 11). */
const SPELL_BOLT_JITTER = 0.85;
/** Grosor de cada segmento del zigzag (antes 0.045 a radio unitario del proyectil: casi invisible). */
const SPELL_BOLT_THICKNESS = 0.16;
/** Nº de chispas de estela por proyectil de hechizo. */
const SPELL_SPARK_COUNT = 4;
/** Cuánto se alargan las chispas por detrás del centro, a radio unitario. */
const SPELL_SPARK_TRAIL = 3.4;

/** Hash determinista barato, sin estado: dos enteros → [-1,1]. Sin Math.random. */
function jitter11(a: number, b: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Cristal de hielo del arma `arrow` ("Hielo" en la UI, antes "Fuego" — ver
 * WeaponBar.tsx): cono facetado (`arrowCrystalGeometry`, 5 caras, cuerpo
 * dominante claramente visible) + asta corta detrás + esquirlas estáticas
 * incrustadas en la superficie (ARROW_SHARDS), proporciones a radio unitario
 * (el grupo padre se escala por p.radius). El cono apunta en +Z local (la
 * punta hacia delante, en la dirección de movimiento — ProjectileSlot alinea
 * +Z con la velocidad).
 */
function ArrowShape() {
  return (
    <>
      <mesh
        geometry={arrowCrystalGeometry}
        material={arrowMaterial}
        position={[0, 0, ARROW_CONE_LENGTH / 2]}
        rotation-x={Math.PI / 2}
        scale={[ARROW_CONE_THICKNESS, ARROW_CONE_LENGTH, ARROW_CONE_THICKNESS]}
      />
      <mesh
        geometry={arrowShaftGeometry}
        material={arrowTipMaterial}
        position={[0, 0, -ARROW_SHAFT_LENGTH / 2]}
        rotation-x={Math.PI / 2}
        scale={[ARROW_SHAFT_THICKNESS, ARROW_SHAFT_LENGTH, ARROW_SHAFT_THICKNESS]}
      />
      {ARROW_SHARDS.map((shard, i) => (
        <mesh
          key={i}
          geometry={spellSparkGeometry}
          material={arrowTipMaterial}
          position={shard.position}
          rotation={shard.rotation}
          scale={shard.scale}
        />
      ))}
    </>
  );
}

/** Hechizo: núcleo + zigzag eléctrico + chispas, proporciones a radio unitario. */
function SpellShape({ session, slotIndex }: { session: GameSession; slotIndex: number }) {
  const boltRefs = useRef<(Mesh | null)[]>([]);
  const sparkRefs = useRef<(Mesh | null)[]>([]);
  const segDepth = spellBoltSegmentGeometry.parameters.depth as number;
  const segBaseThickness = spellBoltSegmentGeometry.parameters.width as number;
  const boltThicknessScale = SPELL_BOLT_THICKNESS / segBaseThickness;

  useFrame((state) => {
    const p = session.world.projectiles[slotIndex];
    if (!p.active || p.kind !== 'spell') return;
    const t = state.clock.elapsedTime;

    // Zigzag: segmentos encadenados en Z local, cada uno con desplazamiento
    // lateral (X) oscilante — jitter determinista por segmento y por slot
    // (sin Math.random), sin asignaciones.
    const step = SPELL_BOLT_LENGTH / SPELL_BOLT_SEGMENTS;
    let prevX = 0;
    let prevZ = -SPELL_BOLT_LENGTH / 2;
    for (let i = 0; i < SPELL_BOLT_SEGMENTS; i++) {
      const seg = boltRefs.current[i];
      if (!seg) continue;
      const z = -SPELL_BOLT_LENGTH / 2 + step * (i + 1);
      const wobble = Math.sin(t * 22 + slotIndex * 7 + i * 2.3) * SPELL_BOLT_JITTER;
      const x = i === SPELL_BOLT_SEGMENTS - 1 ? 0 : wobble;
      const midX = (prevX + x) / 2;
      const midZ = (prevZ + z) / 2;
      const dx = x - prevX;
      const dz = z - prevZ;
      const len = Math.hypot(dx, dz);
      seg.position.set(midX, 0, midZ);
      seg.rotation.set(0, Math.atan2(dx, dz), 0);
      seg.scale.set(boltThicknessScale, boltThicknessScale, len / segDepth);
      prevX = x;
      prevZ = z;
    }
    // Chispas: puntitos deterministas en la estela (Z negativa), con leve
    // deriva lateral/temporal para que parpadeen sin asignar nada.
    for (let i = 0; i < SPELL_SPARK_COUNT; i++) {
      const spark = sparkRefs.current[i];
      if (!spark) continue;
      const phase = jitter11(slotIndex * 11 + i * 5, 3);
      const trailT = ((t * 3 + i / SPELL_SPARK_COUNT) % 1) * SPELL_SPARK_TRAIL;
      spark.position.set(phase * SPELL_BOLT_JITTER * 0.7, Math.sin(t * 9 + i) * 0.15, -SPELL_BOLT_LENGTH / 2 - trailT);
      const fade = 1 - trailT / SPELL_SPARK_TRAIL;
      spark.scale.setScalar(0.4 * fade);
    }
  });

  return (
    <>
      {/* Punto 11 de playtest ronda 3: sin núcleo esférico — solo energía/rayo. */}
      {Array.from({ length: SPELL_BOLT_SEGMENTS }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            boltRefs.current[i] = el;
          }}
          geometry={spellBoltSegmentGeometry}
          material={spellBoltMaterial}
        />
      ))}
      {Array.from({ length: SPELL_SPARK_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            sparkRefs.current[i] = el;
          }}
          geometry={spellSparkGeometry}
          material={spellSparkMaterial}
        />
      ))}
    </>
  );
}

function ProjectileSlot({ session, index }: { session: GameSession; index: number }) {
  const groupRef = useRef<Group>(null);
  const arrowGroupRef = useRef<Group>(null);
  const spellGroupRef = useRef<Group>(null);
  const enemyBodyRef = useRef<Mesh>(null);
  const haloRef = useRef<Mesh>(null);
  const lastKind = useRef<ProjectileKind | null>(null);
  // Rastro de proyectiles (ver cabecera del fichero): índice del trazo
  // ABIERTO de este slot en `session.effects.streaks`, o -1 si ninguno, más
  // el origen (mundo) del tramo actual — `StreakPool` no lo conserva (ver su
  // cabecera), así que vive aquí, junto al índice, en las refs del propio
  // slot de proyectil.
  const streakIndex = useRef(-1);
  const streakOriginX = useRef(0);
  const streakOriginZ = useRef(0);
  // Detectan, sin ambigüedad, "esto es un vuelo DISTINTO al que ocupaba este
  // slot" incluso si el slot se recicla para un disparo nuevo dentro del
  // mismo tick de sim SIN pasar por un frame con `p.active=false` por medio
  // (`acquireProjectile` reutiliza el primer slot libre por índice, así que
  // el reciclaje inmediato es plausible, no un caso de laboratorio — ver
  // combat.ts). `ttl` SOLO decrece durante la vida de un proyectil
  // (`stepProjectiles`: `p.ttl -= dt`, y otro `-= 0.4` en cada rebote), así
  // que un valor mayor que el último visto es prueba inequívoca de un
  // proyectil nuevo en este slot.
  const lastTtl = useRef(0);
  // `bouncesLeft` (world/types.ts) es el contador de rebotes DE VERDAD de la
  // sim (decrece SOLO en `stepHeroProjectileCollisions` al rebotar contra
  // pared/roca, combat.ts) — se prefiere a inferir el rebote por el cambio
  // brusco de dirección de la velocidad (el rebote además la amortigua por
  // SPELL_BOUNCE_FACTOR, así que un "cambio brusco" sería más ambiguo de
  // umbralizar) y a escuchar el evento 'projectile-wall' (que TAMBIÉN se
  // emite cuando el proyectil MUERE contra la pared, no solo cuando rebota —
  // distinguir ambos casos desde el evento exigiría replicar aquí la misma
  // condición `bouncesLeft > 0` que ya decide combat.ts, así que leer el
  // contador directamente es más simple y no puede desincronizarse). La
  // flecha nunca rebota (`bouncesLeft` siempre 0 para 'arrow'), así que esta
  // comparación nunca se dispara para ella — coherente con que solo el
  // Hechizo rebota hoy.
  const lastBounces = useRef(0);

  useFrame(() => {
    const p = session.world.projectiles[index];
    const group = groupRef.current;
    if (!group) return;
    if (!p.active) {
      // Impacto FINAL contra un muro (flecha siempre, o el último rebote del
      // hechizo sin bouncesLeft): solo si ESTE slot venía siendo seguido como
      // vuelo de arco/hechizo del héroe (streakIndex.current !== -1, fijado
      // en el frame anterior) — evita comprobar geometría en slots inactivos
      // sin dueño o proyectiles enemigos, que nunca dejan marca. Ver
      // `spawnWallMarkForImpact` para por qué no basta esta transición sola
      // (necesita además que `p.position` toque de verdad un muro).
      if (streakIndex.current !== -1) {
        spawnWallMarkForImpact(session, p);
      }
      group.visible = false;
      streakIndex.current = -1;
      return;
    }
    group.visible = true;
    group.position.set(p.position.x, PROJECTILE_GROUP_HEIGHT, p.position.y);

    // Orientación: alinea el eje +Z local (asta de flecha / eje del hechizo)
    // con la dirección de movimiento.
    const speed = Math.hypot(p.velocity.x, p.velocity.y);
    if (speed > 0.01) {
      group.rotation.y = Math.atan2(p.velocity.x, p.velocity.y);
    }

    if (lastKind.current !== p.kind) lastKind.current = p.kind;

    // Rastro de proyectiles del héroe (arrow/spell): un trazo por tramo recto
    // (ver cabecera del fichero y streaks.ts). `isNewFlight` cubre TANTO el
    // nacimiento normal (frame anterior con streakIndex=-1, tras !p.active)
    // COMO el reciclaje del slot sin pasar por un frame inactivo (ver
    // `lastTtl` arriba); `bounced` solo puede dispararse si NO es un vuelo
    // nuevo, así que un `bouncesLeft` heredado de un disparo anterior nunca
    // se confunde con un rebote real de este vuelo.
    if (p.owner === 'hero' && (p.kind === 'arrow' || p.kind === 'spell')) {
      const streaks = session.effects.streaks;
      const isNewFlight = streakIndex.current === -1 || p.ttl > lastTtl.current;
      const bounced = !isNewFlight && p.bouncesLeft !== lastBounces.current;
      if (bounced) {
        // Cierra el tramo actual en el punto de rebote: posición actual, ya
        // resuelta por combat.ts (misma posición que usa el evento
        // 'projectile-wall' para el fogonazo/partículas de impacto).
        streaks.update(streakIndex.current, streakOriginX.current, streakOriginZ.current, p.position.x, p.position.y);
        // Marca de impacto en el muro contra el que acaba de rebotar (solo el
        // Hechizo llega aquí: la flecha nunca rebota, bouncesLeft siempre 0).
        spawnWallMarkForImpact(session, p);
      }
      if (isNewFlight || bounced) {
        // Nace un trazo: al disparar (isNewFlight) o justo tras cerrar el
        // anterior en el punto de rebote (bounced) — el nuevo tramo empieza
        // exactamente donde acabó el rebote, encadenados.
        const color = WEAPON_COLOR[p.kind];
        streakIndex.current = streaks.open(
          p.position.x,
          p.position.y,
          p.radius * PROJECTILE_STREAK_WIDTH_FACTOR,
          color.r,
          color.g,
          color.b,
          p.kind === 'arrow' ? STREAK_TYPE_FROST : STREAK_TYPE_ARCANE,
        );
        streakOriginX.current = p.position.x;
        streakOriginZ.current = p.position.y;
      } else {
        // Vuelo normal: estira el trazo abierto hasta la posición actual —
        // se ve crecer en vivo en vez de aparecer de golpe.
        streaks.update(streakIndex.current, streakOriginX.current, streakOriginZ.current, p.position.x, p.position.y);
      }
      lastTtl.current = p.ttl;
      lastBounces.current = p.bouncesLeft;
    } else {
      // Proyectil enemigo (o cualquier otro `kind`): no deja trazo, igual que
      // antes no dejaba cera. Suelta el índice sin tocar la geometría del
      // trazo viejo — ya quedó con su última posición válida en el último
      // frame en que SÍ calificaba (streaks.ts: "cerrar" es simplemente dejar
      // de llamar a update()).
      streakIndex.current = -1;
    }

    const arrowGroup = arrowGroupRef.current;
    if (arrowGroup) {
      arrowGroup.visible = p.kind === 'arrow';
      if (p.kind === 'arrow') {
        // Colmillo de Hierro (F5): ensancha SOLO la sección transversal
        // (X/Y del grupo), el largo (Z, dirección de vuelo) se queda en
        // p.radius (× PROJECTILE_VISUAL_SCALE, solo render — ver cabecera).
        const widthScale =
          p.radius * PROJECTILE_VISUAL_SCALE * arrowWidthScaleForLevel(getUpgradeLevel(session.world.hero, 'flecha-dano'));
        arrowGroup.scale.set(widthScale, widthScale, p.radius * PROJECTILE_VISUAL_SCALE);
      }
    }
    const spellGroup = spellGroupRef.current;
    if (spellGroup) {
      spellGroup.visible = p.kind === 'spell';
      if (p.kind === 'spell') spellGroup.scale.setScalar(p.radius * PROJECTILE_VISUAL_SCALE);
    }
    const enemyBody = enemyBodyRef.current;
    if (enemyBody) {
      enemyBody.visible = p.kind === 'enemy';
      if (p.kind === 'enemy') {
        enemyBody.scale.setScalar(p.radius * PROJECTILE_VISUAL_SCALE);
        // Tinte por-proyectil (colorTag): reasigna la REFERENCIA del
        // material (nunca muta `.color` de uno compartido, ver cabecera de
        // `assets.ts`) — mismo truco de swap que el flash de golpe de
        // EnemyViews.tsx, cero asignaciones nuevas.
        enemyBody.material = enemyProjectileMaterialForTag(p.colorTag);
      }
    }
    // Halo de "luz por bala" (ver cabecera del fichero): TODO proyectil
    // activo lo lleva ahora, no solo el enemigo — reasigna la REFERENCIA del
    // material según el dueño (mismo truco de swap que el cuerpo del
    // proyectil enemigo un poco más arriba, cero asignaciones nuevas: ambas
    // ramas devuelven un material CACHEADO). Héroe = color de su arma activa
    // (WEAPON_COLOR); enemigo = tinte por colorTag, como antes.
    const halo = haloRef.current;
    if (halo) {
      halo.visible = true;
      halo.material =
        p.kind === 'enemy'
          ? enemyProjectileGlowHaloMaterialForTag(p.colorTag)
          : glowPuddleMaterial(WEAPON_COLOR[p.kind], PROJECTILE_HERO_HALO_OPACITY);
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <group ref={arrowGroupRef}>
        <ArrowShape />
      </group>
      <group ref={spellGroupRef}>
        <SpellShape session={session} slotIndex={index} />
      </group>
      <mesh ref={enemyBodyRef} geometry={unitSphere} material={enemyProjectileMaterial} />
      {/* Halo de "luz por bala" (ver cabecera del fichero): TODO proyectil
          activo lo lleva ahora (antes solo el enemigo) — disco aditivo
          pegado al suelo vía GlowPuddle, indistinguible de una luz real
          desde la cámara cenital y coste ~0 (sin pointLight, ver
          GlowPuddle.tsx). Color/opacidad de montaje son un valor por
          defecto cualquiera: el useFrame de arriba reasigna `material`
          cada frame según el dueño real del slot antes de mostrarlo. */}
      <GlowPuddle
        meshRef={haloRef}
        color={WEAPON_COLOR.arrow}
        radius={PROJECTILE_HALO_RADIUS}
        opacity={PROJECTILE_HERO_HALO_OPACITY}
        position={[0, PROJECTILE_HALO_LOCAL_Y, 0]}
        visible={false}
      />
    </group>
  );
}

export function ProjectileViews({ session }: { session: GameSession }) {
  const count = session.world.projectiles.length;
  const indices = Array.from({ length: count }, (_, i) => i);
  return (
    <>
      {indices.map((i) => (
        <ProjectileSlot key={i} session={session} index={i} />
      ))}
    </>
  );
}
