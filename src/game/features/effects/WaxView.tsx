/**
 * Render de la capa de rastro persistente (`WaxPool`, wax.ts): TRES
 * `InstancedMesh` de `capacity` instancias cada uno — cera / escarcha /
 * arcano (`WAX_TYPE_*`) —, montados siempre desde GameRoot. A diferencia de
 * `TrailView` (que recalcula sus ~24 instancias cada frame porque la vida
 * cambia sin parar), aquí los puntos NUNCA se mueven ni se desvanecen una
 * vez depositados — así que este componente NO recorre las `capacity`
 * instancias cada frame: sube a la GPU ÚNICAMENTE los slots que cambiaron
 * desde el frame anterior (`pool.version` delta, ver cabecera de wax.ts), y
 * solo hace un barrido completo (ocultar todo) el frame en que detecta un
 * `clear()` (`pool.epoch`, reinicio de run/mazmorra).
 *
 * ── Un ring buffer, tres mallas: mapeo índice→malla (sin recorrer nada) ────
 * `WaxPool` es UN ring buffer compartido por los 3 tipos: el slot `idx` de
 * la ronda actual pudo pertenecer a OTRO tipo en la ronda anterior (el
 * buffer da la vuelta cada ~2000 emisiones del héroe). La solución más
 * barata (y la que usa este fichero) es que el índice DENTRO de cada malla
 * sea EL MISMO índice `idx` del pool — mapeo trivial, O(1), sin tabla de
 * traducción — a costa de que cada una de las 3 mallas reserve `capacity`
 * instancias (no `capacity/3`): 5000 instancias × 3 mallas es ~1.1 MB de
 * buffers de instancia en GPU, trivial para el presupuesto de este juego
 * (mismo razonamiento que "coste de memoria despreciable" ya aceptado para
 * los `Float32Array` del propio pool).
 *
 * Con ese mapeo, cada slot nuevo (`toUpdate`, más abajo) se escribe en LA
 * MALLA GANADORA (`pool.type[idx]`) con su transform/color reales, y se
 * OCULTA (posición fuera de vista, escala 0) en las otras dos — si no se
 * ocultara, un slot que fue escarcha hace una vuelta y ahora es cera dejaría
 * un cristal fantasma flotando en la malla de escarcha. Ocultar no toca el
 * color (con escala 0 no se dibuja nada, cambiarlo sería trabajo de sobra).
 * El barrido de `clear()`/montaje hace lo mismo pero para las `capacity`
 * instancias de las 3 mallas (raro: reinicio de run/mazmorra, no cada sala).
 *
 * Sin arrays/closures nuevos dentro de `useFrame` (AGENTS.md: cero
 * asignaciones por frame): las 3 referencias de malla se leen directas de
 * `meshRefs.current[N]` y el reparto "a qué malla toca esto" se hace con un
 * `if/else` sobre `WAX_TYPE_*`, no indexando un array construido al vuelo.
 *
 * ── Los 3 materiales (Problema 2 VFX: "cada arma deja su propio rastro") ──
 * Ver el comentario de cada `const ...Material` más abajo para el porqué de
 * cada geometría/blending. Ninguno fija `color`: los tres se tiñen por
 * `instanceColor` (igual que la cera de siempre), porque el MISMO tipo
 * puede recibir depósitos de colores distintos (p. ej. escarcha la escribe
 * tanto el rastro del héroe con Hielo activo como el proyectil de Hielo, con
 * su propio color cada uno).
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { unitCircle, unitPlane } from '@/game/render/assets';
import { vfxTexture } from '@/game/render/vfx-textures';
import { WAX_TYPE_ARCANE, WAX_TYPE_FROST, WAX_TYPE_WAX, type WaxPool } from './wax';

/**
 * Cera (arma cuerpo, `WAX_TYPE_WAX`): disco liso (`unitCircle`, sin textura),
 * OPACO — `transparent: false`, `opacity: 1`, `depthWrite: true` (playtest
 * VFX post-T1, David: "la cera sigue viéndose como pegatinas, que al
 * superponerse se suma su alpha [...] debería verse [...] sin sumar
 * alphas"). Con el material `transparent`/`opacity:0.6` que tenía antes, dos
 * gotas superpuestas daban 0.84 de opacidad, tres 0.94: el rastro se volvía
 * un pegote blanco donde el héroe pasaba dos veces. Mientras la cera fueran
 * quads semitransparentes no había forma de evitarlo — la única salida es
 * opacidad 1: dos gotas superpuestas se ven EXACTAMENTE igual que una, sea
 * cual sea el orden de dibujado.
 *
 * `depthWrite: true` (necesario para que una gota opaca tape correctamente a
 * la que tiene detrás) introduce un riesgo nuevo: TODAS las gotas viven al
 * mismo `WAX_GROUND_Y`, así que dos gotas solapadas escriben profundidades
 * casi idénticas → z-fighting (parpadeo entre gotas al mover la cámara). Se
 * resuelve con un micro-offset de altura por instancia derivado de su índice
 * en el ring buffer (`WAX_GROUND_Y + (idx % 16) * WAX_Y_JITTER_STEP`, ver más
 * abajo): 16 alturas posibles separadas 0.5 mm, invisible a la vista pero
 * suficiente para que el depth buffer las distinga. Se aplica al escribir
 * CUALQUIER instancia (las 3 mallas), no solo la de cera: la escarcha
 * también es opaca (ver su material) y comparte el mismo riesgo.
 *
 * Sigue siendo Lambert (decisión de playtest ronda 8, documentada ya antes
 * de este cambio: "la cera solo debe leerse donde llega luz real" — sin
 * emissive, así que en zona oscura se funde con la penumbra ambiental en vez
 * de leerse "encendida"), y sigue con `instanceColor`/`receiveShadow`.
 */
