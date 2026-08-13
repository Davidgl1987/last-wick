/**
 * Puntería slingshot (GDD §3): drag desde cualquier punto del canvas con
 * Pointer Events + setPointerCapture. Vector de tiro = inicio − actual,
 * medido en el plano del suelo (raycast de la cámara), clampado a
 * MAX_DRAG_DISTANCE. Fuerza normalizada [0,1]; <8% se cancela con aviso.
 *
 * Todo el estado del drag vive en variables capturadas y en session.aim
 * (objeto mutable): CERO re-renders y cero asignaciones durante el drag.
 */

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { MAX_DRAG_DISTANCE, MIN_LAUNCH_FORCE } from './constants';
import type { GameSession } from '@/game/session/session';
import { resolveWeaponRelease } from '@/game/features/combat/combat';
import { launchHero } from './launch';
import { useUiStore } from '@/game/session/store';
import { playSfx } from '@/game/audio/sfxEngine';

export function AimInput({ session, onLaunch }: { session: GameSession; onLaunch: () => void }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const el = gl.domElement;
    // Asignaciones solo al montar; reutilizadas durante todo el ciclo de vida.
    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const start = { x: 0, y: 0 };
    let activePointer = -1;

    /** Proyecta un evento de puntero al plano del suelo (y=0). */
    const projectToGround = (e: PointerEvent): boolean => {
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(groundPlane, hit) !== null;
    };

    /** Hot path del drag: actualiza session.aim sin asignar memoria. */
    const updateAim = (e: PointerEvent): void => {
      if (!projectToGround(e)) return;
      const aim = session.aim;
      const dx = start.x - hit.x; // vector = inicio − actual (tirachinas)
      const dy = start.y - hit.z;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-6) {
        aim.force = 0;
        return;
      }
      aim.dirX = dx / len;
      aim.dirY = dy / len;
      const clamped = len > MAX_DRAG_DISTANCE ? MAX_DRAG_DISTANCE : len;
      aim.force = clamped / MAX_DRAG_DISTANCE;
    };

    const endDrag = (e: PointerEvent): void => {
      activePointer = -1;
      session.aim.active = false;
      if (el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (activePointer !== -1 || !e.isPrimary) return;
      // Con la sim pausada (modal de mejora / game-over) no se apunta ni dispara.
      if (session.world.phase !== 'playing') return;
      if (!projectToGround(e)) return;
      activePointer = e.pointerId;
      start.x = hit.x;
      start.y = hit.z;
      const aim = session.aim;
      aim.active = true;
      aim.force = 0;
      aim.dirX = 0;
      aim.dirY = 0;
      playSfx('aim-pull');
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Puntero sin captura disponible (p.ej. eventos sintéticos): el drag
        // sigue funcionando vía listeners del canvas.
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (e.pointerId !== activePointer) return;
      updateAim(e);
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (e.pointerId !== activePointer) return;
      updateAim(e);
      const aim = session.aim;
      endDrag(e);
      if (aim.force < MIN_LAUNCH_FORCE) {
        // Rechazo de tiro accidental (GDD §3): aviso, sin coste.
        useUiStore.getState().showNotice('Tiro demasiado flojo');
        playSfx('ui-cancel');
        return;
      }
      if (session.world.phase !== 'playing') return; // la fase pudo cambiar durante el drag
      const mode = session.world.hero.weaponMode;
      const launched =
        mode === 'body'
          ? launchHero(session.world, aim.dirX, aim.dirY, aim.force, session.events)
          : resolveWeaponRelease(session.world, aim.dirX, aim.dirY, aim.force, session.events);
      // Solo cuenta un lanzamiento que la sim haya aceptado: una cancelación,
      // un tiro flojo o soltar durante el cooldown no ocultan el tutorial.
      if (launched) onLaunch();
    };

    /** Cancelación (gesto interrumpido, pérdida de captura): anula sin coste. */
    const onPointerCancel = (e: PointerEvent): void => {
      if (e.pointerId !== activePointer) return;
      endDrag(e);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [camera, gl, onLaunch, session]);

  return null;
}
