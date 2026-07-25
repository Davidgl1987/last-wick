/**
 * Render de la capa de cera persistente (`WaxPool`, wax.ts): UN InstancedMesh
 * de `capacity` discos aplastados a ras de suelo, montado siempre desde
 * GameRoot. A diferencia de `TrailView` (que recalcula sus ~24 instancias
 * cada frame porque la vida cambia sin parar), aquí los puntos NUNCA se
 * mueven ni se desvanecen una vez depositados — así que este componente NO
 * recorre las 2000 instancias cada frame: sube a la GPU ÚNICAMENTE las
 * instancias que cambiaron desde el frame anterior (`pool.version` delta,
 * ver cabecera de wax.ts), y solo hace un barrido completo (ocultar todo)
 * el frame en que detecta un `clear()` (`pool.epoch`, reinicio de run/mazmorra).
 *
 * Geometría: `unitCircle` (disco plano, más barato que aplastar una esfera)
 * rotado -90° en X para tumbarlo en el plano del suelo, a y≈0.02-0.03 (mismo
 * criterio de altura que el goterón de TrailView en silueta, evita
 * z-fighting con el suelo de la sala).
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { unitCircle } from '@/game/render/assets';
import type { WaxPool } from './wax';

/**
 * Lambert (no Basic/autoiluminado, playtest ronda 8: "la cera se ve hasta sin
 * luz, debe afectarle [la luz] de manera que si no está iluminada no se
 * vea"): sin emissive, así que un disco de cera SOLO se lee donde de verdad
 * llega luz (vela/linternas/antorchas) — en zona oscura se funde con la
 * penumbra ambiental (~0.22, apenas se intuye: correcto, no un bug). Sigue
 * soportando color por instancia (instanceColor funciona igual con Lambert,
 * three.js lo aplica en el chunk de color con independencia del material).
 */
const waxMaterial = new THREE.MeshLambertMaterial({
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
});

/** Altura del disco de cera: casi a ras de suelo (mismo criterio que el goterón de TrailView en silueta). */
const WAX_GROUND_Y = 0.025;
/** Fuera de vista: forma barata de "ocultar" una instancia sin desmontarla (mismo truco que ParticleView/TrailView). */
const HIDDEN_Y = -1000;

export function WaxView({ pool }: { pool: WaxPool }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const scratch = useMemo(() => ({ obj: new THREE.Object3D(), color: new THREE.Color() }), []);
  const lastVersion = useRef(0);
  const lastEpoch = useRef(0);
  // three.js inicializa instanceMatrix a identidad (todas las instancias en
  // el origen, escala 1): sin este flag, el primer frame mostraría 2000
  // discos apilados en (0,0,0) hasta el primer emit/clear. Fuerza el mismo
  // barrido de ocultado que `clear()` una vez, al montar.
  const initialized = useRef(false);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { obj, color } = scratch;
    let touched = false;

    if (pool.epoch !== lastEpoch.current || !initialized.current) {
      // clear(): el pool ya no garantiza que las instancias visibles sigan
      // siendo válidas (cursor/count volvieron a 0) — barrido completo
      // ocultando TODO, único momento (aparte del montaje) en que este
      // componente recorre las `capacity` instancias. Raro (reinicio de
      // run/mazmorra), no cada sala.
      initialized.current = true;
      lastEpoch.current = pool.epoch;
      lastVersion.current = pool.version;
      obj.position.set(0, HIDDEN_Y, 0);
      obj.scale.setScalar(0);
      obj.updateMatrix();
      color.setRGB(0, 0, 0);
      for (let i = 0; i < pool.capacity; i++) {
        mesh.setMatrixAt(i, obj.matrix);
        mesh.setColorAt(i, color);
      }
      touched = true;
    }

    const newWrites = pool.version - lastVersion.current;
    if (newWrites > 0) {
      // Solo las instancias tocadas desde el último frame (como mucho
      // `capacity` si se depositó más de una vuelta completa entera en un
      // único frame, caso extremo): son los últimos `toUpdate` índices
      // escritos, terminando en `cursor - 1` (ring buffer).
      const toUpdate = Math.min(newWrites, pool.capacity);
      for (let k = 0; k < toUpdate; k++) {
        const idx = (((pool.cursor - toUpdate + k) % pool.capacity) + pool.capacity) % pool.capacity;
        obj.position.set(pool.x[idx], WAX_GROUND_Y, pool.z[idx]);
        obj.rotation.set(-Math.PI / 2, 0, 0);
        obj.scale.setScalar(pool.size[idx]);
        obj.updateMatrix();
        color.setRGB(pool.r[idx], pool.g[idx], pool.b[idx]);
        mesh.setMatrixAt(idx, obj.matrix);
        mesh.setColorAt(idx, color);
      }
      lastVersion.current = pool.version;
      touched = true;
    }

    if (touched) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  // receiveShadow: con material Lambert de arriba, la sombra de un muro/roca
  // también debe oscurecer la cera que hay debajo (mismo criterio que el
  // suelo de RoomView.tsx).
  return (
    <instancedMesh
      ref={meshRef}
      args={[unitCircle, waxMaterial, pool.capacity]}
      frustumCulled={false}
      receiveShadow
    />
  );
}
