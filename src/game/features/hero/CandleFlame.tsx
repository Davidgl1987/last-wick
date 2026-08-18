/**
 * Llama de vela COMPARTIDA: la usan tanto el héroe (`HeroView.tsx`) como
 * Lumora, la vela del vestíbulo del título (`TitleScreenScene.tsx`).
 *
 * Nace como componente único por un encargo de David (2026-08-18, tercer
 * punto de una lista de feedback, el que obligaba a refactorizar): "desde el
 * propio título ya se ve que no está del todo bien situada, aunque parece
 * que se hace de manera distinta... debería usarse el mismo modelo y la
 * misma llama en todos sitios". Hasta ahora cada sitio construía su propia
 * llama a mano — Lumora con números de posición/escala propios, el héroe con
 * su propia lógica de billboard/pulso — y las pequeñas diferencias entre
 * ambas implementaciones ya se notaban en pantalla. Con un solo componente
 * usado por los dos sitios eso deja de ser posible.
 *
 * CONTRATO (para poder montarse igual en sitios con jerarquías de escena muy
 * distintas — el héroe con su `tiltGroup` que se inclina al moverse/apuntar,
 * Lumora con un `group` casi estático que solo se balancea un poco):
 * - Trabaja en espacio LOCAL NORMALIZADO, donde el radio de la vela vale 1 —
 *   igual que `normalizeHeroCandleGeometry` (`render/hero-candle.ts`) deja el
 *   cuerpo. Quien monta este componente es quien escala ese espacio a su
 *   tamaño real (aplicando `scale` sobre el `<group>` que lo envuelve).
 * - Se monta ya colocado en la MECHA: su origen local, antes de cualquier
 *   ajuste propio por frame, ES la base de la llama.
 * - Por dentro: un `<group>` PIVOTE (la base, en su propio origen) y dentro
 *   de él el `<mesh>` del quad, desplazado hacia arriba la mitad de su alto
 *   actual. Rotar el pivote rota la llama DESDE LA BASE — la hendidura de la
 *   textura (ver `flame()` en `scripts/gen-vfx-textures.mjs`) se queda casi
 *   quieta y solo se mueve la punta, que es justo lo que pide el punto (b)
 *   del encargo: "el vaivén hazlo con la base fija... que rote desde la
 *   hendidura que tiene la llama abajo".
 *
 * BUG que motivó separar esto en un componente propio en vez de seguir
 * remendando la versión de `HeroView.tsx` (David, mismo feedback, punto a):
 * "el desplazamiento parece que no lo has corregido bien" — con la vela
 * inclinada al apuntar, la llama seguía saliéndose de la mecha. Causa real
 * (no era el offset de mundo hacia cámara, ronda anterior, que estaba bien):
 * el centro del quad vivía en el EJE LOCAL de la vela, a una altura
 * (`FLAME_HEIGHT_FACTOR`, ya retirada) muy por encima de la boca. Un punto
 * tan alto del eje se desplaza LATERALMENTE mucho más que la boca cuando la
 * vela se inclina (el desplazamiento lateral de un punto en un eje que rota
 * crece con la distancia al pivote de esa rotación) — así que la llama se
 * separaba de la mecha justo al apuntar, y cuanto más se subía el hueco
 * entre boca y llama, peor. Arreglo de fondo: la llama ya NO se construye a
 * lo largo del eje inclinado de la vela. Su BASE se ancla en la mecha (que
 * sí acompaña el lean, como el resto del cuerpo) y crece hacia arriba en
 * VERTICAL DE MUNDO desde ahí — como una llama de verdad, que nace pegada a
 * la mecha y arde hacia arriba pase lo que pase con la inclinación de la
 * vela.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Quaternion, Vector3, type Group, type Mesh } from 'three';
import { unitPlane } from '@/game/render/assets';
import { heroFlameMaterial, heroFlameSilhouetteMaterial } from '@/game/render/assets-dark';
import { SILHOUETTE_RENDER_ORDER } from '@/game/render/occlusion-silhouette';

/**
 * Frecuencias del pulso de tamaño (playtest ronda 4, punto 3: "parece que se
 * balancea, mejor que crezca y decrezca"): suma de dos senos a frecuencias
 * INCONMENSURADAS (sin razón simple entre ellas, para que el pulso nunca
 * caiga en un ciclo corto y repetitivo) — barato, sin asignaciones.
 */
