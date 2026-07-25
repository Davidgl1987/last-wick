/**
 * Antorcha de muro reutilizable (rama `estilo-oscuro`, playtest: "los cirios
 * de los jefes, parece que puedes chocar con ellos... o los haces más
 * pequeños y pegados a la pared, como antorchas"): reemplaza los cirios
 * grandes sueltos en mitad de la sala por antorchas pequeñas ADOSADAS al
 * muro, fuera del carril de juego — atrezzo visual puro (SIN colisión, la
 * sim no las conoce).
 *
 * GEOMETRÍA PURA desde el recorte de luces de la rama `luces-optimizadas`
 * (escena de ~43 luces reales a 7): `WallTorch` ya NO monta ninguna
 * `spotLight`/`object3D` de target propios — antes cada antorcha era una luz
 * real permanente (hasta 10 entre sala de jefe y tienda, montadas SIEMPRE
 * desde `GameRoot`, estuviera el héroe donde estuviera). Ahora la única luz
 * real de antorcha del juego vive en `render/TorchLightPool.tsx`: un pool
 * FIJO de 3 spotLights reasignadas cada frame a las antorchas más cercanas al
 * héroe (`selectNearestInto`/`collectTorchEmitters`). `WallTorch` conserva
 * SOLO lo que no depende de estar "encendida de verdad": la cera, la llama
 * (material Basic autoiluminado, se sigue viendo apagada la luz real o no) y
 * un `GlowPuddle` FIJO a sus pies — un disco aditivo pegado al suelo,
 * indistinguible de un derrame de luz real desde la cámara cenital, coste ~0
 * — para que la antorcha no se quede visualmente "muerta" cuando el pool no
 * la tiene entre sus 3 elegidas.
 *
 * Ya no monta su propio cono dirigido (`dirX`/`dirZ`, antes usados para
 * apuntar el spotLight hacia dentro de la sala): esa orientación la lee ahora
 * directamente `TorchLightPool` desde `collectTorchEmitters`, así que
 * `WallTorch` ya no necesita conocerla — solo posición e índice (para
 * desincronizar el parpadeo de la llama entre antorchas).
 *
 * Layout (`wallTorchLayout`): vivía DUPLICADO aquí y en
 * `torch-placements.ts` (la copia de `torch-placements.ts` existe porque
 * importar este fichero desde un test revienta: la cadena de imports crea
 * texturas con `document`, que no existe en el entorno node de vitest — ver
 * cabecera de `torch-placements.ts`). Única definición ahora: la de
 * `torch-placements.ts` (privada ahí, solo la usa `collectTorchEmitters`
 * internamente). Este fichero ya no la necesita: nada de aquí calcula
 * layouts de sala, el consumidor único de `WallTorch`
 * (`TorchPropsView.tsx`) obtiene posición y orientación directamente de
 * `collectTorchEmitters`.
 *
 * Compartida por `TorchPropsView.tsx` (atrezzo de sala de jefe + tienda,
 * antes `BossCandlesView.tsx`/`ShopLightsView.tsx` por separado — unificadas
 * al converger ambas en leer de la misma lista de emisores).
 *
 * Altura de montaje: la base se ancla a `TORCH_BASE_Y` (mismo valor que
 * `WALL_HEIGHT` en RoomView.tsx) — se lee como un aplique colgado del muro a
 * su altura, no como una vela apoyada en el suelo.
 *
 * Parpadeo de la llama: misma suma de senos (barata, sin asignaciones) que
 * `CandleLightView`/el cirio de jefe original, desfasada por índice de
 * antorcha para que no titilen sincronizadas entre sí. El índice que recibe
 * `WallTorch` y el que usa `TorchLightPool` para la MISMA antorcha física son
 * el mismo (la posición de ese emisor dentro de `collectTorchEmitters`,
 * calculada por ambos consumidores con la misma función pura) — así, cuando
 * al héroe le toca encenderla de verdad, la llama y la luz laten en fase.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { unitCone } from '@/game/render/assets';
import { bossCandleFlameMaterial, bossCandleWaxMaterial, wallTorchWaxGeometry } from '@/game/render/assets-dark';
import { TORCH_LIGHT_COLOR } from '@/game/features/dungeon/torch-placements';
import { GlowPuddle } from '@/game/render/GlowPuddle';

/** Alto de la cera — igual que `wallTorchWaxGeometry` (render/assets.ts). */
const TORCH_WAX_HEIGHT = 0.7;
/** Base de la antorcha a la altura del muro (WALL_HEIGHT=0.9 en RoomView.tsx): aplique colgado, no clavado en el suelo. */
const TORCH_BASE_Y = 0.9;
const FLAME_HEIGHT = TORCH_BASE_Y + TORCH_WAX_HEIGHT + 0.08;
const FLAME_SCALE_XZ = 0.1;
const FLAME_SCALE_Y = 0.2;

