/**
 * Cola de eventos de gameplay: ring buffer preasignado.
 *
 * La sim publica eventos y effects/ui los drenan cada frame. Cero asignaciones
 * en el hot path: los slots se crean una vez y se reutilizan mutándolos.
 *
 * Diseño del slot: en lugar de una unión discriminada con objetos distintos
 * por variante (que obligaría a asignar en cada push), cada slot es una
 * estructura plana con el superconjunto de campos y un discriminante `type`.
 * Fase 2: añadir variantes ('impact', 'enemy-died', 'barrel-explosion',
 * 'player-damaged'...) ampliando `GameEventType` y, si hace falta, añadiendo
 * campos numéricos/string al slot (siempre reutilizables, nunca objetos nuevos).
 */

export type GameEventType =
  | 'launch'
  | 'wall-bounce'
  /**
   * Playtest 2026-07-16 ("las flechas no tienen efecto al chocar con las
   * paredes"): un proyectil del HÉROE (flecha o hechizo) choca contra un
   * muro/obstáculo — se emite en cada colisión de `stepHeroProjectileCollisions`
   * (`features/combat/combat.ts`), tanto si el proyectil se apaga (flecha,
   * o hechizo sin rebotes) como si sobrevive rebotando (hechizo con
   * `bouncesLeft`). label = arma que impactó ('arrow'|'spell'), usado por
   * `reactToEvent.ts`/`burstTable.ts` para colorear el burst del arma
   * (distinto del 'wall-bounce' genérico gris, que sigue cubriendo el rebote
   * del CUERPO del héroe y de proyectiles enemigos).
   */
  | 'projectile-wall'
  /**
   * Un enemigo dispara un proyectil: el arquetipo *shooter*
   * (`features/enemies/shooter/ai.ts`) al final de su carga, y La Tormenta
   * (`features/bosses/storm/pattern.ts`) en cada bala de sus 3 patrones.
   * Evento nuevo (encargo de audio, ver `audio/eventSfx.ts`): antes de esto
   * un disparo enemigo no emitía nada, así que no tenía sonido propio. El
   * Prisma NO lo emite aquí — sus disparos ya viajan como `boss-telegraph`
   * con label `<arma>-fire` (`prisma-arrow-fire`/`prisma-spell-fire`), y
   * `eventSfx.ts` resuelve ESE label al mismo clip `enemy-shot` sin duplicar
   * el evento.
   */
  | 'enemy-shot'
  | 'enemy-hit'
  /** Golpe del jugador que daña a un JEFE (vs 'enemy-hit' de enemigos normales): shake grande, escalado por daño (playtest 2026-07-10: "más shake al dañar al jefe, menos a enemigos pequeños"). intensity = daño. */
  | 'boss-hit'
  | 'enemy-died'
  | 'player-damaged'
  | 'player-died'
  /**
   * Modo dios de playtest (`?godmode`, render/debug-params.ts): el héroe
   * llegó a 0 hp pero en vez de 'player-died'/game-over revive a maxHp y la
   * partida sigue (`applyDamageToHero`, features/combat/combat.ts).
   */
  | 'godmode-revive'
  | 'shield-block'
  | 'pit-fall'
  | 'pit-respawn'
  | 'spikes-hit'
  | 'barrel-explosion'
  | 'item-pickup'
  | 'room-cleared'
  | 'upgrade-applied'
  /** Compra en tienda (docs/plans/ECONOMY_PLAN.md, F1 economía/F4 tienda): intensity = precio pagado. */
  | 'upgrade-purchased'
  /** Contacto con el tendero de la sala de tienda abre la fase 'shopping' (docs/plans/ECONOMY_PLAN.md F4). */
  | 'shop-opened'
  | 'room-entered'
  | 'doors-open'
  | 'door-locked'
  | 'victory'
  /**
   * Run multi-mazmorra (GDD §10): se limpia la sala de un jefe que NO es el
   * último de la secuencia — quedan más mazmorras/jefes por delante. Distinto
   * de 'victory' (fin real de la run, último jefe derrotado).
   */
  | 'dungeon-cleared'
  // ── Jefes (GDD §15) ──────────────────────────────────────────────────────
  /** Se sella la puerta de la sala de jefe al entrar (GDD §15.1 punto 7). */
  | 'boss-door-sealed'
  /** Cambio de fase por umbral de vida (66%/33%, GDD §15.1 punto 3). label = fase alcanzada ('2'|'3'). */
  | 'boss-phase-changed'
  /** Aviso de ataque telegrafiado (GDD §15.1 punto 2). label = `bossTelegraphKind`. */
  | 'boss-telegraph'
  /** El jefe muere: dispara el clímax audiovisual (GDD §15.1 punto 8). */
  | 'boss-defeated'
  /**
   * Guardián de Canto (GDD §15.2): rastro de polvo emitido periódicamente
   * mientras carga. Genérico (cualquier jefe futuro con un ataque de
   * embestida puede reutilizarlo); intensity = velocidad de carga (u/s).
   */
  | 'boss-charge-dust'
  /**
   * Guardián de Canto fase 3 (GDD §15.2): campo de esquirlas temporal en el
   * punto donde una carga choca contra roca/pared. intensity = radio del
   * campo (u).
   */
  | 'boss-shard-burst'
  /**
   * Guardián de Canto (GDD §15.2, playtest 2026-07-06): aparece un barril
   * rodante en el perímetro de la arena — INICIO de la caída del cielo (surge
   * la sombra creciente en el suelo como aviso legible desde toda la sala).
   */
  | 'boss-barrel-spawn'
  /**
   * Guardián de Canto (GDD §15.2, playtest 2026-07-06): el barril que caía del
   * cielo ATERRIZA (rebote + burst de polvo). Lo emite el render al detectar el
   * cruce de `barrel.landingAt`, no la sim: el aterrizaje visual cae entre
   * ticks de dt fijo, así el polvo se sincroniza con el frame en que el cuerpo
   * toca suelo. A partir de aquí el barril es arrollable/explotable normal.
   */
  | 'boss-barrel-land'
  /**
   * Guardián de Canto (GDD §15.2): su carga arrolla un barril rodante — el
   * barril explota (daño normal + shockwave, ya cubierto por
   * 'barrel-explosion') y el Guardián queda aturdido más tiempo de lo normal.
   * Evento propio para diferenciar el aturdimiento largo del choque normal
   * contra roca/pared (mismo `boss-telegraph`-style feedback, intensity =
   * duración del aturdimiento).
   */
  | 'boss-barrel-charge-stun'
  /**
   * Reina del Enjambre (GDD §15.3): invoca una oleada de larvas. intensity =
   * nº de larvas invocadas en esta oleada (puede ser menor que
   * QUEEN_LARVA_PER_WAVE si el cap de vivas ya estaba casi lleno).
   */
  | 'boss-wave-spawn'
  /**
   * Reina del Enjambre (rediseño 2026-07-10, GDD §15.3): una columna de su
   * sala recibe el 1.º golpe de embestida y se AGRIETA (le queda 1 golpe más
   * antes de romperse). Telegrafía la rotura inminente.
   */
  | 'boss-column-cracked'
  /**
   * Reina del Enjambre (rediseño 2026-07-10, GDD §15.3): una columna recibe
   * el 2.º golpe de embestida y se ROMPE — se retira su Obstacle sólido y el
   * jefe pierde QUEEN_COLUMN_DAMAGE_FRACTION de su vida máxima.
   */
  | 'boss-column-broken'
  /**
   * Reina del Enjambre (rediseño 2026-07-10, GDD §15.3): cae la ÚLTIMA columna
   * — el jefe queda "desconectado" y pasa a vulnerable PERMANENTE (daño
   * completo) para rematar el último 1/3 de su vida a golpes normales.
   */
  | 'boss-columns-cleared'
  /**
   * Reina del Enjambre (simplificación 2026-08-31, GDD §15.3): una columna
   * VIVA pare un minion desde su propio reloj (`QueenColumn.spawnTimer`, ver
   * `queen/pattern.ts::queenStepColumnSpawns`) — sustituye la oleada única
   * sincronizada desde el cuerpo. Ceniza/polvo + temblor de la columna;
   * emitido junto al ya existente `boss-wave-spawn` (mismo instante, misma
   * posición: la de la columna).
   */
  | 'boss-column-spawn'
  /**
   * Reina del Enjambre (simplificación 2026-08-31, GDD §15.3): la Reina GRITA
   * de dolor al romperse una columna — comunica que columna y jefe están
   * conectados (sin el rol guardiana defendiéndola, es el único aviso de que
   * romper una columna también le duele A ELLA). Emitido en la posición del
   * BOSS, junto al ya existente `boss-column-broken`.
   */
  | 'boss-column-roar'
  /**
   * El Prisma (GDD §15.4, Fase B3): golpe con el arma equivocada para el
   * color activo (o para ninguno de los dos en solape de fase 3) — el daño se
   * descarta por completo y el render dibuja un chispazo de "inmune" en vez
   * del flash de golpe normal. Distinto de 'enemy-hit'/'boss-hit' (que sí
   * bajan HP): este evento nunca acompaña una bajada de vida real.
   */
  | 'boss-immune-hit';

