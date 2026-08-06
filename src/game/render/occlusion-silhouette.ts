/**
 * Siluetas de oclusión: ver al héroe (y a los enemigos) A TRAVÉS de lo que los
 * tape.
 *
 * Por qué existe (playtest de David, 2026-08-06): al pasar los muros de
 * parapeto bajo a muro completo (`wall`, 3.36 u), el muro que queda entre la
 * cámara y el héroe lo oculta por completo — con `CAMERA_OFFSET = (0, 9.5,
 * 6.2)` la pendiente es 0.65, así que un muro de 3.36 u tapa ~2.2 u por
 * detrás. Perder de vista tu propio personaje choca de frente con el
 * "legibilidad ante todo" del GDD §14. La idea es de David: "se puede crear
 * una máscara que haga invisible a los enemigos y al personaje principal
 * cuando están tapados por el muro, o mostrar un wireframe para estos".
 *
 * CÓMO FUNCIONA, que es lo bonito del truco: no hace falta postproceso, ni
 * stencil, ni un render target aparte, ni saber qué tapa a quién. Se dibuja
 * una COPIA de la malla del personaje con `depthFunc = GreaterDepth`, es
 * decir, invirtiendo el test de profundidad: el fragmento solo pasa donde está
 * MÁS LEJOS que lo ya pintado. Traducido: la copia se ve exactamente donde el
 * personaje está TAPADO, y desaparece sola en cuanto deja de estarlo. El
 * hardware ya está haciendo esa comparación de todos modos; esto solo la lee
 * al revés.
 *
 * Detalles que importan:
 * - `depthWrite: false` — la silueta no debe escribir profundidad o taparía a
 *   lo que se dibuje después (incluida ella misma en la parte que sí se ve).
 * - `renderOrder` alto en la malla que lo use: tiene que dibujarse DESPUÉS del
 *   escenario, o no habría nada contra lo que comparar y la silueta saldría
 *   siempre.
 * - `MeshBasicMaterial`, no Lambert: una silueta a través de un muro no debe
 *   recibir luz — es un símbolo, no un objeto. Además así se lee igual de bien
 *   en la oscuridad, que es justo cuando hace falta.
 * - `fog: false` — el mismo motivo: no debe difuminarse con la distancia.
 *
 * Coste: una llamada de dibujo por personaje tapado, con el material más
 * barato que hay. No añade ninguna luz (el presupuesto de 7 luces + 1 sombra
 * sigue intacto) y no toca la simulación.
 */

import * as THREE from 'three';

/**
 * `renderOrder` de las siluetas. Alto para que el escenario ya esté dibujado
 * (y su profundidad escrita) cuando le toca a la silueta comparar contra él.
 */
export const SILHOUETTE_RENDER_ORDER = 10;

/**
 * Opacidad de la silueta. No es 1 a propósito: una silueta plana y opaca a
 * través de un muro se lee como un bug de render ("el personaje atraviesa la
 * pared"); traslúcida se lee como lo que es, una ayuda de lectura.
 */
const SILHOUETTE_OPACITY = 0.55;

/**
 * Material de silueta para un color dado. Se crea UNO por color y se
 * comparte — mismo criterio que `assets.ts`: los materiales se crean una vez
 * al cargar el módulo, nunca por frame ni por instancia.
 */
export function makeSilhouetteMaterial(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    depthFunc: THREE.GreaterDepth,
    depthWrite: false,
    transparent: true,
    opacity: SILHOUETTE_OPACITY,
    fog: false,
  });
}
