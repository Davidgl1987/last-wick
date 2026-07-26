/**
 * Post-procesado global de la escena (fase 1: infraestructura + Vignette y
 * Noise; fase 2: Bloom; fase 3: ChromaticAberration ligada al trauma de
 * cámara. Sin fases pendientes.)
 *
 * `multisampling={4}`: el `<EffectComposer>` de @react-three/postprocessing
 * renderiza la escena a un render-target propio y aplica los efectos como
 * pases de post-proceso — eso ANULA el antialiasing nativo del canvas
 * (`gl={{ antialias: true }}` en GameRoot.tsx), porque ya no se dibuja
 * directamente al framebuffer por defecto del navegador. El composer tiene
 * que reintroducir su propio MSAA para no perder ese suavizado de bordes;
 * 4 muestras es el valor estándar (calidad/coste razonable) que usa la propia
 * librería como ejemplo.
 *
 * `return null` con los 4 flags apagados: sin composer montado, R3F vuelve a
 * su render directo de toda la vida — coste cero de post-proceso cuando el
 * jugador no ha activado ningún efecto (el valor por defecto, ver
 * postSettings.ts). Evita pagar el render-target extra + el pase de
 * composición por nada.
 *
 * Los toggles SOLO cambian desde los checkboxes del modal de pausa
 * (PauseModal.tsx), nunca en caliente durante el juego: montar/desmontar
 * `<EffectComposer>` recompila shaders de post-proceso (tirón perceptible),
 * pero como la sim está parada en pausa ese tirón queda oculto tras la
 * pantalla de pausa — nunca se nota una sacudida a mitad de partida.
 *
 * ChromaticAberration (fase 3) es un caso distinto: aunque su checkbox
 * también monta/desmonta el `<EffectComposer>` (mismo coste oculto en
 * pausa), UNA VEZ montado el efecto en sí NUNCA se desmonta por trauma — solo
 * su `offset` se anima cada frame (mutación directa del uniform, mismo
 * patrón que el shake posicional de CameraRig.tsx). Montar/desmontar por
 * trauma recompilaría el composer en pleno combate, justo el tirón de
 * shaders que ya se diagnosticó con la tienda (ver comentario de Preload más
 * abajo).
 *
 * ORDEN DEL CHAIN (fase 5, playtest de David 2026-07-26: "el resto de
 * efectos no los noto"): Bloom → ToneMapping → ChromaticAberration →
 * Vignette → Noise. Antes ToneMapping iba el último y por eso aberración,
 * viñeta y grano operaban en espacio LINEAL HDR — con una escena tan oscura
 * como esta (fondo #050508 + niebla) los valores lineales ahí son minúsculos
 * y los tres efectos resultaban imperceptibles. El Bloom SÍ necesita ese
 * espacio lineal (su umbral de luminancia se evalúa antes del tone mapping,
 * ver `BLOOM_LUMINANCE_THRESHOLD` más abajo), así que va primero. Pero los
 * efectos de "look" — aberración, viñeta, grano — están diseñados para
 * espacio de pantalla LDR (0-1 tras el tone mapping), que es donde de verdad
 * se leen. Por eso ToneMapping pasa a ir justo después del Bloom en vez de
 * al final: sigue siendo el único pase de corrección de color base (sin
 * toggle, siempre presente mientras el composer esté montado — ver más
 * abajo), solo cambia de posición.
 *
 * ToneMapping (ACES filmic): mientras el composer está montado,
 * postprocessing desactiva el tone mapping del renderer (renderiza en
 * lineal), así que hay que reaplicar el ACES que R3F trae por defecto o la
 * escena entera sale quemada. No tiene toggle: es corrección de color base,
 * no un efecto opcional — pero ya NO es el último pase del chain (ver arriba).
 */

import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { useMemo } from 'react';
import { BlendFunction, ChromaticAberrationEffect, ToneMappingMode } from 'postprocessing';
import { Vector2 } from 'three';
import type { GameSession } from '@/game/session/session';
import { usePostSettings } from './postSettings';

