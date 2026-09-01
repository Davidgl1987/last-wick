/**
 * Tabla de burst por tipo de evento (GDD §12): color/tamaño/cantidad/duración
 * de partículas y trauma de cámara asociado. Única fuente de estos valores
 * para que particles.ts y CameraRig no dupliquen tuning.
 *
 * Colores alineados con la paleta de render/assets.ts (mismo lenguaje visual
 * entidad↔efecto): dorado = objetos/monedas, rosa = curación/muerte, azul =
 * lanzamiento/escudo, naranja = explosión, blanco = impacto, rojo = daño.
 *
 * `texture` (VFX_PLAN.md, ampliación 2026-08-11 — feedback de David: "los
 * barriles parece que sueltan las mismas partículas de cera... pon texturas
 * acordes a explosiones"): silueta por familia, en vez de la única `splat02`
 * que llevaban TODAS las partículas del juego antes de esto. Cuatro familias
 * (`ParticleTextureName`, `features/effects/particles.ts`):
 * - `disc` — Explosión: `barrel-explosion`, `boss-defeated`,
 *   `boss-column-broken`. Bola con rayos radiales, brasa/fogonazo.
 * - `shape_e` — Impacto: `enemy-hit`, `boss-hit`, `projectile-wall`,
 *   `wall-bounce`, `shield-block`, `boss-immune-hit`. Destello de 4 puntas.
 * - `snowflake` — Hielo: NO aparece aquí como valor fijo de tabla; reactToEvent.ts
 *   sustituye la textura por defecto de `launch`/`projectile-wall` por este
 *   copo cuando el arma activa es `arrow` ("Hielo"), igual que ya sustituye
 *   su COLOR. La entrada de tabla de esos dos eventos es su textura POR
 *   DEFECTO (arma cuerpo/hechizo, o sin sustitución posible en `launch`).
 * - `splat02` — Resto: todo lo demás (recogidas, mejoras, muerte de enemigo,
 *   polvo de jefe, victoria...), el splat que ya había.
 *
 * Sin familia de "humo" (`shape_c`, disponible en el catálogo): un burst de
 * `disc` ya diferencia la explosión de cualquier otro evento del
 * juego, que es el problema que reportó David; mezclar una segunda textura
 * en el mismo burst duplicaría el coste de instancing (otro InstancedMesh)
 * para un matiz que no hacía falta para resolver el feedback — confirmado
 * viendo la explosión en `?room=test&godmode` (ver informe final).
 */

import type { GameEventType } from '@/engine/events';
import type { ParticleTextureName } from './particles';

export interface BurstSpec {
  /** Color hex de las partículas. */
  color: string;
  /** Radio base de cada partícula (mundo). */
  size: number;
  /** Nº de partículas del burst (antes de escalar por intensidad). */
  count: number;
  /** Vida de cada partícula (s). */
  life: number;
  /** Velocidad base de expansión (u/s). */
  speed: number;
  /** Trauma de cámara añadido [0,1] (antes de escalar por intensidad). */
  trauma: number;
  /** Textura por defecto del burst (ver cabecera del fichero); reactToEvent.ts puede sustituirla (arma Hielo). */
  texture: ParticleTextureName;
}

const NONE: BurstSpec = { color: '#ffffff', size: 0, count: 0, life: 0, speed: 0, trauma: 0, texture: 'splat02' };

