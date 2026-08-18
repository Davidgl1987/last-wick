/**
 * Vela COMPARTIDA: el modelo completo del héroe-vela —cuerpo de cera,
 * silueta de oclusión, carita (ojos) y llama— en un único componente que
 * montan tanto el héroe jugable (`HeroView.tsx`) como Lumora, la vela del
 * vestíbulo del título (`TitleScreenScene.tsx`).
 *
 * Nace de un encargo de David (2026-08-18): "las cosas difieren entre la
 * pantalla de título y el juego real. En TitleScreenScene CandleFlame
 * depende de dos groups que hay encima, y en HeroView depende de
 * flameAnchorRef que depende de la posición que se le asigna ahí...
 * Debería haber un componente que lo pinte todo, tanto en el título como en
 * el juego." Hasta ahora cada sitio RECOMPONÍA la vela a mano: `HeroView`
 * construía cuerpo/silueta/ojos/llama con refs actualizadas cada frame,
 * `TitleScreenScene` los recomponía con sus propios números (posición/
 * escala de dos `<group>` anidados para la llama, offsets propios para los
 * ojos) — dos RECETAS distintas para el mismo resultado, que solo
 * coincidían si quien tocaba una se acordaba de tocar la otra igual. Con un
 * único componente eso deja de ser posible: cuerpo, silueta, ojos y llama
 * son proporciones FIJAS en espacio local normalizado (radio de la vela =
 * 1, la misma convención que ya fija `normalizeHeroCandleGeometry`,
 * `render/hero-candle.ts`), y quien monta el componente decide un ÚNICO
 * número (`scale`, prop de abajo) más DÓNDE va (la posición/rotación del
 * `<group>` que lo envuelve, que sigue siendo cosa de quien lo monta — el
 * `candleTiltGroupRef` de `HeroView`, el `<group>` de balanceo de Lumora).
 *
 * CONTRATO:
 * - `scale`: el único grado de libertad de tamaño. Multiplica UNIFORMEMENTE
 *   cada pieza (cuerpo, silueta, ojos, ancla de la llama) — nunca de forma
 *   independiente por eje ni por pieza, o las proporciones (afinadas en
 *   muchas rondas de playtest, ver los historiales de más abajo) dejarían
 *   de coincidir entre sitios. `HeroView` pasa `HERO_RADIUS` (un número
 *   fijo — el squash/estiramiento/Firmeza en vivo se aplica aparte, vía las
 *   refs de abajo, exactamente como pasaba ya con `scale={HERO_RADIUS}` en
 *   el `<mesh>` del cuerpo antes de este refactor); Lumora pasa
 *   `LUMORA_CANDLE_RADIUS` y no vuelve a tocar nada más.
 * - Refs OPCIONALES (`bodyRef`, `candleGroupRef`, `flameAnchorRef`,
 *   `eyeGroupRef`): quien las pase puede seguir mutando esas piezas cada
 *   frame por sí mismo — es justo lo que necesita `HeroView` (squash/
 *   estiramiento y parpadeo de i-frames en el cuerpo, reescalado del ancla
 *   de la llama por Firmeza, yaw de la mirada en los ojos) y justo lo que
 *   Lumora NO necesita (no las pasa, y el componente sigue funcionando con
 *   los valores estáticos que derivan de `scale`).
 * - `children`: hijos que cuelgan del CUERPO (`bodyRef`), para heredar
 *   gratis su escala/squash/parpadeo — los pinchos del Erizo de Acero y la
 *   burbuja de la Burbuja de Cuarzo en `HeroView`; nada en Lumora.
 *
 * POR QUÉ OJOS Y LLAMA NO CUELGAN DEL CUERPO: el cuerpo (`bodyRef`) es la
 * única pieza que se deforma —squash de impacto, estiramiento vertical con
 * la velocidad, los dos SOLO en `HeroView`, Lumora nunca los aplica—. Si
 * ojos/llama fueran hijos del cuerpo heredarían esa deformación gratis,
 * pero una llama que se ESTIRA VERTICAL igual que la cera del cuerpo no se
 * lee como fuego, se lee como un globo que se infla con la vela. Por eso
 * viven en un grupo HERMANO sin deformar (`candleGroupRef`, hijo directo de
 * lo que monte este componente, nunca de `bodyRef`): comparten la posición/
 * inclinación de quien lo monta, pero JAMÁS su escala de squash/
 * estiramiento. Esta separación YA existía en las dos recetas antiguas por
 * igual (ni `HeroView` ni Lumora colgaban la llama del cuerpo) — no era la
 * causa directa de que David viera "notablemente más larga" la llama del
 * título —, pero es la razón de que este componente esté estructurado en
 * dos ramas (cuerpo deformable / ojos+llama sin deformar) en vez de un
 * único `<mesh>` padre: con un solo padre habría sido imposible mantener
 * esa separación sin volver a las dos recetas de nuevo.
 *
 * VERIFICACIÓN DE PROPORCIÓN (encargo de David, punto 4: "comprueba que la
 * proporción llama/vela es la misma en título y juego, y si encuentras
 * alguna cuenta del título que no cuadre, dilo en vez de inventar una
 * corrección"). Con `scale` multiplicando uniformemente cuerpo/silueta/
 * ojos/ancla-de-llama, y `CandleFlame` operando en el mismo espacio local
 * normalizado (recibe `FLAME_BASE_SCALE`, el mismo número para los dos
 * sitios), la proporción llama/vela es IDÉNTICA por construcción para
 * cualquier valor de `scale` de aquí en adelante — no puede volver a
 * descuadrarse. Repasada a mano la ARITMÉTICA de las dos recetas ANTIGUAS
 * (antes de este refactor) para confirmar que no hiciera falta ningún
 * factor de corrección al unificarlas:
 *   - Posición del ancla: Lumora componía
 *     `LUMORA_CANDLE_RADIUS · (1 + CANDLE_FLAME_ANCHOR_Y)` (dos `<group>`
 *     anidados, posición del externo + posición del interno ya escalada);
 *     el héroe componía `visualRadius · (1 + CANDLE_FLAME_ANCHOR_Y)`
 *     (`candleGroupRef` a `visualRadius` + `flameAnchorRef` a
 *     `visualRadius·CANDLE_FLAME_ANCHOR_Y` dentro de él, sin escala propia
 *     de `candleGroupRef`). Es la MISMA fórmula con distinto nombre de
 *     variable, y ambas caen exactamente en la boca de la vela
 *     (`2·escala·CANDLE_HALF_HEIGHT`, el mismo `mouthY` que ya calculaba
 *     Lumora): con `CANDLE_HALF_HEIGHT=2.12` y `FLAME_GAP=0`,
 *     `1+CANDLE_FLAME_ANCHOR_Y = 2·CANDLE_HALF_HEIGHT = 4.24` en los dos
 *     sitios, sin resto.
 *   - Escala acumulada hasta `CandleFlame`: Lumora multiplicaba
 *     `LUMORA_CANDLE_RADIUS` (grupo externo) × 1 (grupo interno, sin escala
 *     propia) = `LUMORA_CANDLE_RADIUS`; el héroe multiplicaba
 *     `visualRadius` una sola vez (`flameAnchorRef.scale`). Misma cuenta.
 *   - Con `HERO_RADIUS=0.24` y `LUMORA_CANDLE_RADIUS=0.27`, el cociente es
 *     exactamente 0.27/0.24 = 1.125 —el mismo ~12% "a propósito, primer
 *     plano del vestíbulo" del que habla David— y ese 12% se aplicaba YA
 *     por igual a la posición del ancla y a la escala de la llama en las
 *     dos recetas antiguas. No había ninguna cuenta de la llama que no
 *     cuadrase: ya estaba bien proporcionada. Lo que hacía falta no era
 *     corregir un número, sino borrar la receta duplicada para que no
 *     pudiera volver a desincronizarse en el futuro —que es justo lo que
 *     hace este componente—.
 *   - SÍ había una cuenta que NO cuadraba: los OJOS. Lumora los recomponía
 *     con números propios (separación 0.105, escala [0.065, 0.1, 0.04], Z
 *     0.265, altura `mouthY·0.56`) que no salían de ninguna fórmula
 *     compartida con el héroe —simplemente se veían "razonablemente bien"
 *     a ojo—. Este componente los sustituye por las mismas constantes
 *     `CANDLE_EYE_*` de `HeroView` (ver más abajo), generalizadas a
 *     cualquier `scale` en vez de fijas a `HERO_RADIUS`: con
 *     `scale=LUMORA_CANDLE_RADIUS` esto mueve los ojos de Lumora a
 *     [-0.089, 0, 0.259] con escala ≈[0.057, 0.086, 0.032], unos 15-20% más
 *     pequeños que los números inventados y unos milímetros más arriba. Es
 *     un cambio real y deliberado (pedido explícito del punto 1: "desde las
 *     constantes CANDLE_EYE_* que ya existen en HeroView, no los números
 *     sueltos del título"), no una regresión.
 */

