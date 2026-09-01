/**
 * Reina del Enjambre (GDD §15.3, Fase B2, `bossId==='queen'`): extraído de
 * `EnemyViews.tsx` en la pasada pre-release. Corona estática (5 púas en
 * abanico) + grito/animación de DOLOR al perder una columna (simplificación
 * 2026-08-31, encargo de feedback visual: "el boss debe reaccionar con un
 * grito/animación de dolor para comunicar que columna y boss están
 * conectados").
 *
 * Sustituye al extinto "pulso de invocación" (anillo verde bajo los pies que
 * se expandía en cada oleada de larvas, detectando el salto de
 * `enemy.bossTelegraphUntil`): con el rediseño 2026-08-31 la Reina ya NO
 * invoca desde el cuerpo — cada columna viva pare sus propios minions con su
 * propio reloj (`QueenColumn.spawnTimer`, `queen/columns.ts`) — así que
 * `bossTelegraphUntil` dejó de escribirse para la Reina y el pulso quedó
 * como código muerto (nadie lo disparaba nunca). El truco de detección se
 * REUTILIZA sobre otro campo que sí sigue vivo: `stepQueenColumns`
 * (`queen/columns.ts`) fija `enemy.bossVulnerableUntil` a `world.time +
 * QUEEN_COLUMN_STUN_DURATION` (aturdimiento temporal) o a `Infinity`
 * (vulnerable permanente, con la última columna) cada vez que una columna se
 * ROMPE — nunca decrece entre roturas (`world.time` es monótono creciente y
 * el campo se queda fijo hasta la próxima rotura), así que un salto hacia
 * arriba respecto al valor leído el frame anterior es, sin ambigüedad,
 * "acaba de perder una columna". Mismo truco que usaba el pulso extinto (ref
 * con el valor del frame anterior + comparación), sin necesitar leer eventos
 * de sim desde el render; el salto a `Infinity` dispara el grito igual que
 * cualquier otro (`Infinity > x` finito es `true`) y no se repite mientras el
 * valor se quede ahí (`Infinity > Infinity` es `false`).
 *
 * `applyQueenBossFrame` se llama desde el ÚNICO `useFrame` de `EnemyMesh`
 * (EnemyViews.tsx), en el mismo punto exacto donde vivía este bloque antes de
 * la extracción — los refs los sigue poseyendo `EnemyMesh` (se pasan aquí por
 * parámetro) para no alterar el orden de mutación dentro del frame. El grito
 * se pinta como un pulso de escala sobre el propio `bodyRef` (cuerpo del
 * jefe, ya poseído por `EnemyMesh`, que ya escribe `bodyRadius` en su escala
 * ANTES de llamar aquí) en vez de un mesh propio: a diferencia del pulso de
 * invocación (un anillo en el suelo), "encogerse de dolor" es una
 * deformación del propio cuerpo, no necesita geometría nueva.
 */

import type { RefObject } from 'react';
import type { Mesh } from 'three';
import { queenCrownMaterial, queenCrownSpikeGeometry } from '@/game/render/assets';
import { makeSilhouetteMaterial } from '@/game/render/occlusion-silhouette';
import type { Enemy, World } from '@/game/world/types';

/**
 * Silueta de oclusión de la Reina (occlusion-silhouette.ts): NO clona
 * `queenBodyMaterial.color` (mismo bug de fondo documentado en
 * EnemyViews.tsx) — `assets-dark.ts` oscurece el cuerpo a `#221f2a`, casi
 * negro, invisible sobre un muro oscuro. Lo que de verdad identifica a la
 * Reina en la oscuridad hoy es el acento verdoso de su corona
 * (`queenCrownMaterial`, `emissive: '#9fd65c'`, ver assets-dark.ts) — se
 * clona ESE color en su lugar. Fija por el mismo motivo que el Guardián: sus
 * intercambios de material (telegraph/carga de las larvas guardianas) son
 * avisos temporales que ya se leen por sus propios efectos, no por el color
 * del cuerpo de la propia Reina.
 */
export const queenSilhouetteMaterial = makeSilhouetteMaterial(queenCrownMaterial.emissive.clone());

