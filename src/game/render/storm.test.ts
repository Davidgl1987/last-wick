/**
 * Tests de `storm.ts` (encargo playtest 2026-08-07): lógica PURA, sin `three`
 * ni React — se prueba entera muestreando el eje de tiempo, sin montar nada.
 * Ver la cabecera de `storm.ts` para el razonamiento de cada constante que
 * aquí se verifica indirectamente (rango, dosis, doble destello, intervalo).
 */

import { describe, expect, it } from 'vitest';
import { stormFlash } from './storm';

describe('stormFlash', () => {
  it('es determinista: el mismo time da siempre el mismo valor', () => {
    const tiempos = [0, 1.234, 15, 47.5, 123.456, 900.01, 3661.5];
    for (const t of tiempos) {
      expect(stormFlash(t)).toBe(stormFlash(t));
    }
  });

  it('el valor siempre cae en [0, 1]', () => {
    for (let t = 0; t < 600; t += 0.03) {
      const v = stormFlash(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('el pico de un fogonazo llega a ~1', () => {
    let max = 0;
    for (let t = 0; t < 300; t += 0.005) {
      max = Math.max(max, stormFlash(t));
    }
    expect(max).toBeGreaterThan(0.99);
  });

  it('la fracción de tiempo con fogonazo es pequeña', () => {
    const step = 0.02;
    const totalSeconds = 20 * 60; // 20 minutos simulados
    let encendido = 0;
    let muestras = 0;
    for (let t = 0; t < totalSeconds; t += step) {
      muestras++;
      if (stormFlash(t) > 0.001) encendido++;
    }
    const fraccion = encendido / muestras;
    // Sí hay algún fogonazo en la ventana muestreada...
    expect(fraccion).toBeGreaterThan(0);
    // ...pero es una fracción pequeña del tiempo total (diseño: ~2%, margen generoso).
    expect(fraccion).toBeLessThan(0.05);
  });

  it('en un intervalo largo hay más de un fogonazo, y no equiespaciados de forma exacta', () => {
    const step = 0.02;
    const totalSeconds = 10 * 60; // 10 minutos simulados
    const picos: number[] = [];
    let dentro = false;
    for (let t = 0; t < totalSeconds; t += step) {
      // Umbral alto (0.9): solo el primer flash del doble destello (pico 1)
      // lo cruza — el segundo llega como mucho a FLASH2_PEAK = 0.6 — así cada
      // fogonazo cuenta UNA vez, no dos.
      const encendido = stormFlash(t) > 0.9;
      if (encendido && !dentro) picos.push(t);
      dentro = encendido;
    }
    expect(picos.length).toBeGreaterThan(1);

    const huecos: number[] = [];
    for (let i = 1; i < picos.length; i++) huecos.push(picos[i] - picos[i - 1]);

    // Todos los huecos dentro del rango [10, 20] s pedido (con margen del paso de muestreo).
    for (const hueco of huecos) {
      expect(hueco).toBeGreaterThan(10 - 0.1);
      expect(hueco).toBeLessThan(20 + 0.1);
    }

    // Y no todos exactamente iguales: el intervalo varía, no es un metrónomo.
    const distintos = new Set(huecos.map((h) => Math.round(h * 10)));
    expect(distintos.size).toBeGreaterThan(1);
  });
});