const waxMaterial = new THREE.MeshLambertMaterial({
  transparent: false,
  opacity: 1,
  depthWrite: true,
});

/**
 * Escarcha (arma Hielo/`arrow` en el mundo simulado, `WAX_TYPE_FROST`): quad
 * `unitPlane` con `snowflake.png` — Splat PROPIO generado por
 * `scripts/gen-vfx-textures.mjs` (copo de 6 brazos con ramitas; los `fan_*`
 * de Kenney son aspas de ventilador y no colaban como copo, feedback de
 * David 2026-08-12: "los copos de nieve no tienen esa textura"). `rot` por
 * instancia SÍ aporta aquí (a diferencia de la cera): orienta cada cristal
 * al azar para que el rastro no se lea como copias idénticas.
 *
 * Recorte por `alphaTest`, no blending aditivo: a diferencia de `fan_d`
 * (Light Mask sin canal alfa), `snowflake.png` es un Splat con alfa FIABLE
 * (blanco recortado por alfa, ver cabecera de `vfx-textures.ts`) — mismo
 * criterio que la cera (`waxMaterial` arriba): `transparent: false` +
 * `alphaTest` + `depthWrite: true` recorta la silueta del copo sin blending
 * de verdad, así que dos copos solapados NO acumulan opacidad (cada
 * fragmento por encima del umbral se pinta 100% opaco, el más cercano a
 * cámara gana por profundidad) — el mismo problema de "pegatinas que suman
 * alfa" que ya se resolvió para la cera, aquí evitado desde el principio en
 * vez de con `opacity: 1` sobre un disco relleno (el copo SÍ tiene huecos
 * reales que deben seguir transparentes, `opacity: 1` con blending normal no
 * bastaría). `depthWrite: true` comparte el mismo riesgo de z-fighting que
 * la cera y el mismo remedio (`WAX_Y_JITTER_*` más abajo, aplicado a
 * cualquier instancia sea cual sea su tipo).
 */
const frostMaterial = new THREE.MeshBasicMaterial({
  map: vfxTexture('snowflake'),
  transparent: false,
  alphaTest: 0.5,
  depthWrite: true,
  opacity: 1,
});

/**
 * Arcano (arma `spell`, `WAX_TYPE_ARCANE`): quad `unitPlane` con
 * `bolt.png` — Splat PROPIO generado por `scripts/gen-vfx-textures.mjs`
 * (rayo en zigzag con dos ramas: feedback de David 2026-08-12, "esperaba
 * algún tipo de rayo" en vez de `circle_rings_a`, que se leía como sello
 * circular, no como rayo). Mismo criterio de recorte que la escarcha
 * (`alphaTest` + `depthWrite: true`, ver comentario largo arriba): alfa
 * fiable del propio Splat, sin blending aditivo ni acumulación de opacidad
 * al superponerse.
 */