/**
 * PUNTO DE TUNING: oscurecimiento y extensión del viñeteado de bordes.
 * Rango razonable: 0.4-0.7 (por debajo no se distingue del fondo casi negro
 * de las esquinas; por encima empieza a comerse el área jugable centrada en
 * el héroe).
 *
 * Subido de 0.35 a 0.55 (playtest de David 2026-07-26: "no lo noto"). La
 * limitación real de este efecto en este juego es que las esquinas YA son
 * casi negras por dirección artística (fondo #050508 + niebla) — la viñeta
 * siempre va a tener poco margen de contraste ahí porque parte de un negro
 * casi total. 0.55 es el punto en el que el oscurecimiento adicional ya se
 * nota al comparar con/sin efecto sin tragarse el centro donde está el
 * héroe.
 */
const VIGNETTE_DARKNESS = 0.55;
/**
 * PUNTO DE TUNING: dónde empieza el oscurecimiento (menor = más cerca del
 * centro = más cobertura). Bajado de 0.3 a 0.2 junto con la subida de
 * `VIGNETTE_DARKNESS`: con el offset original la franja oscurecida quedaba
 * pegada al borde extremo, que ya era negro por la niebla — bajarlo trae el
 * oscurecimiento un poco más hacia el centro para que tenga imagen visible
 * sobre la que actuar, sin llegar a tocar al héroe.
 */
const VIGNETTE_OFFSET = 0.2;

/**
 * PUNTO DE TUNING: opacidad del grano aditivo. Rango útil: 0.02-0.04.
 *
 * El blend pasó de OVERLAY a ADD (playtest 2026-07-26): con OVERLAY el grano
 * calculaba `2·base·ruido` y sobre un fondo casi negro eso era invisible
 * hiciera lo que hiciera la opacidad. Pero ADD tiene el defecto simétrico —
 * suma la MISMA cantidad a todos los píxeles, tengan el brillo que tengan —,
 * así que la opacidad se traduce casi directamente en cuánto se levanta el
 * negro: 0.1 lo sube a ~25/255 y la mazmorra entera se lee como nieve de
 * televisión gris (verificado en captura, playtest 2026-07-26, primer intento
 * de este mismo cambio). 0.03 levanta el negro solo ~4/255: se percibe la
 * textura en los degradados alrededor de la vela sin que el fondo deje de
 * leerse como negro.
 */
const NOISE_OPACITY = 0.03;

/**
 * PUNTO DE TUNING (Bloom): con la escena en penumbra (fondo #050508,
 * materiales Lambert apagados) el umbral de luminancia debe ser alto — solo
 * queremos que "florezcan" los puntos realmente intensos (llama de la vela,
 * antorchas, proyectiles, jefe), nunca el suelo/paredes con luz ambiental
 * normal. OJO: el umbral se evalúa sobre el buffer LINEAL — el Bloom es el
 * primer pase del chain, antes del ToneMapping (ver docstring de cabecera) —
 * donde los valores pueden superar 1.
 *
 * Subido de 1.1 a 2.0 (playtest de David, fase 4): con 1.1 el suelo Lambert
 * bajo la vela (luz `CANDLE_BASE_INTENSITY=55`) TODAVÍA superaba el umbral en
 * espacio lineal — el charco de luz entero floreaba de golpe, no solo la
 * llama. 2.0 queda por encima de lo que ese suelo iluminado alcanza; los
 * emisores intencionales (llama, antorchas, ojos de enemigo, proyectiles,
 * acentos de jefe) se suben aparte a HDR con `BLOOM_EMISSIVE_INTENSITY` (ver
 * `assets-dark.ts`) precisamente para cruzar ESTE umbral con margen, así que
 * solo florece lo que el propio material declara como emisor, nunca lo que
 * simplemente recibe mucha luz.
 */