import { useMemo } from 'react';
import type { ReactNode, Ref } from 'react';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { type BufferGeometry, type Group, type Mesh, Vector3 } from 'three';
import { CANDLE_HALF_HEIGHT, normalizeHeroCandleGeometry } from '@/game/render/hero-candle';
import { makeSilhouetteMaterial, SILHOUETTE_RENDER_ORDER } from '@/game/render/occlusion-silhouette';
import { heroMaterial, smallDotGeometry, WEAPON_COLOR } from '@/game/render/assets';
import { candleEyeMaterial } from '@/game/render/assets-dark';
import { CandleFlame } from './CandleFlame';

// ── Silueta de oclusión ──────────────────────────────────────────────────

/**
 * Silueta del héroe a través de lo que lo tape (ver `occlusion-silhouette.ts`
 * para el truco de `GreaterDepth`). Su color sigue al del arma activa, igual
 * que la llama y el punto de puntería: si la silueta se quedara de un color
 * fijo, sería la única pieza del héroe que no responde al arma, y el color de
 * arma es justo lo que el jugador usa para saber con qué está disparando.
 *
 * EXPORTADA: `HeroView.tsx` sigue mutando `.color` cada frame en su `useFrame`
 * (lerp hacia el color del arma activa, ver `WEAPON_COLOR_LERP_STIFFNESS`
 * allí) — el objeto material es el mismo singleton se mire desde donde se
 * mire, así que esa mutación se aplica igual venga la silueta montada aquí o
 * en el fichero antiguo. Lumora no la muta nunca (no tiene arma activa que
 * lerpear), así que en el título se ve siempre con su color de fábrica
 * (`WEAPON_COLOR.body`) — en la práctica invisible de todas formas: nada
 * ocluye a Lumora en el vestíbulo del título, así que este mesh no llega a
 * dibujar ni un píxel ahí, es puro "por si acaso" de tener un único
 * componente.
 */
export const heroSilhouetteMaterial = makeSilhouetteMaterial(WEAPON_COLOR.body.clone());

/**
 * Extrae los vértices de una `BufferGeometry` como `Vector3[]`, formato que
 * pide `ConvexGeometry` (ver comentario grande de `buildHeroSilhouetteGeometry`
 * más abajo). Genérica a propósito, sin acoplarse a la vela: si algún día
 * hiciera falta un hull para otra pieza, esta función ya sirve.
 */
function bufferGeometryVertices(geometry: BufferGeometry): Vector3[] {
  const position = geometry.attributes.position;
  const vertices: Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    vertices.push(new Vector3().fromBufferAttribute(position, i));
  }
  return vertices;
}

