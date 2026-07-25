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
 * - Flecha (ronda 3, punto 3: "las flechas apenas se ven, puedes usar un
 *   cono"): CONO amarillo grande como cuerpo dominante (mucho más ancho que
 *   el fino asta+punta de la ronda anterior, que seguía sin leerse bien en
 *   móvil) + un asta corta detrás para dar sensación de proyectil alargado,
 *   orientado según su velocidad (rotación en el plano XZ). Proporciones a
 *   radio unitario; el GRUPO se escala por `p.radius` cada frame (nunca se
 *   recrea geometría).
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
import type { Group, Mesh, PointLight } from 'three';
import type { GameSession } from '@/game/session/session';
import type { Projectile } from '@/game/world/types';
import { getUpgradeLevel } from '@/game/session/upgrades';
import { arrowMaterial, arrowShaftGeometry, arrowTipMaterial, enemyProjectileGlowHaloMaterialForTag, enemyProjectileMaterial, enemyProjectileMaterialForTag, spellBoltMaterial, spellBoltSegmentGeometry, spellSparkGeometry, spellSparkMaterial, unitCircle, unitCone, unitSphere, WEAPON_COLOR } from '@/game/render/assets';
import { PROJECTILE_WAX_EMIT_DISTANCE } from '@/game/features/effects/wax';
import { arrowWidthScaleForLevel } from './upgrade-visuals';

/**
 * Luz de proyectil (punto 3 de playtest: "los ataques de flecha y hechizo
 * deben emitir luz también") — REDISEÑO (playtest: "cuando el boss lanza
 * muchos proyectiles el rendimiento baja un montón, sobre todo con el bullet
 * hell"): antes cada SLOT del pool (hasta `PROJECTILE_POOL_SIZE`=96) montaba
 * su propia pointLight, apagada con `group.visible=false` cuando el slot
 * estaba inactivo. three.js recompila TODOS los programas de shader cada vez
 * que cambia el Nº de luces VISIBLES en la escena — con un bullet hell
 * (decenas de proyectiles apareciendo/muriendo por segundo) eso era una
 * recompilación constante. Fix: POOL FIJO de `PROJECTILE_LIGHT_POOL_SIZE`
 * pointLights, montadas UNA vez (mismo Nº de luces en escena SIEMPRE, cero
 * recompilaciones) en `ProjectileLightPool`, reasignadas cada frame por
 * prioridad — (a) proyectiles del héroe, (b) proyectiles enemigos más
 * CERCANOS al héroe — a los proyectiles activos; las sobrantes quedan con
 * intensity=0 (nunca `visible=false` ni desmontadas, para no volver a variar
 * el recuento). Color del arma activa (`WEAPON_COLOR`, arrow/spell); el
 * proyectil del shooter enemigo (`kind==='enemy'`) recibe una versión bastante
 * más débil, en su propio color. SIN sombra (coste).
 */
const PROJECTILE_LIGHT_INTENSITY = 6;
const PROJECTILE_LIGHT_DISTANCE = 3;
const PROJECTILE_LIGHT_DECAY = 2;
const PROJECTILE_LIGHT_INTENSITY_ENEMY = 3;
const PROJECTILE_LIGHT_DISTANCE_ENEMY = 2.2;
/** Altura Y del centro del proyectil (mismo valor que `group.position.set` en `ProjectileSlot`). */
const PROJECTILE_LIGHT_HEIGHT = 0.3;
/** Tamaño FIJO del pool de luces de proyectil (ver cabecera del fichero): antes leído de un presupuesto de calidad, ahora una constante única. */
const PROJECTILE_LIGHT_POOL_SIZE = 6;

/**
 * Halo aditivo bajo CADA proyectil enemigo (feedback playtest 2026-07-17: "me
 * gustaría que cada bola tuviera su luz") — mismo truco barato que un sprite
 * aditivo con `glowHaloTexture` pegado al suelo, indistinguible de una luz
 * real desde la cámara cenital y coste ~0. NO es una pointLight nueva: el
 * recuento de luces reales de la escena se queda fijo (`ProjectileLightPool`,
 * más abajo) — este halo es un mesh MÁS por slot del pool de proyectiles, no
 * una luz.
 */
const PROJECTILE_ENEMY_HALO_RADIUS = 0.6;
/**
 * Altura LOCAL del halo dentro del group del slot (que ya vive a
 * `PROJECTILE_LIGHT_HEIGHT`=0.3 de mundo): offset negativo para dejarlo
 * pegado al suelo (~0.03 de mundo, mismo criterio que `ItemView.tsx`).
 */
const PROJECTILE_ENEMY_HALO_LOCAL_Y = 0.03 - PROJECTILE_LIGHT_HEIGHT;

/**
 * Tamaño VISUAL de los proyectiles (playtest: "los proyectiles mejor un
 * poco más pequeños"), ~20% menos — SOLO afecta a la escala del mesh de
 * render (`arrowGroup`/`spellGroup`/`enemyBody`, más abajo); `p.radius`
 * (radio de colisión de la sim, `combat.ts`) no se toca. Aplica a los 3
 * `kind` en todos los modos (dark 0/1/2).
 */