export interface GameEvent {
  type: GameEventType;
  /** Posición del evento en el plano del suelo. */
  x: number;
  y: number;
  /**
   * Magnitud del evento: fuerza [0,1] en 'launch',
   * velocidad normal de impacto (u/s) en 'wall-bounce'.
   */
  intensity: number;
  /** Etiqueta textual opcional (ej. nombre de sala en 'room-entered'); '' si no aplica. */
  label: string;
}

export interface EventQueue {
  readonly slots: GameEvent[];
  readonly capacity: number;
  /** Índice del evento más antiguo. */
  head: number;
  /** Número de eventos pendientes. */
  count: number;
}

export function createEventQueue(capacity = 64): EventQueue {
  const slots: GameEvent[] = [];
  for (let i = 0; i < capacity; i++) {
    slots.push({ type: 'launch', x: 0, y: 0, intensity: 0, label: '' });
  }
  return { slots, capacity, head: 0, count: 0 };
}

/**
 * Publica un evento mutando el siguiente slot libre.
 * Si la cola está llena, sobrescribe el más antiguo (los eventos de effects
 * son descartables; nunca debe bloquear la sim).
 */
export function pushEvent(
  queue: EventQueue,
  type: GameEventType,
  x: number,
  y: number,
  intensity: number,
  label = '',
): void {
  let index: number;
  if (queue.count === queue.capacity) {
    index = queue.head;
    queue.head = (queue.head + 1) % queue.capacity;
  } else {
    index = (queue.head + queue.count) % queue.capacity;
    queue.count++;
  }
  const slot = queue.slots[index];
  slot.type = type;
  slot.x = x;
  slot.y = y;
  slot.intensity = intensity;
  slot.label = label;
}

/**
 * Visita todos los eventos pendientes en orden y vacía la cola.
 * No crea arrays: el consumidor recibe cada slot por callback y NO debe
 * retener la referencia (el slot se reutilizará).
 */
export function drainEvents(queue: EventQueue, visit: (event: GameEvent) => void): void {
  for (let i = 0; i < queue.count; i++) {
    visit(queue.slots[(queue.head + i) % queue.capacity]);
  }
  queue.head = 0;
  queue.count = 0;
}
