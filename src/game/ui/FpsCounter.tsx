/**
 * Contador de FPS (punto 12 de playtest): overlay DOM discreto, esquina
 * superior. Se actualiza ~2 veces/s desde un rAF propio con media móvil de
 * los deltas entre frames, mutando `textContent` directamente — NUNCA
 * `setState` por frame (ARCHITECTURE.md: prohibido useState/setState por
 * frame; three el hot path de React).
 *
 * Visible siempre en dev; en build de producción solo si `?fps=1` está en la
 * URL (activable para depurar rendimiento sin ensuciar la UI del jugador).
 */

import { useEffect, useRef } from 'react';
import { useT } from '@/i18n';
import './fps-counter.css';

/** Cada cuántos ms se refresca el texto mostrado (2 veces/s ≈ 500 ms). */
const UPDATE_INTERVAL_MS = 500;
/** Peso de la media móvil exponencial (mayor = más reactivo, menor = más estable). */
const SMOOTHING = 0.15;

function shouldShowInProd(): boolean {
  return new URLSearchParams(window.location.search).get('fps') === '1';
}

export function FpsCounter() {
  const t = useT();
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!import.meta.env.DEV && !shouldShowInProd()) return;

    let rafId = 0;
    let lastFrameTime = performance.now();
    let lastUpdateTime = lastFrameTime;
    let smoothedFps = 60;

    const loop = (now: number) => {
      const delta = now - lastFrameTime;
      lastFrameTime = now;
      if (delta > 0) {
        const instantFps = 1000 / delta;
        smoothedFps += (instantFps - smoothedFps) * SMOOTHING;
      }
      if (now - lastUpdateTime >= UPDATE_INTERVAL_MS) {
        lastUpdateTime = now;
        const el = elRef.current;
        if (el) el.textContent = t('hud.fps', { n: Math.round(smoothedFps) });
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(rafId);
  }, [t]);

  if (!import.meta.env.DEV && !shouldShowInProd()) return null;

  return (
    <div ref={elRef} className="fps-counter" aria-hidden="true">
      {/* Placeholder hasta el primer refresco del rAF (<500 ms): misma clave,
          con '--' en lugar de la cifra. */}
      {t('hud.fps', { n: '--' })}
    </div>
  );
}