const PROJECTILE_VISUAL_SCALE = 0.8;

/**
 * Estela de proyectiles del héroe (playtest 2026-07-20, David: "cuando
 * dispares con proyectiles, deja cera de ese color") — REDISEÑO (mismo
 * playtest, punto de la cera persistente): ya NO usa `session.effects.trail`
 * (vida corta, se desvanece); flecha y hechizo depositan en la capa de cera
 * persistente (`session.effects.wax`, `features/effects/wax.ts`, MISMO pool
 * que usa `HeroView.tsx`), con color del arma activa (`WEAPON_COLOR`, no el
 * color de cera del héroe) y cadencia por DISTANCIA recorrida
 * (`PROJECTILE_WAX_EMIT_DISTANCE`, no por tiempo — un proyectil rápido con
 * cadencia por tiempo dejaría puntos muy espaciados en el suelo, mientras que
 * uno lento los apelmazaría). Emitido aquí (render, useFrame de
 * `ProjectileSlot`, mismo sitio donde ya se itera cada proyectil por frame) y
 * NUNCA en la sim (combat.ts stepea física/daño, no efectos).
 */
const PROJECTILE_TRAIL_SIZE_FACTOR = 0.55;

type ProjectileKind = Projectile['kind'];

// Proporciones de la flecha a radio unitario (el grupo se escala por
// p.radius): CONO grande como cuerpo dominante (mucho más ancho que el fino
// asta+punta anterior), con un asta corta detrás para dar sentido de
// proyectil alargado en vuelo.
const ARROW_CONE_LENGTH = 2.2;
const ARROW_CONE_THICKNESS = 2.6;
const ARROW_SHAFT_LENGTH = 1.6;
const ARROW_SHAFT_THICKNESS = 0.9;

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
 * Flecha: CONO amarillo grande (cuerpo dominante, claramente visible) +
 * asta corta detrás, proporciones a radio unitario (el grupo padre se
 * escala por p.radius). El cono apunta en +Z local (la punta hacia delante,
 * en la dirección de movimiento — ProjectileSlot alinea +Z con la
 * velocidad).
 */
