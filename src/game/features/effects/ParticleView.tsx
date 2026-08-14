/**
 * Render del pool de partículas: un InstancedMesh POR TEXTURA del catálogo
 * (ARCHITECTURE.md "Instancing obligatorio" sigue cumpliéndose — cada malla
 * es un único draw call, solo que ahora hay varias mallas en vez de una),
 * actualizado por CPU en useFrame. Cero asignaciones por frame: la matriz y
 * el color se escriben en objetos `THREE.Object3D`/`THREE.Color` reutilizados
 * (creados una vez en useMemo), y `instanceMatrix`/`instanceColor` se marcan
 * `needsUpdate` cada frame.
 *
 * La física/vida del pool la posee `ParticlePool` (effects/particles.ts, sin
 * three.js); este componente es "render tonto" puro sobre esos datos.
 *
 * Textura por familia de evento (VFX_PLAN.md, ampliación 2026-08-11 —
 * feedback de David: "los barriles parece que sueltan las mismas partículas
 * de cera... pon texturas acordes a explosiones"): antes TODA partícula del
 * juego era un quad `unitPlane` con `map = splat02.png` sin importar el
 * evento, así que explosión/impacto/rastro se leían idénticas. Ahora
 * `ParticlePool.tex[i]` (índice en `PARTICLE_TEXTURES`, ver particles.ts)
 * dice qué familia le toca a cada partícula, decidido en `burstTable.ts`/
 * `reactToEvent.ts`; este componente monta UN InstancedMesh por textura del
 * catálogo (hoy 4: splat02/circle_c_streaks/shape_e/fan_c — "4-5 como mucho"
 * del plan) y reparte las partículas activas entre ellas cada frame.
 *
 * Blending por textura, NO por partícula (VFX_PLAN §2, regla crítica): las
 * Light Masks (`circle_c_streaks`, `shape_e`, `fan_c`) traen RGB SIN alfa
 * fiable, así que van SIEMPRE con `AdditiveBlending` — con blending normal
 * pintarían un cuadrado negro. `splat02` es un Splat (alfa fiable, blanco
 * puro recortado) y va con blending NORMAL. Por eso el material depende de
 * LA TEXTURA (`LIGHT_MASK_NAMES.includes(name)`, derivado del catálogo real
 * de `render/vfx-textures.ts`, no de una tabla propia que pueda desincronizarse),
 * no solo el mapa — a diferencia de antes, cuando un único material servía
 * para toda partícula. Ningún material usa los helpers cacheados
 * `additiveVfxMaterial`/`splatVfxMaterial` de `vfx-textures.ts`: esos hornean
 * un `color`/`opacity` FIJOS, y aquí el tinte lo sigue dando `instanceColor`
 * por partícula (una misma textura pinta partículas de colores distintos,
 * p.ej. `shape_e` blanco en un impacto normal y azul en un bloqueo de
 * escudo) y el fundido lo sigue dando la escala (`fadeFactor` vía
 * `obj.scale`), no la opacidad del material — mismo motivo que ya
 * documentaba este fichero para `splat02` antes de este cambio.
 *
 * Compactado por malla (cero coste para una textura sin partículas activas
 * este frame): en vez de recorrer `pool.capacity` una vez POR MALLA y ocultar
 * las instancias que no le tocan (lo que haría cada malla cargar 256
 * instancias siempre), se recorre `pool.capacity` UNA SOLA VEZ total,
 * escribiendo cada partícula activa en `[0, counts[tex])` de la malla que le
 * corresponde, y al final se pone `mesh.count = counts[tex]` — three.js no
 * dibuja nada más allá de `count`, así que una malla con 0 partículas de su
 * textura este frame no cuesta nada (ni siquiera limpiar el resto del
 * buffer: al no ser dibujado, su contenido es irrelevante). Los contadores
 * viven en un `Uint16Array` preasignado en `useMemo` (regla "cero
 * asignaciones por frame": `.fill(0)` limpia in-place, no crea nada).
 *
 * Billboard orientado a cámara: cada instancia copia el quaternion de la
 * cámara (así el quad siempre la mira) y luego gira en Z con `pool.rot[i]`
 * (variedad de orientación por partícula, generada en `ParticlePool.burst`).
 * Ambos pasos mutan el quaternion ya existente del `obj` scratch — cero
 * asignaciones nuevas (`Object3D.rotateZ` usa un eje/quaternion estático
 * interno de three, no crea uno por llamada).
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { unitPlane } from '@/game/render/assets';
import { LIGHT_MASK_NAMES, vfxTexture, type LightMaskName, type SplatName } from '@/game/render/vfx-textures';
import { PARTICLE_TEXTURES, type ParticlePool } from './particles';

const LIGHT_MASK_SET: ReadonlySet<string> = new Set(LIGHT_MASK_NAMES);

/**
 * Un material por textura del catálogo, mismo orden/índice que
 * `PARTICLE_TEXTURES` (así `pool.tex[i]` indexa directo este array Y el
 * array de InstancedMesh del JSX de más abajo). Ver cabecera del fichero:
 * aditivo para Light Masks, normal para Splats — derivado de
 * `LIGHT_MASK_NAMES`, no hardcodeado, para que no pueda desincronizarse del
 * catálogo real si `PARTICLE_TEXTURES` gana una entrada nueva.
 */