const FLAME_PULSE_FREQ_A = 3.1;
const FLAME_PULSE_FREQ_B = 5.7;
/** Amplitud del pulso de tamaño de la llama: ±15%, pedido explícito de playtest. */
const FLAME_PULSE_AMPLITUDE = 0.15;
/**
 * Estirado NO uniforme de la llama (encargo de David, 2026-08-17: "dale algo
 * de movimiento/escalado para que simule una llama" — con la silueta del
 * icono de vida del HUD, ver `flame()` en `scripts/gen-vfx-textures.mjs`, un
 * pulso puramente uniforme se leía demasiado "de pegatina que crece y
 * encoge"). Reutiliza la MISMA onda que ya mueve `pulse` (`pulseA·0.6 +
 * pulseB·0.4`, sin sumar frecuencias nuevas — ver el `useFrame` más abajo)
 * para estirar en Y y encoger en X A CONTRAFASE: cuando la onda avanza (la
 * llama "se aviva" y `pulse` crece), Y se alarga más allá de lo que ya
 * alarga `pulse` y X se encoge por debajo — una llama de verdad se alarga y
 * adelgaza al avivarse, no solo "crece" uniformemente. Amplitud pequeña
 * (±12%, menor que el ±15% de `FLAME_PULSE_AMPLITUDE`) a propósito: es un
 * efecto ENCIMA del pulso base, no otro pulso independiente — pasarse aquí
 * competiría con él y el conjunto se leería tembloroso en vez de orgánico.
 */
const FLAME_STRETCH_AMPLITUDE = 0.12;
/**
 * Vaivén de la PUNTA de la llama (mismo encargo de 2026-08-17, refinado
 * 2026-08-18): rotación pequeña alrededor del eje Z LOCAL del PIVOTE (la
 * base), aplicada DESPUÉS del billboard (post-multiplicada, no reemplaza su
 * quaternion — ver el `useFrame` más abajo). Como el billboard ya deja el
 * eje Z local del pivote prácticamente alineado con la vista de cámara, este
 * giro se lee en pantalla como un balanceo/"roll" de la llama, no como un
 * giro que la saque de cara a cámara — por eso no pelea con el billboard, a
 * diferencia de rotar en X/Y, que sí lo haría. Al rotar el PIVOTE (la base,
 * en su propio origen) y no el mesh, el punto de rotación coincide con la
 * base de la llama — casi fija — y es la PUNTA, lejos de ese origen, la que
 * de verdad se balancea (David, 2026-08-18: "el vaivén hazlo con la base
 * fija... que rote desde la hendidura que tiene la llama abajo"). Frecuencia
 * inconmensurada con `FLAME_PULSE_FREQ_A`/`_B` (2.3, ninguna razón simple con
 * 3.1 o 5.7) para que el vaivén nunca quede en fase con el pulso de tamaño.
 */