/**
 * Geometría de la SILUETA de oclusión del cuerpo: la ENVOLVENTE CONVEXA
 * (`ConvexGeometry`) de la propia malla normalizada del héroe, en vez de un
 * primitivo aproximado. Historial de este arreglo, porque costó dos
 * intentos y el segundo explica por qué el primero falló:
 *
 * 1) Bug original (playtest 2026-08-17, David: "veo un reflejo de la llama
 *    en modo espejo justo debajo de ella" — intuición suya y correcta:
 *    sospechaba de la silueta; confirmado poniendo `visible={false}` en el
 *    mesh de la silueta, la mancha desaparecía del todo). La silueta reusaba
 *    la MISMA malla que el cuerpo, `heroCandleGeometry` (`candle_melted`
 *    normalizada), que NO es convexa: tiene el cráter/goterón de cera
 *    derretida en su parte alta. `heroSilhouetteMaterial` dibuja con
 *    `depthFunc: GreaterDepth` ("píntame donde esté MÁS LEJOS que lo ya
 *    escrito en el depth buffer"), pensado para compararse contra un muro
 *    EXTERNO que tape al héroe. En una malla CÓNCAVA ese test se cumple
 *    también contra el propio cuerpo: el borde del cráter y el fondo del
 *    cráter son dos superficies frontales de la MISMA malla en el mismo
 *    píxel — la primera escribe la profundidad cercana y la segunda (más
 *    lejana) pasa el test sin que nada externo tape nada. Resultado: un
 *    parche del color de arma (`WEAPON_COLOR.body`) con la forma del
 *    cráter, pintado sobre el propio héroe. Mismo tipo de fallo que el ya
 *    documentado para los ojos (`CANDLE_EYE_RENDER_ORDER`, más abajo) y
 *    para la moneda (`coinBodyMaterial` en `assets.ts`), pero aquí por
 *    CONCAVIDAD, no por z-fighting: no basta con reordenar el dibujo, la
 *    malla en sí no puede tener dos caras frontales en el mismo píxel — la
 *    solución tiene que ser CONVEXA por construcción.
 *
 * 2) Primer intento fallido: un `CylinderGeometry` de radio y alto fijos
 *    (mismo criterio que la silueta esférica de los enemigos,
 *    `EnemyViews.tsx` ≈línea 551), calibrado con una medida a mano
 *    incompleta que asumía sección circular y remate plano. Verificado en
 *    pantalla que NO valía — franjas grises verticales a lo largo del
 *    cuerpo y una mancha gris en la parte alta, el halo permanente que ya
 *    se sospechaba como riesgo. Medida completa de `candle_melted.glb` (ya
 *    en el espacio normalizado, radio nominal 1, centrado en Y) que explica
 *    por qué: la sección NO es un círculo, es un PRISMA DE 9 LADOS (vértices
 *    cada 40°, en −170/−130/−90/−50/−10/30/70/110/150°) con radio
 *    circunscrito (en los vértices) 1.0154 pero radio INSCRITO (en el centro
 *    de cada cara plana) de solo 1.0154·cos(20°) ≈ 0.954 — ningún radio de
 *    cilindro puede evitar sobresalir por el centro de las 9 caras planas
 *    sin quedarse corto en los 9 vértices, de ahí las franjas verticales.
 *    Además el remate superior del tramo de radio pleno es OBLICUO, no
 *    plano: sus vértices van de y=0.894 (el más bajo) a y=1.793 (el más
 *    alto), así que cualquier tope horizontal único deja parte de la pared
 *    real por encima del cilindro en casi media vuelta — la mancha gris de
 *    arriba. Un primitivo de revolución no puede seguir un contorno que no
 *    es de revolución.
 *
 * 3) Arreglo de la CONCAVIDAD: el HULL CONVEXO de los vértices reales de
 *    `heroCandleGeometry` (`bufferGeometryVertices` + `ConvexGeometry`, más
 *    abajo). Por qué no produce halo: el hull contiene EXACTAMENTE los
 *    mismos vértices que la malla real, así que su superficie coincide con
 *    el contorno del modelo en todo punto convexo (el prisma de 9 lados, la
 *    base, el remate oblicuo) y solo se aparta hacia FUERA en las
 *    concavidades del perfil — aquí mínimas, el cráter de la mecha es un
 *    hueco pequeño en la coronilla, no un socavón profundo. Y en la única
 *    concavidad que sí cierra (la "tapa" imaginaria que el hull traza sobre
 *    el cráter para quedar convexo), esa tapa queda MÁS CERCA de la cámara
 *    que el fondo real del cráter — así que ahí el depth buffer la descarta
 *    sola, sin ajuste manual alguno PARA ESE problema concreto (la
 *    concavidad). Resuelve el punto 1 por completo, pero destapa un segundo
 *    problema — ver punto 4. Construida en un `useMemo` propio (no
 *    constante de módulo, a diferencia del intento del cilindro): a
 *    diferencia de un primitivo de three.js, SÍ depende del kit cargado —
 *    necesita los vértices reales de `heroCandleGeometry`, que solo existen
 *    tras `normalizeHeroCandleGeometry()`.
 *
 * 4) Problema nuevo, destapado por el propio hull (playtest 2026-08-17,
 *    SEGUNDA ronda; David: "el player tiene texturas que tiemblan donde no
 *    debería, además de que parece que todavía tiene el reflejo de la
 *    llama"). Verificado en pantalla: rayas claras PARPADEANTES por todo el
 *    cuerpo y un parche fijo en la zona del cráter. Causa: Z-FIGHTING, no
 *    auto-oclusión otra vez — el hull comparte con el cuerpo las caras
 *    laterales del prisma de 9 lados (son EXACTAMENTE COPLANARES: mismos
 *    vértices, por construcción del hull), pero su TRIANGULACIÓN interna es
 *    distinta (`ConvexHull` no tiene por qué generar los mismos triángulos
 *    que trajera el `.glb`), así que la profundidad interpolada de cada
 *    malla en un píxel dado cae en valores casi iguales pero no idénticos, y
 *    ese "casi" cambia de píxel a píxel y de frame a frame (la silueta
 *    hereda el squash/stretch del cuerpo, así que el más mínimo cambio de
 *    escala reordena qué malla gana el sorteo). Donde la profundidad del
 *    hull sale, por puro margen de precisión de coma flotante, un pelín
 *    MAYOR que la del cuerpo, `GreaterDepth` la da por buena: silueta
 *    pintada sobre el héroe sin que nada externo lo tape, parpadeando según
 *    el resultado del sorteo en cada frame — de ahí las rayas temblorosas
 *    (caras laterales) y el parche persistente del cráter (zona con más
 *    triángulos degenerados por la geometría irregular del goterón). Mismo
 *    fenómeno ya documentado en este repo para los ojos
 *    (`CANDLE_EYE_RENDER_ORDER`, más abajo) y para la moneda
 *    (`coinBodyMaterial`, `ItemView.tsx`), pero aquí no vale arreglarlo con
 *    ORDEN de dibujo (`renderOrder`): el problema es la PROFUNDIDAD en sí,
 *    no la cola de render — dos mallas coplanares seguirán empatando el
 *    test de profundidad se dibujen en el orden que se dibujen.
 *
 * 5) Arreglo de la COPLANARIDAD: una "cáscara" — escalar la silueta un
 *    pelín hacia FUERA (`SILHOUETTE_SHELL_SCALE`), nunca hacia dentro.
 *    Contraintuitivo pero obligado: encogerla la dejaría ÍNTEGRA por detrás
 *    de la superficie real del cuerpo, y entonces `GreaterDepth` pasaría
 *    SIEMPRE en toda su extensión (más lejos que el cuerpo en cualquier
 *    punto) — la silueta se vería constantemente, tapada o no, el bug
 *    original pero generalizado a todo el cuerpo en vez de solo al cráter.
 *    Agrandarla la deja SIEMPRE delante (o justo igual) que la superficie
 *    real, así que sin oclusión externa la comparación `GreaterDepth` nunca
 *    se cumple en ningún punto y la silueta no se ve; en cuanto un muro tapa
 *    a ambas mallas, sigue viéndose por el mismo truco de siempre — la
 *    cáscara no cambia CUÁNDO se ve la silueta, solo impide que compita con
 *    el propio cuerpo por el mismo píxel de profundidad.
 *    Magnitud (`SILHOUETTE_SHELL_SCALE = 1.03`, +3%): en unidades de mundo,
 *    0.03 × HERO_RADIUS (0.24) ≈ 0.007 u — subpíxel a la distancia y FOV de
 *    la cámara del juego (`CAMERA_OFFSET`, `render/cameraSettings.ts`),
 *    comprobado en pantalla sobre suelo claro y sobre suelo oscuro sin borde
 *    visible. Con `LUMORA_CANDLE_RADIUS` (0.27, la vela del título) el mismo
 *    3% da 0.008 u — igual de subpíxel, y en la práctica el título ni
 *    siquiera llega a dibujar esta silueta (nada ocluye a Lumora ahí).
 *    `SILHOUETTE_SHELL_LIFT`: al escalar UNIFORMEMENTE una geometría
 *    centrada en el origen local (el hull nace centrado, porque nace de
 *    vértices ya centrados en Y), la base también baja ese mismo 3%,
 *    hundiéndose bajo la base real del cuerpo — y como el suelo del
 *    escenario queda MÁS CERCA de cámara que esa base hundida, el depth
 *    buffer destaparía ahí mismo una franja alrededor de los pies, el mismo
 *    tipo de fallo que se está arreglando pero en la base en vez de en los
 *    lados. `SILHOUETTE_SHELL_LIFT = CANDLE_HALF_HEIGHT · (SILHOUETTE_SHELL_SCALE
 *    − 1)` sube el mesh en Y justo lo necesario para que su base vuelva a
 *    coincidir con la base real del cuerpo; la coronilla queda ese mismo 3%
 *    más alta de lo que ya estaba, invisible por la misma cuenta de
 *    subpíxel de arriba.
 *    Importante: la cáscara NO sustituye al hull del punto 3, lo
 *    COMPLEMENTA — hacen falta los dos a la vez, cada uno resuelve un
 *    problema distinto: el hull resuelve la CONCAVIDAD (auto-oclusión del
 *    cráter contra sí mismo), la cáscara resuelve la COPLANARIDAD
 *    (z-fighting del hull contra el cuerpo en las caras laterales). Quitar
 *    cualquiera de los dos reabre el bug que ese paso arregla.
 */
