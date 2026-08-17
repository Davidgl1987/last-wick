/**
 * Render de `WallMarkPool` (wallmarks.ts): DOS `InstancedMesh` (Hielo/
 * Hechizo), misma filosofía que `StreakView.tsx`/`WaxView.tsx` — léelos
 * primero, es el mismo patrón exacto de actualización incremental por
 * `version`/`epoch` (sube a GPU ÚNICAMENTE los slots que cambiaron desde el
 * frame anterior; barrido completo solo en `clear()`/montaje).
 *
 * La diferencia real con `StreakView` es que aquí el quad se queda VERTICAL
 * (una marca en la cara de un muro, no un trazo tumbado en el suelo): NO
 * hace falta tumbar con `Rx(-90°)`, así que no hay ningún giro compuesto de
 * dos ejes que pueda sacar el quad de su plano — solo un `Ry(yaw)` para
 * encarar la normal del muro y, ANTES de eso, un `Rz(roll)` decorativo para
 * la rotación libre de la marca sobre su propio plano.
 *
 * ── Por qué el roll entra por Z y se aplica ANTES del yaw (derivación) ─────
 * `unitPlane` (`PlaneGeometry(1,1)`, `render/assets.ts`) es un quad en el
 * plano XY local, normal +Z, "de pie" mirando a la cámara por defecto. Con el
 * orden Euler XYZ de three (matriz = Rx·Ry·Rz; un vector local `v` se
 * transforma como `v_world = Rx(Ry(Rz(v)))`, mismo razonamiento que
 * `StreakView.tsx`/`WaxView.tsx`) y `obj.rotation.set(0, yaw, roll)`:
 * `Rz(roll)` gira el quad DENTRO de su propio plano (alrededor de su normal
 * +Z local, "aún de pie mirando a cámara") — es la rotación libre que pide
 * el encargo ("aquí SÍ puede rotarse libremente", a diferencia del trazo del
 * suelo). SOLO DESPUÉS `Ry(yaw)` gira ese quad ya-rotado alrededor del eje Y
 * de MUNDO para que su normal apunte a `(sin(yaw), 0, cos(yaw))` — como
 * `Ry` nunca toca la coordenada Y de ningún punto, el quad sigue siendo
 * exactamente plano y vertical (contiene la dirección Y completa) para
 * CUALQUIER `roll`: se comprobó multiplicando las matrices a mano (normal
 * tras `Rz(roll)` sigue siendo +Z exacto, porque `Rz` gira alrededor de su
 * propio eje; `Ry(yaw)` aplicado después a ese +Z da `(sin yaw, 0, cos yaw)`,
 * la MISMA convención que usa `WallMarkPool.spawn()` para calcular
 * `yaw = atan2(normalX, normalZ)`) y luego se verificó en pantalla (ver
 * informe de la tarea). Si `roll` entrara en Y en vez de Z, o si el yaw se
 * aplicara antes que el roll, el quad seguiría siendo plano igualmente (son
 * solo rotaciones rígidas) pero el eje de "cara a cámara" tras el roll ya no
 * coincidiría con el eje sobre el que gira el yaw, y la marca giraría
 * describiendo un cono en vez de picar sobre su propio centro — por eso el
 * orden importa aunque aquí, a diferencia del trazo del suelo, ambos casos
 * sigan siendo técnicamente "planos".
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { unitPlane, WEAPON_COLOR } from '@/game/render/assets';
import { vfxTexture } from '@/game/render/vfx-textures';
import { WALL_MARK_TYPE_ARCANE, WALL_MARK_TYPE_FROST, type WallMarkPool } from './wallmarks';

/**
 * Materiales: mismo criterio "opaco por alfa" que `frostStreakMaterial`/
 * `arcaneStreakMaterial` de `StreakView.tsx` — `transparent: false` +
 * `alphaTest` recorta la silueta de la marca sin blending de verdad, así que
 * varias marcas que se superpongan (muy plausible: el jugador suele disparar
 * varias veces al mismo punto de un muro) NO acumulan opacidad. A diferencia
 * de streaks (que tiñen por `instanceColor` porque copian el patrón de wax),
 * aquí el color es una función pura del TIPO (Hielo siempre azul hielo,
 * Hechizo siempre púrpura arcano, sin variación por disparo) así que se
 * bakea directamente en dos materiales fijos vía `color` — más simple, sin
 * necesitar un buffer `instanceColor` ni un scratch de `THREE.Color` por
 * frame. `splatVfxMaterial()`/`additiveVfxMaterial()` (vfx-textures.ts) NO
 * sirven aquí: son blending normal/aditivo, no "opaco por alfa".
 */
const frostWallMarkMaterial = new THREE.MeshBasicMaterial({
  map: vfxTexture('snowflake'),
  color: WEAPON_COLOR.arrow.clone(),
  transparent: false,
  alphaTest: 0.5,
  depthWrite: true,
  opacity: 1,
});

const arcaneWallMarkMaterial = new THREE.MeshBasicMaterial({
  map: vfxTexture('splat34'),
  color: WEAPON_COLOR.spell.clone(),
  transparent: false,
  alphaTest: 0.5,
  depthWrite: true,
  opacity: 1,
});

