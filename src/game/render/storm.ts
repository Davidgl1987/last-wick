/**
 * Fogonazo de tormenta — lógica PURA (sin `three` ni React; se testea en el
 * entorno `node` de vitest, igual que `wall-modules.ts`/`floor-families.ts`).
 * Encargo de David en playtest 2026-08-07: "de vez en cuando hubiera un
 * relámpago/trueno que ilumine muy fuerte por la ventana (casi blanco)
 * durante un instante". El trueno SONORO ya está conectado (encargo de
 * audio posterior, motor Web Audio en `audio/sfxEngine.ts`): la detección
 * del flanco de subida de `stormFlash(world.time)` vive en
 * `render/useGameLoop.ts` (una única vez, para no duplicarla en cada
 * consumidor), que dispara `playSfx('thunder', ...)` con retardo y paso bajo
 * para que se oiga como un retumbe lejano tras el fogonazo. Este módulo
 * sigue sin saber nada de audio ni de render: solo decide CUÁNDO y CUÁNTO
 * brilla/truena; CÓMO se pinta o suena lo deciden quienes lo consumen
 * (`RoomView.tsx` muta el material de las ventanas, `SceneLights.tsx` sube un
 * instante el hemisphereLight, `useGameLoop.ts` dispara el trueno).
 *
 * `stormFlash(time)` es determinista por `time` (nada de `Math.random()`,
 * mismo criterio que el resto del render — ver `hashId`, floor-families.ts):
 * la misma marca de tiempo de simulación (`world.time`) da siempre el mismo
 * valor, así que dos consumidores que la llaman en el mismo frame (el
 * material de ventana y el hemisphereLight) quedan en fase sin compartir
 * estado entre ficheros.
 *
 * El jitter del intervalo (más abajo) NO reutiliza `hashId` — se probó primero
 * y falló en la práctica: `hashId` hashea una CADENA con el algoritmo
 * polinómico `hash·31 + charCode`, y para sufijos que solo difieren en el
 * último carácter (`"storm:9"` vs `"storm:10"` no, pero `"storm:8"` vs
 * `"storm:9"` sí: mismo prefijo `"storm:"`, un único dígito que solo cambia en
 * +1 de código ASCII) el hash resultante también solo cambia en +1 — CERO
 * avalancha. Medido en consola contra `stormFlash` real: los huecos entre
 * fogonazos salían constantes en exactamente 15 s durante decenas de ranuras
 * seguidas (todo el tiempo que el índice de ranura tiene la misma cantidad de
 * dígitos), justo el "metrónomo exacto" que el encargo pide evitar. `mix32`
 * (Murmur3 finalizer) es un hash de ENTERO con avalancha completa incluso
 * para entradas secuenciales — es la herramienta correcta para hashear un
 * índice de ranura que avanza de uno en uno, aunque `hashId` siga siendo lo
 * correcto para hashear ids de sala/textos (floor-families.ts, RoomView.tsx).
 *
 * PATRÓN — nunca un metrónomo exacto: la mayor parte del tiempo devuelve 0
 * (cielo despejado). El eje de tiempo se trocea en "ranuras" fijas de
 * `FLASH_SLOT_LENGTH` s (15, el punto medio del rango 10-20 s pedido) y cada
 * ranura lleva EXACTAMENTE un fogonazo, centrado en un punto que varía por
 * ranura (`flashCenter`, hash de su índice) dentro de `±FLASH_JITTER_HALF`
 * respecto al centro geométrico de la ranura. Como el jitter de dos ranuras
 * consecutivas puede diferir como mucho en `2×FLASH_JITTER_HALF` (10 s), la
 * distancia real entre dos fogonazos consecutivos siempre cae en
 * `[FLASH_SLOT_LENGTH − 2×FLASH_JITTER_HALF, FLASH_SLOT_LENGTH +
 * 2×FLASH_JITTER_HALF]` = `[10, 20]` — el rango exacto que pide el encargo,
 * sin acumular un reloj de "próximo fogonazo" ranura a ranura: evaluar
 * `stormFlash` en cualquier `time` es O(1), solo hace falta la ranura que
 * contiene ESE instante (el jitter nunca desplaza el centro fuera de su
 * ranura — ver margen en `flashCenter` — así que nunca hace falta mirar la
 * ranura vecina).
 *
 * Un relámpago real no es un pico único: cada fogonazo es un DOBLE destello
 * (`pulse`, coseno alzado de soporte FINITO — vale exactamente 0 en cuanto
 * `|dt| ≥ halfWidth`, a diferencia de una gaussiana, que nunca llega a 0 del
 * todo — así el fogonazo tiene un final nítido y medible) — un flash corto a
 * intensidad máxima, una caída a 0, y un segundo flash algo más débil justo
 * después. La envolvente final es el MÁXIMO de los dos pulsos, nunca la suma:
 * así el resultado queda garantizado en [0,1] sin tener que recortarlo.
 */

