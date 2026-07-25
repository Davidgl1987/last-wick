/**
 * Charco de luz falso: disco horizontal pegado al suelo, aditivo, que
 * SUSTITUYE a una fuente de luz real. Nace de generalizar el halo que hasta
 * ahora solo llevaban los proyectiles enemigos
 * (`enemyProjectileGlowHaloMaterialForTag`, `assets.ts`) a un componente
 * reutilizable, en la pasada de recorte de luces de la rama
 * `luces-optimizadas` (la escena pasa de ~43 luces reales a 7): three.js
 * recompila TODOS los programas de shader cada vez que cambia el Nº de luces
 * VISIBLES en la escena, así que cuantas menos pointLight/spotLight reales
 * monte el juego (proyectiles, enemigos, antorchas...), menos
 * recompilaciones y menos coste por fuente de luz. Un `GlowPuddle` es SOLO
 * un mesh transparente con blending ADITIVO (mismo mapa radial
 * `glowHaloTexture` que ya usaban los halos de proyectil, teñido por
 * `material.color`) en vez de una luz — indistinguible de una luz real desde
 * la cámara cenital del juego, coste ~0 comparado con una pointLight de
 * verdad. Enemigos y antorchas lo reutilizan (tareas aparte).
 *
 * API pensada para que esos consumidores lo usen SIN poder tocar este
 * fichero:
 * - `meshRef`: el mesh se expone tal cual (mismo patrón que `lanternRef`/
 *   `fillLightRef` de `EnemyLightsRig`, `features/enemies/EnemyLights.tsx`)
 *   para que quien lo usa mueva/oculte el charco desde SU PROPIO useFrame,
 *   sin re-render de React — un enemigo lo hace SEGUIR su posición cada
 *   frame (igual que ya hace con su blob shadow, ver `EnemyViews.tsx`); una
 *   antorcha FIJA ni lo toca tras montarlo: con la posición inicial de
 *   montaje le basta.
 * - `color`/`radius`/`opacity` son props JSX "de una vez", igual que
 *   cualquier mesh estático de este repo: si necesitan animarse frame a
 *   frame, el consumidor muta `meshRef.current` directamente (radio →
 *   `.scale`, apagar/encender → `.visible`), nunca reasignando la prop.
 * - `position`/`visible` fijan el estado de montaje; con un objeto fijo
 *   (antorcha) suele bastar con esto, con un objeto que se mueve (enemigo)
 *   el consumidor los sobreescribe cada frame vía `meshRef.current`.
 *
 * Altura: por defecto se ancla a `GLOW_PUDDLE_GROUND_Y`, el mismo offset
 * mínimo sobre el suelo (~0.03 de mundo) que ya usaba el halo de proyectil
 * enemigo (antes `PROJECTILE_ENEMY_HALO_LOCAL_Y`, ver `ProjectileView.tsx`)
 * para no hacer z-fighting con el suelo. Si el `GlowPuddle` cuelga de un
 * group padre que YA vive a otra altura de mundo (p.ej. el group de un
 * enemigo, que bota y cambia de Y con `bodyRadius + bob`), el consumidor
 * calcula el offset LOCAL igual que ya hace con su propia sombra
 * (`shadow.position.set(0, 0.02 - (bodyRadius + bob), 0)` en
 * `EnemyViews.tsx`), reutilizando esta misma constante en vez de otro número
 * mágico.
 */

import type { RefObject } from 'react';
import type { ColorRepresentation, Mesh } from 'three';
import { glowPuddleMaterial, unitCircle } from '@/game/render/assets';

/** Altura mínima de mundo sobre el suelo (evita z-fighting): mismo valor que ya usaba el halo de proyectil enemigo. */
export const GLOW_PUDDLE_GROUND_Y = 0.03;

export function GlowPuddle({
  meshRef,
  color,
  radius,
  opacity,
  position,
  visible = true,
}: {
  /** Ref al mesh del disco: el consumidor lo mueve/oculta desde su propio useFrame (ver cabecera del fichero). */
  meshRef: RefObject<Mesh | null>;
  /** Color del charco (material aditivo cacheado por color+opacidad, ver `glowPuddleMaterial` en `assets.ts`). */
  color: ColorRepresentation;
  /** Radio del disco, en unidades de mundo (escala `unitCircle`). */
  radius: number;
  /** Opacidad del blending aditivo (~0.15-0.2 para no saturar; ver los halos existentes en `assets.ts`). */
  opacity: number;
  /** Posición de montaje (local al padre); por defecto en el origen del padre, a `GLOW_PUDDLE_GROUND_Y` de altura. */
  position?: readonly [number, number, number];
  /** Visibilidad de montaje; el consumidor puede alternarla después vía `meshRef.current.visible`, sin re-render. */
  visible?: boolean;
}) {
  return (
    <mesh
      ref={meshRef}
      geometry={unitCircle}
      material={glowPuddleMaterial(color, opacity)}
      rotation-x={-Math.PI / 2}
      position={position ?? [0, GLOW_PUDDLE_GROUND_Y, 0]}
      scale={radius}
      visible={visible}
    />
  );
}