/** Duración del grito/pulso de dolor (s, encargo: "~0.5 s"): ventana corta, se lee como reacción inmediata a perder una columna sin eternizarse. */
const QUEEN_ROAR_DURATION = 0.5;
/** Amplitud del pulso de escala del cuerpo durante el grito (encargo: "del orden de ±12–15%"): pronunciado, pero sin deformar la silueta hasta ser irreconocible. */
const QUEEN_ROAR_SCALE_AMPLITUDE = 0.14;
/** Velocidad angular del pulso (rad/s): un par de sacudidas que decaen a 0 al llegar a QUEEN_ROAR_DURATION en vez de cortar en seco (mismo criterio "no cortar en seco" que el temblor de columna, QueenColumnsView.tsx). */
const QUEEN_ROAR_PULSE_SPEED = 26;

export function applyQueenBossFrame(params: {
  enemy: Enemy;
  world: World;
  bodyRadius: number;
  bodyRef: RefObject<Mesh | null>;
  lastQueenVulnerableUntil: { current: number };
  queenRoarUntil: { current: number };
}): void {
  const { enemy, world, bodyRadius, bodyRef, lastQueenVulnerableUntil, queenRoarUntil } = params;
  // Grito de dolor (ver cabecera del fichero): detecta el salto hacia arriba
  // de `bossVulnerableUntil` que `stepQueenColumns` fija al romperse una
  // columna. `lastQueenVulnerableUntil` es el valor leído el frame anterior
  // (arranca en 0 en EnemyMesh, igual que el campo real del jefe en
  // world/create.ts — sin falso disparo al montar); en cuanto el valor sube,
  // se guarda la nueva ventana del grito.
  if (enemy.bossVulnerableUntil > lastQueenVulnerableUntil.current) {
    queenRoarUntil.current = world.time + QUEEN_ROAR_DURATION;
  }
  lastQueenVulnerableUntil.current = enemy.bossVulnerableUntil;

  const roaring = world.time < queenRoarUntil.current;
  if (roaring && bodyRef.current) {
    // `remaining` decae de QUEEN_ROAR_DURATION a 0 según se acerca el final
    // de la ventana; se usa tanto para la envolvente (decay, sin cortar en
    // seco) como para la fase de la oscilación (elapsed = tiempo transcurrido
    // desde que empezó el grito) — mismo estilo que el extinto pulso de
    // invocación (`t = 1 - remaining / duración`), aplicado ahora como
    // pulso de escala en vez de expansión de anillo.
    const remaining = queenRoarUntil.current - world.time;
    const elapsed = QUEEN_ROAR_DURATION - remaining;
    const decay = remaining / QUEEN_ROAR_DURATION;
    const pulse = Math.cos(elapsed * QUEEN_ROAR_PULSE_SPEED) * QUEEN_ROAR_SCALE_AMPLITUDE * decay;
    // `EnemyMesh` ya escribió `bodyRef.current.scale.setScalar(bodyRadius)`
    // este mismo frame ANTES de llamar aquí (ver EnemyViews.tsx) — se
    // sobreescribe con el pulso encima mientras dura el grito.
    bodyRef.current.scale.setScalar(bodyRadius * (1 + pulse));
  }
}

/**
 * JSX específico de la Reina: corona estática (5 púas en abanico). El grito
 * de dolor (ver cabecera del fichero) vive sobre el propio cuerpo del jefe
 * (`bodyRef`, ya poseído por `EnemyMesh`) — a diferencia del extinto pulso de
 * invocación, no necesita geometría propia, así que este componente ya no
 * recibe ninguna ref. Vive dentro del `<group ref={groupRef}>` del padre
 * (EnemyViews.tsx), como el resto de composición específica de jefe.
 */
export function QueenBossExtras() {
  return (
    <>
      {/* Corona: 5 púas finas en abanico sobre la cabeza (silueta de "reina
          de enjambre", distinta del Guardián) — estática en local, ya vive
          dentro del `group` que escala con `enemy.radius`. */}
      {[0, 1, 2, 3, 4].map((i) => {
        const angle = (i - 2) * 0.5;
        return (
          <mesh
            key={i}
            geometry={queenCrownSpikeGeometry}
            material={queenCrownMaterial}
            position={[Math.sin(angle) * 0.32, 0.55, Math.cos(angle) * 0.32]}
            rotation-x={-0.25}
            rotation-z={angle * 0.4}
          />
        );
      })}
    </>
  );
}