/** Parpadeo: mismo criterio que CandleLightView (2 senos inconmensurados), desfasado por índice de antorcha. */
const FLICKER_FREQ_A = 4.3;
const FLICKER_FREQ_B = 9.1;
const FLICKER_WEIGHT_A = 0.6;
const FLICKER_WEIGHT_B = 0.4;
/** Desfase fijo (rad) por índice de antorcha — no coincide con las frecuencias de arriba, así que no vuelven a alinearse periódicamente. */
const FLICKER_PHASE_STEP = 2.3;

/**
 * Charco de luz falso a los pies de la antorcha (ver cabecera): derrame
 * visible incluso cuando el pool de 3 luces reales no la ha elegido. Radio
 * generoso a propósito — aproxima el alcance que tenía el cono real
 * (`TORCH_LIGHT_DISTANCE`=4 en `torch-placements.ts`) sin replicarlo al
 * milímetro, ya que un disco no puede fingir un cono dirigido; punto de
 * tuning.
 */
const TORCH_GLOW_PUDDLE_RADIUS = 1.4;
/** Opacidad del charco: mismo valor que el resto de halos aditivos del juego (proyectiles/enemigos, ver `assets.ts`/`EnemyLights.tsx`). */
const TORCH_GLOW_PUDDLE_OPACITY = 0.16;

export function WallTorch({ x, z, index }: { x: number; z: number; index: number }) {
  const flameRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);

  useFrame((state) => {
    const flame = flameRef.current;
    if (!flame) return;
    const t = state.clock.elapsedTime + index * FLICKER_PHASE_STEP;
    const flicker = FLICKER_WEIGHT_A * Math.sin(t * FLICKER_FREQ_A) + FLICKER_WEIGHT_B * Math.sin(t * FLICKER_FREQ_B);
    // Pulso de tamaño puro (mismo criterio que el cirio de jefe original): crece/decrece uniforme en X/Y/Z, sin vaivén de posición/rotación.
    const pulse = 1 + flicker * 0.1;
    flame.scale.set(FLAME_SCALE_XZ * pulse, FLAME_SCALE_Y * pulse, FLAME_SCALE_XZ * pulse);
  });

  return (
    <group position={[x, 0, z]}>
      <mesh
        geometry={wallTorchWaxGeometry}
        material={bossCandleWaxMaterial}
        position={[0, TORCH_BASE_Y + TORCH_WAX_HEIGHT / 2, 0]}
      />
      <mesh
        ref={flameRef}
        geometry={unitCone}
        material={bossCandleFlameMaterial}
        position={[0, FLAME_HEIGHT, 0]}
        scale={[FLAME_SCALE_XZ, FLAME_SCALE_Y, FLAME_SCALE_XZ]}
      />
      {/* Antorcha FIJA (nunca se mueve tras montar): con la posición inicial
          por defecto de GlowPuddle (0, GLOW_PUDDLE_GROUND_Y, 0 local) basta,
          sin necesidad de tocar glowRef desde ningún useFrame. */}
      <GlowPuddle
        meshRef={glowRef}
        color={TORCH_LIGHT_COLOR}
        radius={TORCH_GLOW_PUDDLE_RADIUS}
        opacity={TORCH_GLOW_PUDDLE_OPACITY}
      />
    </group>
  );
}
