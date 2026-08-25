/**
 * Enemigos (GDD §7): un mesh por enemigo (≤10 por sala, el presupuesto lo
 * permite explícitamente). Lee la sim en useFrame; nunca la muta.
 *
 * Flash blanco de golpe: se implementa INTERCAMBIANDO materiales compartidos
 * de assets.ts (material del arquetipo ↔ enemyHitFlashMaterial) en vez de
 * mutar colores o crear materiales por instancia — cumple estrictamente la
 * regla de "materiales compartidos, creados una vez".
 *
 * Personalidad por arquetipo (punto 11 de playtest): pura composición
 * geométrica + micro-animación de RENDER (nunca toca la sim), silueta/color
 * de contrato del GDD intactos. Cada arquetipo (Dummy/Chaser/Spike/Trail/
 * Shooter) tiene su propio bloque visual extraído a `<kind>/Mesh.tsx`; aquí
 * solo vive lo compartido por TODOS (cuerpo, sombra, flash de golpe,
 * orientación por velocidad) y lo específico de jefe (GDD §15, Fase B0):
 * - Boss (genérico): anillo ámbar mientras `bossTelegraphUntil` está activo
 *   (aviso de ataque), anillo verde mientras `bossVulnerable` (ventana de
 *   castigo) y flash blanco-cálido de cuerpo entero al cambiar de fase
 *   (retrigger por `bossPhase`).
 * - Guardián de Canto (GDD §15.2, Fase B1, `bossId==='guardian'`): sustituye
 *   el cuerpo genérico por uno propio (esfera pétrea grande + 2 "cuernos"
 *   cónicos de hombro, escalados con `enemy.radius` como cualquier jefe),
 *   brillo+vibración durante el telegraph (material ámbar intercambiado +
 *   jitter de posición, más intenso que el aro genérico), y estado aturdido
 *   INCONFUNDIBLE: tambaleo (oscilación de rotación en Z) + 3 estrellitas
 *   doradas orbitando sobre la cabeza — todo con geometrías/materiales
 *   compartidos de assets.ts, encima (no en sustitución) de los anillos
 *   genéricos de telegraph/vulnerabilidad ya heredados.
 * - Guardianas de la Reina (larvas `chasing===false`, GDD §15.3, rediseño
 *   2026-07-10): aviso de embestida sobre `enemy.bossStage` (0=orbita,
 *   1=TELEGRAFÍA, 2=carga) — parpadeo ámbar + hinchazón pulsante durante la
 *   telegrafía, tono rojo intenso y constante mientras carga; el flash de
 *   golpe (hitFlash, ya existente) tiene prioridad y nunca se pisan.
 * - El Prisma (GDD §15.4, Fase B3, `bossId==='prisma'`): el núcleo (mismo
 *   `bodyRef` compartido) MUTA su color al del arma activa
 *   (`enemy.bossWeaponGateA`, mapeado con `WEAPON_COLOR` — el mismo mapeo
 *   instantáneo arma↔color que ya usa la Weapon bar del héroe), en vez de
 *   intercambiar materiales — un único Prisma vivo a la vez, mismo criterio
 *   que `heroMaterial`. Telegraph de cambio de color: "tartamudeo" (parpadeo
 *   rápido alternando el color actual y el siguiente, leído de
 *   `bossTelegraphKind==='color-change:<arma>'`). Solape de fase 3
 *   (`bossWeaponGateB!==''`): alterna los dos colores activos a un ritmo más
 *   calmado. 3 gemas orbitando el núcleo dan silueta propia, distinta de
 *   cuernos/corona.
 * - La Tormenta (GDD §15.5, Fase B4, `bossId==='storm'`; rediseño de telegraph
 *   post-playtest 2026-07-15, David: "que el anillo fuera siempre como el
 *   anillo de Saturno, en horizontal, y que se iluminara por partes... de la
 *   forma en la que van a salir las bolas"): jefe de esquive puro, cuerpo
 *   tormentoso propio (gris-azulado) envuelto en un halo SIEMPRE horizontal
 *   (plano del suelo, nunca inclinado — el toro-arco giratorio anterior se
 *   leía verticalizado en playtest, ver comentario largo en
 *   `stormHaloSegmentGeometry`, assets.ts) compuesto de `STORM_HALO_SEGMENTS`
 *   secciones fijas cuyo COLOR (nunca su rotación) delata, sección por
 *   sección, POR DÓNDE va a salir el patrón `enemy.bossCounter`
 *   (`stormSegmentLit`, más abajo: espiral ilumina 4 secciones centradas en
 *   los ángulos reales de los brazos —girando a la velocidad angular real
 *   durante el telegraph—, anillos ilumina TODO el anillo menos el hueco de
 *   diseño real del primer anillo, ráfaga ilumina las 3 zonas con balas y
 *   apaga los 3 pasillos reales) — así el jugador lee POR DÓNDE va a esquivar
 *   antes de que empiece a disparar, no solo QUE algo va a pasar (el anillo
 *   ámbar genérico ya cubre eso). El patrón de CADA ciclo se decide al entrar
 *   en recarga, no al empezar su telegraph propio
 *   (`storm/pattern.ts::stormEnterReload` → `stormResetPatternState`, que YA
 *   arranca el generador para que sus ángulos sean reales desde ya), así que
 *   el aro puede empezar a insinuarlo desde la 2ª mitad de la recarga
 *   anterior (secciones que se funden del verde de "ventana abierta" al
 *   color resuelto del patrón, intensidad creciente) y llegar a insinuación
 *   plena en el IDLE breve que sigue, antes incluso de que arranque el
 *   telegraph con lectura completa. Pose de recarga (ventana de
 *   vulnerabilidad, GDD §15.5 "aviso visual claro"): cuerpo sustituido por un
 *   tono pálido/apagado y anillo VERDE UNIFORME (todas las secciones iguales)
 *   en su 1ª mitad — inconfundible frente al resto de estados, encima del
 *   anillo verde genérico ya heredado; el tinte verdoso NUNCA desaparece del
 *   todo mientras la ventana siga abierta, para que insinuar el próximo
 *   patrón no camufle que sigue siendo el momento de golpear.
 *
 * Todo con geometrías/materiales compartidos de assets.ts; cero asignaciones
 * en useFrame (solo escalares y mutación de refs/materiales ya existentes).
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Group, InstancedMesh, Material, Mesh } from 'three';
import { QUEEN_LARVA_ID_PREFIX } from '@/game/features/bosses/queen/constants';
import { ENEMY_ORIENTATION_DAMP_LAMBDA, ENEMY_ORIENTATION_SPEED_THRESHOLD } from '@/game/features/enemies/constants';
import { dampAngleTowards } from '@/engine/geometry';
import type { GameSession } from '@/game/session/session';
import type { BossId, Enemy, EnemyKind } from '@/game/world/types';
import {
  blobShadowMaterial,
  bossBodyMaterial,
  bossPhaseFlashMaterial,
  bossTelegraphMaterial,
  bossVulnerableMaterial,
  chaserMaterial,
  dummyMaterial,
  enemyHitFlashMaterial,
  guardianBodyMaterial,
  queenBodyMaterial,
  queenGuardianChargeMaterial,
  queenGuardianTelegraphMaterial,
  prismaCoreMaterial,
  shooterMaterial,
  spikeMaterial,
  stormBodyMaterial,
  trailMaterial,
  unitCircle,
  unitSphere,
} from '@/game/render/assets';
import { ChaserMesh } from '@/game/features/enemies/chaser/Mesh';
import { DummyMesh } from '@/game/features/enemies/dummy/Mesh';
import { ShooterMesh } from '@/game/features/enemies/shooter/Mesh';
import { SpikeMesh } from '@/game/features/enemies/spike/Mesh';
import { TrailMesh } from '@/game/features/enemies/trail/Mesh';
import { ENEMY_LIGHT_COLOR, ENEMY_LIGHT_INTENSITY_BOSS, EnemyLightsRig } from '@/game/features/enemies/EnemyLights';
import { makeSilhouetteMaterial, SILHOUETTE_RENDER_ORDER } from '@/game/render/occlusion-silhouette';
import { useKnownRoomIds } from '@/game/render/known-rooms';
import { applyGuardianBossFrame, GuardianBossExtras, guardianSilhouetteMaterial } from '@/game/features/bosses/guardian/BossView';
import { applyQueenBossFrame, QueenBossExtras, queenSilhouetteMaterial } from '@/game/features/bosses/queen/BossView';
import { applyPrismaBossFrame, PrismaBossExtras, prismaSilhouetteMaterial } from '@/game/features/bosses/prisma/BossView';
import { applyStormBossFrame, StormBossExtras, stormSilhouetteMaterial } from '@/game/features/bosses/storm/BossView';

const ENEMY_MATERIAL: Record<EnemyKind, Material> = {
  dummy: dummyMaterial,
  chaser: chaserMaterial,
  spike: spikeMaterial,
  trail: trailMaterial,
  shooter: shooterMaterial,
  boss: bossBodyMaterial,
};

/**
 * Silueta de oclusión por arquetipo (occlusion-silhouette.ts): NO clona el
 * `.color` de `ENEMY_MATERIAL` (bug encontrado en verificación visual,
 * 2026-08-06) — `assets-dark.ts` es el ÚNICO modo de render del juego hoy y
 * oscurece el cuerpo Lambert de CASI todos los arquetipos a un tono casi
 * negro (p. ej. `chaserMaterial` → `#0d0c12`, ver su cabecera: "figura alta y
 * fina, CASI NEGRA"), a propósito, para que solo se lea bajo luz cercana. Si
 * la silueta clonara ese color heredaría el mismo casi-negro y sería
 * invisible sobre un muro oscuro — literalmente lo comprobado en pantalla:
 * cero contraste. Lo que de verdad identifica a cada arquetipo hoy, GDD §14,
 * es el EMISSIVE de sus ojos (`dummyEyeGlowMaterial`/`chaserEyeGlowMaterial`/
 * etc., assets-dark.ts), que su propia cabecera documenta como "el mismo
 * color que su charco" — es decir, exactamente `ENEMY_LIGHT_COLOR`
 * (EnemyLights.tsx), ya exportado y usado por el charco/luz de cada
 * arquetipo. Reutilizarlo aquí evita duplicar hex a mano y garantiza que
 * silueta, ojos y charco cuenten siempre el mismo color. `trail` es la única
 * excepción real: su cuerpo NO se oscurece (se aclara a `#cfc4e8`, ver
 * assets-dark.ts), así que su `ENEMY_LIGHT_COLOR` (pálido violeta, mismo
 * espíritu) sigue siendo válido. `boss` es el material GENÉRICO (jefe sin
 * acento propio, p. ej. `test-boss`); los 4 jefes con composición propia
 * (guardián/reina/prisma/tormenta) tienen el suyo, ver `silhouetteMaterialFor`
 * más abajo. Un material por TIPO, creado una vez al cargar el módulo, nunca
 * por instancia ni por frame (misma política que `ENEMY_MATERIAL`).
 */
