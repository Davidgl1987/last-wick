/**
 * Máquina de dos fases (saliendo / entrando) para el fundido CRUZADO de un
 * slot del pool de antorchas (`TorchLightPool.tsx`, ver "POP al reasignar" en
 * su cabecera). Extraída como función PURA por el mismo motivo que
 * `light-pool.ts::selectNearestInto`: se llama una vez por frame y por slot
 * desde `useFrame`, así que conviene poder testearla sin montar three.js/R3F
 * ni depender de `document` (mismo problema que documenta la cabecera de
 * `torch-placements.ts` para justificar por qué esa función tampoco importa
 * nada con efectos de módulo).
 *
 * Motivación del cambio (antes solo había fundido de ENTRADA): cuando
 * `selectNearestInto` reasigna un slot a un emisor distinto, la antorcha
 * SALIENTE cortaba en seco —intensidad a 0 en el mismo frame— mientras la
 * ENTRANTE aparecía ya en la posición nueva y subía desde 0. Con las dos
 * ocurriendo en frames contiguos se lee como "se apaga una y se enciende
 * otra", justo el parpadeo que reporta David en la sala de la tienda. El
 * fundido cruzado ataca eso: al cambiar de emisor, el slot primero BAJA la
 * intensidad hasta 0 sin moverse (conserva posición/color/cono del emisor
 * VIEJO — fase 'exiting'), y solo entonces salta al emisor nuevo y sube
 * (fase 'entering'). El resultado visual es un cruce, no un pop.
 *
 * Diseño del estado (`SlotFadeState`, mutado in-place por `stepSlotFade` —
 * CERO asignaciones por llamada, mismo criterio que `selectNearestInto`):
 * - `displayedIdx`: qué emisor está MOSTRANDO el slot ahora mismo (de aquí
 *   sale la posición/color/cono que debe pintar el caller). Puede ir por
 *   detrás del índice recién elegido por `selectNearestInto` mientras dura
 *   la fase de salida — es justo lo que hace posible conservar el emisor
 *   viejo mientras se apaga.
 * - `pendingIdx`: el emisor al que saltar cuando termine la fase de salida.
 *   Solo tiene sentido durante 'exiting'; se actualiza cada frame con la
 *   asignación más reciente (por si `selectNearestInto` vuelve a cambiar de
 *   idea a media salida) pero eso NO reinicia el cronómetro de la salida —
 *   si lo reiniciara, una reasignación por frame en el punto de equilibrio
 *   entre dos antorchas podría dejar un slot fundiendo a negro
 *   indefinidamente. Prioriza terminar la fase en curso a tiempo fijo.
 * - `phase`: 'entering' | 'exiting'.
 * - `phaseElapsed`: segundos transcurridos en la fase ACTUAL (se reinicia en
 *   cada transición de fase, no es acumulado global).
 *
 * `displayedIdx`/`pendingIdx` usan los mismos códigos que `nearestScratch` de
 * `TorchLightPool.tsx`: -1 = "sin emisor" (menos candidatos que tamaño de
 * pool, o héroe lejos de todos), más `UNASSIGNED_EMITTER` (-2) = "este slot
 * nunca ha mostrado nada todavía" (arranque de la run). Ambos son <0 y se
 * tratan igual en un sitio clave: si el slot no tiene NADA visible que
 * conservar (viene de -1 o de UNASSIGNED_EMITTER), no tiene sentido abrir una
 * fase de salida para fundir "nada" — se salta directo a mostrar el emisor
 * nuevo y entra desde 0, que es exactamente el fundido de entrada que ya
 * existía antes de este cambio.
 */

/** Sentinela de "este slot nunca ha mostrado un emisor todavía" (arranque de la run). Distinto de -1 ("sin emisor en el top-K de este frame"). */
export const UNASSIGNED_EMITTER = -2;

export type SlotFadePhase = 'entering' | 'exiting';

export interface SlotFadeState {
  phase: SlotFadePhase;
  /** Índice (en la lista de emisores) que el slot está mostrando AHORA MISMO: de aquí sale posición/color/cono. */
  displayedIdx: number;
  /** Índice al que saltar cuando termine la fase de salida; solo relevante mientras `phase === 'exiting'`. */
  pendingIdx: number;
  /** Segundos transcurridos en la fase actual. */
  phaseElapsed: number;
}

/** Estado inicial de un slot: nada mostrado todavía, listo para entrar directo en cuanto se le asigne un emisor. */
export function createSlotFadeState(): SlotFadeState {
  return {
    phase: 'entering',
    displayedIdx: UNASSIGNED_EMITTER,
    pendingIdx: UNASSIGNED_EMITTER,
    phaseElapsed: 0,
  };
}

/**
 * Avanza un frame la máquina de un slot y devuelve la fracción de intensidad
 * [0,1] a aplicar sobre el emisor que el slot está mostrando este frame
 * (`state.displayedIdx` tras la llamada — el caller lo lee del propio
 * `state`, no se devuelve aparte). Muta `state` in-place; el caller lo crea
 * una vez por slot (`createSlotFadeState`) y lo reutiliza cada frame.
 *
 * @param state Estado del slot (mutado in-place).
 * @param desiredIdx Índice elegido este frame por `selectNearestInto` para
 *   este slot (-1 si ninguno).
 * @param delta Segundos desde el frame anterior.
 * @param phaseDuration Duración en segundos de CADA fase (salida y entrada
 *   por separado, no el ciclo completo — ver `TORCH_POOL_FADE_PHASE_DURATION`
 *   en `TorchLightPool.tsx`).
 */
export function stepSlotFade(state: SlotFadeState, desiredIdx: number, delta: number, phaseDuration: number): number {
  if (state.phase === 'entering') {
    if (desiredIdx !== state.displayedIdx) {
      if (state.displayedIdx < 0) {
        // Nada visible que conservar (primera asignación del slot, o venía
        // apagado por falta de candidatos): entra directo, sin fase de salida.
        state.displayedIdx = desiredIdx;
        state.phaseElapsed = 0;
      } else {
        // Cambio de emisor con algo visible en pantalla: arranca la SALIDA.
        // `displayedIdx` NO cambia todavía — el slot sigue mostrando el
        // emisor viejo (posición/color/cono) mientras se apaga.
        state.phase = 'exiting';
        state.pendingIdx = desiredIdx;
        state.phaseElapsed = 0;
      }
    } else if (state.phaseElapsed < phaseDuration) {
      state.phaseElapsed += delta;
    }
  } else {
    // 'exiting': recuerda el destino más reciente por si `selectNearestInto`
    // cambia de idea a media salida, pero NO reinicia el cronómetro (ver
    // cabecera del fichero — evita fundidos que nunca terminan).
    state.pendingIdx = desiredIdx;
    state.phaseElapsed += delta;
    if (state.phaseElapsed >= phaseDuration) {
      // Salida completa (intensidad ya en 0 este mismo frame): salta al
      // emisor nuevo y arranca la ENTRADA desde 0.
      state.phase = 'entering';
      state.displayedIdx = state.pendingIdx;
      state.pendingIdx = UNASSIGNED_EMITTER;
      state.phaseElapsed = 0;
    }
  }

  if (state.displayedIdx < 0) return 0;
  return state.phase === 'exiting'
    ? 1 - Math.min(1, state.phaseElapsed / phaseDuration)
    : Math.min(1, state.phaseElapsed / phaseDuration);
}
