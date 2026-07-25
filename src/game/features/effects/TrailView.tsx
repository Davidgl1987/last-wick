/**
 * Render de la estela del héroe: InstancedMesh pequeño (pool ~24), mismo
 * patrón que ParticleView pero con datos de TrailPool (sin física, solo
 * desvanecido). Color por instancia (punto 1 de playtest ronda 3): sigue el
 * color del arma activa del héroe en el momento de depositarse (TrailPool ya
 * guarda r/g/b por punto), mismo lenguaje visual que heroMaterial.
 *
 * La cera (antes emitida aquí con vida/desvanecido, y con esferitas de color
 * de arma para los proyectiles) vive ahora en su propia capa persistente sin
 * desvanecido (`session.effects.wax`, `WaxView.tsx`) — ni `HeroView.tsx` ni
 * `ProjectileView.tsx` emiten ya a este pool (playtest ronda 7), así que este
 * componente se sigue montando (`session.effects.trail` sigue existiendo)
 * pero de momento nunca recibe puntos.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { unitSphere } from '@/game/render/assets';
import type { TrailPool } from './trail';

const trailMaterial = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
});

export function TrailView({ pool }: { pool: TrailPool }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const scratch = useMemo(() => ({ obj: new THREE.Object3D(), color: new THREE.Color() }), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { obj, color } = scratch;
    for (let i = 0; i < pool.capacity; i++) {
      if (pool.active[i]) {
        const t = pool.life[i] / pool.maxLife[i];
        const scale = pool.size[i] * t;
        obj.position.set(pool.x[i], 0.25, pool.z[i]);
        obj.scale.setScalar(scale);
        color.setRGB(pool.r[i], pool.g[i], pool.b[i]);
      } else {
        obj.position.set(0, -1000, 0);
        obj.scale.setScalar(0);
        color.setRGB(0, 0, 0);
      }
      obj.updateMatrix();
      mesh.setMatrixAt(i, obj.matrix);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[unitSphere, trailMaterial, pool.capacity]} frustumCulled={false} />
  );
}