const ENEMY_SILHOUETTE_MATERIAL: Record<EnemyKind, Material> = {
  dummy: makeSilhouetteMaterial(ENEMY_LIGHT_COLOR.dummy),
  chaser: makeSilhouetteMaterial(ENEMY_LIGHT_COLOR.chaser),
  spike: makeSilhouetteMaterial(ENEMY_LIGHT_COLOR.spike),
  trail: makeSilhouetteMaterial(ENEMY_LIGHT_COLOR.trail),
  shooter: makeSilhouetteMaterial(ENEMY_LIGHT_COLOR.shooter),
  boss: makeSilhouetteMaterial(ENEMY_LIGHT_COLOR.boss),
};

// Luz MÓVIL de enemigo (recorte de ~43 a 7 luces reales, rama
// `luces-optimizadas`): el JEFE conserva su pointLight propia; el resto de
// arquetipos ya NO monta ninguna luz real, solo un `GlowPuddle` (charco
// aditivo pegado al suelo). Rig extraído a `EnemyLights.tsx` (constantes y el
// componente de JSX `EnemyLightsRig`, ver su cabecera para el porqué
// completo) — este componente solo mirrorea la posición en el useFrame de
// más abajo, en el mismo punto exacto donde vivía el bloque antes.

/**
 * Material "en reposo" del cuerpo (sin flash de golpe/fase/telegraph
 * encima): el genérico por arquetipo, salvo el Guardián de Canto
 * (`bossId==='guardian'`), que sustituye el violeta genérico de jefe por su
 * propio pétreo (GDD §15.2). Único punto de verdad para los 3 sitios que
 * restauran el material tras un flash temporal.
 */
