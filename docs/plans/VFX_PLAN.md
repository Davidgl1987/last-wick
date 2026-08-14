# Plan de VFX: texturas de Kenney para efectos, impactos y luz falsa

*Escrito 2026-08-11. Mete textura en la capa de efectos usando dos packs CC0 de
Kenney (**Light Masks** 1.0, 150 archivos; **Splat Pack**, 36 archivos). No toca
la simulación ni añade una sola luz real: todo lo de aquí es capa de render.*

---

## 1. Punto de partida (por qué esto merece la pena)

La capa de efectos actual es geométricamente correcta y visualmente pobre, por
una razón concreta: **no hay una sola textura en ella**. Todo son primitivas
lisas.

| Efecto | Hoy | Problema |
|---|---|---|
| Cera del rastro (`WaxView`) | 2000 `unitCircle` Lambert | círculos geométricamente perfectos, se leen como pastillas |
| Partículas (`ParticleView`) | `unitSphere` instanciada, `MeshBasicMaterial` sin `map` | bolitas; aceptable en movimiento rápido |
| Onda expansiva (`ShockwaveView`) | `RingGeometry(0.82, 1)` | el borde termina en filo, no se difumina |
| Halos de luz falsa (`GlowPuddle`, halos de proyectil) | `createGlowHaloTexture()`: degradado radial de canvas 64² | funciona, pero es el degradado más plano posible |
| Impactos (`enemy-hit`, `projectile-wall`, `wall-bounce`) | solo burst de partículas | ningún fogonazo: el golpe no "destella" |
| Explosión de barril | partículas + anillo + trauma | no deja rastro; la sala olvida que hubo una explosión |

Los dos packs cubren exactamente esos huecos, y lo hacen **sin añadir luces**
(techo vigente: 7 luces reales, 1 sombra) porque son texturas que *fingen* luz:
el mismo truco que ya usa `GlowPuddle.tsx`, con mejor material de partida.

### Nota sobre `docs/ARCHITECTURE.md`

El §"Presupuesto de rendimiento" dice *"sin sombras dinámicas"* y *"sin
postprocesado"*. Ambas afirmaciones están **desactualizadas** (hay 1 sombra
direccional en `SceneLights.tsx` y una cadena `EffectComposer` en
`PostEffects.tsx`). Ningún agente de este plan debe "corregir" el código para
alinearlo con ese texto. Lo que **sí** sigue vigente y es innegociable: cero
asignaciones por frame, instancing obligatorio, materiales y geometrías
compartidos creados una vez.

---

## 2. Los assets: qué entra y por qué

Zips ya descargados en `~/Downloads/`:
`kenney_light-masks-1.0.zip` (carpeta `Default/`, PNG 512²) y
`kenney_splat-pack.zip` (carpeta `PNG/Default (256px)/`, PNG 256²).

De 186 archivos entran **16** (8 Light Masks + 8 Splats). Selección hecha
mirando los contactos de ambos
packs; los nombres son literales del zip.

| Archivo del pack | Destino en el juego | Por qué ese y no otro |
|---|---|---|
| `circle_c.png` | halo de luz falsa (sustituye `glowHaloTexture`) | núcleo pequeño y brillante con caída larga: se lee como *fuente puntual*, no como disco |
| `circle_rings_a.png` | fogonazo de explosión | núcleo blanco + dos anillos: frente de choque instantáneo |
| `ring_a.png` | onda expansiva | anillo fino con las dos caras difuminadas |
| `shape_e.png` | destello de impacto normal | estrella de 4 puntas suave |
| `shape_g.png` | destello de impacto fuerte | núcleo duro + 8 rayos; se distingue de `shape_e` a un vistazo |
| `shape_c.png` | humo (fase 3) | bola con textura de nubes |
| `splat00/05/08/12.png` | cera del rastro | los 4 más **redondeados**: gota caída, no salpicadura violenta |
| `splat02/20/26/34.png` | hollín e impactos | con pinchos y gotas satélite: proyección, no goteo |
| `window_i_blur.png` | cookie de ventana (fase 3) | ventana ojival con parteluz, difuminada |
| `cone_composed_a.png` | haz de antorcha (fase 3) | cono con núcleo y lóbulos laterales |

