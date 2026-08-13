/**
 * Render de fogonazos de impacto (VFX_PLAN T3): un quad `unitPlane` por slot
 * del pool (8), tumbado sobre el suelo, con material aditivo PROPIO por slot
 * creado UNA vez a nivel de módulo — mismo patrón que `ShockwaveView.tsx` y
 * por el mismo motivo: aquí la OPACIDAD y el COLOR se animan por slot cada
 * frame (el color lo decide `reactToEvent.ts` según el arma/tipo de golpe),
 * así que un único material cacheado por nombre (`additiveVfxMaterial`, que
 * cachea por `nombre|color|opacidad`) se pisaría entre los 8 slots activos a
 * la vez: NO usar ese helper aquí.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { unitPlane } from '@/game/render/assets';
import { vfxTexture } from '@/game/render/vfx-textures';
import { FLASH_POOL_SIZE, type FlashPool } from './flash';

/**
 * Altura de mundo sobre el suelo: mínima para no hacer z-fighting con el
 * suelo (mismo criterio que `GLOW_PUDDLE_GROUND_Y` = 0.03 en
 * `render/GlowPuddle.tsx`), pero distinta tanto de esa constante como de la
 * onda expansiva (`ShockwaveView.tsx`, 0.04) — un fogonazo y una onda pueden
 * nacer en el MISMO punto exacto (p.ej. 'barrel-explosion' dispara ambos vía
 * `reactToEvent.ts`), así que comparten altura harían z-fighting entre ellos.
 */
const FLASH_GROUND_Y = 0.05;

/** Fracción de la vida en la que la escala alcanza su pico antes de caer a 0 ("la escala hace un pico rápido y cae", VFX_PLAN T3). */
const FLASH_RISE_FRACTION = 0.2;
/** Escala mínima mientras el fogonazo está activo (evita escala exactamente 0 en el primer frame de vida). */
const FLASH_MIN_SCALE = 0.02;
/** Opacidad en el nacimiento del fogonazo (aditivo + Bloom de PostEffects.tsx: no hace falta más para leerse). */
const FLASH_MAX_OPACITY = 0.95;

/** Un material MUTABLE por slot (ver cabecera): opacity y color se reescriben cada frame en useFrame, nunca se recrean. */
const flashMaterials: THREE.MeshBasicMaterial[] = [];
for (let i = 0; i < FLASH_POOL_SIZE; i++) {
  flashMaterials.push(
    new THREE.MeshBasicMaterial({
      map: vfxTexture('shape_e'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    }),
  );
}

export function FlashView({ pool }: { pool: FlashPool }) {
  const meshRefs = useRef<(THREE.Mesh | null)[]>(new Array<THREE.Mesh | null>(FLASH_POOL_SIZE).fill(null));

  useFrame(() => {
    for (let i = 0; i < pool.capacity; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      if (!pool.active[i]) {
        mesh.visible = false;
        continue;
      }
      // t: 0 (recién nacido) → 1 (muere).
      const t = 1 - pool.life[i] / pool.maxLife[i];
      // Escala: sube lineal hasta el pico en FLASH_RISE_FRACTION de la vida,
      // luego cae lineal a 0 — el "pico rápido y cae" del plan, sin objetos
      // ni closures nuevos (solo aritmética escalar).
      const scaleT =
        t < FLASH_RISE_FRACTION ? t / FLASH_RISE_FRACTION : 1 - (t - FLASH_RISE_FRACTION) / (1 - FLASH_RISE_FRACTION);
      // unitPlane mide 1 de LADO (medio-lado 0.5): para un fogonazo de radio
      // `size` en el mundo, el quad se escala a size*2, no a size.
      const scale = Math.max(FLASH_MIN_SCALE, pool.size[i] * 2 * scaleT);
      mesh.visible = true;
      mesh.position.set(pool.x[i], FLASH_GROUND_Y, pool.z[i]);
      mesh.scale.setScalar(scale);
      const material = flashMaterials[i];
      material.color.setRGB(pool.r[i], pool.g[i], pool.b[i]);
      // Opacidad: ease-out sobre toda la vida (nace brillante, se apaga rápido).
      material.opacity = FLASH_MAX_OPACITY * (1 - t) * (1 - t);
    }
  });

  return (
    <>
      {flashMaterials.map((material, i) => (
        <mesh
          key={i}
          ref={(el) => {
            meshRefs.current[i] = el;
          }}
          geometry={unitPlane}
          material={material}
          rotation-x={-Math.PI / 2}
          visible={false}
        />
      ))}
    </>
  );
}
