/**
 * `readForcedTestRoom` (debug-params.ts): herramienta de playtest `?room=test`
 * que salta directo a la Sala de Pruebas (`testRoom`, rooms.ts) sin depender
 * del azar de la mazmorra (encargo de David 2026-08-11). Mismo patrón que
 * `?boss=<id>` (readForcedBossRoom): estos tests fijan su contrato —
 * ausencia de parámetro → null, valor 'test' (insensible a mayúsculas) → la
 * sala, cualquier otro valor → null.
 *
 * `window` no existe en el entorno de test (vite.config.ts: `environment:
 * 'node'`, sin DOM) — se stubea vía `vi.stubGlobal` con solo lo que la
 * función lee (`location.search`) y se limpia en `afterEach`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readForcedTestRoom } from './debug-params';
import { testRoom } from '@/game/features/dungeon/rooms';

function withSearch(search: string): void {
  vi.stubGlobal('window', { location: { search } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readForcedTestRoom', () => {
  it('sin parámetro `room` en la URL: null', () => {
    withSearch('');
    expect(readForcedTestRoom()).toBeNull();
  });

  it('`?room=test`: devuelve la Sala de Pruebas', () => {
    withSearch('?room=test');
    expect(readForcedTestRoom()).toBe(testRoom);
  });

  it('`?room=TEST` (mayúsculas): mismo criterio insensible a mayúsculas que `?boss=`', () => {
    withSearch('?room=TEST');
    expect(readForcedTestRoom()).toBe(testRoom);
  });

  it('`?room=` con un valor que no es `test`: null (no revienta con valores desconocidos)', () => {
    withSearch('?room=otra-sala');
    expect(readForcedTestRoom()).toBeNull();
  });
});