function restingBodyMaterial(kind: EnemyKind, bossId: BossId | undefined): Material {
  if (kind === 'boss' && bossId === 'guardian') return guardianBodyMaterial;
  if (kind === 'boss' && bossId === 'queen') return queenBodyMaterial;
  // El Prisma (GDD §15.4): MUTABLE, ver comentario de cabecera — su color se
  // actualiza cada frame más abajo en vez de intercambiar material.
  if (kind === 'boss' && bossId === 'prisma') return prismaCoreMaterial;
  // La Tormenta (GDD §15.5): cuerpo tormentoso propio, sustituido por
  // stormReloadCoreMaterial mientras está en RELOAD (ver useFrame de abajo).
  if (kind === 'boss' && bossId === 'storm') return stormBodyMaterial;
  return ENEMY_MATERIAL[kind];
}

/**
 * Silueta "en reposo" del cuerpo: mismo criterio de selección que
 * `restingBodyMaterial` de arriba, pero devolviendo el material de SILUETA
 * en vez del real. El Prisma es el único de los 4 jefes con silueta MUTABLE:
 * `prismaSilhouetteMaterial` se actualiza cada frame dentro de
 * `applyPrismaBossFrame` (bosses/prisma/BossView.tsx), igual que
 * `heroSilhouetteMaterial` sigue al arma activa en HeroView.tsx — el resto
 * (guardián/reina/tormenta) usa un color fijo, porque su cuerpo tampoco
 * cambia de color de forma permanente (solo lo intercambian brevemente
 * durante telegraph/recarga, que la silueta no necesita replicar).
 */
function silhouetteMaterialFor(kind: EnemyKind, bossId: BossId | undefined): Material {
  if (kind === 'boss' && bossId === 'guardian') return guardianSilhouetteMaterial;
  if (kind === 'boss' && bossId === 'queen') return queenSilhouetteMaterial;
  if (kind === 'boss' && bossId === 'prisma') return prismaSilhouetteMaterial;
  if (kind === 'boss' && bossId === 'storm') return stormSilhouetteMaterial;
  return ENEMY_SILHOUETTE_MATERIAL[kind];
}

/** true si este id de enemigo es una larva de la Reina del Enjambre (GDD §15.3): mini-dummy, escala menor. */
function isQueenLarvaId(enemyId: string): boolean {
  return enemyId.startsWith(QUEEN_LARVA_ID_PREFIX);
}

