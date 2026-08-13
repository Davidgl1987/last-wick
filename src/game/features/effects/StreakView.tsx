/**
 * Render de `StreakPool` (streaks.ts): DOS `InstancedMesh` (Hielo/Hechizo),
 * misma filosofía que `WaxView.tsx` — léelo primero, es el mismo patrón
 * exacto de actualización incremental por `version`/`epoch` (sube a GPU
 * ÚNICAMENTE los slots que cambiaron desde el frame anterior; barrido
 * completo solo en `clear()`/montaje). La diferencia real es que aquí cada
 * instancia representa un TRAMO RECTO (longitud + ángulo reales), no una
 * mancha redonda: el quad `unitPlane` se escala de forma NO UNIFORME
 * (longitud en un eje, ancho en el otro) y se rota para alinear su eje largo
 * con la dirección real del tramo, en vez de una rotación puramente
 * decorativa como la de la cera.
 *
 * ── Por qué el ángulo del tramo entra por Z, no por Y (derivación) ────────
 * Con el orden Euler XYZ de three (matriz = Rx·Ry·Rz; un vector local `v` se
 * transforma como `v_world = Rx(Ry(Rz(v)))`, ver el comentario de
 * `WaxView.tsx` sobre `pool.rot`), rotar el tramo en Y ANTES de tumbar con X
 * saca al quad del plano horizontal en cuanto `angle≠0` — se comprueba
 * multiplicando las matrices: el eje que se quiere estirar deja de tener
 * Y=0 tras la composición. La solución (mismo truco que ya usa
 * `WaxPool.rot`/`WaxView` para su rotación decorativa) es rotar en Z: `Rz(φ)`
 * gira el quad DENTRO de su propio plano (alrededor de su normal +Z local,
 * "aún de pie") ANTES de que `Rx(-90°)` lo tumbe, así que el resultado se
 * queda siempre en Y=0 sea cual sea `φ`. `StreakPool.update` ya calcula
 * `angle` en la convención exacta que este componente necesita
 * (`atan2(-dz, dx)`, ver su cabecera) — aquí solo hace falta
 * `obj.rotation.set(-Math.PI / 2, 0, angle)`, sin ninguna conversión.
 * Verificado contra la propia matriz de three.js (no solo álgebra a mano)
 * para 5 direcciones distintas antes de escribir este fichero.
 *
 * El "espejo" aleatorio (`pool.mirror`, variedad pedida por David: "espeja el
 * trazo al azar") es geométricamente un giro de 180° alrededor de esa misma
 * normal del quad — se suma como `+ Math.PI` al mismo componente Z, nunca
 * toca Y. El ÁNGULO REAL del tramo (`pool.angle`) no se altera por esto: el
 * mirror es una decisión de orientación discreta fijada una vez en
 * `open()` (no cambia mientras el trazo vive, evita parpadeo), el ángulo
 * geométrico sigue siendo el real del tramo en todo momento — el rayo del
 * Hechizo nunca se ve torcido respecto a su trayectoria.
 *
 * ── Escalado no uniforme ───────────────────────────────────────────────
 * `unitPlane` (`PlaneGeometry(1,1)`, `render/assets.ts`) tiene lado 1
 * centrado en el origen: escalar su eje X local a `length` y su eje Y local
 * (el que tras tumbar con `Rx(-90°)` pasa a ser el ancho, perpendicular al
 * tramo) a `width` da un quad de exactamente `length` × `width` unidades de
 * mundo — sin ningún factor de conversión adicional (a diferencia de la
 * cera, que reconcilia radio-de-círculo vs. lado-de-plano) porque
 * `length`/`width` ya son dimensiones TOTALES, no radios.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { unitPlane } from '@/game/render/assets';
import { vfxTexture } from '@/game/render/vfx-textures';
import { STREAK_TYPE_ARCANE, STREAK_TYPE_FROST, type StreakPool } from './streaks';

/**
 * Materiales: mismo criterio "opaco por alfa" que la escarcha/arcano de
 * `WaxView.tsx` (`frostMaterial`/`arcaneMaterial` ahí, no reutilizados a
 * propósito — ese fichero no se toca en esta tarea) — `transparent: false` +
 * `alphaTest` recorta la silueta del trazo sin blending de verdad, así que
 * dos trazos que se crucen NO acumulan opacidad (cada fragmento por encima
 * del umbral se pinta 100% opaco; el más cercano a cámara gana por
 * profundidad). `bolt_streak`/`frost_streak` son Splats PROPIOS (blanco
 * recortado por alfa fiable, ver `vfx-textures.ts`), afiladas en los dos
 * extremos a propósito para que un tramo empalme limpio con el siguiente tras
 * un rebote. Sin `color` fijo: las dos texturas son blancas, el tinte real
 * (color del arma en el momento del disparo) lo aporta `instanceColor` por
 * trazo. `depthWrite: true` comparte el mismo riesgo de z-fighting que la
 * cera y el mismo remedio (jitter de altura por índice, más abajo).
 */
const frostStreakMaterial = new THREE.MeshBasicMaterial({
  map: vfxTexture('frost_streak'),
  transparent: false,
  alphaTest: 0.5,
  depthWrite: true,
  opacity: 1,
});

const arcaneStreakMaterial = new THREE.MeshBasicMaterial({
  map: vfxTexture('bolt_streak'),
  transparent: false,
  alphaTest: 0.5,
  depthWrite: true,
  opacity: 1,
});

/**
 * Altura base sobre el suelo: mismo VALOR que `WAX_GROUND_Y` en
 * `WaxView.tsx` (mismo criterio — "casi a ras de suelo"), duplicado aquí en
 * vez de importado porque `WaxView.tsx` no se toca en esta tarea (cera del
 * héroe ya validada por David).
 */