function buildHeroSilhouetteGeometry(heroCandleGeometry: BufferGeometry): BufferGeometry {
  return new ConvexGeometry(bufferGeometryVertices(heroCandleGeometry));
}

/**
 * Factor de la "cáscara" de la silueta (punto 5 del historial de arriba):
 * cuánto se agranda `heroSilhouetteGeometry` respecto al cuerpo real para
 * que nunca compita con él por la misma profundidad en las caras laterales
 * coplanares del hull (z-fighting). +3%, no un valor mayor "por si acaso":
 * ya es indetectable en pantalla (0.03 × HERO_RADIUS ≈ 0.007 u de mundo,
 * subpíxel a la cámara del juego) y agrandar más solo arriesgaría un halo
 * perceptible sin ganar nada — ver el desglose completo en el punto 5.
 */
const SILHOUETTE_SHELL_SCALE = 1.03;
/**
 * Compensación en Y para que la base de la cáscara (que se hunde al escalar
 * uniformemente una geometría centrada en el origen) vuelva a coincidir con
 * la base real del cuerpo, en vez de destaparse contra el suelo — ver punto
 * 5 del historial de arriba para la cuenta completa. Derivado de
 * `SILHOUETTE_SHELL_SCALE` (no un número aparte) para que ambos efectos de
 * la cáscara se muevan siempre juntos si algún día cambia el porcentaje.
 */
const SILHOUETTE_SHELL_LIFT = CANDLE_HALF_HEIGHT * (SILHOUETTE_SHELL_SCALE - 1);

// ── Llama ─────────────────────────────────────────────────────────────────

/**
 * Tamaño base de la llama en unidades locales normalizadas (radio de la
 * vela = 1) — prop `scale` de `CandleFlame`. Ya NO se exporta (extracción a
 * `CandleModel.tsx`, 2026-08-18): antes la reexportaba `HeroView.tsx` para
 * que `TitleScreenScene.tsx` (Lumora) la reutilizara tal cual; ahora ningún
 * consumidor externo monta `<CandleFlame>` directamente —los dos pasan por
 * este componente—, así que el número es enteramente interno.
 *
 * Historial de tamaño, conservado porque cada subida respondió a un
 * problema de LECTURA concreto, no a "más grande porque sí":
 * - Ronda 8 (playtest, "la llama hazla un poco más grande"): 0.5 → 0.7
 *   (+40%, dentro del 35-45% pedido).
 * - 2026-08-17 (encargo de David: la mecha del propio modelo del kit se
 *   confundía con "un reflejo de la llama en modo espejo" con el bloom
 *   encima — ver el historial de `FLAME_GAP`, aquí abajo): 0.7 → 0.85
 *   (+21%), para que la llama gane a la mecha en lectura y no quepa
 *   ambigüedad sobre cuál es cuál.
 * - Mismo encargo, tras cambiar la TEXTURA a la silueta del icono de vida
 *   del HUD (ver `flame()` en `scripts/gen-vfx-textures.mjs`): 0.85 → 1.05
 *   (+24%). La forma nueva es una gota ÚNICA y estrecha (ancho útil ~142 de
 *   los 256 px del lienzo), mientras la anterior eran tres lenguas abiertas
 *   que llenaban el cuadro a lo ancho — a igualdad de escala del quad, la
 *   llama nueva se leía bastante más pequeña. Este ajuste le devuelve en
 *   pantalla el tamaño que tenía, medido sobre la vela en el juego.
 *
 * (El cálculo de altura que antes vivía en este comentario —"centro deseado
 * = boca + semialto"— quedó obsoleto en el refactor de 2026-08-18: la llama
 * ya no se ancla por su CENTRO a lo largo del eje de la vela, se ancla por
 * su BASE en la mecha, ver `CANDLE_FLAME_ANCHOR_Y`.)
 */