function ArrowShape() {
  return (
    <>
      <mesh
        geometry={unitCone}
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
  const enemyHaloRef = useRef<Mesh>(null);
  const lastKind = useRef<ProjectileKind | null>(null);
  // Cera del proyectil (ver PROJECTILE_TRAIL_SIZE_FACTOR arriba): acumulador
  // propio por slot, de DISTANCIA recorrida (no tiempo — cada slot se
  // recicla entre disparos, así que empezar en 0 tras un `kind` nuevo es
  // correcto: como mucho retrasa el primer punto de ese disparo unos
  // milímetros, nunca arrastra distancia del proyectil anterior).
  const trailAccumulator = useRef(0);

  useFrame((_, delta) => {
    const p = session.world.projectiles[index];
    const group = groupRef.current;
    if (!group) return;
    if (!p.active) {
      group.visible = false;
      trailAccumulator.current = 0;
      return;
    }
    group.visible = true;
    group.position.set(p.position.x, 0.3, p.position.y);

    // Orientación: alinea el eje +Z local (asta de flecha / eje del hechizo)
    // con la dirección de movimiento.
    const speed = Math.hypot(p.velocity.x, p.velocity.y);
    if (speed > 0.01) {
      group.rotation.y = Math.atan2(p.velocity.x, p.velocity.y);
    }

    if (lastKind.current !== p.kind) lastKind.current = p.kind;

    // Cera de color del arma (solo proyectiles del héroe): ver cabecera del
    // fichero (PROJECTILE_TRAIL_SIZE_FACTOR). Cadencia por DISTANCIA recorrida
    // (`speed * delta`, ya calculado arriba), no por tiempo — mismo criterio
    // que la cera del héroe en HeroView.tsx.
    if (p.owner === 'hero' && (p.kind === 'arrow' || p.kind === 'spell')) {
      trailAccumulator.current += speed * delta;
      while (trailAccumulator.current >= PROJECTILE_WAX_EMIT_DISTANCE) {
        trailAccumulator.current -= PROJECTILE_WAX_EMIT_DISTANCE;
        const color = WEAPON_COLOR[p.kind];
        session.effects.wax.emit(
          p.position.x,
          p.position.y,
          p.radius * PROJECTILE_TRAIL_SIZE_FACTOR,
          color.r,
          color.g,
          color.b,
        );
      }
    } else {
      trailAccumulator.current = 0;
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
    const enemyHalo = enemyHaloRef.current;
    if (enemyHalo) {
      const showHalo = p.kind === 'enemy';
      enemyHalo.visible = showHalo;
      if (showHalo) enemyHalo.material = enemyProjectileGlowHaloMaterialForTag(p.colorTag);
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
      {/* Halo de "luz por bala" (solo proyectiles enemigos): disco aditivo
          pegado al suelo — indistinguible de una luz real desde la cámara
          cenital y coste ~0 (sin pointLight nueva). */}
      <mesh
        ref={enemyHaloRef}
        geometry={unitCircle}
        material={enemyProjectileGlowHaloMaterialForTag('')}
        rotation-x={-Math.PI / 2}
        position={[0, PROJECTILE_ENEMY_HALO_LOCAL_Y, 0]}
        scale={PROJECTILE_ENEMY_HALO_RADIUS}
        visible={false}
      />
    </group>
  );
}

/**
 * Pool FIJO de luces de proyectil (ver cabecera del fichero): SIEMPRE monta
 * exactamente `PROJECTILE_LIGHT_POOL_SIZE` pointLights (nunca más, nunca
 * menos — recuento constante durante toda la vida del componente, sin variar
 * al montar/desmontar proyectiles). Cada frame reasigna las luces a los
 * proyectiles activos por prioridad, sin asignar memoria nueva (arrays de
 * scratch creados una vez vía useRef).
 */
function ProjectileLightPool({ session }: { session: GameSession }) {
  const poolSize = PROJECTILE_LIGHT_POOL_SIZE;
  const lightRefs = useRef<(PointLight | null)[]>([]);
  // Scratch reutilizado cada frame (cero `new`/allocs en useFrame):
  // `assignedSlot[k]` = índice en world.projectiles asignado a la luz k (-1
  // si ninguno); `assignedDist2[k]` = distancia² al héroe del candidato
  // ocupando el slot k durante la fase 2 (selección top-K de enemigos más
  // cercanos, ver abajo).
  const assignedSlot = useRef<number[]>(new Array(poolSize).fill(-1));
  const assignedDist2 = useRef<number[]>(new Array(poolSize).fill(Infinity));

  useFrame(() => {
    const world = session.world;
    const projectiles = world.projectiles;
    const slots = assignedSlot.current;
    const dist2 = assignedDist2.current;
    for (let k = 0; k < poolSize; k++) slots[k] = -1;

    // Fase 1 — prioridad máxima: proyectiles del héroe (flecha/hechizo), en
    // orden de pool (orden de disparo).
    let filled = 0;
    for (let i = 0; i < projectiles.length && filled < poolSize; i++) {
      const p = projectiles[i];
      if (p.active && p.owner === 'hero') {
        slots[filled] = i;
        filled++;
      }
    }

    // Fase 2 — huecos restantes: proyectiles ENEMIGOS más cercanos al héroe
    // (selección top-K acotada sobre los slots libres [filled..POOL), sin
    // ordenar ni asignar arrays nuevos — sustituye el peor candidato ya
    // ocupado si el nuevo está más cerca).
    if (filled < poolSize) {
      for (let k = filled; k < poolSize; k++) dist2[k] = Infinity;
      const heroX = world.hero.position.x;
      const heroY = world.hero.position.y;
      for (let i = 0; i < projectiles.length; i++) {
        const p = projectiles[i];
        if (!p.active || p.owner !== 'enemy') continue;
        const dx = p.position.x - heroX;
        const dy = p.position.y - heroY;
        const d2 = dx * dx + dy * dy;
        let worstSlot = -1;
        let worstDist2 = -1;
        for (let k = filled; k < poolSize; k++) {
          if (dist2[k] > worstDist2) {
            worstDist2 = dist2[k];
            worstSlot = k;
          }
        }
        if (worstSlot !== -1 && d2 < worstDist2) {
          slots[worstSlot] = i;
          dist2[worstSlot] = d2;
        }
      }
    }

    // Aplica la asignación a las luces montadas: posición + color/intensidad
    // del proyectil asignado, o intensity=0 (NUNCA visible=false/desmontar:
    // cambiaría el recuento) si el slot quedó sin candidato.
    for (let k = 0; k < poolSize; k++) {
      const light = lightRefs.current[k];
      if (!light) continue;
      const idx = slots[k];
      if (idx === -1) {
        light.intensity = 0;
        continue;
      }
      const p = projectiles[idx];
      light.position.set(p.position.x, PROJECTILE_LIGHT_HEIGHT, p.position.y);
      if (p.kind === 'arrow' || p.kind === 'spell') {
        light.color.copy(WEAPON_COLOR[p.kind]);
        light.intensity = PROJECTILE_LIGHT_INTENSITY;
        light.distance = PROJECTILE_LIGHT_DISTANCE;
      } else {
        // Mismo colorTag que tiñe el cuerpo/halo del proyectil (ver
        // `ProjectileSlot`): reutiliza la misma tabla, sin duplicar colores.
        light.color.copy(enemyProjectileMaterialForTag(p.colorTag).color);
        light.intensity = PROJECTILE_LIGHT_INTENSITY_ENEMY;
        light.distance = PROJECTILE_LIGHT_DISTANCE_ENEMY;
      }
    }
  });

  return (
    <>
      {Array.from({ length: poolSize }, (_, k) => (
        <pointLight
          key={k}
          ref={(el) => {
            lightRefs.current[k] = el;
          }}
          decay={PROJECTILE_LIGHT_DECAY}
          intensity={0}
        />
      ))}
    </>
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
      <ProjectileLightPool session={session} />
    </>
  );
}