const arcaneMaterial = new THREE.MeshBasicMaterial({
  map: vfxTexture('bolt'),
  transparent: false,
  alphaTest: 0.5,
  depthWrite: true,
  opacity: 1,
});

/** Altura base del rastro: casi a ras de suelo (mismo criterio que el goterón de TrailView en silueta). */
const WAX_GROUND_Y = 0.025;
/** Cuántas alturas distintas de anti-z-fighting hay en el ciclo (ver comentario de `waxMaterial` arriba). */
const WAX_Y_JITTER_SLOTS = 16;
/** Paso entre alturas de anti-z-fighting: 0.5 mm, imperceptible a la vista, suficiente para el depth buffer. */
const WAX_Y_JITTER_STEP = 0.0005;
/** Fuera de vista: forma barata de "ocultar" una instancia sin desmontarla (mismo truco que ParticleView/TrailView). */
const HIDDEN_Y = -1000;

export function WaxView({ pool }: { pool: WaxPool }) {
  const meshRefs = useRef<[THREE.InstancedMesh | null, THREE.InstancedMesh | null, THREE.InstancedMesh | null]>([null, null, null]);
  const scratch = useMemo(() => ({ obj: new THREE.Object3D(), color: new THREE.Color() }), []);
  const lastVersion = useRef(0);
  const lastEpoch = useRef(0);
  // three.js inicializa instanceMatrix a identidad (todas las instancias en
  // el origen, escala 1): sin este flag, el primer frame mostraría miles de
  // marcas apiladas en (0,0,0) hasta el primer emit/clear. Fuerza el mismo
  // barrido de ocultado que `clear()` una vez, al montar.
  const initialized = useRef(false);

  useFrame(() => {
    const meshWax = meshRefs.current[WAX_TYPE_WAX];
    const meshFrost = meshRefs.current[WAX_TYPE_FROST];
    const meshArcane = meshRefs.current[WAX_TYPE_ARCANE];
    if (!meshWax || !meshFrost || !meshArcane) return;
    const { obj, color } = scratch;

    if (pool.epoch !== lastEpoch.current || !initialized.current) {
      // clear(): el pool ya no garantiza que las instancias visibles sigan
      // siendo válidas (cursor/count volvieron a 0) — barrido completo
      // ocultando TODO en las 3 mallas, único momento (aparte del montaje)
      // en que este componente recorre las `capacity` instancias. Raro
      // (reinicio de run/mazmorra), no cada sala.
      initialized.current = true;
      lastEpoch.current = pool.epoch;
      lastVersion.current = pool.version;
      obj.position.set(0, HIDDEN_Y, 0);
      obj.scale.setScalar(0);
      obj.updateMatrix();
      color.setRGB(0, 0, 0);
      for (let i = 0; i < pool.capacity; i++) {
        meshWax.setMatrixAt(i, obj.matrix);
        meshWax.setColorAt(i, color);
        meshFrost.setMatrixAt(i, obj.matrix);
        meshFrost.setColorAt(i, color);
        meshArcane.setMatrixAt(i, obj.matrix);
        meshArcane.setColorAt(i, color);
      }
      meshWax.instanceMatrix.needsUpdate = true;
      if (meshWax.instanceColor) meshWax.instanceColor.needsUpdate = true;
      meshFrost.instanceMatrix.needsUpdate = true;
      if (meshFrost.instanceColor) meshFrost.instanceColor.needsUpdate = true;
      meshArcane.instanceMatrix.needsUpdate = true;
      if (meshArcane.instanceColor) meshArcane.instanceColor.needsUpdate = true;
    }

    const newWrites = pool.version - lastVersion.current;
    if (newWrites > 0) {
      // Solo los slots tocados desde el último frame (como mucho `capacity`
      // si se depositó más de una vuelta completa entera en un único frame,
      // caso extremo): son los últimos `toUpdate` índices escritos,
      // terminando en `cursor - 1` (ring buffer). Cada `emit()` real escribe
      // 2-3 de estos slots (cúmulo, ver wax.ts) pero eso es transparente
      // aquí: `version` ya cuenta slots, no llamadas a `emit()`.
      const toUpdate = Math.min(newWrites, pool.capacity);
      for (let k = 0; k < toUpdate; k++) {
        const idx = (((pool.cursor - toUpdate + k) % pool.capacity) + pool.capacity) % pool.capacity;
        const type = pool.type[idx];
        const yJitter = WAX_GROUND_Y + (idx % WAX_Y_JITTER_SLOTS) * WAX_Y_JITTER_STEP;

        // Este slot del ring buffer es GLOBAL a los 3 tipos: en una vuelta
        // anterior pudo pertenecer a otro tipo. Oculta idx en las dos mallas
        // que NO ganan esta escritura (posición fuera de vista + escala 0,
        // sin tocar color: con escala 0 no se dibuja nada).
        obj.position.set(0, HIDDEN_Y, 0);
        obj.scale.setScalar(0);
        obj.updateMatrix();
        if (type !== WAX_TYPE_WAX) meshWax.setMatrixAt(idx, obj.matrix);
        if (type !== WAX_TYPE_FROST) meshFrost.setMatrixAt(idx, obj.matrix);
        if (type !== WAX_TYPE_ARCANE) meshArcane.setMatrixAt(idx, obj.matrix);

        // Malla ganadora: transform + color reales.
        obj.position.set(pool.x[idx], yJitter, pool.z[idx]);
        // Orden Euler XYZ por defecto de three: al transformar el vértice se
        // aplica primero Z, luego Y, luego X (matriz = Rx·Ry·Rz). El giro en
        // Z gira la mancha DENTRO del plano propio del quad/disco (aún "de
        // pie", normal en +Z local) antes de que la X lo tumbe -90° al plano
        // del suelo — exactamente lo que se busca: orientación aleatoria de
        // la mancha, no del tumbado. No cambiar a otro orden ni componer
        // quaterniones (mismo criterio ya documentado en versiones previas
        // de este fichero).
        obj.rotation.set(-Math.PI / 2, 0, pool.rot[idx]);
        // unitCircle (assets.ts) es CircleGeometry(1,24): RADIO 1. unitPlane
        // es PlaneGeometry(1,1): LADO 1. Para que "size" (que llega como un
        // RADIO físico desde HeroView/ProjectileView) dé el mismo tamaño en
        // pantalla con cualquier geometría, la cera escala ×1 (radio =
        // size) y escarcha/arcano escalan ×2 (lado = 2·size, o sea
        // semi-lado = size = mismo radio aparente que un disco).
        obj.scale.setScalar(type === WAX_TYPE_WAX ? pool.size[idx] : pool.size[idx] * 2);
        obj.updateMatrix();
        color.setRGB(pool.r[idx], pool.g[idx], pool.b[idx]);
        if (type === WAX_TYPE_WAX) {
          meshWax.setMatrixAt(idx, obj.matrix);
          meshWax.setColorAt(idx, color);
        } else if (type === WAX_TYPE_FROST) {
          meshFrost.setMatrixAt(idx, obj.matrix);
          meshFrost.setColorAt(idx, color);
        } else {
          meshArcane.setMatrixAt(idx, obj.matrix);
          meshArcane.setColorAt(idx, color);
        }
      }
      lastVersion.current = pool.version;
      meshWax.instanceMatrix.needsUpdate = true;
      if (meshWax.instanceColor) meshWax.instanceColor.needsUpdate = true;
      meshFrost.instanceMatrix.needsUpdate = true;
      if (meshFrost.instanceColor) meshFrost.instanceColor.needsUpdate = true;
      meshArcane.instanceMatrix.needsUpdate = true;
      if (meshArcane.instanceColor) meshArcane.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      {/* Cera: Lambert opaco, recibe sombra (ver waxMaterial arriba). */}
      <instancedMesh
        ref={(el) => {
          meshRefs.current[WAX_TYPE_WAX] = el;
        }}
        args={[unitCircle, waxMaterial, pool.capacity]}
        frustumCulled={false}
        receiveShadow
      />
      {/* Escarcha/arcano: MeshBasicMaterial aditivo — no reciben sombra (ese
          material no incluye el chunk de sombras de three.js, `receiveShadow`
          no tendría efecto: se omite a propósito, no es un olvido). */}
      <instancedMesh
        ref={(el) => {
          meshRefs.current[WAX_TYPE_FROST] = el;
        }}
        args={[unitPlane, frostMaterial, pool.capacity]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(el) => {
          meshRefs.current[WAX_TYPE_ARCANE] = el;
        }}
        args={[unitPlane, arcaneMaterial, pool.capacity]}
        frustumCulled={false}
      />
    </>
  );
}
