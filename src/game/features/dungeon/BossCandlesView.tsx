/**
 * Antorchas de la sala de jefe (punto 2b de playtest original: "en los
 * bosses debería haber más luz, algunas columnas que sean como cirios";
 * ajuste posterior, playtest de David: "los cirios de los jefes, parece que
 * puedes chocar con ellos... o los haces más pequeños y pegados a la pared,
 * como antorchas, o los haces grandes y con colisiones en las esquinas" → se
 * eligió la opción SIN tocar la sim: antorchas pequeñas ADOSADAS al muro en
 * vez de cirios grandes sueltos en mitad de la sala). Atrezzo visual puro
 * (SIN colisión, la sim no las conoce). Componente/geometría/parpadeo
 * compartidos con `ShopLightsView.tsx` vía `TorchView.tsx`
 * (`WallTorch`/`wallTorchLayout`).
 *
 * Sala del jefe: se localiza vía el propio enemigo `kind==='boss'` +
 * `bossRoomBounds` (mismo utilitario que ya usa el movimiento de jefes para
 * no salirse de su sala, `features/bosses/movement.ts`) — así no hace falta
 * leer la mazmorra/topología aparte ni duplicar esa búsqueda.
 *
 * Cantidad: 4 esquinas + puntos medios de los muros largos (hasta 6) cuando
 * la sala es suficientemente grande (`wallTorchLayout`, `includeMidpoints`);
 * las salas de jefe reales (11-21 u) siempre calificarían por tamaño. El
 * recuento se fija al montar (una sola vez por sala; la sala de jefe no
 * cambia durante la partida) y nunca varía por frame.
 */

import { useMemo } from 'react';
import type { GameSession } from '@/game/session/session';
import { bossRoomBounds } from '@/game/features/bosses/movement';
import { WallTorch, wallTorchLayout } from '@/game/features/dungeon/TorchView';

export function BossCandlesView({ session }: { session: GameSession }) {
  const world = session.world;
  const boss = world.enemies.find((e) => e.kind === 'boss');
  // La sala del jefe no cambia durante la partida (mazmorra fija tras
  // generarse): recalcular solo si cambia qué enemigo boss existe (en la
  // práctica, solo al montar) evita recomputar el layout cada render.
  const positions = useMemo(() => {
    if (!boss) return [];
    const bounds = bossRoomBounds(world, boss);
    return wallTorchLayout(bounds, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boss]);

  if (positions.length === 0) return null;

  return (
    <>
      {positions.map((p, i) => (
        <WallTorch key={i} x={p.x} z={p.z} index={i} dirX={p.dirX} dirZ={p.dirZ} />
      ))}
    </>
  );
}
