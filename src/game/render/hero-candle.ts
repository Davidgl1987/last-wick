/**
 * Normalización COMPARTIDA de la vela del héroe (pieza `candle_melted` del
 * kit): la usan tanto `HeroView.tsx` (el héroe jugable) como
 * `TitleScreenScene.tsx` (Lumora, la vela del vestíbulo del título).
 *
 * Extraído de `HeroView.tsx` (encargo de David, 2026-08-18: "debería usarse
 * el mismo modelo y la misma llama en todos sitios"). Hasta ahora cada sitio
 * normalizaba la pieza a su manera — `HeroView.tsx` a radio 1 y centrada en
 * Y (lo que hay aquí abajo), `TitleScreenScene.tsx` con
 * `kitXZCenteredGeometry` (solo recentra X/Z, conserva el pivote nativo del
 * modelo en Y, sin normalizar el radio) — y las pequeñas diferencias
 * resultantes ya se notaban a simple vista ("desde el propio título ya se ve
 * que no está del todo bien situada, aunque parece que se hace de manera
 * distinta"). Con una sola función usada por los dos sitios es IMPOSIBLE que
 * la vela del héroe y la de Lumora diverjan de nuevo por este motivo: la
 * geometría, y todo lo que se ancle a sus proporciones (llama, ojos,
 * pinchos...), sale exactamente igual en los dos, y solo cambia la escala
 * global que aplique quien la monte.
 */

import * as THREE from 'three';
import { kitGeometry } from './kit';

/**
 * Nombre de la pieza del kit que hace de CUERPO del héroe (prueba pedida por
 * David, 2026-08-05: "probar a utilizar la vela más ancha que hay en el kit
 * como personaje, incluyendo los ojos"). De las velas sueltas del pack todas
 * miden lo mismo de ancho (0.33) y lo que cambia es el alto, así que "la más
 * ancha" en PROPORCIÓN es la derretida (0.33 × 0.70). Cambiar esta constante
 * a `'candle'` (0.33 × 0.87, más estilizada) es todo lo que hace falta para
 * probar la otra: el resto del código que consume esta normalización deriva
 * sus medidas de la geometría, no de números fijos. `candle_lit` NO sirve:
 * trae su propia llama modelada y el héroe ya pone la suya, animada
 * (`CandleFlame.tsx`).
 */
export const HERO_CANDLE_MODEL = 'candle_melted';

/**
 * Mitad del alto de la vela EN SU ESPACIO LOCAL, donde el radio vale 1 (misma
 * convención que tenía `heroCandleGeometry`, el cilindro de ronda 7: radio 1,
 * alto 2.8 ⇒ mitad 1.4). Mantiene la base pinchada al pivote pase lo que pase
 * con el escalado vertical (squash o estiramiento) en `HeroView.tsx`.
 *
 * Ya NO es un 1.4 fijo: se calcula a partir de la proporción real del modelo
 * del kit (`normalizeHeroCandleGeometry` más abajo), porque la vela del pack
 * es más esbelta que el cilindro que sustituye y ese número manda sobre
 * varias medidas ya afinadas en playtest — dónde va la llama (ver
 * `CANDLE_FLAME_ANCHOR_Y` en `HeroView.tsx`), dónde los ojos y dónde se
 * clavan los pinchos del Erizo de Acero. Derivarlas todas de aquí es lo que
 * permite cambiar `HERO_CANDLE_MODEL` sin volver a tunear nada a ojo.
 *
 * La silueta se normaliza por el RADIO (no por el alto) a propósito: en la
 * ronda 7 David corrigió justo esto — "has cambiado el modelo y no la hitbox,
 * te pedí lo contrario" —, así que el ancho visible tiene que seguir siendo
 * exactamente el de la hitbox (`HERO_RADIUS`), ni generoso ni tacaño, y el
 * alto es el que le toque al modelo.
 *
 * El número: `candle_melted` mide 0.33 de ancho por 0.70 de alto, así que
 * normalizada a radio 1 (ancho 2) su alto es 2·0.70/0.33 = 4.24 y su mitad,
 * 2.12. Va escrito como constante en vez de leerse del `boundingBox` porque
 * este módulo se importa ANTES de que el kit esté precargado (App.tsx monta el
 * juego después, pero el import es estático) y `kitGeometry` lanzaría. A cambio
 * `normalizeHeroCandleGeometry` comprueba en tiempo de ejecución que el modelo
 * real coincide con este número y avisa por consola si algún día deja de
 * hacerlo.
 */
export const CANDLE_HALF_HEIGHT = 2.12;

/**
 * Adapta la vela del kit a la convención local que ya usaba el cilindro al que
 * sustituye: RADIO 1 y CENTRADA en el origen (el modelo del pack nace apoyado
 * en su base, con el ancho que le tocó al artista). Se hace una sola vez sobre
 * una copia — nunca se muta la geometría cacheada de `kitGeometry`, que
 * comparte cualquier otro uso del kit.
 *
 * Escala UNIFORME por el radio (no independiente por eje): estirar solo el alto
 * deformaría el goterón de cera, que es justo lo que da personalidad a esta
 * pieza. El alto resultante es el que dicte el modelo, y `CANDLE_HALF_HEIGHT`
 * ya está calculado para él.
 */
export function normalizeHeroCandleGeometry(): THREE.BufferGeometry {
  const source = kitGeometry(HERO_CANDLE_MODEL);
  const box = source.boundingBox;
  if (!box) throw new Error('la vela del kit no trae boundingBox calculado');
  const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  const scale = 1 / radius;
  const centerY = (box.max.y + box.min.y) / 2;
  const normalized = source.clone().translate(0, -centerY, 0).scale(scale, scale, scale);
  normalized.computeBoundingBox();

  // Comprobación de que `CANDLE_HALF_HEIGHT` (constante, porque este módulo se
  // importa antes de que el kit esté cargado) sigue describiendo al modelo
  // real. Si algún día se cambia `HERO_CANDLE_MODEL` y se olvida el número,
  // esto lo dice en vez de dejar la llama flotando y los ojos descolgados.
  const realHalfHeight = normalized.boundingBox?.max.y ?? 0;
  if (Math.abs(realHalfHeight - CANDLE_HALF_HEIGHT) > 0.02) {
    console.warn(
      `[hero-candle] CANDLE_HALF_HEIGHT=${CANDLE_HALF_HEIGHT} no cuadra con '${HERO_CANDLE_MODEL}' (real ${realHalfHeight.toFixed(2)}): actualízalo o la llama, los ojos y los pinchos quedarán fuera de sitio.`,
    );
  }
  return normalized;
}