const FLAME_BASE_SCALE = 1.05;
/**
 * Desplazamiento en Y entre la boca de la vela y la base visible de la
 * llama, en × `scale`. CUATRO etapas —se conserva el historial completo
 * porque cada una responde (o deshace) a la anterior, y sin ese contexto el
 * valor actual (0.4) parece un número sacado de la nada—, más una quinta y
 * sexta que cambian su SIGNIFICADO (de qué mide) y una séptima de esta
 * extracción:
 *
 * Etapa 1 (playtest 2026-08-13, David: "parece que tiene reflejo" — veía un
 * brillo lechoso sobre el cuerpo en vez de una llama). Diagnosticado con la
 * escena real (posición de mundo del billboard vía consola): con hueco cero
 * la base de la llama caía EXACTAMENTE en la boca del cilindro, y desde la
 * cámara elevada de CameraRig (~56° sobre la horizontal) las dos siluetas se
 * fundían en pantalla en una sola mancha — más aún con el tono casi blanco
 * que deja el tonemap ACES sobre el amarillo pálido en HDR
 * (`WEAPON_COLOR_FLAME_HDR`), que no contrasta con la cera clara
 * (`HERO_WAX_COLOR`). Arreglo: separar la llama de la boca, `FLAME_GAP = 0.6`
 * (positivo), para dejar una franja oscura visible entre cera y fuego.
 *
 * Etapa 2 (encargo de David, 2026-08-17, primer intento): resulta que aquel
 * "reflejo" nunca fue la propia llama duplicándose — era la MECHA modelada
 * en el kit (`candle_melted` trae su goterón/mecha de cera ya esculpidos
 * encima del cuerpo), que con el bloom encima se lee como "una llama
 * invertida" justo debajo de la de verdad (mismo malentendido, causa
 * distinta; ver también el arreglo de la silueta de oclusión más arriba en
 * este fichero, otro síntoma de la misma mecha). Pedido de David,
 * literalmente el opuesto de la etapa 1: "mueve la llama un poco más hacia
 * abajo para que parezca parte de la mecha". `FLAME_GAP` pasó a −0.35
 * (solape, no hueco).
 *
 * Etapa 3 (mismo encargo, verificado en pantalla): −0.35 casi hacía
 * DESAPARECER la llama — no por el tamaño, sino porque bajarla la metía más
 * en la sombra que proyecta la cabeza de la vela vista desde el ángulo de
 * cámara (diagnóstico y arreglo completos en el comentario de
 * `FLAME_FORWARD`, en `CandleFlame.tsx`). Con la llama ya adelantada hacia
 * cámara vía `FLAME_FORWARD`, se probaron en pantalla −0.35 / −0.1 / 0.3 /
 * 0.45 / 0.6: los valores altos (0.35 en adelante) suben la llama hasta el
 * fondo CLARO de la sala, donde el blending ADITIVO de `heroFlameMaterial`
 * pierde fuerza — sumar luz sobre un fondo ya claro apenas se nota, sumarla
 * sobre la cabeza OSCURA de la vela resalta mucho. Resultado
 * contraintuitivo: cuanto más arriba, MENOS llama se ve. Con la textura de
 * tres lenguas el óptimo estaba en 0.15 (base recortada sobre la boca, sin
 * asomar al fondo claro).
 *
 * Etapa 4 (mismo encargo, tras pasar la textura a la silueta del icono de
 * vida del HUD): 0.15 → 0.4. La gota nueva es compacta y de núcleo denso, así
 * que aguanta el fondo claro mucho mejor que las tres lenguas difusas, y a
 * 0.15 quedaba ENTERA dentro del perfil de la cabeza: se leía como un dibujo
 * pintado sobre la cera, no como fuego ardiendo encima. Con 0.4 la punta
 * asoma por el perfil y la base sigue apoyada en la mecha — que es justo la
 * lectura pedida.
 *
 * Etapa 5 (refactor 2026-08-18, `CandleFlame.tsx`): esta constante CAMBIA DE
 * SIGNIFICADO. Antes medía el hueco entre la boca y el CENTRO de la llama, a
 * través de una cuenta que restaba el semialto de la propia llama
 * (`FLAME_BASE_SCALE · 1.8 / 2`) — con la llama ahora anclada por su BASE
 * (no por su centro), `FLAME_GAP` pasa a medir ese hueco DIRECTAMENTE, sin
 * pasar por ninguna cuenta con el semialto: es literalmente cuánto se separa
 * la base de la llama de la boca de la vela. El valor heredado de la etapa 4
 * (0.4) se mantuvo sin retocar en este primer paso del refactor — enseguida
 * se vio que ya no valía, ver etapa 6.
 *
 * Etapa 6 (mismo refactor, feedback de David tras probarlo: "todavía sale un
 * poco desplazada la llama en el juego, y un poco arriba en el título").
 * `FLAME_GAP = 0.4` era un número afinado a mano para el anclaje ANTIGUO (el
 * centro del quad) — no "se corrige" en esta etapa, es que dejó de medir lo
 * mismo: con el centro como referencia, 0.4 compensaba estar restando medio
 * alto de llama de por medio; con la BASE como referencia (etapa 5), ese
 * mismo 0.4 pasó a ser hueco PURO entre la mecha y el arranque de la llama —
 * de ahí que en Lumora se viera flotando por encima de la vela. Y en el
 * juego el mismo hueco se traduce ADEMÁS en desplazamiento LATERAL: el punto
 * de anclaje vive 0.4 por encima de la boca a lo largo del EJE de la vela
 * (no en su superficie), así que al inclinarse para apuntar ese punto se
 * desplaza de lado más que la propia mecha — el mismo mecanismo geométrico
 * del bug de la etapa anterior (un punto más lejos del pivote de la
 * inclinación se mueve más), solo que en miniatura, y es justo lo que David
 * seguía viendo. `FLAME_GAP = 0`: la llama nace exactamente en la boca/mecha,
 * sin hueco que además tirar de lado. Se deja la resta escrita en
 * `CANDLE_FLAME_ANCHOR_Y` (justo debajo) en vez de simplificarla: sigue
 * siendo el punto de tuning si un playtest futuro pide separarla nuevamente.
 *
 * Etapa 7 (extracción a `CandleModel.tsx`, 2026-08-18, encargo "un
 * componente que lo pinte todo"): sin cambio de valor. Lo único que cambia
 * es que el multiplicador que antes se llamaba `visualRadius` en `HeroView`
 * y `LUMORA_CANDLE_RADIUS` en Lumora ahora es un único `scale`, prop
 * genérica de este componente — ver la VERIFICACIÓN DE PROPORCIÓN en la
 * cabecera del fichero para la cuenta completa de que ambas recetas
 * antiguas ya daban el mismo resultado con ese cambio de nombre.
 *
 * Etapa 8 (playtest 2026-08-18, David: "baja un poco la llama para que
 * apenas haya separación entre la llama y la mecha"): 0 → -0.2, un solape
 * pequeño. Con 0 la BASE del quad caía justo en la boca, pero eso no es lo
 * mismo que la base VISIBLE del fuego: `flame.png` deja ~9% de margen
 * transparente por debajo de la llama dibujada (la silueta ocupa de y=16 a
 * y=232 de los 256 px del lienzo, ver `flame()` en
 * `scripts/gen-vfx-textures.mjs`), así que quedaba un hueco de aire entre la
 * punta de la mecha y donde empieza a verse fuego. Los -0.2 se comen ese
 * margen: en unidades del quad son 0.2 / (FLAME_BASE_SCALE · FLAME_ASPECT)
 * ≈ 0.2/1.89 ≈ 10.6% de su alto, es decir justo el margen de la textura.
 * Verificado en pantalla en el juego y en el título — la llama arranca
 * pegada a la mecha sin llegar a hundirse en la cera.
 */