const ENEMY_RADIUS_RENDER = 0.4;

/**
 * Escala ESTÁTICA del cuerpo compartido por arquetipo (silueta del concept
 * art): "Vigía de hollín" ligeramente achatado, "Acechador del Umbral" alto y
 * fino. Fijada UNA vez al montar vía JSX (no en useFrame): el único código
 * que muta `bodyRef.scale` después del montaje es el bloque de jefe/larva de
 * más abajo (`kind==='boss' || isLarva`), que nunca se cumple para
 * dummy/chaser, así que este valor persiste sin pisarse. Radio de colisión
 * intacto (`enemy.radius`/`ENEMY_RADIUS_RENDER` no cambian, esto es solo la
 * escala visual del mesh).
 */
function bodyScaleForKind(kind: EnemyKind): number | [number, number, number] {
  if (kind === 'dummy') {
    return [ENEMY_RADIUS_RENDER * 1.08, ENEMY_RADIUS_RENDER * 0.82, ENEMY_RADIUS_RENDER * 1.08];
  }
  if (kind === 'chaser') {
    return [ENEMY_RADIUS_RENDER * 0.78, ENEMY_RADIUS_RENDER * 1.45, ENEMY_RADIUS_RENDER * 0.78];
  }
  return ENEMY_RADIUS_RENDER;
}
/** Duración del flash de cuerpo entero al cambiar de fase (GDD §15.1 punto 3). Puramente cosmético. */
const BOSS_PHASE_FLASH_DURATION = 0.3;
// Umbral de velocidad y λ de amortiguación de la orientación: movidos a
// `features/enemies/constants.ts` (ENEMY_ORIENTATION_SPEED_THRESHOLD /
// ENEMY_ORIENTATION_DAMP_LAMBDA) porque dejaron de ser un detalle privado del
// render — el Spike (spike/ai.ts) gira su `facing` en marcha con el mismo λ
// que el cuerpo gira aquí, y la ventana de giro de patrulla
// (steering.ts::stepPatrol) se define por contraste con ambos: ahí no se usa
// ninguna de las dos, porque la sim gobierna el giro y el render solo la
// sigue. Ver el comentario de cabecera de esas constantes.

// El Prisma (GDD §15.4) y La Tormenta (GDD §15.5): constantes/helpers puros
// de su render específico extraídos junto a `applyPrismaBossFrame`/
// `applyStormBossFrame` (bosses/prisma/BossView.tsx, bosses/storm/BossView.tsx).

