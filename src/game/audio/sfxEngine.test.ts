/**
 * El entorno de test es `node` (vite.config.ts): no hay `window` ni
 * `AudioContext` globales. Este es exactamente el caso que el motor debe
 * tolerar sin lanzar (cabecera de sfxEngine.ts) — estos tests no verifican
 * audio real (imposible sin navegador), solo que la API completa es segura
 * de llamar cuando no hay soporte.
 */

import { describe, expect, it } from 'vitest';
import { initAudio, playSfx, setLoop, stopLoop, unlockAudio } from './sfxEngine';

describe('sfxEngine (no-op seguro sin AudioContext)', () => {
  it('initAudio no lanza y es idempotente sin window', () => {
    expect(() => initAudio('/')).not.toThrow();
    expect(() => initAudio('/')).not.toThrow();
    expect(() => initAudio('/last-wick/')).not.toThrow();
  });

  it('unlockAudio no lanza sin AudioContext disponible', () => {
    expect(() => unlockAudio()).not.toThrow();
    expect(() => unlockAudio()).not.toThrow();
  });

  it('playSfx no lanza para ningún clip, con o sin opciones', () => {
    expect(() => playSfx('ui-click')).not.toThrow();
    expect(() =>
      playSfx('thunder', { volume: 0.5, rate: 0.5, rateJitter: 0.08, lowpass: 900, delay: 0.35, pan: -1, bus: 'music' }),
    ).not.toThrow();
  });

  it('setLoop/stopLoop no lanzan en ningún orden', () => {
    expect(() => setLoop('hero-slide-loop', 0.5, 1.1)).not.toThrow();
    expect(() => stopLoop('hero-slide-loop')).not.toThrow();
    expect(() => setLoop('hero-slide-loop', 0, 1)).not.toThrow();
    expect(() => stopLoop('hero-slide-loop')).not.toThrow();
  });
});