const FLAME_SWAY_FREQ = 2.3;
/** Amplitud del vaivén: ±0.12 rad ≈ ±6.9°, "pocos grados" pedido — perceptible sin que la punta parezca que aletea. */
const FLAME_SWAY_AMPLITUDE = 0.12;
/**
 * Adelanto de la llama hacia la CÁMARA, en unidades LOCALES normalizadas
 * (radio de la vela = 1) — mismo mecanismo que `CANDLE_EYE_Z` en
 * `HeroView.tsx` usa para sacar los ojos del volumen del cuerpo, aplicado
 * aquí a la llama.
 *
 * Por qué hace falta (encargo de David, 2026-08-17; verificado en pantalla:
 * sin este adelanto "la llama casi desaparecía"). Causa: aunque
 * `heroFlameMaterial` es aditivo, lleva `depthWrite: false` pero el
 * `depthTest` por defecto SIGUE activo, así que sus fragmentos se descartan
 * donde ya hay algo más cerca de cámara escrito en el depth buffer — igual
 * que cualquier malla opaca. Con la llama en el EJE de la vela (x=z=0) y la
 * cámara mirando desde arriba-delante (~56° sobre la horizontal en el juego,
 * `CAMERA_OFFSET` de `CameraRig.tsx`), el borde superior TRASERO de la
 * cabeza de la vela cae, en pantalla, más cerca de cámara que el propio
 * nacimiento de la llama sobre el eje — así que ese trozo de cabeza gana el
 * depth test y se come la base de la llama. Ni acercar ni separar la llama
 * de la boca en ALTURA arregla esto por sí solo: el problema no es de altura
 * sino de qué gana el depth test en cada píxel.
 *
 * Arreglo: sacar la llama del volumen del cuerpo hacia la cámara (+Z local
 * del pivote, luego convertido a mundo cada frame — ver más abajo) para que
 * sus fragmentos vuelvan a quedar más cerca que la cabeza y dejen de perder
 * el depth test. Efecto colateral bueno: al adelantarse, la base de la llama
 * tapa en pantalla el brillo de la mecha/cráter del modelo — justo el "que
 * se lean como una sola cosa" que pedía David.
 *
 * Por qué 0.9 y no un valor que iguale o supere el radio real (1.0): los
 * ojos son geometría OPACA y necesitan quedar justo FUERA de la superficie
 * real (si la superficie asoma por delante, el z-test normal se los come).
 * La llama solo necesita GANAR el depth test contra la cabeza en la zona
 * donde antes lo perdía, no salir de la superficie por un margen concreto —
 * con 0.9, todavía un pelín por DENTRO del radio nominal, ya gana. Quedarse
 * por dentro evita además que la llama se vea despegarse del cuerpo cuando
 * la vela se inclina.
 *
 * BUG encontrado al aplicar esto en Z LOCAL del pivote directamente (David,
 * 2026-08-17, con captura: "la llama sale un poco desplazada, se nota más
 * todavía cuando se apunta"): el eje Z local de un ancestro que se inclina
 * (el `tiltGroup` del héroe al apuntar) rota CON él, así que el adelanto se
 * iba de lado en vez de seguir empujando hacia cámara. Arreglo: el adelanto
 * se construye como un vector de MUNDO fijo hacia cámara (mismo `yaw` que ya
 * calcula el billboard) y se convierte a espacio local cada frame con la
 * inversa del quaternion de MUNDO del padre — así se queda SIEMPRE mirando a
 * cámara en mundo, se incline lo que se incline el ancestro que sea, en vez
 * de rotar solidario con él. El valor (0.9) no cambió: el bug estaba en QUÉ
 * eje se usaba para aplicarlo, no en cuánto.
 *
 * A CERO desde 2026-08-18 (feedback de David con capturas, en el juego y en
 * el título a la vez): "en el juego parece que la llama está un poco
 * desplazada hacia la cámara, pues da igual hacia dónde mire la vela que
 * aparece siempre un poco hacia abajo", y en el título "un poco más larga,
 * quizá por la perspectiva, y un poco desplazada hacia la izquierda". Los
 * dos síntomas son este adelanto: empujar la llama hacia la cámara la baja
 * en pantalla SIEMPRE con la cámara cenital del juego (de ahí el "hacia
 * abajo" constante), y en el vestíbulo del título, con la cámara casi a la
 * altura de la vela, la acerca al objetivo — se ve más grande (la
 * "perspectiva" que nota David) y desplazada hacia donde esté la cámara
 * respecto al eje de Lumora.
 *
 * Por qué ya no hace falta: el motivo original (la cabeza de la vela ganaba
 * el depth test y se comía la base de la llama) desapareció al cambiar el
 * anclaje. Cuando se introdujo, la llama se posicionaba por su CENTRO y con
 * `FLAME_GAP` negativo, o sea con su mitad inferior metida DENTRO del
 * volumen de la cabeza: ahí sí competía contra el cuerpo píxel a píxel.
 * Hoy `CandleModel` ancla la BASE en la boca con `FLAME_GAP = 0`, así que la
 * llama entera vive POR ENCIMA del cuerpo y no hay nada suyo que pueda
 * ganarle el depth test. Verificado en pantalla con la vela recta e
 * inclinada apuntando, en el juego y en el título.
 *
 * Se conserva la constante (y el cálculo, que con 0 es un vector nulo y no
 * cuesta nada) en vez de borrarla: si algún día vuelve a cambiar el anclaje
 * o el modelo de vela y la base vuelve a hundirse en la cabeza, este es el
 * punto de tuning, con el diagnóstico completo escrito arriba.
 */
