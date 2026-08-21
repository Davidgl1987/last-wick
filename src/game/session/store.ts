/**
 * Store zustand SOLO para estado de UI de baja frecuencia (HP, monedero,
 * avisos, fase de juego, llave). Prohibido usarlo para nada que cambie cada
 * frame (cooldowns/barras de recarga se leen directamente de la sim vía rAF,
 * nunca vía este store). Las mejoras acumuladas (nivel por `UpgradeId`) no
 * viven aquí: se leen directamente de `session.world.hero.upgradeLevels`
 * donde hacen falta (ej. PauseModal), sin duplicar estado.
 *
 * Se sincroniza desde fuera (GameRoot/HUD) al drenar la cola de eventos y al
 * observar cambios de `world.phase`; nunca desde dentro del hot loop de sim.
 *
 * `notice` guarda una CLAVE de traducción (+ params), no la frase ya montada:
 * así cambiar de idioma con un aviso en pantalla lo re-traduce en vez de
 * dejar la frase vieja congelada en el idioma del momento en que ocurrió el
 * evento. `HUD.tsx` traduce al pintar (`t(notice.key, notice.params)`), no
 * quien llama a `showNotice` (`useGameLoop.ts`/`AimInput.tsx`).
 *
 * Nota sobre la regla ★ de ARCHITECTURE.md ("sim nunca importa React"): este
 * fichero importa el TIPO `TranslationKey` de `@/i18n` con `import type`, que
 * se borra por completo en tiempo de compilación (no arrastra React al
 * bundle). Además `store.ts` ya es capa de UI (zustand), no sim — la regla
 * protege a `engine/`/`world/`/los `.ts` de cada feature, no a este fichero.
 */

import { create } from 'zustand';
import { HERO_START_HP } from '@/game/features/hero/constants';
import type { TranslationKey } from '@/i18n';
import type { GamePhase } from '@/game/world/types';

/** Aviso transitorio del HUD: clave de traducción + params de interpolación (ver `t` en @/i18n). */
interface Notice {
  key: TranslationKey;
  params?: Record<string, string | number>;
}

interface UiState {
  hp: number;
  maxHp: number;
  /** Monedero gastable (docs/plans/ECONOMY_PLAN.md), no el total histórico recogido. */
  coins: number;
  hasKey: boolean;
  phase: GamePhase;
  roomsCleared: number;
  score: number;
  /** Sala actual (1-indexada) / total de la run (GDD §12), null en modo sala única. */
  roomIndex: number | null;
  totalRooms: number | null;
  /** Id ESTABLE de la sala actual (para `tRoomName`); `currentRoomName` sigue de fallback (sala sin clave propia, p.ej. importada por el editor). */
  currentRoomId: string;
  currentRoomName: string;
  notice: Notice | null;
  /** Cambia con cada aviso para retrigger aunque la clave se repita. */
  noticeSeq: number;
  showNotice: (key: TranslationKey, params?: Record<string, string | number>) => void;
  clearNotice: () => void;
  syncFromWorld: (snapshot: {
    hp: number;
    maxHp: number;
    coins: number;
    hasKey: boolean;
    phase: GamePhase;
    roomsCleared: number;
    score: number;
    roomIndex: number | null;
    totalRooms: number | null;
    currentRoomId: string;
    currentRoomName: string;
  }) => void;
  resetRun: () => void;
}

const initialState = {
  hp: HERO_START_HP,
  maxHp: HERO_START_HP,
  coins: 0,
  hasKey: false,
  phase: 'playing' as GamePhase,
  roomsCleared: 0,
  score: 0,
  roomIndex: null as number | null,
  totalRooms: null as number | null,
  currentRoomId: '',
  currentRoomName: '',
  notice: null as Notice | null,
  noticeSeq: 0,
};

export const useUiStore = create<UiState>((set) => ({
  ...initialState,
  showNotice: (key, params) => set((s) => ({ notice: { key, params }, noticeSeq: s.noticeSeq + 1 })),
  clearNotice: () => set({ notice: null }),
  syncFromWorld: (snapshot) => set(snapshot),
  resetRun: () => set({ ...initialState }),
}));