const BLOOM_LUMINANCE_THRESHOLD = 2.0;
/** PUNTO DE TUNING (Bloom): suaviza el corte del umbral (transición gradual en vez de un recorte duro que se notaría como un halo con borde visible). */
const BLOOM_LUMINANCE_SMOOTHING = 0.15;
/** PUNTO DE TUNING (Bloom): intensidad del resplandor — el orquestador la ajustará mirando capturas reales de la escena en juego. */
const BLOOM_INTENSITY = 0.35;
/**
 * PUNTO DE TUNING (Bloom): radio del blur de mipmaps. El suelo justo bajo la
 * vela alcanza en LINEAL valores de luminancia enormes (luz intensidad 55 a
 * <1 u de distancia ⇒ decenas), así que ningún umbral razonable lo excluye
 * sin excluir también los emissive HDR (3) — ese núcleo caliente SIEMPRE va a
 * florecer algo. El radio corto es la palanca que evita que ese núcleo se
 * expanda en la "bola" gigante del playtest: halos apretados alrededor de
 * cada fuente en vez de un lavado de media pantalla.
 */
const BLOOM_RADIUS = 0.5;

/**
 * PUNTO DE TUNING (ChromaticAberration): desplazamiento máximo (unidades UV)
 * de los canales R/B con trauma = 1. Rango razonable: 0.01-0.02 — por debajo
 * vuelve a perderse contra el shake de cámara simultáneo, por encima empieza
 * a leerse como una franja de color permanente en vez de un pico de impacto.
 *
 * Subido de 0.004 a 0.015 (playtest de David 2026-07-26: "no lo noto"), y el
 * escalado en el useFrame de abajo pasa de trauma² a trauma LINEAL. Con
 * trauma² un golpe medio (trauma 0.5) se quedaba en el 25% del efecto — con
 * 0.004 de máximo eso es medio píxel de desplazamiento, encima enmascarado
 * por el shake posicional de la cámara ocurriendo a la vez. Con escalado
 * lineal ese mismo golpe medio ya da el 50% del efecto. En reposo (trauma =
 * 0) el offset sigue siendo exactamente (0,0) en ambos casos — eso no
 * cambia, solo la curva entre 0 y 1.
 */
const CA_MAX_OFFSET = 0.015;

