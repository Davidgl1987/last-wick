/**
 * Tipos de contrato de la tabla de definición de jefes (GDD §15): un jefe =
 * una entrada en `registry.ts::BOSS_DEFS`, en el mismo espíritu que
 * `sim/upgrades.ts::UPGRADE_POOL` — B1-B4 solo añaden una entrada + sus
 * funciones `stepPattern`/`onPhaseChanged`, sin tocar el framework de
 * `lifecycle.ts`.
 *
 * SIN imports de React ni three.js: es contenido puro, consumido por la sim
 * (`lifecycle.ts`) y por el render (composición específica por jefe en
 * `features/enemies/EnemyViews.tsx` vía `bossId`).
 */

import type { EventQueue } from '@/engine/events';
import type { BossId, Enemy, World } from '@/game/world/types';

/**
 * Contrato de patrón de un jefe: se llama una vez por tick (mismo dt fijo que
 * el resto de la sim) mientras el jefe está vivo y la sala está en juego.
 * Debe mutar `boss` (posición/velocity/bossTimer/bossStage/bossCounter/
 * bossTelegraphUntil/bossTelegraphKind/bossVulnerable) y puede emitir
 * eventos propios (p.ej. disparos) via `events`. Cero asignaciones: solo
 * escalares y los campos ya existentes del Enemy.
 */
export type BossPatternStep = (world: World, boss: Enemy, dt: number, events: EventQueue) => void;

/**
 * Paso de estado propio de un jefe en la fase de contacto del tick (mismo
 * punto que `stepHeroEnemyContacts`, ver `world/step.ts`): recibe el mapa de
 * cooldowns de daño por contacto para reutilizarlo por entidad. La Reina lo usa
 * para su `stepQueenColumns` (embestidas del héroe contra sus columnas). Corre
 * para TODO jefe presente en `world.enemies`, vivo o muerto, mientras la sala
 * no esté en `game-over` — igual semántica que tenía la llamada directa.
 */
export type BossStateStep = (world: World, cooldowns: Map<string, number>, events: EventQueue) => void;

export interface BossDef {
  id: BossId;
  // Sin `name`: prosa de i18n (regla ★ ARCHITECTURE.md, sim nunca importa
  // React/@/i18n). BossHealthBar.tsx (render) resuelve
  // `t(\`bosses.${id}.name\`)` al pintar — ver src/i18n/locales/es.json::bosses.
  /** Vida máxima (GDD §15.6). */
  maxHp: number;
  /**
   * Radio de colisión/visual (los jefes se diseñan más grandes que el 0.4 de
   * un enemigo normal y su cuerpo de render escala con el radio REAL). Si se
   * omite, se conserva el radio por defecto de createEnemy.
   */
  radius?: number;
  /**
   * Techo de daño de un único golpe del jefe al héroe, como fracción de su
   * vida MÁXIMA (GDD §15.1 punto 6: 60% en fase 1, puede escalar un poco en
   * fases posteriores, nunca hasta 100%). Índice 0/1/2 = fase 1/2/3.
   */
  hitDamageCapFraction: [number, number, number];
  /**
   * Multiplicador de daño recibido mientras NO está en ventana de
   * vulnerabilidad (GDD §15.1 punto 4). 0 = inmune fuera de ventana; un
   * valor >0 dejaría pasar daño reducido si algún jefe futuro lo necesitara.
   */
  damageOutsideWindow: number;
  /** Daño por explosión de barril en su radio, como fracción de maxHp (bypass de ventana, en cualquier momento). */
  barrelDamageFraction?: number;
  /** Avance de un tick del patrón de ataque de este jefe. */
  stepPattern: BossPatternStep;
  /**
   * Hook opcional de estado propio del jefe, invocado desde la fase de
   * contacto del tick (`world/step.ts`, dentro del gate `!== 'game-over'`,
   * justo tras `stepHeroEnemyContacts`) vía `lifecycle.ts::stepBossStates`.
   * Punto de extensión para jefes cuyo estado en `World.bossState` reacciona a
   * la posición/velocidad del héroe este tick (p.ej. la Reina: embestidas
   * contra sus columnas). Omitir si el jefe no tiene estado que avanzar aquí.
   */
  stepState?: BossStateStep;
  /** Se llama una vez al cruzar a fase 2 o 3 (para resetear bossStage/timers propios del patrón). */
  onPhaseChanged?: (world: World, boss: Enemy, phase: 2 | 3) => void;
  /**
   * Se llama una vez, justo tras construir el mundo (mismo momento que fija
   * hp/maxHp/radius reales, ver `lifecycle.ts::initBossEnemies`). Punto de
   * extensión para jefes que necesitan reservar estado propio en el mundo al
   * arrancar (p.ej. la Reina del Enjambre, GDD §15.3: preasigna sus slots de
   * larva en `world.enemies`, igual espíritu que `createProjectilePool`).
   */
  onInit?: (world: World, boss: Enemy) => void;
}