const FLAME_GAP = -0.2;
/**
 * Altura LOCAL (dentro de `candleGroup`, que vive en 1.00·`scale` absoluto —
 * ver comentario de `CANDLE_EYE_Y` más abajo) a la que se ancla la BASE de
 * la llama: boca de la vela (2·`CANDLE_HALF_HEIGHT`) + el hueco `FLAME_GAP`
 * − el 1.00 del grupo padre (mismo "−1" que ya usa `CANDLE_EYE_Y`, el offset
 * de `candleGroup` respecto al suelo). Sustituye a la antigua
 * `FLAME_HEIGHT_FACTOR` (refactor 2026-08-18, `CandleFlame.tsx`): aquella
 * calculaba dónde poner el CENTRO de un quad que crecía a lo largo del eje
 * de la vela (sumando su propio semialto); esta calcula dónde poner la BASE,
 * sin más — el crecimiento hacia la punta ya no es cosa de esta constante,
 * lo resuelve `CandleFlame` internamente, siempre en vertical de mundo. Este
 * cambio de anclaje es justo el arreglo del bug de desplazamiento al apuntar
 * (ver el comentario de cabecera de `CandleFlame.tsx`).
 *
 * EXPORTADA: `HeroView.tsx` sigue necesitando este número en su propio
 * `useFrame` para reposicionar `flameAnchorRef` cada frame según
 * `visualRadius` (Firmeza en vivo) — este componente, por su parte, ya lo usa
 * internamente para el valor ESTÁTICO por defecto (ver el JSX más abajo),
 * que es todo lo que necesita Lumora.
 */
export const CANDLE_FLAME_ANCHOR_Y = 2 * CANDLE_HALF_HEIGHT - 1 + FLAME_GAP;

// ── Ojos ─────────────────────────────────────────────────────────────────

/**
 * Ojos de la vela, reajustados a la vela fina y alta de ronda 7 (radio local
 * 1, alto local 2.8 — ver comentario de `CANDLE_PIVOT_HEIGHT_FRACTION` en
 * `HeroView.tsx` y de `heroCandleGeometry` en `render/assets.ts`).
 *
 * Cuenta de ALTURAS (números en × `scale`; antes de esta extracción, en ×
 * `visualRadius` en `HeroView.tsx`, con `visualRadius ≈ HERO_RADIUS` a nivel
 * base de Firmeza — la misma aproximación sigue aplicando: `scale`, aquí, es
 * el número ESTÁTICO que pase quien monte el componente, no el `visualRadius`
 * dinámico que `HeroView` sigue recalculando cada frame en su propio
 * `useFrame` para el CUERPO): con `CANDLE_PIVOT_HEIGHT_FRACTION = 0` (en
 * `HeroView.tsx`), `tiltGroup` (y por tanto la base del cilindro) vive en
 * mundo a y=0 exacto. `candleGroup` (padre de los ojos, dentro de este
 * componente) tiene y local = `scale · (1 − CANDLE_PIVOT_HEIGHT_FRACTION)` =
 * 1.00·`scale` — nótese que esta cuenta se CANCELA sola respecto a
 * `CANDLE_PIVOT_HEIGHT_FRACTION` (tiltGroup.y + candleGroup.y_local =
 * fracción + (1−fracción) = 1 siempre), así que `candleGroup` cae en el mismo
 * sitio absoluto pase lo que pase con el pivote. El cilindro (alto local 2.8,
 * base en y=0) ocupa en altura absoluta [0, 2.8]·`scale`, así que el origen
 * de `candleGroup` (1.00) cae al 1.00/2.8 ≈ 36% de la altura — bastante por
 * debajo de donde deben ir los ojos. `CANDLE_EYE_Y` = 0.68 los sube a
 * 1.68·`scale` absolutos ⇒ 1.68/2.8 = 60% de la altura del cilindro (pedido
 * original: 55-65%, se mantiene el mismo criterio que en rondas anteriores).
 * Esta Y ya estaba bien: se verificó con la aritmética de arriba y no se
 * toca.
 *
 * BUG encontrado en playtest ronda 8 ("los ojos han desaparecido"): la Z de
 * antes (0.9·HERO_RADIUS) los dejaba DENTRO del cilindro. El radio ABSOLUTO
 * real de la superficie del cuerpo (ver `body.scale.set(scaleXZ, ...)` en
 * `HeroView.tsx`) es `scaleXZ` ≈ `visualRadius` (radio LOCAL 1 del cilindro ×
 * `visualRadius`) — y `visualRadius` ≈ `HERO_RADIUS` a nivel base de
 * Firmeza. Con Z = 0.9·HERO_RADIUS ≈ 0.9·visualRadius, los ojos quedaban al
 * 90% del radio real (100% = superficie): EMBEBIDOS un 10% dentro del sólido,
 * ocultos por el propio cuerpo en el z-test de profundidad (de ahí que "no se
 * vean" en vez de solo "se vean mal"). Fix: sacarlos justo fuera de la
 * superficie, al 102% del radio.
 *
 * Agrandados ×2 (playtest 2026-07-26, David: "agranda los ojos de todos,
 * incluida la vela"): de los 5 personajes con ojos (4 arquetipos + vela),
 * la vela partía siendo el MÁS PEQUEÑO de todos en términos absolutos (ancho
 * 0.105·HERO_RADIUS = 0.105·0.24 ≈ 0.025u, frente a 0.045-0.19u de los
 * arquetipos) — incluso más fino que el Acechador, el más ranurado de los
 * 4. Mismo factor ×2 que Vigía/Acechador (los otros dos "pequeños" del
 * criterio), NO más agresivo: la carita simple de la vela lleva muchas
 * rondas de playtest afinándose (ver historial de esta sección) y un
 * salto mayor la desproporcionaría respecto al resto de su diseño.
 *
 * Separación entre CENTROS de ambos ojos, en × `scale` (juntos, carita
 * del concept; misma proporción que ronda 6 respecto al nuevo diámetro del
 * cilindro, radio local 1 en vez de 0.85). Sube también ×2 junto con el
 * tamaño (0.33→0.66): si solo creciera el tamaño del ojo, los dos óvalos se
 * solaparían en el centro (radio 0.21·`scale` > separación media
 * 0.165·`scale` de antes) — al escalar tamaño Y separación por el MISMO
 * factor, toda la carita crece como un "zoom" uniforme y conserva
 * exactamente las mismas proporciones internas (mismo hueco relativo entre
 * ojos) que ya estaban verificadas.
 *
 * EXTRACCIÓN A `CandleModel.tsx` (2026-08-18): las cuatro constantes de esta
 * sección (`CANDLE_EYE_SEPARATION`, `_X`, `_Y`, `_Z`, `_SCALE`) vivían en
 * `HeroView.tsx` como `HERO_RADIUS · <ratio>` —números YA absolutos, pensados
 * solo para el héroe—. Aquí se ha retirado el factor `HERO_RADIUS`: cada
 * constante pasa a ser el `<ratio>` puro (exactamente el mismo número, solo
 * que sin el `HERO_RADIUS` multiplicando), y es el JSX de más abajo el que
 * multiplica por `scale` —la prop genérica del componente— en su lugar. Para
 * `HeroView` (que pasa `scale=HERO_RADIUS`) el resultado en pantalla es
 * BIT A BIT IDÉNTICO a antes de esta extracción: `ratio · HERO_RADIUS` es
 * exactamente lo que ya calculaban las fórmulas antiguas. Para Lumora
 * (`scale=LUMORA_CANDLE_RADIUS`) esto sustituye sus números inventados por
 * los mismos ratios que ya usa el héroe, escalados a su propio tamaño —ver
 * la VERIFICACIÓN DE PROPORCIÓN en la cabecera del fichero para las cifras
 * concretas del cambio—.
 */