export function PostEffects({ session }: { session: GameSession }) {
  const { bloom, vignette, noise, chromaticAberration } = usePostSettings();
  // Instancia del efecto construida A MANO (no vía el componente
  // <ChromaticAberration> del wrapper de @react-three/postprocessing): el
  // offset inicial (0,0) va garantizado en el constructor — el
  // ChromaticAberrationEffect de postprocessing trae un offset POR DEFECTO
  // distinto de cero (0.001, 0.0005), y pasándolo como prop del wrapper se
  // vio fringing de color constante en reposo (verificado en captura: bordes
  // R/B en cajas y monedas con trauma = 0). Con la instancia en mano, el
  // useFrame de abajo muta su uniform directamente, sin depender de refs a
  // través del wrapper. Se monta con <primitive> más abajo.
  const chromaticAberrationEffect = useMemo(
    () =>
      new ChromaticAberrationEffect({
        offset: new Vector2(0, 0),
        radialModulation: false,
        modulationOffset: 0,
      }),
    [],
  );

  // El hook se declara SIEMPRE, incluso si más abajo devolvemos null con todo
  // apagado — las reglas de hooks de React exigen que los hooks corran en el
  // mismo orden en cada render, así que no pueden ir después de un return
  // condicional. Mutar el uniform con el efecto desmontado es un no-op barato.
  useFrame(() => {
    // trauma LINEAL × CA_MAX_OFFSET (antes trauma², ver docstring de la
    // constante): con trauma² el efecto quedaba enmascarado por el shake de
    // cámara en los golpes medios; lineal lo hace notorio antes en la curva.
    // En trauma = 0 el resultado sigue siendo exactamente 0 — el efecto solo
    // deja de ser subliminal, no deja de partir de reposo real.
    const trauma = session.effects.state.trauma;
    const magnitude = trauma * CA_MAX_OFFSET;

    // Dirección: diagonal FIJA (no animada). A diferencia del shake de
    // cámara —que sí necesita ruido multi-eje para leerse como un temblor
    // físico creíble—, la aberración cromática es un efecto de color casi
    // subliminal: lo que vende el impacto es el PULSO de magnitud (trauma),
    // no hacia dónde apunta el desplazamiento de canales. Una dirección fija
    // evita 3 constantes de frecuencia más (como SHAKE_FREQ_X/Y/Z) sin que
    // se pierda nada perceptible. `.set()` muta el Vector2 uniform in-place
    // (mismo objeto que devuelve el getter `offset` del efecto), sin asignar
    // uno nuevo cada frame.
    chromaticAberrationEffect.offset.set(magnitude, magnitude);
  });

  // Con todo apagado no hay composer: el Canvas renderiza directo (coste cero).
  if (!bloom && !vignette && !noise && !chromaticAberration) return null;

  // Hijos como array SIN fragments vacíos: el composer monta bien con
  // fragments de relleno, pero RECONCILIAR un cambio de hijos (fragment ↔
  // efecto) tras un toggle lo tumbaba con Context Lost (verificado en
  // playtest de esta rama: pantalla negra al desmarcar Bloom en pausa). Solo
  // entran los efectos activos, cada uno con key estable.
  const passes = [];
  if (bloom) {
    // mipmapBlur: variante barata de Bloom (pirámide de mipmaps en vez de
    // múltiples pases de blur de resolución completa) — obligatoria aquí
    // porque el target de rendimiento incluye móvil. Va ANTES de la
    // viñeta/grano para muestrear la imagen sin viñetear (si no, el bloom
    // de los bordes se apagaría con las esquinas oscurecidas).
    passes.push(
      <Bloom
        key="bloom"
        mipmapBlur
        luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD}
        luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
        intensity={BLOOM_INTENSITY}
        radius={BLOOM_RADIUS}
      />,
    );
  }
  // SIEMPRE presente (sin toggle) justo después del Bloom: postprocessing
  // pone `renderer.toneMapping = NoToneMapping` mientras el composer está
  // montado (renderiza a buffers lineales), así que sin este pase la escena
  // pierde el ACES filmic por defecto de R3F y sale quemada/lavada
  // (verificado: la vela pasaba de llama recogida a bola de fuego). Va
  // DESPUÉS del Bloom (que necesita leer el HDR lineal para su umbral de
  // luminancia) y ANTES de aberración/viñeta/grano — esos tres son efectos de
  // "look" diseñados para espacio de pantalla LDR (0-1), no para el HDR
  // lineal donde antes vivían por ir el ToneMapping al final del chain (ver
  // docstring de cabecera del fichero).
  passes.push(<ToneMapping key="tonemapping" mode={ToneMappingMode.ACES_FILMIC} />);
  if (chromaticAberration) {
    // La instancia del useMemo de arriba (offset garantizado a (0,0) desde el
    // constructor), montada como <primitive>. El efecto NO se monta/desmonta
    // por trauma — solo por el toggle de pausa (ver docstring de cabecera);
    // el useFrame de arriba anima su uniform a partir del reposo.
    passes.push(<primitive key="ca" object={chromaticAberrationEffect} />);
  }
  if (vignette) {
    passes.push(<Vignette key="vignette" darkness={VIGNETTE_DARKNESS} offset={VIGNETTE_OFFSET} />);
  }
  if (noise) {
    // BlendFunction.ADD (antes OVERLAY, playtest de David 2026-07-26): OVERLAY
    // calcula 2·base·ruido, y con la base casi negra de esta escena (fondo
    // #050508 + niebla) el resultado varía una diezmilésima — invisible por
    // construcción, no por culpa de NOISE_OPACITY. ADD suma el ruido
    // directamente sobre el color final (ya en LDR gracias al reordenamiento
    // del chain, ver docstring de cabecera), así que sí se lee como grano
    // encima de los negros.
    passes.push(<Noise key="noise" opacity={NOISE_OPACITY} blendFunction={BlendFunction.ADD} />);
  }

  // `key` = set de efectos activos: cualquier cambio de toggles REMONTA el
  // composer entero (desmontaje limpio + montaje fresco, la ruta que sí
  // funciona) en vez de reconciliar pases en caliente (la que crasheaba).
  // Coste: recompilar los shaders de post-proceso al cambiar un toggle —
  // oculto tras el modal de pausa, que es el único sitio desde donde cambian.
  const chainKey = `${+bloom}${+chromaticAberration}${+vignette}${+noise}`;

  return (
    <EffectComposer key={chainKey} multisampling={4}>
      {passes}
    </EffectComposer>
  );
}