const FLAME_FORWARD = 0;
/** Proporción alto:ancho del quad de la llama — fijada desde que pasó de `unitCone` a un quad texturado (2026-08-12) y sin motivo para cambiar desde entonces. */
const FLAME_ASPECT = 1.8;
/**
 * Eje de mundo reutilizado para el billboard CILÍNDRICO de la llama (ver
 * `useFrame` más abajo): solo lectura, nunca se muta, así que un único
 * objeto de módulo vale para todos los frames sin asignar nada nuevo.
 */
const Y_AXIS = new Vector3(0, 1, 0);
/** Eje LOCAL reutilizado para el vaivén de la punta (ver `FLAME_SWAY_FREQ`): mismo criterio que `Y_AXIS`, solo lectura. */
const Z_AXIS = new Vector3(0, 0, 1);

export interface CandleFlameProps {
  /**
   * Tamaño base de la llama en unidades LOCALES normalizadas (radio de la
   * vela = 1), antes del pulso — el ancho (X/Z) del quad en reposo; el alto
   * sale de multiplicar esto por `FLAME_ASPECT`. Mismo número
   * (`FLAME_BASE_SCALE`, definido en `./CandleModel.tsx`, el componente
   * compartido que monta tanto el héroe como Lumora y es quien pasa este
   * `scale` — ya no lo monta nadie más directamente) para el héroe y para
   * Lumora: es lo que garantiza "misma llama, misma proporción" entre los
   * dos sitios — solo cambia la escala GLOBAL que aplique quien monte
   * `CandleModel`, nunca esta forma.
   */
  scale: number;
}

/**
 * Llama de vela: ver el comentario de cabecera del fichero para el contrato
 * completo y el historial de bugs que llevaron a esta forma. Sin `ref`
 * expuesta a propósito — todo lo que necesita (verticalidad, billboard,
 * adelanto, vaivén, pulso) lo resuelve por sí sola cada frame a partir de su
 * propio `parent`, así que un padre nunca necesita tocarla directamente;
 * solo escalar/posicionar el `<group>` que la envuelve.
 */