### Regla crítica de blending (leer dos veces)

**El canal alfa de Light Masks es inconsistente entre archivos del propio
pack.** Auditado: `circle_a`/`circle_b`/`ring_a` traen RGBA; `circle_c`,
`circle_d`, `circle_rings_*`, `shape_*`, `cone_a` son RGB **sin alfa**; los
`window_*` sin `_blur` llegan a ser bitmaps de 1 bit.

> **Toda Light Mask se usa SIEMPRE con `blending: THREE.AdditiveBlending`**, que
> trata el negro como transparente por definición y hace el alfa irrelevante.
> Usar una Light Mask con blending normal pinta un **cuadrado negro** en pantalla.
>
> **Todo Splat se usa con blending NORMAL** (`transparent: true`): ahí el alfa sí
> es fiable y uniforme (los 36 son RGBA, blanco puro recortado por alfa).

Ambos packs son **CC0**: atribución no obligatoria. Se hace igualmente, como ya
se hace con KayKit y con las UI Borders de Kenney.

---

## 3. Invariantes que todo agente de este plan debe respetar

Además de `AGENTS.md` (de lectura obligatoria, incluye "no uses la herramienta
Agent", "no toques git", "vitest siempre con `run`"):

1. **Ni una luz real nueva.** Nada de `pointLight`/`spotLight`/`SpotLight.map`.
   Cada luz visible extra recompila todos los shaders de la escena.
2. **Un efecto = un draw call.** Lo repetido va en `InstancedMesh`; los pools
   pequeños de tamaño fijo (ondas, destellos) pueden ser N mallas con material
   por slot, como ya hace `ShockwaveView`.
3. **Texturas cargadas una vez a nivel de módulo**, nunca dentro de `useFrame`
   ni de un componente. Materiales cacheados por clave, calcando el patrón de
   `glowPuddleMaterial()` en `render/assets.ts:112`.
4. **Cero asignaciones por frame.** Objetos `Object3D`/`Color` scratch en
   `useMemo`, como ya hacen `ParticleView`/`WaxView`.
5. **`texture.colorSpace = THREE.SRGBColorSpace`** en toda textura de color
   (mismo criterio que `createGlowHaloTexture`).
6. Ningún módulo de `features/effects/*.ts` (lógica de pools) importa three.js
   ni React: siguen siendo testeables headless. Solo los `*View.tsx` conocen
   three.
7. **Lo visual promete lo mecánico** (`AGENTS.md`): un fogonazo o un anillo no
   puede ser más grande que el radio de daño real.

---

## 4. Fases y tareas

Cada tarea lleva su prompt listo para delegar. **Modelo: `sonnet` en todas** —
ninguna tiene algoritmos con garantías formales ni bugs enrevesados que
justifiquen `opus` (T0 podría bajar a `haiku`, su contrato está cerrado).

### Orden y paralelismo

```
Ola 1:  T0                          (bloquea todo: crea el módulo de texturas)
Ola 2:  T1 ‖ T2 ‖ T3                (ficheros disjuntos, en paralelo)
Ola 3:  T4                          (depende de T3: ambos tocan reactToEvent.ts)
        + verificación visual del orquestador
Ola 4:  T5 ‖ T6                     (opcionales, según lo que se vea en la ola 3)
```

Conflictos de edición evitados a propósito: T0 es la **única** tarea que toca
`render/assets.ts`; T3 y T4 son los únicos que tocan `reactToEvent.ts` /
`session.ts` / `GameRoot.tsx`, y van en serie.

---

### T0 — Base: assets en `public/`, módulo de texturas y swap del halo

**Ficheros:** crea `public/textures/vfx/*` (+ `LICENSE-kenney.txt` + `README.md`),
crea `src/game/render/vfx-textures.ts` y su test; modifica `render/assets.ts`
(solo `glowHaloTexture`) y `game/ui/CreditsModal.tsx`.

**Qué hace:**
1. Extrae los zips a un temporal y copia los 14 PNG de §2 a
   `public/textures/vfx/` conservando el nombre del pack (trazabilidad).
   Reescala las Light Masks de 512² a 256² (`sips -z 256 256`, ~15 KB cada una;
   son manchas difusas, 256 sobra). Los splats ya vienen a 256².
2. `vfx-textures.ts`: carga con `THREE.TextureLoader` **una vez a nivel de
   módulo**, `colorSpace = SRGBColorSpace`, más dos helpers cacheados por clave
   `color|opacidad|textura` calcando `glowPuddleMaterial()`:
   `additiveVfxMaterial(name, color, opacity)` (Light Masks) y
   `splatVfxMaterial(name, opacity)` (Splats, blending normal). La URL base
   entra como parámetro con `import.meta.env.BASE_URL` resuelto por el
   llamador, **igual que `clips.ts`/`kit-models.ts`**, para no romper tests.
3. Test headless que valida que cada nombre de la tabla del módulo existe en
   `public/textures/vfx/` (calca `kit-models.test.ts`).
4. Cambia `glowHaloTexture` en `assets.ts` para que use `circle_c.png` en vez
   del degradado de canvas. `createRadialTexture()` (blob shadows, negra) **no
   se toca**. Ajusta las opacidades de `glowPuddleMaterial` si el halo nuevo
   satura — el núcleo de `circle_c` es más brillante que el degradado actual.
5. Crédito a Kenney por los dos packs en `CreditsModal.tsx` (ya hay precedente).

**Aceptación:** typecheck/test/build limpios; el juego arranca y los halos de
proyectil/enemigo/antorcha siguen viéndose (mejor, no distintos de color).

<details><summary>Prompt de delegación</summary>

> Lee `AGENTS.md` y `docs/plans/VFX_PLAN.md` (§2, §3 y T0) antes de tocar nada, y
> cúmplelos al pie de la letra. Implementa la tarea T0 completa: copiar los 16
> PNG seleccionados desde `~/Downloads/kenney_light-masks-1.0.zip` y
> `~/Downloads/kenney_splat-pack.zip` a `public/textures/vfx/`, crear
> `src/game/render/vfx-textures.ts` con su test, y cambiar `glowHaloTexture` en
> `render/assets.ts` para que use `circle_c.png`. Respeta la regla de blending
> del §2 (Light Masks SOLO aditivo, Splats blending normal) y el patrón de URL
> base por parámetro de `clips.ts`. No toques ningún otro fichero de efectos:
> otras tareas los están editando en paralelo. Verifica typecheck, test y build
> antes del informe.

</details>

---

### T1 — La cera deja manchas, no pastillas

**Ficheros:** `features/effects/wax.ts`, `wax.test.ts`,
`features/effects/WaxView.tsx`. **Nada más.**

**Qué hace:** cada gota de cera pasa de disco perfecto a mancha irregular
rotada al azar.

- `WaxPool` gana `rot: Float32Array`. La rotación **se genera dentro de
  `emit()`** con un `rng: () => number = Math.random` inyectable (mismo patrón
  que `ParticlePool.burst`), *no* la pasan los llamadores: así
  `HeroView.tsx:640` y `ProjectileView.tsx:284` no se tocan y el diff queda
  contenido. `clear()` resetea `rot` como el resto de arrays.
- `WaxView` cambia la geometría a `unitPlane` (ya existe en `assets.ts:14`) y el
  material a Lambert **con `map` = `splat00.png`**, manteniendo
  `transparent`/`opacity 0.6`/`depthWrite:false`/`receiveShadow` y el
  `instanceColor` actual (el splat es blanco puro: no altera el tinte).
- Rotación en el sitio correcto: `obj.rotation.set(-Math.PI / 2, 0, pool.rot[idx])`.
  Con el orden Euler XYZ por defecto el giro en Z se aplica en el plano del
  propio quad **antes** de tumbarlo, que es justo lo que se quiere. No inventes
  otro orden ni compongas quaterniones.
- **No** toques la actualización incremental por `version`/`epoch` de
  `WaxView` — es el corazón de su rendimiento y está documentada en su cabecera.

**Aceptación:** además de typecheck/test/build, un test nuevo en `wax.test.ts`
que compruebe que `emit()` con un rng determinista escribe `rot` y que `clear()`
lo limpia. Un solo draw call para toda la cera (sigue siendo un `InstancedMesh`).

**Riesgo conocido:** con una única textura de splat puede notarse repetición. Se
acepta a propósito: la rotación aleatoria la disimula y evita un atlas + UVs por
instancia. Si tras verlo en juego canta, se abre T1b (atlas 2×2 con los 4
splats redondeados y `instanceUV` por `onBeforeCompile`) — **no** lo hagas
ahora.

<details><summary>Prompt de delegación</summary>

> Lee `AGENTS.md` y `docs/plans/VFX_PLAN.md` (§2, §3 y T1) antes de tocar nada, y
> cúmplelos al pie de la letra. Implementa T1: la cera del rastro pasa de discos
> perfectos a manchas de splat rotadas al azar. Toca EXCLUSIVAMENTE
> `features/effects/wax.ts`, `wax.test.ts` y `WaxView.tsx` — otros agentes están
> editando el resto de la capa de efectos en paralelo, y `render/assets.ts` está
> tocado por otra tarea, así que da por hecho que `unitPlane` ya existe ahí y que
> `public/textures/vfx/splat00.png` ya está en su sitio. La rotación se genera
> dentro de `emit()` con un rng inyectable, no la pasan los llamadores. Verifica
> typecheck, test y build antes del informe.

</details>

---

### T2 — Onda expansiva con frente difuminado

**Ficheros:** `features/effects/ShockwaveView.tsx`. **Nada más.**

**Qué hace:** sustituye `RingGeometry(0.82, 1, 48)` por `unitPlane` con
`ring_a.png` en aditivo, teñido con el `#ffb066` actual. Se conserva tal cual el
pool de 4 slots, el material por slot (la opacidad se anima por slot) y la curva
`eased`/opacidad ya afinada. El quad debe escalarse a **2× el radio** de la onda
(la textura tiene el anillo inscrito en el cuadrado, el radio del anillo es la
mitad del lado).

**Aceptación:** la onda de `barrel-explosion` sigue midiendo lo mismo que antes
en el suelo — es un requisito mecánico, no estético (`AGENTS.md`: lo visual
promete lo mecánico; el radio visible debe seguir coincidiendo con
`BARREL_BLAST_RADIUS`).

<details><summary>Prompt de delegación</summary>

> Lee `AGENTS.md` y `docs/plans/VFX_PLAN.md` (§2, §3 y T2) antes de tocar nada.
> Implementa T2: `ShockwaveView.tsx` pasa de `RingGeometry` a un quad `unitPlane`
> con la textura `ring_a.png` en blending aditivo. Toca EXCLUSIVAMENTE
> `ShockwaveView.tsx`. Da por hecho que `render/vfx-textures.ts` ya existe con
> sus helpers cacheados (otra tarea lo creó). Cuidado con la escala: la textura
> lleva el anillo inscrito, así que el quad va a 2× el radio de la onda — el
> radio VISIBLE en el suelo debe quedar idéntico al actual, es un requisito
> mecánico. Verifica typecheck, test y build antes del informe.

</details>

---

### T3 — Fogonazo de impacto (pool nuevo)

**Ficheros:** crea `features/effects/flash.ts` + `flash.test.ts` +
`FlashView.tsx`; modifica `features/effects/reactToEvent.ts`,
`session/session.ts`, `render/useGameLoop.ts`, `render/GameRoot.tsx`.

**Qué hace:** hoy un impacto es solo un puñado de partículas. Añade un destello
aditivo brevísimo en el punto de impacto, que con el `Bloom` ya montado en
`PostEffects.tsx` brilla sin coste extra.

- `FlashPool`: pool fijo de 8 slots, arrays `Float32Array` (x, z, life, maxLife,
  size, r, g, b) + `active: Uint8Array`, con `spawn()` y `update(dt)`. Calcado
  de `shockwave.ts`, que es el ejemplo más corto del repo. **Sin three.js.**
- `FlashView.tsx`: 8 quads `unitPlane` tumbados, material aditivo por slot
  (`shape_e.png`), opacidad y escala animadas en `useFrame` desde el pool.
  Vida ~0.10 s; la escala hace un pico rápido y cae.
- `reactToEvent.ts`: recibe `flashes: FlashPool | null = null` **siguiendo el
  patrón del `shockwaves: ShockwavePool | null = null` que ya tiene**. Va
  **al final del todo, después de `heroWeaponColorHex`**: ese parámetro es hoy
  el 6º y `useGameLoop.ts` lo pasa posicionalmente, así que colarse delante de
  él rompería la llamada real y los tests existentes. Dispara en:
  `enemy-hit`, `boss-hit`, `projectile-wall`, `wall-bounce`, `shield-block`,
  `boss-immune-hit` y `barrel-explosion`. Reutiliza el color ya resuelto en esa
  función (arma/objeto), no lo recalcules.
- Tamaño por evento: escala con el mismo `event.intensity` que ya usa el trauma,
  con techo. Un `enemy-hit` normal ~0.5 u; `barrel-explosion` a
  `BARREL_BLAST_RADIUS`, ni un pelo más.
- `session.ts`: `flashes: new FlashPool()` en `EffectsSession` (junto a
  `shockwaves`). `GameRoot.tsx`: monta `<FlashView pool={session.effects.flashes} />`
  junto a `<ShockwaveView>`. `useGameLoop.ts`: llama a `flashes.update(dt)` donde
  ya actualiza los demás pools, y pasa el pool a `reactToEvent`.

**Aceptación:** tests headless de `flash.ts` (spawn ocupa slot libre, reciclado
al agotarse, `update` libera al morir); typecheck/test/build limpios; cero
asignaciones en el `useFrame` de `FlashView`.

<details><summary>Prompt de delegación</summary>

> Lee `AGENTS.md` y `docs/plans/VFX_PLAN.md` (§2, §3 y T3) antes de tocar nada, y
> cúmplelos al pie de la letra. Implementa T3 completa: pool nuevo de fogonazos
> de impacto (`features/effects/flash.ts` + test + `FlashView.tsx`) enganchado
> desde `reactToEvent.ts`, `session.ts`, `useGameLoop.ts` y `GameRoot.tsx`.
> Copia la estructura de `shockwave.ts`/`ShockwaveView.tsx`, que es el ejemplo
> más corto y más parecido. El parámetro nuevo de `reactToEvent` va como
> opcional con default `null`, igual que `shockwaves`, para no romper las
> llamadas existentes en los tests. Da por hecho que `render/vfx-textures.ts` ya
> existe con sus helpers cacheados y que `public/textures/vfx/shape_e.png` está
> en su sitio (otra tarea lo hizo). NO toques `wax.ts`, `WaxView.tsx` ni
> `ShockwaveView.tsx`: otros agentes los están editando ahora mismo. El tamaño
> del fogonazo de `barrel-explosion` no puede superar `BARREL_BLAST_RADIUS`.
> Verifica typecheck, test y build antes del informe.

</details>

---

### T4 — La explosión deja hollín

**Ficheros:** `features/effects/reactToEvent.ts` (+ su test si lo hay),
`useGameLoop.ts`. **Depende de T3** (mismos ficheros).

**Qué hace:** `barrel-explosion` y `boss-defeated` depositan 3-5 manchas oscuras
grandes en el `WaxPool` que ya existe, alrededor del punto de impacto. La sala
conserva la marca hasta el reinicio de run/mazmorra (la cera ya sobrevive a los
cambios de sala; `session.ts:294` y `:380` la limpian donde toca).

Deliberadamente **no** crea una capa de decals nueva: reusar el pool de cera son
~15 líneas y cero infraestructura. Si el hollín gris sobre suelo oscuro no se lee
(la cera es Lambert: en penumbra se funde con el fondo, y eso es correcto para la
cera pero puede matar el hollín), se promueve a capa propia con material
`MultiplyBlending` — decisión del orquestador tras verlo, no del agente.

**Aceptación:** típicos + que el hollín no aparezca fuera del radio de la
explosión.

<details><summary>Prompt de delegación</summary>

> Lee `AGENTS.md` y `docs/plans/VFX_PLAN.md` (§2, §3 y T4) antes de tocar nada.
> Implementa T4: en `reactToEvent.ts`, los eventos `barrel-explosion` y
> `boss-defeated` depositan 3-5 manchas oscuras grandes en el `WaxPool`
> existente (pásalo como parámetro opcional con default `null`, igual que
> `shockwaves` y `flashes`), repartidas con el `rng` que la función ya recibe y
> dentro del radio real de la explosión (`event.intensity` para
> `barrel-explosion`; para `boss-defeated`, que no trae radio, usa ~1.5 u fijo y
> dilo en el informe). No crees capa nueva ni toques
> `wax.ts`/`WaxView.tsx`. Verifica typecheck, test y build antes del informe.

</details>

---

### Fase 3 (opcionales, decidir tras ver la ola 3 en juego)

**T5 — Cookie de ventana con el relámpago.** `window_i_blur.png` como quad
aditivo en el suelo bajo las ventanas de muro, con la intensidad ligada al
relámpago de `render/storm.ts`. Es lo que más "producción" añade de todo el
plan, pero necesita antes una tarea de investigación sobre `wall-modules.ts`
para saber dónde caen las ventanas en coordenadas de sala. Riesgo medio.

**T6 — Humo de explosión.** Quads tumbados con `shape_c.png` que crecen y se
desvanecen tras el fogonazo. Ojo: tumbados al suelo, **no** billboards — la
cámara es cenital inclinada y orientar quads a cámara con instancing es más lío
del que el efecto merece.

**Lo que este plan NO hace, a propósito:** texturizar `ParticleView`. Las
partículas pequeñas son esferas y desde esta cámara funcionan; pasarlas a quads
las aplastaría y billboardearlas no compensa. La textura va en lo grande y lento
(cera, fogonazos, ondas, decals), no en las chispas.

---

## 5. Verificación visual (orquestador, tras la ola 3)

> **Ojo:** los puentes dev-only `window.__lastwick` / `window.__lastwickScene`
> que `AGENTS.md` manda conservar **ya no existen** en el código (comprobado el
> 2026-08-11: cero apariciones en `src/`). No los cites en prompts de tareas ni
> planifiques verificaciones que dependan de ellos. La verificación es jugando
> en el preview; `?seed=N` sí sigue funcionando, y `?godmode` también
> (`render/debug-params.ts`).

Con `?seed=N` para fijar la mazmorra:

1. **Cera**: mover al héroe en zigzag bajo una antorcha → manchas irregulares
   con orientaciones distintas, no pastillas alineadas. En penumbra debe seguir
   casi desapareciendo (es el comportamiento correcto desde playtest ronda 8).
2. **Impacto**: golpear un enemigo → destello blanco de ~100 ms; a ojo debe
   leerse *antes* que las partículas.
3. **Barril**: explosión → fogonazo + anillo difuminado + hollín persistente, y
   el anillo midiendo lo mismo que el radio de daño.
4. **Halos**: monedas/proyectiles/antorchas siguen viéndose a través de muros
   como hasta ahora (T0 cambió su textura; comprobar que no saturan con Bloom).
5. **Rendimiento**: draw calls y FPS antes/después en la sala más poblada.
   La cera debe seguir siendo **1** draw call.
