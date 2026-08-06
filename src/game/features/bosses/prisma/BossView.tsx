/**
 * El Prisma (GDD §15.4, Fase B3, `bossId==='prisma'`): extraído de
 * `EnemyViews.tsx` en la pasada pre-release. El núcleo (mismo `bodyRef`
 * compartido del padre) MUTA su color al del arma activa
 * (`enemy.bossWeaponGateA`, mapeado con `WEAPON_COLOR` — el mismo mapeo
 * instantáneo arma↔color que ya usa la Weapon bar del héroe), en vez de
 * intercambiar materiales — un único Prisma vivo a la vez, mismo criterio que
 * `heroMaterial`. Telegraph de cambio de color: "tartamudeo" (parpadeo
 * rápido alternando el color actual y el siguiente, leído de
 * `bossTelegraphKind==='color-change:<arma>'`). Solape de fase 3
 * (`bossWeaponGateB!==''`): alterna los dos colores activos a un ritmo más
 * calmado. 3 gemas orbitando el núcleo dan silueta propia, distinta de
 * cuernos/corona.
 *
 * `applyPrismaBossFrame` se llama desde el ÚNICO `useFrame` de `EnemyMesh`
 * (EnemyViews.tsx), en el mismo punto exacto donde vivía este bloque antes de
 * la extracción — los refs los sigue poseyendo `EnemyMesh` (se pasan aquí por
 * parámetro) para no alterar el orden de mutación dentro del frame.
 */

import type { RefObject } from 'react';
import type { Mesh } from 'three';
import { prismaCoreMaterial, prismaGemGeometry, prismaGemMaterial, WEAPON_COLOR } from '@/game/render/assets';
import { makeSilhouetteMaterial } from '@/game/render/occlusion-silhouette';
import type { Enemy, World } from '@/game/world/types';

/** Velocidad angular del "tartamudeo" de color durante el telegraph de cambio (~10Hz, en rad/s: 2π×10). */
const PRISMA_COLOR_TELEGRAPH_BLINK_SPEED = 63;
/** Fase 3: ritmo más calmado (~4Hz) al alternar los 2 colores del solape. */
const PRISMA_OVERLAP_BLINK_SPEED = 25;
/** Velocidad angular de la órbita visual de las gemas del Prisma. */
const PRISMA_GEM_ORBIT_SPEED = 1.4;

/**
 * Silueta de oclusión del núcleo (occlusion-silhouette.ts): MUTABLE, a
 * diferencia de los otros 3 jefes — el Prisma se identifica por su color de
 * ARMA activa (GDD §15.4, "en cada momento el Prisma tiene UN color activo"),
 * así que perder ese color al quedar tapado por un muro sería perder
 * justo la información que el jugador necesita para saber con qué arma
 * dañarlo. Se actualiza en `applyPrismaBossFrame` en el mismo punto donde ya
 * se resuelve `prismaCoreMaterial.color` (mismo patrón que
 * `heroSilhouetteMaterial` siguiendo al arma activa en HeroView.tsx).
 * Arranca en el mismo color inicial que `prismaCoreMaterial`.
 */
export const prismaSilhouetteMaterial = makeSilhouetteMaterial(WEAPON_COLOR.body.clone());

/** Mapea el gate de arma ('ram'|'arrow'|'spell') al mismo color que `WEAPON_COLOR` del héroe ('ram'→'body'). */
export function prismaWeaponColor(weapon: string): (typeof WEAPON_COLOR)['body'] {
  if (weapon === 'arrow') return WEAPON_COLOR.arrow;
  if (weapon === 'spell') return WEAPON_COLOR.spell;
  return WEAPON_COLOR.body;
}

export function applyPrismaBossFrame(params: {
  enemy: Enemy;
  world: World;
  flashing: boolean;
  bodyRadius: number;
  prismaGemRefs: RefObject<(Mesh | null)[]>;
}): void {
  const { enemy, world, flashing, bodyRadius, prismaGemRefs } = params;
  // Núcleo con el color del arma activa (GDD §15.4): MUTA el color del
  // material compartido en vez de intercambiarlo (ver `restingBodyMaterial`
  // en EnemyViews.tsx). El flash de golpe tiene prioridad: mismo criterio que
  // el Guardián, que tampoco compite contra el flash de fase.
  if (!flashing) {
    const activeColor = prismaWeaponColor(enemy.bossWeaponGateA);
    const telegraphingColorChange =
      enemy.bossTelegraphKind.startsWith('color-change:') && world.time < enemy.bossTelegraphUntil;
    if (telegraphingColorChange) {
      // Tartamudeo (GDD §15.4): parpadeo rápido alternando el color actual y
      // el siguiente (leído del propio `bossTelegraphKind`).
      const nextWeapon = enemy.bossTelegraphKind.slice('color-change:'.length);
      const nextColor = prismaWeaponColor(nextWeapon);
      const blink = Math.sin(world.time * PRISMA_COLOR_TELEGRAPH_BLINK_SPEED) > 0;
      prismaCoreMaterial.color.copy(blink ? activeColor : nextColor);
    } else if (enemy.bossWeaponGateB !== '') {
      // Solape de fase 3 (GDD §15.4): alterna los dos colores activos a un
      // ritmo más calmado que el tartamudeo del telegraph.
      const overlapColor = prismaWeaponColor(enemy.bossWeaponGateB);
      const blink = Math.sin(world.time * PRISMA_OVERLAP_BLINK_SPEED) > 0;
      prismaCoreMaterial.color.copy(blink ? activeColor : overlapColor);
    } else {
      prismaCoreMaterial.color.copy(activeColor);
    }
    // Silueta de oclusión (ver comentario de cabecera de
    // `prismaSilhouetteMaterial`): sigue SIEMPRE el color recién resuelto del
    // núcleo, sea cual sea la rama de arriba (tartamudeo, solape o color
    // fijo) — un único punto de sincronización en vez de repetir el copy en
    // las 3 ramas.
    prismaSilhouetteMaterial.color.copy(prismaCoreMaterial.color);
  }

  // Gemas orbitando el núcleo (silueta propia, distinta de cuernos/corona).
  for (let i = 0; i < prismaGemRefs.current.length; i++) {
    const gem = prismaGemRefs.current[i];
    if (!gem) continue;
    const angle = world.time * PRISMA_GEM_ORBIT_SPEED + (i / prismaGemRefs.current.length) * Math.PI * 2;
    const orbitRadius = bodyRadius * 1.35;
    gem.position.set(Math.cos(angle) * orbitRadius, 0, Math.sin(angle) * orbitRadius);
    gem.rotation.y = angle * 1.5;
  }
}

/**
 * JSX específico del Prisma: 3 gemas orbitando el núcleo, silueta propia
 * (posición real recalculada en `applyPrismaBossFrame`). Vive dentro del
 * `<group ref={groupRef}>` del padre (EnemyViews.tsx), como el resto de
 * composición específica de jefe.
 */
export function PrismaBossExtras({ prismaGemRefs }: { prismaGemRefs: RefObject<(Mesh | null)[]> }) {
  return (
    <>
      {/* Silueta propia (GDD §15.4): 3 gemas pequeñas orbitando el núcleo
          (distinta de cuernos/corona) — posición real recalculada en
          `applyPrismaBossFrame` (órbita continua, siempre visible). */}
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            prismaGemRefs.current[i] = el;
          }}
          geometry={prismaGemGeometry}
          material={prismaGemMaterial}
        />
      ))}
    </>
  );
}
