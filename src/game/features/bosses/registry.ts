/**
 * Tabla de definición de jefes (GDD §15): un jefe = una entrada aquí, en el
 * mismo espíritu que `sim/upgrades.ts::UPGRADE_POOL` — B1-B4 solo añaden una
 * entrada a `BOSS_DEFS` + sus funciones `stepPattern`/`onPhaseChanged`, sin
 * tocar el framework de `lifecycle.ts`.
 */

import type { BossId } from '@/game/world/types';
import { GUARDIAN_BARREL_DAMAGE_FRACTION, GUARDIAN_DAMAGE_OUTSIDE_WINDOW, GUARDIAN_HIT_DAMAGE_CAP_FRACTION, GUARDIAN_MAX_HP, GUARDIAN_RADIUS } from '@/game/features/bosses/guardian/constants';
import { guardianOnPhaseChanged, guardianStepPattern } from '@/game/features/bosses/guardian/pattern';
import { QUEEN_DAMAGE_OUTSIDE_WINDOW, QUEEN_HIT_DAMAGE_CAP_FRACTION, QUEEN_MAX_HP, QUEEN_RADIUS } from '@/game/features/bosses/queen/constants';
import { queenOnInit, queenOnPhaseChanged, queenStepPattern } from '@/game/features/bosses/queen/pattern';
import { stepQueenColumns } from '@/game/features/bosses/queen/columns';
import { PRISMA_DAMAGE_OUTSIDE_WINDOW, PRISMA_HIT_DAMAGE_CAP_FRACTION, PRISMA_MAX_HP, PRISMA_RADIUS } from '@/game/features/bosses/prisma/constants';
import { prismaOnInit, prismaOnPhaseChanged, prismaStepPattern } from '@/game/features/bosses/prisma/pattern';
import { STORM_DAMAGE_OUTSIDE_WINDOW, STORM_HIT_DAMAGE_CAP_FRACTION, STORM_MAX_HP } from '@/game/features/bosses/storm/machine-constants';
import { STORM_RADIUS } from '@/game/features/bosses/storm/constants';
import { stormOnInit, stormOnPhaseChanged, stormStepPattern } from '@/game/features/bosses/storm/pattern';
import { testBossStepPattern } from '@/game/features/bosses/test-boss/pattern';
import type { BossDef } from './types';

/**
 * Orden canónico de dificultad de los jefes de diseño (`test-boss` queda
 * fuera, es el jefe trivial de dev/tests — ver rooms.ts). Feedback de
 * playtest de David (2026-07-15): "como este [La Tormenta] es el más
 * difícil, me gustaría que estuviera el último, así que mejor los jefes por
 * orden, y entre jefes, mazmorras aleatorias". Vive aquí (junto a
 * `BOSS_DEFS`, la tabla de referencia de todos los jefes) en vez de en
 * session.ts, porque es una propiedad de DISEÑO de los jefes, no del flujo de
 * la run: session.ts la consume en `deriveBossSequence` para ordenar los
 * jefes presentes en el pool de cada partida.
 */
export const BOSS_DIFFICULTY_ORDER: readonly BossId[] = ['guardian', 'queen', 'prisma', 'storm'];

export const BOSS_DEFS: Record<BossId, BossDef> = {
  'test-boss': {
    id: 'test-boss',
    maxHp: 12,
    hitDamageCapFraction: [0.6, 0.65, 0.7],
    damageOutsideWindow: 0,
    stepPattern: testBossStepPattern,
  },
  guardian: {
    id: 'guardian',
    maxHp: GUARDIAN_MAX_HP,
    radius: GUARDIAN_RADIUS,
    hitDamageCapFraction: GUARDIAN_HIT_DAMAGE_CAP_FRACTION,
    damageOutsideWindow: GUARDIAN_DAMAGE_OUTSIDE_WINDOW,
    barrelDamageFraction: GUARDIAN_BARREL_DAMAGE_FRACTION,
    stepPattern: guardianStepPattern,
    onPhaseChanged: guardianOnPhaseChanged,
  },
  queen: {
    id: 'queen',
    maxHp: QUEEN_MAX_HP,
    radius: QUEEN_RADIUS,
    hitDamageCapFraction: QUEEN_HIT_DAMAGE_CAP_FRACTION,
    // Rediseño 2026-07-10 (GDD §15.3, docs/plans/QUEEN_REDESIGN_PLAN.md): su
    // vida está en las columnas, pero al cuerpo SIEMPRE le entra daño (cualquier
    // ataque): reducido por `damageOutsideWindow` (0.15) fuera de aturdimiento,
    // completo mientras está ATURDIDA (al romper columna, o permanente con todas
    // rotas — ver `queenStepPattern`/`stepQueenColumns`).
    damageOutsideWindow: QUEEN_DAMAGE_OUTSIDE_WINDOW,
    stepPattern: queenStepPattern,
    // Su vida vive en las columnas: las embestidas del héroe contra ellas se
    // resuelven en la fase de contacto del tick (ver `stepBossStates`).
    stepState: stepQueenColumns,
    onPhaseChanged: queenOnPhaseChanged,
    onInit: queenOnInit,
  },
  prisma: {
    id: 'prisma',
    maxHp: PRISMA_MAX_HP,
    radius: PRISMA_RADIUS,
    hitDamageCapFraction: PRISMA_HIT_DAMAGE_CAP_FRACTION,
    // Escudo de color rotatorio (GDD §15.4): el gate real (solo el arma del
    // color activo hace daño de verdad) vive en `Enemy.bossWeaponGateA/B` y
    // se comprueba en `applyDamageToEnemy` (combat.ts). Sin ventana de
    // vulnerabilidad (tuning post-playtest 2026-07-17): `bossVulnerable` es
    // permanentemente `true` (`prisma/pattern.ts::prismaOnInit`), así que
    // este factor (1 = neutro) nunca llega a aplicarse — se deja explícito
    // por defensividad, ver `PRISMA_DAMAGE_OUTSIDE_WINDOW`.
    damageOutsideWindow: PRISMA_DAMAGE_OUTSIDE_WINDOW,
    stepPattern: prismaStepPattern,
    onPhaseChanged: prismaOnPhaseChanged,
    onInit: prismaOnInit,
  },
  storm: {
    id: 'storm',
    maxHp: STORM_MAX_HP,
    radius: STORM_RADIUS,
    hitDamageCapFraction: STORM_HIT_DAMAGE_CAP_FRACTION,
    // Jefe de esquive puro (GDD §15.5): sin puzzle de arma/color (a
    // diferencia del Prisma, cualquier arma le hace daño siempre), pero la
    // recarga sigue siendo LA ventana de vulnerabilidad — fuera de ella,
    // inmune del todo (0), ver el porqué en machine-constants.ts.
    damageOutsideWindow: STORM_DAMAGE_OUTSIDE_WINDOW,
    stepPattern: stormStepPattern,
    onPhaseChanged: stormOnPhaseChanged,
    onInit: stormOnInit,
  },
};

export function getBossDef(id: BossId): BossDef {
  return BOSS_DEFS[id];
}