/** Duración nominal entre fogonazos (s): punto medio del rango 10-20 s pedido por el encargo. */
const FLASH_SLOT_LENGTH = 15;

/**
 * Mitad del jitter aplicado al centro de cada ranura (s). Con este valor, la
 * distancia entre dos fogonazos consecutivos cae siempre en
 * `[FLASH_SLOT_LENGTH − 2×FLASH_JITTER_HALF, FLASH_SLOT_LENGTH + 2×FLASH_JITTER_HALF]`
 * = [10, 20] — el rango exacto pedido (ver razonamiento en la cabecera).
 */
const FLASH_JITTER_HALF = 2.5;

/** Separación entre los dos picos del doble destello (s). */
const FLASH_PEAK_GAP = 0.2;
/** Semi-anchura del primer flash (el que llega a intensidad máxima): soporte finito, coseno alzado. */
const FLASH1_HALF_WIDTH = 0.06;
/** Semi-anchura del segundo flash: algo más ancho/suave que el primero. */
const FLASH2_HALF_WIDTH = 0.09;
/** Intensidad de pico del segundo flash — "algo más débil" que el primero (que llega a 1); duración total del doble destello ≈ FLASH_PEAK_GAP + FLASH1_HALF_WIDTH + FLASH2_HALF_WIDTH ≈ 0.35 s, dentro del rango 0.3-0.4 s pedido. */
const FLASH2_PEAK = 0.6;

/**
 * Hash de ENTERO de 32 bits con avalancha completa (finalizador de
 * MurmurHash3 — constantes estándar, no inventadas): a diferencia de un hash
 * polinómico sobre una cadena (`hashId`, floor-families.ts), aquí un cambio
 * de +1 en la entrada cambia la salida de forma aparentemente no relacionada,
 * incluso para enteros SECUENCIALES como un índice de ranura — justo lo que
 * hace falta para que el jitter de dos ranuras consecutivas no esté
 * correlacionado (ver cabecera del fichero: por qué NO se reutiliza `hashId`
 * aquí). `>>> 0` interpreta el resultado como entero SIN signo de 32 bits.
 */
function mix32(n: number): number {
  let h = n >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Punto en el tiempo (s) donde cae el fogonazo de la ranura `slot` — mitad de
 * la ranura más un jitter determinista por índice de ranura (`mix32(slot)`,
 * nunca `Math.random()`). El jitter cae en `[-FLASH_JITTER_HALF,
 * +FLASH_JITTER_HALF)` ⊂ `(-FLASH_SLOT_LENGTH/2, +FLASH_SLOT_LENGTH/2)`, así
 * que el centro siempre queda estrictamente dentro de su propia ranura, con
 * margen de sobra (≥5 s) respecto a los bordes — el margen que permite a
 * `stormFlash` mirar solo esta ranura y nunca la vecina.
 */
function flashCenter(slot: number): number {
  const jitterUnit = mix32(slot) / 0xffffffff; // [0, 1]
  const jitter = jitterUnit * (2 * FLASH_JITTER_HALF) - FLASH_JITTER_HALF; // [-FLASH_JITTER_HALF, +FLASH_JITTER_HALF]
  return slot * FLASH_SLOT_LENGTH + FLASH_SLOT_LENGTH / 2 + jitter;
}

/**
 * Pulso de soporte finito (coseno alzado): sube y baja suave entre `peak` y
 * 0, y vale EXACTAMENTE 0 en cuanto `|dt| ≥ halfWidth` (ver cabecera del
 * fichero: es lo que da al fogonazo un final nítido, medible en los tests).
 */
function pulse(dt: number, halfWidth: number, peak: number): number {
  const t = Math.abs(dt) / halfWidth;
  if (t >= 1) return 0;
  return peak * 0.5 * (1 + Math.cos(Math.PI * t));
}

/**
 * Factor de fogonazo en `time` (s de simulación, `world.time`), en [0, 1]. 0
 * la inmensa mayoría del tiempo; sube hasta 1 en el pico del primer flash de
 * cada ranura de `FLASH_SLOT_LENGTH` s (ver cabecera del fichero para el
 * patrón completo: ranuras + jitter + doble destello).
 */
export function stormFlash(time: number): number {
  const slot = Math.floor(time / FLASH_SLOT_LENGTH);
  const center = flashCenter(slot);
  const first = pulse(time - (center - FLASH_PEAK_GAP / 2), FLASH1_HALF_WIDTH, 1);
  const second = pulse(time - (center + FLASH_PEAK_GAP / 2), FLASH2_HALF_WIDTH, FLASH2_PEAK);
  return Math.max(first, second);
}
