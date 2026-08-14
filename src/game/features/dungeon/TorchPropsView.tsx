/**
 * Atrezzo de antorchas de TODA la mazmorra (sala de jefe + sala de tienda +
 * la luz del tendero): UNIFICA lo que antes eran dos vistas separadas,
 * `BossCandlesView.tsx` y `ShopLightsView.tsx` (punto 2b del playtest
 * original: "en los bosses debería haber más luz, algunas columnas que sean
 * como cirios"; y "la tienda puede emitir luz, el placeholder por ejemplo y
 * varios cirios en las esquinas"). Atrezzo visual puro (SIN colisión, la sim
 * no lo conoce).
 *
 * Por qué se unificaron (rama `luces-optimizadas`, recorte de la escena de
 * ~43 luces reales a 7): antes cada vista recalculaba su PROPIO layout de
 * antorchas (`wallTorchLayout(bounds, ...)` sobre su propia sala) y montaba
 * una `spotLight`/`pointLight` real por antorcha — dos componentes
 * necesariamente separados porque cada uno conocía SOLO su sala. Con el pool
 * fijo de 3 luces reasignadas por cercanía (`render/TorchLightPool.tsx`), la
 * fuente de verdad de posiciones pasa a ser `collectTorchEmitters(world)`
 * (`torch-placements.ts`) — una lista ÚNICA y ya aplanada de jefe+tienda+
 * tendero, sin noción de "sala" en su forma de datos. Recalcular esa
 * distinción de sala aquí solo para poder seguir teniendo dos componentes
 * habría sido trabajo extra sin ningún beneficio: ambas vistas quedaban
 * reducidas a "por cada emisor, monta su geometría", literalmente el mismo
 * bucle — de ahí la fusión en una sola vista de atrezzo.
 *
 * Contenido por tipo de emisor:
 * - `kind === 'torch'` (antorchas de muro, jefe y tienda indistintamente):
 *   `WallTorch` (`TorchView.tsx`) — cera + llama + `GlowPuddle` a sus pies.
 * - `kind === 'shopkeeper'` (la luz que antes llevaba `ShopkeeperLight`,
 *   una `pointLight` propia sobre la cabeza del tendero): YA NO es una luz
 *   propia — el tendero es un emisor más de `collectTorchEmitters`, así que
 *   el pool de 3 lo enciende de verdad cuando el héroe está cerca. Aquí solo
 *   se le deja un `GlowPuddle` a sus pies (no un `WallTorch`: no hay cera ni
 *   llama que montar, el cuerpo visible del tendero ya lo pone
 *   `ItemView.tsx`) para que su sala no quede completamente a oscuras vista
 *   desde lejos, antes de que el pool lo elija.
 *
 * Índice de parpadeo: se pasa a `WallTorch` la posición del emisor DENTRO de
 * `collectTorchEmitters` (no un contador local por sala) — el mismo índice
 * que usa `TorchLightPool` para desfasar el parpadeo de la luz real de ESE
 * emisor cuando le toca encenderse. Ambos consumidores parten de la misma
 * función pura sobre el mismo `world`, así que coinciden sin necesidad de
 * coordinarse explícitamente: la llama y la luz de una misma antorcha laten
 * en fase.
 */

import { useMemo, useRef } from 'react';
import type { Mesh } from 'three';
import type { GameSession } from '@/game/session/session';
import { collectTorchEmitters, TORCH_LIGHT_COLOR } from '@/game/features/dungeon/torch-placements';
import { WallTorch } from '@/game/features/dungeon/TorchView';
import { GlowPuddle } from '@/game/render/GlowPuddle';
import { isPointInKnownRoom, useKnownRoomIds } from '@/game/render/known-rooms';

/**
 * Charco de luz falso a los pies del tendero — mismo criterio que el de
 * `WallTorch` (`TorchView.tsx`), pero algo más generoso (antes
 * `SHOPKEEPER_LIGHT_DISTANCE`=5 > `TORCH_LIGHT_DISTANCE`=4 en
 * `torch-placements.ts`: la luz que sustituye alcanzaba más lejos).
 */
const SHOPKEEPER_GLOW_PUDDLE_RADIUS = 1.8;
/** Opacidad del charco: mismo valor que el resto de halos aditivos del juego — bajada de 0.16 a 0.13 junto con el resto (VFX_PLAN T0, ver el comentario largo sobre `enemyProjectileGlowHaloMaterials` en `assets.ts`). */
const SHOPKEEPER_GLOW_PUDDLE_OPACITY = 0.13;

function ShopkeeperGlow({ x, z }: { x: number; z: number }) {
  const glowRef = useRef<Mesh>(null);
  return (
    // El tendero placeholder es estático (nunca se mueve, ver ItemView.tsx): con la posición de montaje basta, sin useFrame propio.
    <group position={[x, 0, z]}>
      <GlowPuddle
        meshRef={glowRef}
        color={TORCH_LIGHT_COLOR}
        radius={SHOPKEEPER_GLOW_PUDDLE_RADIUS}
        opacity={SHOPKEEPER_GLOW_PUDDLE_OPACITY}
      />
    </group>
  );
}

export function TorchPropsView({ session }: { session: GameSession }) {
  const world = session.world;
  // La mazmorra no cambia de layout durante la partida: se calcula una sola vez al montar (mismo criterio que TorchLightPool.tsx).
  const emitters = useMemo(() => collectTorchEmitters(world), [world]);
  // Una antorcha de una sala todavía oculta delataría dónde está el jefe antes
  // de tiempo — y flotando en negro, además. Los emisores no llevan `roomId`
  // (son una lista plana de posiciones, ver `collectTorchEmitters`), así que se
  // resuelven por posición contra las salas conocidas.
  const known = useKnownRoomIds(world);

  if (emitters.length === 0) return null;

  return (
    <>
      {emitters.map((e, i) =>
        !isPointInKnownRoom(world, known, e.x, e.z) ? null : e.kind === 'shopkeeper' ? (
          <ShopkeeperGlow key={i} x={e.x} z={e.z} />
        ) : (
          <WallTorch key={i} x={e.x} z={e.z} dirX={e.dirX} dirZ={e.dirZ} index={i} />
        ),
      )}
    </>
  );
}