const CANDLE_EYE_SEPARATION = 0.66;
const CANDLE_EYE_X = CANDLE_EYE_SEPARATION / 2;
/**
 * 60% de la altura del cuerpo, que es la proporción validada en rondas
 * anteriores (antes salía de un 0.68 fijo sobre el cilindro de alto local
 * 2.8: (1.00+0.68)/2.8 = 60%). Derivado ahora de `CANDLE_HALF_HEIGHT` para que
 * la carita no se descuelgue si cambia el modelo de vela: absoluto =
 * 0.6·(2·semialto), y este offset es local a `candleGroup`, que vive en
 * 1.00·`scale`.
 */
const CANDLE_EYE_Y = 0.6 * (2 * CANDLE_HALF_HEIGHT) - 1;
/**
 * Radio local del cilindro (1, ronda 7): antes al 102% (JUSTO fuera de la
 * superficie real, ver BUG de ronda 8 arriba). Al agrandar el ojo ×2 (ronda
 * 2026-07-26) su semi-grosor en Z también se duplica (0.06·`scale` →
 * 0.12·`scale`, +0.06·`scale`): si se dejara el 102% intacto, el FRENTE del
 * ojo (Z + semi-grosor) se adelantaría esos mismos 0.06·`scale` de más,
 * flotando más de lo que ya flotaba. Se retrasa el multiplicador esa misma
 * cantidad (1.02−0.06=0.96) para que el frente del ojo quede en la MISMA
 * profundidad absoluta que antes de agrandarlo — ni más hundido ni más
 * flotando de lo que ya estaba (mismo criterio que `DUMMY_EYE_Z`/
 * `CHASER_FACE_RADIUS` en los arquetipos).
 */
const CANDLE_EYE_Z = 0.96;
/**
 * Tamaño de cada ojo, en × `scale` (se achica junto con el resto de la
 * vela al reducirse `HERO_RADIUS` en ronda 7, y crece con ella si sube por
 * Firmeza — ver `visualRadius` en el `useFrame` de `HeroView.tsx`, que sigue
 * reescalando `bodyRef` aunque ya no reescale los ojos: ver la nota de
 * "a nivel base de Firmeza" en el comentario de `CANDLE_EYE_Y` arriba).
 * Historial: "un punto más grandes" en ronda 9 → ×2 en playtest 2026-07-26
 * (ver comentario de `CANDLE_EYE_SEPARATION` arriba).
 */
const CANDLE_EYE_SCALE: [number, number, number] = [0.21, 0.32, 0.12];

/**
 * `renderOrder` de los ojos: por encima de `SILHOUETTE_RENDER_ORDER` (David
 * 2026-08-13: "los ojos parece que tienen también la máscara de cuando estás
 * tapado por la pared, y deberían ser negros siempre"). Causa raíz: los ojos
 * son opacos y se asientan casi en la superficie del cuerpo, así que el
 * depth buffer los ve como "algo delante del cuerpo" — justo lo que
 * `heroSilhouetteMaterial` (`depthFunc: GreaterDepth`, ver
 * `occlusion-silhouette.ts`) interpreta como oclusión externa, así que se
 * pintaba encima suyo (color de arma a través de ellos) incluso sin ningún
 * muro de por medio. `candleEyeMaterial` pasa a `transparent: true`
 * (`assets-dark.ts`) para que los ojos entren en la cola TRANSPARENTE de
 * three.js — la única forma de que un `renderOrder` los sitúe después de la
 * silueta, que también es transparente: three.js dibuja siempre toda la cola
 * opaca antes que la transparente, así que un renderOrder alto en un
 * material opaco nunca los habría colado después de la silueta. Con esto
 * detrás de la silueta en orden de dibujo (y el depthTest normal, sin tocar,
 * que los sigue ocultando correctamente contra un muro real más cercano en
 * el buffer), los ojos quedan siempre negros salvo cuando de verdad les tapa
 * algo.
 */
const CANDLE_EYE_RENDER_ORDER = SILHOUETTE_RENDER_ORDER + 1;

// ── Componente ───────────────────────────────────────────────────────────

export interface CandleModelProps {
  /**
   * Escala uniforme del espacio local normalizado (radio de la vela = 1) a
   * unidades de mundo — el ÚNICO número que decide quien monta el
   * componente (ver CONTRATO en la cabecera del fichero). `HeroView` pasa
   * `HERO_RADIUS`; Lumora pasa `LUMORA_CANDLE_RADIUS`.
   */
  scale: number;
  /** Mesh del cuerpo (cera): opcional, solo lo pasa quien necesite mutar su `.scale`/`.position`/`.visible` cada frame (squash/estiramiento, parpadeo de i-frames — `HeroView`). */
  bodyRef?: Ref<Mesh>;
  /** Grupo padre de ojos+llama (hermano del cuerpo, ver POR QUÉ en la cabecera): opcional, solo lo pasa quien reposicione esta pieza en vivo (`HeroView`, reescalado por Firmeza). */
  candleGroupRef?: Ref<Group>;
  /** Ancla de la llama (hijo de `candleGroupRef`): opcional, solo lo pasa quien reescale/reposicione la llama en vivo (`HeroView`, `visualRadius`). */
  flameAnchorRef?: Ref<Group>;
  /** Grupo que rota los ojos en Y (mirada): opcional, solo lo pasa quien anime el yaw en vivo (`HeroView`). */
  eyeGroupRef?: Ref<Group>;
  /** Hijos que cuelgan del CUERPO (`bodyRef`): heredan gratis su escala/squash/parpadeo — pinchos y burbuja de escudo en `HeroView`, nada en Lumora. */
  children?: ReactNode;
}