/**
 * Separación a lo largo de la normal del muro para no z-fightear con la
 * geometría del kit (mismo motivo que el jitter de altura de StreakView/
 * WaxView, pero aquí horizontal, a lo largo de la normal, no en Y).
 *
 * Bajado de 0.03 a 0.01 (playtest, David: "las manchas en la pared están un
 * poco despegadas") — con 0.03 la mancha quedaba visiblemente flotando por
 * delante de la superficie del muro/roca real del kit KayKit. No puede ser 0:
 * el muro es geometría real (no un plano perfecto), así que un quad coplanar
 * exacto SÍ parpadea (dos superficies compitiendo por el mismo depth en el
 * z-buffer). 0.01 es el margen más pequeño que sigue evitando ese parpadeo a
 * la escala de esta escena (cámara a ~10-15 u de distancia típica, near=0.5/
 * far=80 en GameRoot.tsx): un orden de magnitud por debajo del grosor de
 * muro (WALL_THICKNESS) y de cualquier imperfección de geometría del kit, así
 * que la mancha queda pegada a la superficie sin z-fighting perceptible.
 */
const WALL_MARK_SURFACE_OFFSET = 0.01;
/** Fuera de vista: mismo truco que StreakView/WaxView/ParticleView para "ocultar" una instancia sin desmontarla. */
const HIDDEN_Y = -1000;

export function WallMarkView({ pool }: { pool: WallMarkPool }) {
  const meshRefs = useRef<[THREE.InstancedMesh | null, THREE.InstancedMesh | null]>([null, null]);
  const scratch = useMemo(() => ({ obj: new THREE.Object3D() }), []);
  const lastVersion = useRef(0);
  const lastEpoch = useRef(0);
  // Mismo motivo que StreakView/WaxView: three.js inicializa instanceMatrix a
  // identidad (todas las instancias en el origen, escala 1) — sin este flag
  // el primer frame mostraría marcas apiladas en (0,0,0) hasta el primer
  // spawn()/clear().
  const initialized = useRef(false);

  useFrame(() => {
    const meshFrost = meshRefs.current[WALL_MARK_TYPE_FROST];
    const meshArcane = meshRefs.current[WALL_MARK_TYPE_ARCANE];
    if (!meshFrost || !meshArcane) return;
    const { obj } = scratch;

    if (pool.epoch !== lastEpoch.current || !initialized.current) {
      // clear(): barrido completo ocultando TODO en las 2 mallas (reinicio de
      // run/mazmorra, no cada sala) — ver el comentario largo equivalente en
      // WaxView.tsx/StreakView.tsx.
      initialized.current = true;
      lastEpoch.current = pool.epoch;
      lastVersion.current = pool.version;
      obj.position.set(0, HIDDEN_Y, 0);
      obj.scale.setScalar(0);
      obj.updateMatrix();
      for (let i = 0; i < pool.capacity; i++) {
        meshFrost.setMatrixAt(i, obj.matrix);
        meshArcane.setMatrixAt(i, obj.matrix);
      }
      meshFrost.instanceMatrix.needsUpdate = true;
      meshArcane.instanceMatrix.needsUpdate = true;
    }

    // `version` sube en CADA spawn() — impactos de muro son eventos raros
    // (un rebote o una muerte contra un muro, no un evento por frame), así
    // que esto recorre normalmente 0 o 1 slots.
    const newWrites = pool.version - lastVersion.current;
    if (newWrites > 0) {
      const toUpdate = Math.min(newWrites, pool.capacity);
      for (let k = 0; k < toUpdate; k++) {
        const idx = (((pool.cursor - toUpdate + k) % pool.capacity) + pool.capacity) % pool.capacity;
        const type = pool.type[idx];

        // Este slot del ring buffer es GLOBAL a los 2 tipos: oculta idx en la
        // malla que NO gana esta escritura (mismo motivo que StreakView con
        // sus 2 tipos / WaxView con sus 3).
        obj.position.set(0, HIDDEN_Y, 0);
        obj.scale.setScalar(0);
        obj.updateMatrix();
        if (type !== WALL_MARK_TYPE_FROST) meshFrost.setMatrixAt(idx, obj.matrix);
        if (type !== WALL_MARK_TYPE_ARCANE) meshArcane.setMatrixAt(idx, obj.matrix);

        // Malla ganadora: transform real. Ver cabecera del fichero para la
        // derivación del orden de rotación (roll en Z, yaw en Y).
        const yaw = pool.yaw[idx];
        const normalX = Math.sin(yaw);
        const normalZ = Math.cos(yaw);
        obj.position.set(
          pool.x[idx] + normalX * WALL_MARK_SURFACE_OFFSET,
          pool.y[idx],
          pool.z[idx] + normalZ * WALL_MARK_SURFACE_OFFSET,
        );
        obj.rotation.set(0, yaw, pool.roll[idx]);
        obj.scale.setScalar(pool.size[idx]);
        obj.updateMatrix();
        if (type === WALL_MARK_TYPE_FROST) {
          meshFrost.setMatrixAt(idx, obj.matrix);
        } else {
          meshArcane.setMatrixAt(idx, obj.matrix);
        }
      }
      lastVersion.current = pool.version;
      meshFrost.instanceMatrix.needsUpdate = true;
      meshArcane.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh
        ref={(el) => {
          meshRefs.current[WALL_MARK_TYPE_FROST] = el;
        }}
        args={[unitPlane, frostWallMarkMaterial, pool.capacity]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(el) => {
          meshRefs.current[WALL_MARK_TYPE_ARCANE] = el;
        }}
        args={[unitPlane, arcaneWallMarkMaterial, pool.capacity]}
        frustumCulled={false}
      />
    </>
  );
}
