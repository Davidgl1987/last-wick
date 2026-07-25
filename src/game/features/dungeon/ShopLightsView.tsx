/**
 * Iluminación de la sala de tienda (playtest de David: "la tienda puede
 * emitir luz, el placeholder por ejemplo y varios cirios en las esquinas"):
 * atrezzo visual puro (SIN colisión, la sim no lo conoce) — mismo patrón que
 * `BossCandlesView.tsx`.
 *
 * Sala de tienda: se localiza vía el item `kind==='shopkeeper'` (siempre
 * exactamente uno por mazmorra, ver `dungeon.ts`) + su `roomId` →
 * `world.roomRuntimes` (mismo criterio que `bossRoomBounds` en
 * `features/bosses/movement.ts`, con fallback a `world.bounds` en el modo
 * sala única de los tests). El tendero placeholder es estático (nunca se
 * mueve, ver `ItemView.tsx`), así que su posición se lee una sola vez.
 *
 * Contenido:
 * - Una `pointLight` cálida con flicker sutil tipo vela sobre la cabeza del
 *   tendero (mismo patrón de parpadeo que `WallTorch`, ver `TorchView.tsx`).
 * - Antorchas de muro en las 4 esquinas de la sala (`WallTorch`/
 *   `wallTorchLayout`, MISMO componente que `BossCandlesView.tsx` — sin
 *   puntos medios: la sala de tienda es pequeña y cuadrada, 4 esquinas bastan).
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { PointLight } from 'three';
import type { GameSession } from '@/game/session/session';
import { WallTorch, wallTorchLayout } from '@/game/features/dungeon/TorchView';

/** Altura de la luz sobre el tendero: por encima de su cabeza (túnica+cabeza alcanzan ~1.67, ver ItemView.tsx). */
const SHOPKEEPER_LIGHT_HEIGHT = 1.9;
const SHOPKEEPER_LIGHT_INTENSITY = 10;
const SHOPKEEPER_LIGHT_DISTANCE = 5;
const SHOPKEEPER_LIGHT_DECAY = 2;
const SHOPKEEPER_LIGHT_COLOR = '#ffb469';

/** Parpadeo: mismo criterio que WallTorch/CandleLightView (2 senos inconmensurados). */
const FLICKER_FREQ_A = 4.3;
const FLICKER_FREQ_B = 9.1;
const FLICKER_WEIGHT_A = 0.6;
const FLICKER_WEIGHT_B = 0.4;
const FLICKER_AMPLITUDE = 0.16;

function ShopkeeperLight({ x, z }: { x: number; z: number }) {
  const lightRef = useRef<PointLight>(null);

  useFrame((state) => {
    const light = lightRef.current;
    if (!light) return;
    const t = state.clock.elapsedTime;
    const flicker = FLICKER_WEIGHT_A * Math.sin(t * FLICKER_FREQ_A) + FLICKER_WEIGHT_B * Math.sin(t * FLICKER_FREQ_B);
    light.intensity = SHOPKEEPER_LIGHT_INTENSITY * (1 + FLICKER_AMPLITUDE * flicker);
  });

  return (
    <pointLight
      ref={lightRef}
      color={SHOPKEEPER_LIGHT_COLOR}
      intensity={SHOPKEEPER_LIGHT_INTENSITY}
      distance={SHOPKEEPER_LIGHT_DISTANCE}
      decay={SHOPKEEPER_LIGHT_DECAY}
      position={[x, SHOPKEEPER_LIGHT_HEIGHT, z]}
    />
  );
}

export function ShopLightsView({ session }: { session: GameSession }) {
  const world = session.world;
  const shopkeeper = world.items.find((i) => i.kind === 'shopkeeper');
  // La sala de tienda no cambia durante la partida: recalcular solo si
  // cambia qué item shopkeeper existe (en la práctica, solo al montar).
  const layout = useMemo(() => {
    if (!shopkeeper) return null;
    const bounds =
      shopkeeper.roomId !== undefined ? world.roomRuntimes.get(shopkeeper.roomId)?.bounds ?? world.bounds : world.bounds;
    return {
      x: shopkeeper.position.x,
      z: shopkeeper.position.y,
      // `false` = sin puntos medios (comentario de cabecera: sala pequeña y
      // cuadrada, 4 esquinas bastan).
      torches: wallTorchLayout(bounds, false),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopkeeper]);

  if (!layout) return null;

  return (
    <>
      <ShopkeeperLight x={layout.x} z={layout.z} />
      {layout.torches.map((p, i) => (
        <WallTorch key={i} x={p.x} z={p.z} index={i} dirX={p.dirX} dirZ={p.dirZ} />
      ))}
    </>
  );
}
