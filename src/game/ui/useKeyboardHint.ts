/**
 * Hook: true si deben mostrarse las pistas de teclado del microtutorial
 * (HUD.tsx) — WASD para moverse, Tab para cambiar de arma. Decisión de David
 * (2026-08-31), dos señales independientes, cualquiera basta:
 *
 * 1. Dispositivo de escritorio por CAPACIDADES: misma comprobación exacta que
 *    el paseo WASD (`supportsKeyboardMove`, keyboard-move.ts — matchMedia
 *    '(hover: hover) and (pointer: fine)'), reutilizada tal cual para que
 *    "es de escritorio" tenga una única definición en todo el juego.
 * 2. Uso REAL de teclado detectado en caliente: la primera vez que se pulsa
 *    una tecla que cuenta (`isKeyboardHintCode`, keyboard-hint.ts — WASD/
 *    flechas o Tab; cualquier otra tecla se ignora, ver cabecera de ese
 *    fichero).
 *
 * En táctil puro (sin ninguna de las dos señales) devuelve `false` siempre:
 * el cartel queda exactamente como estaba antes de esta feature.
 *
 * Extraído a su propio hook (en vez de vivir dentro de HUD.tsx) porque
 * centraliza el ÚNICO listener 'keydown' de esta señal y su limpieza — si el
 * día de mañana otro sitio de la UI necesita el mismo booleano, ya está listo
 * para reutilizarse sin duplicar el criterio de detección.
 */

import { useEffect, useState } from 'react';
import { supportsKeyboardMove } from '@/game/features/hero/keyboard-move';
import { isKeyboardHintCode } from './keyboard-hint';

export function useShowKeyboardHints(): boolean {
  const [visible, setVisible] = useState(() => supportsKeyboardMove(window.matchMedia?.bind(window)));

  useEffect(() => {
    // Ya activo por capacidades (escritorio): no hace falta escuchar teclas,
    // y así se evita dejar un listener sin motivo el resto de la run.
    if (visible) return;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (isKeyboardHintCode(e.code)) setVisible(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible]);

  return visible;
}