export function CandleFlame({ scale }: CandleFlameProps) {
  const pivotRef = useRef<Group>(null);
  const meshRef = useRef<Mesh>(null);

  // Scratch reutilizados cada frame — cero asignaciones, mismo criterio que
  // el resto del render de esta rama.
  const parentWorldQuat = useRef(new Quaternion());
  const parentWorldQuatInverse = useRef(new Quaternion());
  const worldPosition = useRef(new Vector3());
  const billboardQuat = useRef(new Quaternion());
  const swayQuat = useRef(new Quaternion());
  const forwardOffset = useRef(new Vector3());

  useFrame((state) => {
    const pivot = pivotRef.current;
    const mesh = meshRef.current;
    if (!pivot || !mesh) return;

    // Verticalidad y anclaje: cancelar la rotación de MUNDO heredada del
    // padre — sea cual sea (el `tiltGroup` del héroe al inclinarse, el
    // ligero balanceo en Z de Lumora, o nada) — leyéndola de `pivot.parent`
    // en vez de recibirla por props. `getWorldQuaternion`/`getWorldPosition`
    // (three.js) recalculan `matrixWorld` bajo mano a partir de los valores
    // ACTUALES de posición/rotación del ancestro, así que esto es siempre
    // fresco dentro del mismo frame aunque el ancestro haya mutado su
    // transform ese mismo tick, sin depender del orden en que React llame a
    // los distintos `useFrame` de la escena.
    if (pivot.parent) {
      pivot.parent.getWorldQuaternion(parentWorldQuat.current);
    } else {
      parentWorldQuat.current.identity();
    }
    parentWorldQuatInverse.current.copy(parentWorldQuat.current).invert();

    // Billboard CILÍNDRICO hacia la cámara ACTIVA (`state.camera`, la del
    // juego para el héroe, `TitleCamera` para Lumora — este componente no
    // necesita saber cuál es). "Cilíndrico" y no ESFÉRICO a propósito: copiar
    // el quaternion de la cámara entero inclinaría la llama con su PITCH —
    // cualquier cámara que mire desde arriba (la del juego, ~56° sobre la
    // horizontal) dejaría una llama tumbada hacia cámara, que no se lee como
    // fuego ardiendo hacia arriba. Un billboard cilíndrico solo gira en YAW
    // (eje Y), manteniendo el eje vertical fijo al de mundo.
    //
    // Yaw calculado con la posición de MUNDO REAL del propio pivote
    // (`getWorldPosition`), no con la del objeto que lo monta ni con ninguna
    // aproximación: a diferencia de la versión anterior de este código (que
    // usaba la posición interpolada del héroe como proxy, con un error
    // angular pequeño pero no nulo), este componente no tiene acceso a nada
    // específico del héroe — y no lo necesita, porque puede preguntarle a
    // three.js su propia posición real.
    pivot.getWorldPosition(worldPosition.current);
    const camera = state.camera;
    const yaw = Math.atan2(camera.position.x - worldPosition.current.x, camera.position.z - worldPosition.current.z);
    billboardQuat.current.setFromAxisAngle(Y_AXIS, yaw);

    // Adelanto hacia cámara EN MUNDO (ver el historial completo en el
    // comentario de `FLAME_FORWARD`, arriba: aplicado en un eje LOCAL que
    // rota con el ancestro, la llama se iba de lado al inclinarse la vela).
    // Vector de MUNDO `(sin(yaw), 0, cos(yaw)) · FLAME_FORWARD` — la MISMA
    // dirección hacia cámara que el billboard, así que el adelanto y el giro
    // que hace mirar la llama a cámara SIEMPRE coinciden — pasado a espacio
    // LOCAL con la inversa ya calculada arriba (cancelar el lean para un
    // offset de mundo es la misma cuenta que cancelarlo para una rotación de
    // mundo). El pivote entero se traslada por este vector: base Y punta se
    // mueven juntas, así que sigue siendo "la base anclada en la mecha", solo
    // que la mecha efectiva está un pelín más cerca de cámara.
    forwardOffset.current
      .set(Math.sin(yaw) * FLAME_FORWARD, 0, Math.cos(yaw) * FLAME_FORWARD)
      .applyQuaternion(parentWorldQuatInverse.current);
    pivot.position.copy(forwardOffset.current);

    // Rotación del PIVOTE (la base): cancela el ancestro, aplica el billboard
    // y luego el vaivén de la punta, en ESE orden — `quaternion.copy(inv).
    // multiply(billboard).multiply(sway)` compone localQuat = inv ⊗ billboard
    // ⊗ sway, así que el resultado en MUNDO es `parentWorld ⊗ inv ⊗ billboard
    // ⊗ sway = billboard ⊗ sway` (el ancestro se cancela exactamente): la
    // llama queda vertical y mirando a cámara pase lo que pase con el
    // ancestro, con el vaivén como un roll adicional sobre esa base. Como el
    // PIVOTE es la base (rota sobre su propio origen) y el mesh cuelga
    // desplazado hacia arriba (ver más abajo), este giro pivota literalmente
    // desde la base de la llama — la punta se balancea, la base casi no se
    // mueve (David, 2026-08-18, punto b del encargo).
    pivot.quaternion.copy(parentWorldQuatInverse.current).multiply(billboardQuat.current);
    const swayAngle = Math.sin(state.clock.elapsedTime * FLAME_SWAY_FREQ) * FLAME_SWAY_AMPLITUDE;
    swayQuat.current.setFromAxisAngle(Z_AXIS, swayAngle);
    pivot.quaternion.multiply(swayQuat.current);

    // Pulso de tamaño + estirado no uniforme, en el MESH (no en el pivote):
    // así el pivote solo controla posición/orientación de la base, y el
    // tamaño vive aparte, sin interferir con el vaivén de arriba. `time` usa
    // el reloj de three.js (`state.clock.elapsedTime`), no `world.time` de la
    // sim — este componente no recibe una `GameSession` (lo monta también
    // Lumora, que no tiene sim), así que no puede depender de ella; el reloj
    // de three.js sigue corriendo mientras el Canvas esté vivo, que es lo
    // único que hace falta para una animación puramente decorativa.
    const time = state.clock.elapsedTime;
    const pulseA = Math.sin(time * FLAME_PULSE_FREQ_A);
    const pulseB = Math.sin(time * FLAME_PULSE_FREQ_B);
    const pulseWave = pulseA * 0.6 + pulseB * 0.4;
    const pulse = 1 + pulseWave * FLAME_PULSE_AMPLITUDE;
    const stretchY = 1 + pulseWave * FLAME_STRETCH_AMPLITUDE;
    const stretchX = 1 - pulseWave * FLAME_STRETCH_AMPLITUDE;
    const sizeScale = scale * pulse;
    const heightBase = sizeScale * FLAME_ASPECT;
    const height = heightBase * stretchY;
    mesh.scale.set(sizeScale * stretchX, height, sizeScale * stretchX);
    // `unitPlane` (`PlaneGeometry(1,1)`) nace CENTRADA: su borde inferior
    // local está a mitad de su alto ACTUAL por debajo del centro. Recolocar
    // esto cada frame (en vez de compensar con un offset fijo, como hacía la
    // versión anterior) mantiene el borde inferior exactamente en el origen
    // del pivote pase lo que pase con `stretchY` — la base pegada a la mecha
    // en todo momento, ni un frame despegada.
    mesh.position.y = height / 2;
  });

  return (
    <group ref={pivotRef}>
      <mesh ref={meshRef} geometry={unitPlane} material={heroFlameMaterial}>
        {/*
          Silueta de oclusión de la llama (encargo de David, 2026-08-18: "si
          puedes, dale silueta también cuando esté detrás del muro" — el
          cuerpo ya la tiene, `heroSilhouetteMaterial`, `HeroView.tsx`, pero
          la llama no, así que tras un muro la vela se veía "apagada"). HIJA
          del propio mesh de la llama (no hermana bajo el pivote) a propósito:
          un hijo hereda GRATIS la posición/escala que el `useFrame` de arriba
          ya escribe cada frame en `mesh` (pulso, estirado no uniforme,
          `mesh.position.y` recolocada) — ni un cálculo extra, ni otro sitio
          donde desincronizarse. Misma geometría (`unitPlane`) que el quad
          real: la silueta tiene que coincidir exactamente con la forma
          visible de la llama. `heroFlameSilhouetteMaterial`
          (`assets-dark.ts`) usa la textura de la llama como `alphaMap`
          (no `map`) para recortar esa forma con un color plano — ver el
          comentario de ese material para el porqué completo, incluido por
          qué el blending se queda NORMAL en vez de aditivo.
        */}
        <mesh geometry={unitPlane} material={heroFlameSilhouetteMaterial} renderOrder={SILHOUETTE_RENDER_ORDER} />
      </mesh>
    </group>
  );
}