function EnemyMesh({
  session,
  enemyId,
  kind,
  bossId,
}: {
  session: GameSession;
  enemyId: string;
  kind: EnemyKind;
  bossId?: BossId;
}) {
  const bodyRef = useRef<Mesh>(null);
  const shadowRef = useRef<Mesh>(null);
  const groupRef = useRef<Group>(null);
  const wasFlashing = useRef(false);

  // Boss (GDD §15): anillo de telegraph (ámbar), anillo de ventana de
  // vulnerabilidad (verde) y flash de cuerpo entero al cambiar de fase.
  const bossTelegraphRingRef = useRef<Mesh>(null);
  const bossVulnerableRingRef = useRef<Mesh>(null);
  const bossPhaseFlashUntil = useRef(0);
  const lastBossPhase = useRef(1);
  const wasPhaseFlashing = useRef(false);
  // Guardián de Canto (GDD §15.2): brillo de telegraph propio (jitter de
  // vibración) y grupo de estrellitas del aturdimiento (orbitan sobre la
  // cabeza); los cuernos (JSX más abajo) son estáticos, sin ref necesaria.
  const guardianStunGroupRef = useRef<Group>(null);
  const guardianStunStarRefs = useRef<(Mesh | null)[]>([]);
  const wasGuardianTelegraphing = useRef(false);
  // Reina del Enjambre (GDD §15.3): pulso de invocación (anillo que se
  // expande brevemente cada vez que suelta una oleada de larvas); la corona
  // (JSX más abajo) es estática, sin ref necesaria.
  const queenSummonPulseRef = useRef<Mesh>(null);
  const queenSummonPulseUntil = useRef(0);
  const lastQueenWaveTimer = useRef(0);
  // El Prisma (GDD §15.4): 3 gemas orbitando el núcleo, silueta propia.
  const prismaGemRefs = useRef<(Mesh | null)[]>([]);
  // La Tormenta (GDD §15.5): anillo de Saturno segmentado alrededor del
  // cuerpo — un InstancedMesh de `STORM_HALO_SEGMENTS` secciones (mismo
  // patrón `setMatrixAt`/`setColorAt` que TrailView/ParticleView), color por
  // sección mutado según el patrón telegrafiado/en curso, apagado (verde
  // uniforme) en la pose de recarga. `obj`/`color` son escalares reutilizados
  // cada frame en el bucle de secciones (cero allocs).
  const stormHaloRef = useRef<InstancedMesh>(null);
  const stormHaloScratch = useMemo(() => ({ obj: new THREE.Object3D(), color: new THREE.Color() }), []);
  // Orientación (yaw) suavizada del grupo: yaw actual y yaw OBJETIVO, ver
  // comentario extenso en el useFrame más abajo. `null` = "aún no
  // inicializado" (primer frame con enemigo válido: snap directo sin girar
  // desde 0).
  const orientationYaw = useRef<number | null>(null);
  const orientationTarget = useRef(0);
  // Luz propia del enemigo (ver cabecera de EnemyLights.tsx para el
  // porqué): el JEFE conserva su pointLight real (sin sombra); el resto de
  // arquetipos monta un `GlowPuddle` (mesh aditivo, no una luz) en su lugar.
  // `bossLightRef`/`puddleMeshRef` son los nodos que este useFrame mueve o
  // apaga; solo uno de los dos grupos (`bossLightGroupRef`/`puddleGroupRef`)
  // acaba montado según `kind`, el otro se queda en `null` para siempre.
  const bossLightRef = useRef<THREE.PointLight>(null);
  const puddleMeshRef = useRef<Mesh>(null);
  /**
   * Groups HERMANOS de `groupRef` (nunca `groupRef.visible=false` los apaga):
   * uno u otro se monta según `kind` (ver `EnemyLightsRig`) y este useFrame
   * mirrorea su posición cada frame a partir de la de `group` — nunca su
   * rotación, ninguno de los dos la necesita. Separarlos de `groupRef` viene
   * de antes de este recorte: cambiar el Nº de luces VISIBLES en la escena
   * recompila todos los shaders (three.js), así que la pointLight del jefe
   * se apaga con `intensity=0` en vez de `group.visible=false` al morir —
   * el charco no-jefe, al no ser una luz real, sí puede usar `visible=false`
   * sin ese coste (ver comentario del bloque de abajo que lo apaga).
   */
  const bossLightGroupRef = useRef<Group>(null);
  const puddleGroupRef = useRef<Group>(null);

  useFrame((_, delta) => {
    const world = session.world;
    const enemy = world.enemies.find((e: Enemy) => e.id === enemyId);
    const group = groupRef.current;
    if (!enemy || !group) return;

    const alive = enemy.hp > 0;
    group.visible = alive;
    // Recuento de luces estable (ver comentario de `bossLightGroupRef`): la
    // pointLight del jefe se apaga con intensity=0, el group que la contiene
    // sigue montado y visible pase lo que pase. El charco no-jefe no es una
    // luz real (mesh aditivo, `visible` normal), así que se apaga sin más
    // con `visible=false` — decisión explícita, ver cabecera del fichero.
    if (bossLightRef.current) bossLightRef.current.intensity = alive ? ENEMY_LIGHT_INTENSITY_BOSS : 0;
    if (puddleMeshRef.current) puddleMeshRef.current.visible = alive;
    if (!alive) return;

    // Balanceo torpe del Dummy al patrullar (no perseguir): cabeceo vertical
    // suave, puramente cosmético, no afecta a la física.
    const bob =
      kind === 'dummy' && !enemy.chasing ? Math.sin(world.time * 5 + enemy.position.x * 3) * 0.035 : 0;
    const isLarva = kind === 'dummy' && isQueenLarvaId(enemyId);
    // Jefe (GDD §15): a diferencia del resto de arquetipos (radio visual fijo
    // ENEMY_RADIUS_RENDER pase lo que pase en la sim), el cuerpo del jefe
    // escala con su radio REAL de colisión (enemy.radius, configurable por
    // sala vía EnemySpawn.radius) — un jefe se diseña visiblemente más
    // grande, y su radio de golpeo debe leerse igual de grande. Las larvas de
    // la Reina (GDD §15.3, mini-dummy) son el caso simétrico: más PEQUEÑAS
    // que un Dummy normal, también leyendo `enemy.radius` real en vez del
    // tamaño fijo del arquetipo.
    const bodyRadius = kind === 'boss' || isLarva ? enemy.radius : ENEMY_RADIUS_RENDER;
    group.position.set(enemy.position.x, bodyRadius + bob, enemy.position.y);
    // Los groups de luz solo TRASLADAN (nunca rotan, ver comentario de
    // `bossLightGroupRef`): mirrorean la posición de `group` cada frame, cada
    // uno a su manera. Jefe: posición COMPLETA (incluida la Y flotante de
    // `bodyRadius + bob`), la pointLight añade su propia altura local encima.
    // No-jefe: solo X/Z — el charco vive pegado al SUELO, nunca a la altura
    // flotante del cuerpo, así que su Y se fija a 0 (el offset mínimo sobre
    // el suelo, `GLOW_PUDDLE_GROUND_Y`, ya lo aporta `GlowPuddle` como
    // posición LOCAL dentro de este mismo group — sumarlo aquí también lo
    // duplicaría). Cero asignaciones: `.set`/`.copy` mutan el Vector3
    // existente.
    if (bossLightGroupRef.current) bossLightGroupRef.current.position.copy(group.position);
    if (puddleGroupRef.current) puddleGroupRef.current.position.set(group.position.x, 0, group.position.z);

    // La sombra es HIJA del grupo (que ya lleva la posición del enemigo):
    // sus coordenadas son LOCALES. Escribirle coordenadas de mundo aquí la
    // proyectaba a 2× la posición del enemigo flotando a y≈0.42 — las
    // "sombras fantasma que se mueven" del playtest de David (2026-07-05).
    const shadow = shadowRef.current;
    if (shadow) shadow.position.set(0, 0.02 - (bodyRadius + bob), 0);
    if ((kind === 'boss' || isLarva) && bodyRef.current) {
      bodyRef.current.scale.setScalar(bodyRadius);
    }

    const flashing = world.time < enemy.hitFlashUntil;
    if (flashing !== wasFlashing.current) {
      wasFlashing.current = flashing;
      const body = bodyRef.current;
      if (body) {
        body.material = flashing ? enemyHitFlashMaterial : restingBodyMaterial(kind, bossId);
      }
    }

    // Guardiana de la Reina (larva `chasing===false`, GDD §15.3, máquina de
    // embestida en `bossStage`: 0=orbita, 1=TELEGRAFÍA, 2=carga): aviso
    // legible de que va a embestir — parpadeo ámbar + hinchazón pulsante
    // durante la telegrafía, tono rojo intenso y constante mientras carga.
    // El flash de golpe (arriba) tiene prioridad: nunca se pisan.
    if (isLarva && !flashing) {
      // Cubre también la perseguidora (`chasing===true`) y la guardiana en
      // reposo (`bossStage===0`) para restaurar el aspecto normal: una larva
      // es un objeto reciclado por la sim (pool por `hp<=0`, ver
      // `queenActivateGuardian`/`queenSpawnChasers`), así que puede renacer
      // con otro rol tras morir a mitad de carga — sin este `else` quedaría
      // con el material rojo intenso de carga pegado indefinidamente.
      const body = bodyRef.current;
      if (body) {
        if (!enemy.chasing && enemy.bossStage === 1) {
          const blink = Math.sin(world.time * 22) > 0;
          body.material = blink ? queenGuardianTelegraphMaterial : restingBodyMaterial(kind, bossId);
          body.scale.setScalar(bodyRadius * (1 + 0.15 * (0.5 + 0.5 * Math.sin(world.time * 22))));
        } else if (!enemy.chasing && enemy.bossStage === 2) {
          body.material = queenGuardianChargeMaterial;
          body.scale.setScalar(bodyRadius * 1.12);
        } else {
          body.material = restingBodyMaterial(kind, bossId);
          body.scale.setScalar(bodyRadius);
        }
      }
    }

    // Ventana de giro de patrulla (stepPatrol, steering.ts): el CUERPO sigue
    // a la SIM, no al revés. Mientras dura, `enemy.velocity` es {0,0} (parado
    // en seco) y quien gobierna la orientación es `enemy.facing`, que la sim
    // rota a velocidad angular CONSTANTE (PATROL_TURN_RATE) — ya sabe
    // exactamente qué yaw mostrar en cada instante, así que aquí solo hay que
    // SEGUIRLA en snap, sin amortiguar encima: amortiguar aquí llegaría
    // TARDE (el cuerpo seguiría girando después de que la sim ya arrancó a
    // moverse), que es justo el bug que motivó este cambio — con el enfoque
    // viejo (deriva + damping del render por velocidad) el giro solo llegaba
    // al ~95% del arco cuando la ventana vencía y el enemigo arrancaba
    // todavía girando. `orientationYaw`/`orientationTarget` se fijan también
    // al mismo valor para que, al salir del giro y volver al modo por
    // velocidad (rama de abajo), no haya salto: el damping arranca ya desde
    // el yaw en el que terminó el giro.
    if (world.time < enemy.patrolTurnUntil) {
      const turnYaw = Math.atan2(enemy.facing.x, enemy.facing.y);
      orientationYaw.current = turnYaw;
      orientationTarget.current = turnYaw;
      group.rotation.y = turnYaw;
    } else {
      // Umbral + giro amortiguado de orientación (bug playtest 2026-07-14: "los
      // ojos bailan cada frame", sobre todo en las larvas de la Reina): la cara
      // de cada enemigo se orienta según su velocidad instantánea, pero incluso
      // por ENCIMA del umbral de velocidad las larvas orbitando a la Reina
      // (steering de órbita + separación entre larvas) zigzaguean de dirección
      // cada tick sin desplazarse realmente distinto — el umbral solo no basta.
      // Fix real: el umbral decide solo si se actualiza el OBJETIVO de yaw (un
      // enemigo quieto no gira), y el yaw ACTUAL siempre avanza hacia ese
      // objetivo por el arco más corto con suavizado exponencial
      // (`dampAngleTowards`, mismo patrón que CameraRig/particles), así que un
      // objetivo que zigzaguea produce como mucho un temblor pequeño y
      // amortiguado, nunca un salto de cara instantáneo.
      const speed = Math.hypot(enemy.velocity.x, enemy.velocity.y);
      if (speed > ENEMY_ORIENTATION_SPEED_THRESHOLD) {
        orientationTarget.current = Math.atan2(enemy.velocity.x, enemy.velocity.y);
      }
      if (orientationYaw.current === null) {
        // Primer frame con este enemigo: snap directo al objetivo inicial (o a
        // 0 si aún no se movió) para no girar visiblemente desde 0.
        orientationYaw.current = speed > ENEMY_ORIENTATION_SPEED_THRESHOLD ? orientationTarget.current : 0;
      } else {
        orientationYaw.current = dampAngleTowards(
          orientationYaw.current,
          orientationTarget.current,
          ENEMY_ORIENTATION_DAMP_LAMBDA,
          delta,
        );
      }
      group.rotation.y = orientationYaw.current;
    }

    if (kind === 'boss') {
      // Telegraph genérico (GDD §15.1 punto 2): anillo ámbar visible mientras
      // `bossTelegraphUntil` no ha vencido, con el mismo pulso de escala que
      // ya usa el Shooter (lenguaje visual consistente entre "aviso de
      // ataque" en toda la sim).
      const telegraphing = world.time < enemy.bossTelegraphUntil;
      if (bossTelegraphRingRef.current) {
        bossTelegraphRingRef.current.visible = telegraphing;
        if (telegraphing) {
          bossTelegraphRingRef.current.scale.setScalar(bodyRadius * (1.5 + 0.2 * Math.sin(world.time * 14)));
        }
      }
      // Ventana de vulnerabilidad (GDD §15.1 punto 4): anillo verde mientras
      // `bossVulnerable`, radio fijo (no pulsa: se distingue del telegraph
      // por color Y por comportamiento, para que nunca se confundan). El
      // Prisma queda fuera: desde playtest 2026-07-17 es vulnerable SIEMPRE
      // (solo gate de color, sin ventana) y el anillo perpetuo sería ruido —
      // su señal es el color del núcleo, no este anillo.
      if (bossVulnerableRingRef.current) {
        bossVulnerableRingRef.current.visible = enemy.bossVulnerable && enemy.bossId !== 'prisma';
        bossVulnerableRingRef.current.scale.setScalar(bodyRadius * 1.5);
      }
      // Flash de cambio de fase (GDD §15.1 punto 3): retrigger al detectar
      // que bossPhase cambió desde el último frame leído.
      if (enemy.bossPhase !== lastBossPhase.current) {
        lastBossPhase.current = enemy.bossPhase;
        bossPhaseFlashUntil.current = world.time + BOSS_PHASE_FLASH_DURATION;
      }
      const phaseFlashing = world.time < bossPhaseFlashUntil.current;
      if (phaseFlashing !== wasPhaseFlashing.current && !flashing) {
        // Solo aplica el flash de fase si el flash de golpe (hitFlash, ya
        // gestionado arriba) no está ya mostrando su propio material: el
        // golpe que causa el cambio de fase ya parpadea en blanco ese mismo
        // instante, así que el flash de fase continúa el gesto sin pisarlo.
        wasPhaseFlashing.current = phaseFlashing;
        const body = bodyRef.current;
        if (body) body.material = phaseFlashing ? bossPhaseFlashMaterial : restingBodyMaterial(kind, bossId);
      }
    }

    // Render específico de cada jefe (GDD §15.2-15.5): extraído a
    // `bosses/<id>/BossView.tsx`, llamado aquí en el mismo orden/punto exacto
    // que antes de la extracción (los refs siguen viviendo en este
    // componente — se pasan por parámetro — para no alterar la mutación
    // dentro del frame).
    if (kind === 'boss' && bossId === 'guardian') {
      applyGuardianBossFrame({
        enemy,
        world,
        flashing,
        bodyRadius,
        bodyRef,
        groupRef,
        guardianStunGroupRef,
        guardianStunStarRefs,
        wasGuardianTelegraphing,
      });
    }

    if (kind === 'boss' && bossId === 'queen') {
      applyQueenBossFrame({ enemy, world, bodyRadius, queenSummonPulseRef, queenSummonPulseUntil, lastQueenWaveTimer });
    }

    if (kind === 'boss' && bossId === 'prisma') {
      applyPrismaBossFrame({ enemy, world, flashing, bodyRadius, prismaGemRefs });
    }

    if (kind === 'boss' && bossId === 'storm') {
      applyStormBossFrame({
        enemy,
        world,
        bodyRadius,
        flashing,
        orientationYaw: orientationYaw.current,
        bodyRef,
        stormHaloRef,
        stormHaloScratch,
      });
    }
  });

  return (
    <>
    <group ref={groupRef}>
      <mesh
        ref={bodyRef}
        geometry={unitSphere}
        material={restingBodyMaterial(kind, bossId)}
        scale={bodyScaleForKind(kind)}
      >
        {/*
          Silueta de oclusión (occlusion-silhouette.ts): MISMA geometría,
          HIJA del cuerpo para heredar gratis su escala/deformaciones —
          estática por arquetipo (bodyScaleForKind), mutada en useFrame para
          jefe/larva (bodyRadius) o para el squash del Trail (TrailMesh
          escribe directamente en bodyRef.scale) — sin replicar ninguna de
          las tres a mano, mismo patrón que la silueta del héroe en
          HeroView.tsx. Solo se ve donde algo tape al enemigo.
        */}
        <mesh geometry={unitSphere} material={silhouetteMaterialFor(kind, bossId)} renderOrder={SILHOUETTE_RENDER_ORDER} />
      </mesh>
      <mesh
        ref={shadowRef}
        geometry={unitCircle}
        material={blobShadowMaterial}
        rotation-x={-Math.PI / 2}
        scale={ENEMY_RADIUS_RENDER * 1.3}
      />

      {kind === 'dummy' && <DummyMesh session={session} enemyId={enemyId} groupRef={groupRef} />}
      {kind === 'chaser' && <ChaserMesh session={session} enemyId={enemyId} groupRef={groupRef} />}
      {kind === 'spike' && <SpikeMesh session={session} enemyId={enemyId} groupRef={groupRef} />}
      {kind === 'trail' && <TrailMesh session={session} enemyId={enemyId} bodyRef={bodyRef} />}
      {kind === 'shooter' && <ShooterMesh session={session} enemyId={enemyId} groupRef={groupRef} />}

      {kind === 'boss' && (
        <>
          {/* Anillo de telegraph (ámbar, GDD §15.1 punto 2) y de ventana de
              vulnerabilidad (verde, punto 4): discos bajo los pies, igual
              lenguaje visual que el telegraph del Shooter pero con radio e
              intensidad de jefe. Genéricos: cualquier jefe B1-B4 los hereda
              sin más composición. */}
          <mesh
            ref={bossTelegraphRingRef}
            geometry={unitCircle}
            material={bossTelegraphMaterial}
            rotation-x={-Math.PI / 2}
            position={[0, -0.42, 0]}
            visible={false}
          />
          <mesh
            ref={bossVulnerableRingRef}
            geometry={unitCircle}
            material={bossVulnerableMaterial}
            rotation-x={-Math.PI / 2}
            position={[0, -0.4, 0]}
            visible={false}
          />
        </>
      )}

      {/* Composición propia de cada jefe (silueta + adornos animados): vive
          junto a su dueño en `features/bosses/<jefe>/BossView.tsx`, igual que
          su patrón/constantes — aquí solo se monta el que toque. El useFrame
          de arriba delega en su `apply<Jefe>BossFrame` hermano. */}
      {kind === 'boss' && bossId === 'guardian' && (
        <GuardianBossExtras guardianStunGroupRef={guardianStunGroupRef} guardianStunStarRefs={guardianStunStarRefs} />
      )}
      {kind === 'boss' && bossId === 'queen' && <QueenBossExtras queenSummonPulseRef={queenSummonPulseRef} />}
      {kind === 'boss' && bossId === 'prisma' && <PrismaBossExtras prismaGemRefs={prismaGemRefs} />}
      {kind === 'boss' && bossId === 'storm' && <StormBossExtras stormHaloRef={stormHaloRef} />}
    </group>

    {/* Luz propia del enemigo (recorte de ~43 a 7 luces reales): rig
        completo (constantes + JSX) extraído a `EnemyLightsRig`
        (EnemyLights.tsx) — group HERMANO de `groupRef`, NUNCA oculto (una
        pointLight real, la del jefe, no puede cambiar de Nº visible en
        escena sin recompilar shaders, ver comentario extenso junto a
        `bossLightGroupRef` arriba); el jefe se apaga con intensity=0 al
        morir, el charco no-jefe con `visible=false` sobre su mesh (no es una
        luz real, no paga ese coste). */}
    <EnemyLightsRig
      kind={kind}
      bossLightGroupRef={bossLightGroupRef}
      bossLightRef={bossLightRef}
      puddleGroupRef={puddleGroupRef}
      puddleMeshRef={puddleMeshRef}
    />
    </>
  );
}

/**
 * Filtra a los enemigos de salas CONOCIDAS (`known-rooms.ts`, encargo de
 * playtest 2026-08-06): un enemigo de una sala aún oculta sigue vivo y
 * simulado igual (la sim no pasa por aquí, ver `world/step.ts`), solo no se
 * monta su mesh hasta que su sala se descubre. `roomId === undefined` es el
 * modo sala única (tests/editor, sin mazmorra): sin filtro, como siempre.
 */
export function EnemyViews({ session }: { session: GameSession }) {
  const knownRoomIds = useKnownRoomIds(session.world);
  return (
    <>
      {session.world.enemies
        .filter((enemy) => enemy.roomId === undefined || knownRoomIds.has(enemy.roomId))
        .map((enemy) => (
          <EnemyMesh key={enemy.id} session={session} enemyId={enemy.id} kind={enemy.kind} bossId={enemy.bossId} />
        ))}
    </>
  );
}