/**
 * Vela completa: ver el comentario de cabecera del fichero para el contrato
 * y el historial de bugs/decisiones. Cuerpo + silueta de oclusión en una
 * rama (deformable, `bodyRef`), ojos + llama en la otra (sin deformar,
 * `candleGroupRef`) — ver POR QUÉ en la cabecera.
 */
export function CandleModel({ scale, bodyRef, candleGroupRef, flameAnchorRef, eyeGroupRef, children }: CandleModelProps) {
  // La vela del kit, normalizada una vez por instancia montada (cada
  // `<CandleModel>` clona su propia copia — mismo criterio que ya tenía cada
  // consumidor por separado antes de este refactor; nunca se muta la
  // geometría cacheada de `kitGeometry`, que comparte cualquier otro uso del
  // kit, ver `normalizeHeroCandleGeometry`).
  const heroCandleGeometry = useMemo(() => normalizeHeroCandleGeometry(), []);
  // Hull convexo + cáscara de esa misma malla, para la silueta de oclusión
  // (ver el historial completo de `buildHeroSilhouetteGeometry` más arriba).
  // Depende de `heroCandleGeometry` (necesita sus vértices reales), así que
  // no puede ser una constante de módulo — se recalcula solo si
  // `heroCandleGeometry` cambia (en la práctica, nunca tras el montaje: ambos
  // `useMemo` llevan deps fijas).
  const heroSilhouetteGeometry = useMemo(() => buildHeroSilhouetteGeometry(heroCandleGeometry), [heroCandleGeometry]);

  return (
    <>
      {/*
        Posición Y por defecto (`scale · CANDLE_HALF_HEIGHT`): la geometría
        normalizada nace CENTRADA (spans ±CANDLE_HALF_HEIGHT en Y, ver
        `normalizeHeroCandleGeometry`), así que sin este offset su CENTRO —no
        la base— caería en el origen de este componente, hundiendo la mitad
        del cuerpo bajo el suelo. Mismo papel que `body.position.set(0,
        scaleY*CANDLE_HALF_HEIGHT, 0)` en el `useFrame` de `HeroView.tsx`
        (que lo sobreescribe cada frame con `scaleY`, ajustado por squash) —
        aquí es el valor ESTÁTICO del que depende Lumora por completo (no
        tiene ningún `useFrame` que lo toque).
      */}
      <mesh
        ref={bodyRef}
        geometry={heroCandleGeometry}
        material={heroMaterial}
        position={[0, scale * CANDLE_HALF_HEIGHT, 0]}
        scale={scale}
      >
        {/*
          Silueta de oclusión: HULL CONVEXO de la propia malla del cuerpo
          (`heroSilhouetteGeometry`) envuelto en una CÁSCARA ligeramente
          mayor (`SILHOUETTE_SHELL_SCALE`/`SILHOUETTE_SHELL_LIFT`) — ver el
          comentario grande de `buildHeroSilhouetteGeometry` más arriba
          (puntos 1-5) para el historial completo. Sigue como HIJA del
          cuerpo para heredar gratis su escala, su squash/stretch y su
          parpadeo de i-frames en `HeroView` — en Lumora, sin ninguno de los
          dos, simplemente no hace nada visible (nada la ocluye en el
          vestíbulo del título).
        */}
        <mesh
          geometry={heroSilhouetteGeometry}
          material={heroSilhouetteMaterial}
          renderOrder={SILHOUETTE_RENDER_ORDER}
          scale={SILHOUETTE_SHELL_SCALE}
          position={[0, SILHOUETTE_SHELL_LIFT, 0]}
        />
        {children}
      </mesh>
      {/*
        Ojos y llama: grupo HERMANO del cuerpo, nunca hijo (ver POR QUÉ en la
        cabecera del fichero) — así ninguno de los dos hereda el squash/
        estiramiento del cuerpo. Posición por defecto derivada de `scale`
        (equivalente a `CANDLE_PIVOT_HEIGHT_FRACTION = 0` en `HeroView.tsx`,
        ver su comentario allí): válida tal cual para Lumora, que nunca la
        toca, y como valor inicial correcto para el héroe hasta que su
        primer `useFrame` la sobreescriba con `visualRadius` a través de
        `candleGroupRef`.
      */}
      <group ref={candleGroupRef} position={[0, scale, 0]}>
        {/* Llama (`CandleFlame.tsx`): el `<group>` es el ancla
            (posición/escala), `CandleFlame` resuelve billboard, adelanto
            hacia cámara, vaivén y pulso por sí sola a partir de su propio
            `parent`. */}
        <group ref={flameAnchorRef} position={[0, scale * CANDLE_FLAME_ANCHOR_Y, 0]} scale={scale}>
          <CandleFlame scale={FLAME_BASE_SCALE} />
        </group>
        {/* Carita de vela: dos ojos negros ovalados simples (concept art),
            juntos y a ~60% de la altura del cilindro (CANDLE_EYE_Y), justo
            fuera de la superficie (CANDLE_EYE_Z, ver BUG en su comentario).
            Cuelgan de un group que rota en Y (MUTABLE vía `eyeGroupRef` en
            `HeroView`) para mirar hacia el apuntado/movimiento, en vez de
            quedar fijos mirando siempre a +Z; en Lumora, sin `eyeGroupRef`,
            se queda fijo mirando a +Z siempre (Lumora nunca apunta ni se
            mueve). */}
        <group ref={eyeGroupRef} position={[0, scale * CANDLE_EYE_Y, 0]}>
          <mesh
            geometry={smallDotGeometry}
            material={candleEyeMaterial}
            position={[-scale * CANDLE_EYE_X, 0, scale * CANDLE_EYE_Z]}
            scale={[scale * CANDLE_EYE_SCALE[0], scale * CANDLE_EYE_SCALE[1], scale * CANDLE_EYE_SCALE[2]]}
            renderOrder={CANDLE_EYE_RENDER_ORDER}
          />
          <mesh
            geometry={smallDotGeometry}
            material={candleEyeMaterial}
            position={[scale * CANDLE_EYE_X, 0, scale * CANDLE_EYE_Z]}
            scale={[scale * CANDLE_EYE_SCALE[0], scale * CANDLE_EYE_SCALE[1], scale * CANDLE_EYE_SCALE[2]]}
            renderOrder={CANDLE_EYE_RENDER_ORDER}
          />
        </group>
      </group>
    </>
  );
}