const particleMaterials: THREE.MeshBasicMaterial[] = PARTICLE_TEXTURES.map((name) => {
  const isLightMask = LIGHT_MASK_SET.has(name);
  return new THREE.MeshBasicMaterial({
    map: vfxTexture(name as LightMaskName | SplatName),
    transparent: true,
    depthWrite: false,
    blending: isLightMask ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
});

/** Escala visual de vida→opacidad/tamaño: se desvanece el último 40% de su vida. */
function fadeFactor(life: number, maxLife: number): number {
  if (maxLife <= 0) return 0;
  const t = life / maxLife;
  return t > 0.4 ? 1 : t / 0.4;
}

export function ParticleView({ pool }: { pool: ParticlePool }) {
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const scratch = useMemo(
    () => ({
      obj: new THREE.Object3D(),
      color: new THREE.Color(),
      // Nº de instancias ya escritas por malla en el frame actual (mismo
      // índice que PARTICLE_TEXTURES/particleMaterials/meshRefs). Preasignado
      // una vez; `.fill(0)` cada frame lo limpia in-place, sin crear nada.
      counts: new Uint16Array(PARTICLE_TEXTURES.length),
    }),
    [],
  );

  useFrame((state) => {
    const { obj, color, counts } = scratch;
    const camera = state.camera; // una vez por frame, no por instancia
    counts.fill(0);
    for (let i = 0; i < pool.capacity; i++) {
      if (!pool.active[i]) continue;
      const mesh = meshRefs.current[pool.tex[i]];
      if (!mesh) continue;
      const slot = counts[pool.tex[i]]++;
      const fade = fadeFactor(pool.life[i], pool.maxLife[i]);
      obj.position.set(pool.x[i], pool.y[i] + 0.05, pool.z[i]);
      // unitPlane (assets.ts) es PlaneGeometry(1,1): LADO 1, a diferencia de
      // unitSphere (SphereGeometry(1,...): RADIO 1, o sea diámetro 2). Con
      // el mismo scale.setScalar(pool.size[i] * fade) la partícula saldría a
      // la mitad del tamaño en pantalla que tenía como esfera. ×2 iguala el
      // lado del quad al diámetro de la esfera anterior (mismo tamaño en
      // pantalla que antes de pasar a quads).
      obj.scale.setScalar(pool.size[i] * fade * 2);
      // Billboard: el quaternion de la cámara orienta el quad hacia ella;
      // rotateZ gira DESPUÉS, dentro del plano ya orientado a cámara (roll
      // de pantalla), dando variedad por partícula. `.copy()` sobrescribe
      // por completo el quaternion de la iteración anterior (no acumula) y
      // `rotateZ` compone sobre un quaternion/eje estático interno de
      // three: ninguna de las dos asigna memoria.
      obj.quaternion.copy(camera.quaternion);
      obj.rotateZ(pool.rot[i]);
      obj.updateMatrix();
      color.setRGB(pool.r[i], pool.g[i], pool.b[i]);
      mesh.setMatrixAt(slot, obj.matrix);
      mesh.setColorAt(slot, color);
    }
    for (let t = 0; t < meshRefs.current.length; t++) {
      const mesh = meshRefs.current[t];
      if (!mesh) continue;
      // Compactado (ver cabecera): SOLO se dibujan las counts[t] instancias
      // que se acaban de escribir arriba. Se asigna SIEMPRE (incluso a 0),
      // nunca condicionalmente: si esta textura tenía partículas el frame
      // anterior y ya no, hay que bajar `count` o quedarían "fantasmas"
      // congelados en su última posición.
      mesh.count = counts[t];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      {PARTICLE_TEXTURES.map((name, idx) => (
        <instancedMesh
          key={name}
          ref={(el) => {
            meshRefs.current[idx] = el;
          }}
          args={[unitPlane, particleMaterials[idx], pool.capacity]}
          frustumCulled={false}
        />
      ))}
    </>
  );
}
