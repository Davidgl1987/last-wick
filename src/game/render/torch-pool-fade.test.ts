/**
 * Tests de `stepSlotFade` (máquina de dos fases del fundido cruzado del pool
 * de antorchas, ver cabecera de torch-pool-fade.ts): cubren la entrada directa
 * desde "nada mostrado", el ciclo completo salida→entrada al reasignar un
 * slot con algo visible, que el emisor VIEJO se conserva durante toda la
 * salida, que una reasignación a media salida no reinicia el cronómetro, y
 * los casos límite con `desiredIdx = -1` (sin candidatos).
 */

import { describe, expect, it } from 'vitest';
import { createSlotFadeState, stepSlotFade, UNASSIGNED_EMITTER } from './torch-pool-fade';

const DURATION = 0.3;

describe('stepSlotFade', () => {
  it('arranque de la run: primera asignación entra directo (sin fase de salida) y sube desde 0', () => {
    const state = createSlotFadeState();
    expect(state.displayedIdx).toBe(UNASSIGNED_EMITTER);

    const fade0 = stepSlotFade(state, 5, 0, DURATION);
    expect(state.phase).toBe('entering');
    expect(state.displayedIdx).toBe(5);
    expect(fade0).toBe(0);

    const fade1 = stepSlotFade(state, 5, DURATION / 2, DURATION);
    expect(fade1).toBeCloseTo(0.5, 5);

    const fade2 = stepSlotFade(state, 5, DURATION, DURATION);
    expect(fade2).toBe(1);
  });

  it('reasignación con algo visible: primero funde a 0 conservando el emisor viejo, luego salta y sube', () => {
    const state = createSlotFadeState();
    // Slot ya asentado en el emisor 2, a plena intensidad.
    stepSlotFade(state, 2, 0, DURATION);
    stepSlotFade(state, 2, DURATION, DURATION);
    expect(state.displayedIdx).toBe(2);
    expect(state.phase).toBe('entering');

    // Cambia la asignación deseada a 7: debe abrir fase de salida SIN mover displayedIdx.
    const fadeAtChange = stepSlotFade(state, 7, 0, DURATION);
    expect(state.phase).toBe('exiting');
    expect(state.displayedIdx).toBe(2); // sigue mostrando el emisor VIEJO
    expect(fadeAtChange).toBe(1); // phaseElapsed recién reiniciado a 0 → fade de salida = 1-0 = 1

    // A mitad de la salida, sigue siendo el emisor viejo, intensidad a medias.
    const fadeMid = stepSlotFade(state, 7, DURATION / 2, DURATION);
    expect(state.displayedIdx).toBe(2);
    expect(state.phase).toBe('exiting');
    expect(fadeMid).toBeCloseTo(0.5, 5);

    // Al completar la duración de la salida, salta al emisor nuevo y arranca la entrada desde 0.
    const fadeDone = stepSlotFade(state, 7, DURATION / 2, DURATION);
    expect(state.phase).toBe('entering');
    expect(state.displayedIdx).toBe(7);
    expect(fadeDone).toBe(0);

    // La entrada sube igual que en el caso de arranque.
    const fadeIn = stepSlotFade(state, 7, DURATION, DURATION);
    expect(state.displayedIdx).toBe(7);
    expect(fadeIn).toBe(1);
  });

  it('reasignación a media salida: actualiza el destino pero NO reinicia el cronómetro', () => {
    const state = createSlotFadeState();
    stepSlotFade(state, 1, 0, DURATION);
    stepSlotFade(state, 1, DURATION, DURATION); // asentado a plena intensidad en 1

    stepSlotFade(state, 2, 0, DURATION); // empieza a salir hacia 2
    stepSlotFade(state, 2, DURATION / 3, DURATION); // avanza 1/3 de la salida

    // A media salida, el destino cambia otra vez (de 2 a 3): el cronómetro NO se reinicia.
    const fadeAfterRetarget = stepSlotFade(state, 3, DURATION / 3, DURATION);
    expect(state.phase).toBe('exiting');
    expect(state.displayedIdx).toBe(1); // sigue conservando el emisor original
    expect(state.pendingIdx).toBe(3); // pero el destino ya es el nuevo
    // 2/3 de la duración transcurridos en total → fade = 1 - 2/3
    expect(fadeAfterRetarget).toBeCloseTo(1 / 3, 5);

    // Termina la salida con el tiempo restante: debe saltar al ÚLTIMO destino pedido (3), no al 2 intermedio.
    stepSlotFade(state, 3, DURATION / 3, DURATION);
    expect(state.phase).toBe('entering');
    expect(state.displayedIdx).toBe(3);
  });

  it('sin candidatos (-1) tras un emisor visible: funde a 0 conservando el emisor viejo, luego se apaga', () => {
    const state = createSlotFadeState();
    stepSlotFade(state, 4, 0, DURATION);
    stepSlotFade(state, 4, DURATION, DURATION);

    const fadeOut = stepSlotFade(state, -1, 0, DURATION);
    expect(state.phase).toBe('exiting');
    expect(state.displayedIdx).toBe(4);
    expect(fadeOut).toBe(1);

    const fadeOff = stepSlotFade(state, -1, DURATION, DURATION);
    expect(state.phase).toBe('entering');
    expect(state.displayedIdx).toBe(-1);
    expect(fadeOff).toBe(0);

    // Se queda apagado mientras no haya candidatos.
    const stillOff = stepSlotFade(state, -1, DURATION, DURATION);
    expect(stillOff).toBe(0);
  });

  it('sin candidatos desde el arranque: no abre fase de salida (nada que conservar) y se queda en 0', () => {
    const state = createSlotFadeState();
    const fade = stepSlotFade(state, -1, 0, DURATION);
    expect(state.phase).toBe('entering');
    expect(state.displayedIdx).toBe(-1);
    expect(fade).toBe(0);
  });
});