const STREAK_GROUND_Y = 0.025;
/** Anti-z-fighting por índice entre trazos que se crucen: mismos valores que `WAX_Y_JITTER_SLOTS`/`WAX_Y_JITTER_STEP` de WaxView.tsx, mismo motivo. */
const STREAK_Y_JITTER_SLOTS = 16;
const STREAK_Y_JITTER_STEP = 0.0005;
/** Fuera de vista: mismo truco que WaxView/ParticleView/TrailView para "ocultar" una instancia sin desmontarla. */
const HIDDEN_Y = -1000;

export function StreakView({ pool }: { pool: StreakPool }) {
  const meshRefs = useRef<[THREE.InstancedMesh | null, THREE.InstancedMesh | null]>([null, null]);
  const scratch = useMemo(() => ({ obj: new THREE.Object3D(), color: new THREE.Color() }), []);
  const lastVersion = useRef(0);
  const lastEpoch = useRef(0);
  // Mismo motivo que WaxView: three.js inicializa instanceMatrix a identidad
  // (todas las instancias en el origen, escala 1) — sin este flag el primer
  // frame mostraría trazos apilados en (0,0,0) hasta el primer open()/clear().
  const initialized = useRef(false);

  useFrame(() => {
    const meshFrost = meshRefs.current[STREAK_TYPE_FROST];
    const meshArcane = meshRefs.current[STREAK_TYPE_ARCANE];
    if (!meshFrost || !meshArcane) return;
    const { obj, color } = scratch;

    if (pool.epoch !== lastEpoch.current || !initialized.current) {
      // clear(): barrido completo ocultando TODO en las 2 mallas (reinicio de
      // run/mazmorra, no cada sala) — ver el comentario largo equivalente en
      // WaxView.tsx.
      initialized.current = true;
      lastEpoch.current = pool.epoch;
      lastVersion.current = pool.version;
      obj.position.set(0, HIDDEN_Y, 0);
      obj.scale.setScalar(0);
      obj.updateMatrix();
      color.setRGB(0, 0, 0);
      for (let i = 0; i < pool.capacity; i++) {
        meshFrost.setMatrixAt(i, obj.matrix);
        meshFrost.setColorAt(i, color);
        meshArcane.setMatrixAt(i, obj.matrix);
        meshArcane.setColorAt(i, color);
      }
      meshFrost.instanceMatrix.needsUpdate = true;
      if (meshFrost.instanceColor) meshFrost.instanceColor.needsUpdate = true;
      meshArcane.instanceMatrix.needsUpdate = true;
      if (meshArcane.instanceColor) meshArcane.instanceColor.needsUpdate = true;
    }

    // `version` sube en CADA open()/update() — mientras un proyectil vuela,
    // ProjectileView llama a update() sobre su trazo abierto una vez por
    // frame, así que esto recorre normalmente muy pocos slots (los
    // proyectiles del héroe activos ese frame), igual de barato que el caso
    // "un emit()" de WaxView.
    const newWrites = pool.version - lastVersion.current;
    if (newWrites > 0) {
      const toUpdate = Math.min(newWrites, pool.capacity);
      for (let k = 0; k < toUpdate; k++) {
        const idx = (((pool.cursor - toUpdate + k) % pool.capacity) + pool.capacity) % pool.capacity;
        const type = pool.type[idx];
        const yJitter = STREAK_GROUND_Y + (idx % STREAK_Y_JITTER_SLOTS) * STREAK_Y_JITTER_STEP;

        // Este slot del ring buffer es GLOBAL a los 2 tipos: oculta idx en la
        // malla que NO gana esta escritura (mismo motivo que WaxView con sus
        // 3 tipos).
        obj.position.set(0, HIDDEN_Y, 0);
        obj.scale.setScalar(0);
        obj.updateMatrix();
        if (type !== STREAK_TYPE_FROST) meshFrost.setMatrixAt(idx, obj.matrix);
        if (type !== STREAK_TYPE_ARCANE) meshArcane.setMatrixAt(idx, obj.matrix);

        // Malla ganadora: transform + color reales. Ver cabecera del fichero
        // para la derivación de `rotZ` y el escalado no uniforme.
        obj.position.set(pool.x[idx], yJitter, pool.z[idx]);
        const rotZ = pool.angle[idx] + (pool.mirror[idx] ? Math.PI : 0);
        obj.rotation.set(-Math.PI / 2, 0, rotZ);
        obj.scale.set(pool.length[idx], pool.width[idx], 1);
        obj.updateMatrix();
        color.setRGB(pool.r[idx], pool.g[idx], pool.b[idx]);
        if (type === STREAK_TYPE_FROST) {
          meshFrost.setMatrixAt(idx, obj.matrix);
          meshFrost.setColorAt(idx, color);
        } else {
          meshArcane.setMatrixAt(idx, obj.matrix);
          meshArcane.setColorAt(idx, color);
        }
      }
      lastVersion.current = pool.version;
      meshFrost.instanceMatrix.needsUpdate = true;
      if (meshFrost.instanceColor) meshFrost.instanceColor.needsUpdate = true;
      meshArcane.instanceMatrix.needsUpdate = true;
      if (meshArcane.instanceColor) meshArcane.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh
        ref={(el) => {
          meshRefs.current[STREAK_TYPE_FROST] = el;
        }}
        args={[unitPlane, frostStreakMaterial, pool.capacity]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(el) => {
          meshRefs.current[STREAK_TYPE_ARCANE] = el;
        }}
        args={[unitPlane, arcaneStreakMaterial, pool.capacity]}
        frustumCulled={false}
      />
    </>
  );
}