/** Burst por defecto para cada tipo de evento; los que no generan feedback visual propio quedan en NONE (count 0). */
export const BURST_BY_EVENT: Record<GameEventType, BurstSpec> = {
  // Color aquí es solo FALLBACK (tests/llamadas sin override): en juego
  // reactToEvent.ts lo sustituye siempre por WEAPON_COLOR[hero.weaponMode]
  // vía el 6º parámetro que le pasa useGameLoop.ts — 'launch' cubre las 3
  // armas (cuerpo/flecha/hechizo), no puede tener un color fijo correcto.
  // texture: 'splat02' es el valor POR DEFECTO (cuerpo/hechizo); reactToEvent.ts
  // lo sustituye por 'snowflake' cuando el arma activa es 'arrow' (Hielo).
  launch: { color: '#54c7ff', size: 0.09, count: 10, life: 0.3, speed: 2.2, trauma: 0.06, texture: 'splat02' },
  'wall-bounce': { color: '#c7ccdf', size: 0.06, count: 5, life: 0.22, speed: 1.6, trauma: 0.08, texture: 'shape_e' },
  // Playtest 2026-07-16: chispas del color del ARMA (reactToEvent.ts lo
  // sustituye vía PROJECTILE_WALL_COLOR/label, igual que 'launch'), más
  // pequeñas/breves y sin apenas trauma — "más humilde" que 'enemy-hit', es
  // un impacto contra un muro inerte, no contra un enemigo. texture: 'shape_e'
  // es el valor POR DEFECTO (hechizo); reactToEvent.ts lo sustituye por
  // 'snowflake' cuando `event.label === 'arrow'` (Hielo).
  'projectile-wall': { color: '#c7ccdf', size: 0.05, count: 5, life: 0.18, speed: 1.8, trauma: 0.02, texture: 'shape_e' },
  // Disparo enemigo (encargo de audio, engine/events.ts): el propio
  // proyectil naciendo ya es el feedback visual; sin burst propio (NONE)
  // para no duplicar partículas sobre lo que dispara el arquetipo shooter/
  // La Tormenta varias veces por segundo.
  'enemy-shot': NONE,
  'enemy-hit': { color: '#ffffff', size: 0.08, count: 8, life: 0.25, speed: 2.6, trauma: 0.06, texture: 'shape_e' },
  // Golpe a un JEFE (playtest 2026-07-10): shake grande, escalado por daño en
  // reactToEvent.ts — mucho más notorio que un enemigo pequeño (enemy-hit).
  'boss-hit': { color: '#ffffff', size: 0.1, count: 10, life: 0.28, speed: 2.8, trauma: 0.35, texture: 'shape_e' },
  'enemy-died': { color: '#ff6bcb', size: 0.12, count: 22, life: 0.5, speed: 3.4, trauma: 0.22, texture: 'splat02' },
  'player-damaged': { color: '#ff3b3b', size: 0.1, count: 14, life: 0.35, speed: 2.8, trauma: 0.32, texture: 'splat02' },
  'player-died': { color: '#ff3b3b', size: 0.14, count: 26, life: 0.6, speed: 3.2, trauma: 0.5, texture: 'splat02' },
  // Modo dios de playtest (?godmode, render/debug-params.ts): revive a maxHp
  // en vez de game-over. Burst barato en el mismo lenguaje "curación" que
  // hearts-heal (hud.css) para que quede claro que es un revivir, no un golpe;
  // trauma bajo (es feedback informativo, no un impacto que reforzar).
  'godmode-revive': { color: '#ff6bcb', size: 0.11, count: 18, life: 0.45, speed: 2.6, trauma: 0.15, texture: 'splat02' },
  'shield-block': { color: '#8fe3ff', size: 0.09, count: 12, life: 0.3, speed: 2.4, trauma: 0.12, texture: 'shape_e' },
  'pit-fall': NONE,
  'pit-respawn': NONE,
  // Daño al jugador (pinchos): NO es de la familia "Impactos" (esa es para
  // golpes que el jugador INFLIGE) — se queda en el splat rojo genérico,
  // que ya se lee como salpicadura de daño.
  'spikes-hit': { color: '#ff3b3b', size: 0.08, count: 10, life: 0.3, speed: 2.4, trauma: 0.2, texture: 'splat02' },
  // speed×life ≈ alcance visual de las partículas: mantenerlo ≈ BARREL_BLAST_RADIUS
  // (2.4) para que la explosión visual no prometa daño donde no lo hay.
  'barrel-explosion': { color: '#ff9f45', size: 0.2, count: 48, life: 0.65, speed: 3.7, trauma: 1, texture: 'disc' },
  'item-pickup': { color: '#ffd166', size: 0.07, count: 9, life: 0.28, speed: 1.8, trauma: 0, texture: 'splat02' },
  'room-cleared': NONE,
  'upgrade-applied': { color: '#54c7ff', size: 0.09, count: 14, life: 0.4, speed: 2.0, trauma: 0, texture: 'splat02' },
  // Compra en tienda (docs/plans/ECONOMY_PLAN.md, F1/F4): dorado como las
  // monedas que gasta, burst algo más contenido que la propia mejora aplicada.
  'upgrade-purchased': { color: '#ffd166', size: 0.08, count: 10, life: 0.35, speed: 1.8, trauma: 0, texture: 'splat02' },
  // Contacto con el tendero (docs/plans/ECONOMY_PLAN.md F4): solo abre el
  // modal, sin feedback visual propio (el ShopModal ya es aviso suficiente).
  'shop-opened': NONE,
  'room-entered': NONE,
  'doors-open': NONE,
  'door-locked': NONE,
  victory: { color: '#ffd166', size: 0.15, count: 40, life: 0.8, speed: 3.0, trauma: 0.3, texture: 'splat02' },
  // Run multi-mazmorra (GDD §10): mismo lenguaje visual que 'victory' (dorado)
  // pero más contenido — es un hito intermedio (jefe derrotado, quedan más),
  // no el clímax de la run.
  'dungeon-cleared': { color: '#ffd166', size: 0.12, count: 24, life: 0.6, speed: 2.4, trauma: 0.2, texture: 'splat02' },
  // ── Jefes (GDD §15) ──────────────────────────────────────────────────────
  'boss-door-sealed': NONE,
  'boss-phase-changed': { color: '#fff2c9', size: 0.12, count: 18, life: 0.4, speed: 2.6, trauma: 0.25, texture: 'splat02' },
  'boss-telegraph': NONE,
  // Clímax de la run (GDD §15.1 punto 8): la mayor combinación de partículas
  // + sacudida de cámara + pausa de impacto del juego (reactToEvent.ts añade
  // el hit-stop más largo, ver STRONG_HIT_DAMAGE_THRESHOLD / triggerHitStop).
  // Mismo lenguaje visual de "explosión" que barrel-explosion (radial, brasa).
  'boss-defeated': { color: '#ffd166', size: 0.22, count: 64, life: 0.9, speed: 4.2, trauma: 1, texture: 'disc' },
  // Guardián de Canto (GDD §15.2): rastro de polvo pétreo tenue mientras
  // carga (burst pequeño y frecuente, no debe saturar el pool a 60Hz) y
  // estallido de esquirlas más grande/anguloso en el punto de impacto.
  'boss-charge-dust': { color: '#8d8367', size: 0.07, count: 3, life: 0.35, speed: 0.6, trauma: 0, texture: 'splat02' },
  'boss-shard-burst': { color: '#c9c2a8', size: 0.1, count: 16, life: 0.4, speed: 2.8, trauma: 0.18, texture: 'splat02' },
  // Barriles rodantes (playtest 2026-07-06): la APARICIÓN es el inicio de la
  // caída del cielo (surge la sombra creciente, el barril aún está arriba), así
  // que sin burst propio (NONE) — el polvo va en el ATERRIZAJE ('boss-barrel-land').
  'boss-barrel-spawn': NONE,
  // Aterrizaje del barril caído (playtest 2026-07-06): burst de polvo pétreo a
  // ras de suelo + un pelín de trauma de cámara, para que el impacto contra el
  // suelo se sienta (el rebote visual del cuerpo lo hace el render).
  'boss-barrel-land': { color: '#a89a76', size: 0.11, count: 14, life: 0.4, speed: 2.2, trauma: 0.14, texture: 'splat02' },
  // Arrollar un barril con la carga ya dispara 'barrel-explosion' (su propio
  // burst grande); este evento es puramente informativo para effects/HUD sobre
  // el aturdimiento largo, sin burst propio (NONE) para no duplicar partículas.
  'boss-barrel-charge-stun': NONE,
  // Reina del Enjambre (GDD §15.3): burst pequeño y verdoso (mismo lenguaje
  // que el Trail, trailMaterial) en el punto de invocación, sin trauma de
  // cámara (no es un golpe, es un aviso ambiental de "ruido nuevo en la sala").
  'boss-wave-spawn': { color: '#4dd68a', size: 0.09, count: 10, life: 0.35, speed: 2.0, trauma: 0, texture: 'splat02' },
  // Reina del Enjambre, rediseño 2026-07-10 (GDD §15.3): columnas de piedra
  // (mismo lenguaje visual pétreo que los eventos del Guardián, 'boss-shard-burst'/
  // 'boss-barrel-land'). Agrietarse: astillas pequeñas, trauma leve (aviso, aún
  // no rompe nada) — se queda en el splat genérico. Romperse: burst mayor +
  // trauma notorio (−12% de vida del jefe) — ESE sí es "explosión" (columna
  // reventando), por eso entra en la familia de `disc`.
  // Reforzado 2026-08-31 (encargo de feedback visual: "al primer golpe:
  // grieta claramente visible, polvo, pequeños fragmentos... al destruirse:
  // efecto de destrucción MUCHO más fuerte"): los valores de arriba eran los
  // de ANTES del rediseño de columnas por-golpe (2 hp en vez de 3, sin rol
  // guardiana) y se quedaban cortos para el único aviso de daño visible antes
  // de romperse. `boss-column-broken` sube mucho más que `boss-column-cracked`
  // (proporción ~1.6-2.6× según el campo) para que la diferencia entre
  // "avisa" y "revienta" se sienta; se mantiene por debajo del trauma de
  // 'boss-defeated'/'barrel-explosion' (1) y de 'boss-columns-cleared' (0.5,
  // la ÚLTIMA columna) — romper una columna cualquiera nunca debe sacudir la
  // cámara más que el hito de quedarse sin ninguna.
  'boss-column-cracked': { color: '#c9c2a8', size: 0.09, count: 16, life: 0.4, speed: 2.4, trauma: 0.18, texture: 'splat02' },
  'boss-column-broken': { color: '#c9c2a8', size: 0.17, count: 42, life: 0.65, speed: 4.2, trauma: 0.45, texture: 'disc' },
  'boss-columns-cleared': { color: '#ff6bcb', size: 0.16, count: 34, life: 0.7, speed: 3.6, trauma: 0.5, texture: 'splat02' },
  // Simplificación 2026-08-31: una columna VIVA pare un minion (sustituye la
  // oleada única desde el cuerpo) — ceniza/polvo gris pálido, pequeño y sin
  // trauma (aviso ambiental, como 'boss-wave-spawn', que se emite a la vez).
  'boss-column-spawn': { color: '#b9b1a0', size: 0.07, count: 8, life: 0.35, speed: 1.6, trauma: 0, texture: 'splat02' },
  // Simplificación 2026-08-31: la Reina grita de dolor al romperse una
  // columna — mismo rosa-enjambre que 'boss-columns-cleared'/'enemy-died',
  // con trauma notorio (comunica que columna y jefe están conectados).
  'boss-column-roar': { color: '#ff6bcb', size: 0.12, count: 14, life: 0.45, speed: 2.4, trauma: 0.25, texture: 'splat02' },
  // El Prisma (GDD §15.4): chispazo blanco y barato al golpear con el arma
  // equivocada — feedback de "inmune", deliberadamente más pequeño y sin
  // trauma que 'enemy-hit'/'boss-hit' (no hay daño real que reforzar). Sigue
  // siendo un IMPACTO (chispa seca, no materia), por eso `shape_e`.
  'boss-immune-hit': { color: '#ffffff', size: 0.06, count: 6, life: 0.2, speed: 1.6, trauma: 0, texture: 'shape_e' },
};

/** Color de burst específico por tipo de objeto recogido (label del evento 'item-pickup'), GDD §12: dorado/rosa/azul. */
export const ITEM_PICKUP_COLOR: Record<string, string> = {
  coin: '#ffd166',
  potion: '#ff6bcb',
  key: '#8fe3ff',
};

/**
 * Color de burst de 'projectile-wall' según el arma que impactó (label del
 * evento: 'arrow'|'spell'). Mismos hex que `WEAPON_COLOR.arrow`/`.spell` en
 * `render/assets.ts`, duplicados aquí a propósito (mismo criterio que
 * `ITEM_PICKUP_COLOR`): reactToEvent.ts no importa three.js.
 */
export const PROJECTILE_WALL_COLOR: Record<string, string> = {
  arrow: '#54c7ff',
  spell: '#d8b4fe',
};
