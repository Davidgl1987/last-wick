/**
 * Render de ondas expansivas: un mesh de quad por slot del pool (4), con
 * material propio por slot creado UNA vez a nivel de módulo (la opacidad se
 * anima por slot, así que no pueden compartir material). Plano sobre el
 * suelo, crece de 0 al radio de la explosión y se desvanece.
 *
 * ── Por qué 4 materiales propios y NO `additiveVfxMaterial()` ─────────────
 * `additiveVfxMaterial()` (render/vfx-textures.ts) cachea por clave
 * `nombre|color|opacidad`: si los 4 slots la usaran, en cuanto dos ondas
 * activas coincidieran en opacidad en el mismo frame (algo casi garantizado,
 * ya que las 4 comparten la misma curva `0.85 * (1 - t)`) compartirían el
 * MISMO objeto `MeshBasicMaterial`, y la última onda actualizada en el
 * bucle le pisaría la opacidad a las demás dentro de ese frame. Por eso este
 * fichero sigue manteniendo su propio array de 4 materiales, mutados por
 * índice, ahora con geometría/mapa/blending de textura en vez de
 * `RingGeometry`.
 *
 * ── Textura y blending (VFX_PLAN.md §2) ────────────────────────────────────
 * Geometría `unitPlane` (render/assets.ts, lado 1) con `ring_a.png`
 * (`vfxTexture`, Light Mask de Kenney) en vez del `RingGeometry(0.82, 1, 48)`
 * de corte duro anterior: el frente de la onda queda difuminado en vez de
 * terminar en filo. `ring_a` es una Light Mask → SIEMPRE `AdditiveBlending`
 * (regla §2 del plan); con blending normal pintaría un cuadrado negro sobre
 * gran parte del área, porque el fondo de la textura es negro puro.
 *
 * ── Escala: el anillo NO está pegado al borde del cuadrado ────────────────
 * `unitPlane` mide 1×1 (medio-lado 0.5). La intuición ingenua es que
 * escalar a `radius * 2` basta (medio-lado en mundo = radius, el anillo
 * "inscrito" tocando el borde del cuadrado). Pero medido en la textura real
 * (256×256, decodificador PNG ad-hoc sobre la fila central, canal alfa
 * constante a 255 así que solo cuenta el RGB) el PICO de brillo del anillo
 * —lo que el jugador percibe como "el borde de la onda"— cae a 92px del
 * centro sobre un medio-ancho de 128px, es decir a fracción
 * `RING_PEAK_FRACTION = 92/128 = 0.71875` del medio-lado, no en el borde
 * (fracción 1): la textura deja margen a propósito para que el difuminado no
 * se corte en seco. Sin corregirlo, el anillo visible mediría
 * `radius * 0.71875` — por debajo del radio real de la explosión,
 * incumpliendo "lo visual promete lo mecánico" (AGENTS.md: el radio visible
 * de `barrel-explosion` debe seguir coincidiendo con `BARREL_BLAST_RADIUS`).
 * De ahí `RING_SCALE_FACTOR = 2 / RING_PEAK_FRACTION ≈ 2.7826`.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { unitPlane } from '@/game/render/assets';
import { vfxTexture } from '@/game/render/vfx-textures';
import { SHOCKWAVE_LIFE, SHOCKWAVE_POOL_SIZE, type ShockwavePool } from './shockwave';

/** Fracción del medio-ancho de `ring_a.png` donde cae el pico de brillo del anillo (medición documentada arriba). */
const RING_PEAK_FRACTION = 92 / 128;

/** Factor de escala del quad para que el PICO del anillo (no el borde del cuadrado) caiga exactamente en `radius` unidades de mundo. */
const RING_SCALE_FACTOR = 2 / RING_PEAK_FRACTION;

const ringMaterials: THREE.MeshBasicMaterial[] = [];
for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) {
  ringMaterials.push(
    new THREE.MeshBasicMaterial({
      map: vfxTexture('ring_a'),
      color: '#ffb066',
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
}

export function ShockwaveView({ pool }: { pool: ShockwavePool }) {
  const meshRefs = useRef<(THREE.Mesh | null)[]>(new Array<THREE.Mesh | null>(SHOCKWAVE_POOL_SIZE).fill(null));

  useFrame(() => {
    for (let i = 0; i < pool.capacity; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      if (!pool.active[i]) {
        mesh.visible = false;
        continue;
      }
      // t: 0 (recién nacida) → 1 (muere). Radio con ease-out, opacidad decae.
      const t = 1 - pool.life[i] / SHOCKWAVE_LIFE;
      const eased = 1 - (1 - t) * (1 - t);
      const radius = Math.max(0.05, pool.maxRadius[i] * eased);
      mesh.visible = true;
      mesh.position.set(pool.x[i], 0.04, pool.z[i]);
      mesh.scale.setScalar(radius * RING_SCALE_FACTOR);
      ringMaterials[i].opacity = 0.85 * (1 - t);
    }
  });

  return (
    <>
      {ringMaterials.map((material, i) => (
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
