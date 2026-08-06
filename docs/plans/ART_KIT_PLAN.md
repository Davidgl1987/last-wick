# Plan de arte: sustituir los placeholders por el KayKit Dungeon Pack

*Escrito 2026-08-05. Sustituye la geometría primitiva del escenario, los props
y los objetos por el kit modular de KayKit (Dungeon Asset Pack 1.1, CC0). No
toca la simulación: todo lo de aquí es capa de render.*

---

## 1. Qué hay en el pack (y qué no)

- **283 modelos glTF** (también fbx/obj, que ignoramos) con **un único material
  y un único atlas de 1024²** compartido por todos. El atlas es una **paleta de
  degradados planos**, no una textura de detalle: el detalle vive en la
  geometría. Consecuencia directa — *un solo material para todo el kit*, así que
  instancing y merge salen gratis.
- Modelos de bajo coste: muro 494 tris, parapeto `barrier` 90, baldosa grande
  188, roca 146, barril pequeño 207, moneda 80.
- El pack incluye **variantes de paleta ya hechas**: usamos
  `alt_texture_5_NightA.png` — azules fríos monocromos, prácticamente calcados a
  los `#3b4266` / `#464b67` actuales. El estilo oscuro sobrevive intacto sin
  tocar un solo color del juego.
- **NO trae personajes.** Ni héroe, ni enemigos, ni jefes, ni NPCs. Toda la
  geometría de personajes (bola, 5 arquetipos, 4 jefes, tendero) sigue siendo
  propia. El tendero se resuelve con atrezzo (§5, F5), no con una figura.

Licencia CC0: uso libre, atribución no obligatoria pero se hace igualmente
(`public/models/kaykit/LICENSE-kaykit.txt` + crédito a Kay Lousberg en
`CreditsModal`, como ya se hace con Kenney en `public/ui/`).

---

## 2. Escala: una sola constante para toda la arquitectura

El kit está construido sobre múltiplos de 4 unidades Blender (muro 4×4×1,
baldosa grande 4×4, pequeña 2×2, parapeto `barrier` 4×1.1×0.5).

**`KIT_SCALE = WALL_THICKNESS / 0.5 = 0.84`** — se deriva del grosor de muro
para que el volumen visible coincida *exactamente* con el AABB de colisión, y de
ahí sale todo lo demás sin distorsión:

| Pieza | Tamaño kit | A escala 0.84 | Encaje con el juego |
|---|---|---|---|
| `barrier` (parapeto) | 4 × 1.1 × 0.5 | 3.36 × 0.92 × **0.42** | grosor = `WALL_THICKNESS` exacto; altura ≈ `WALL_HEIGHT` (0.9 → 0.92) |
| `floor_tile_large` | 4 × 4 | 3.36 × 3.36 | 4 baldosas cubren una sala de 13 u (estirado −3 %) |
| `floor_tile_small` | 2 × 2 | 1.68 × 1.68 | relleno de bordes y decoración |
| `column` | 0.7 × 1.4 | 0.59 × 1.18 | poste de esquina, solo 0.26 u más alto que el muro |

Escala **uniforme**: nada se achata, y el kit queda internamente coherente
(los sillares del muro y los de la baldosa miden lo mismo).

Los props que tienen tamaño de juego propio (barril, roca, moneda, poción,
llave) **no** usan `KIT_SCALE`: cada uno se escala a su AABB / radio de recogida
actual, como hoy.

### Muros: parapeto → muro completo

> **SUPERADO en playtest (2026-08-06).** Lo que sigue es el razonamiento
> original, que llevó al parapeto. David prefirió después el muro completo, y
> la oclusión que este apartado predice se cumplió exactamente — se resolvió con
> siluetas de oclusión, no bajando el muro. Ver §7. Se conserva el texto porque
> la aritmética de oclusión sigue siendo la buena y es la que hay que rehacer
> ante cualquier cambio de altura o de cámara.

Decisión tomada (David me la delegó): **`barrier` a altura 0.92 u**, no el muro
de 4 u.

El motivo es de cámara, no de gusto. `CAMERA_OFFSET = (0, 9.5, 6.2)` da una
pendiente de 0.65: **un muro de altura H tapa 0.65·H unidades por detrás**. Hoy,
con muros de 0.9 u, se ocultan 0.58 u — un valor ya validado en playtest. Con el
muro completo del kit (2.0 u a escala 0.5) se ocultarían **1.3 u**: el héroe
pegado al muro sur desaparecería de pantalla. Eso obliga a fundir los muros
cercanos a cámara, que es trabajo extra para *regresar* en legibilidad — justo lo
que el GDD §14 pone por encima de todo.

El `barrier` es además una pieza *diseñada* para verse a esa altura (remate
superior y postes con proporciones correctas), a diferencia de un muro de 4 u
achatado, y cuesta **90 tris frente a 494**. La verticalidad se recupera con
`column` en las esquinas y junto a las puertas, que solo añade 0.17 u de
oclusión.

Los AABB de muro tienen longitudes fraccionarias (las puertas de 2.0 u recortan
el lado), así que se resuelven con un helper puro y testeable:
`N = max(1, round(len / 3.36))` módulos, cada uno con escala X = `len / N`.
Desviación máxima ±15 % en segmentos cortos, imperceptible en un sillar.

---

## 3. Pipeline de assets

Elegido: **`.gltf` sueltos en `public/`** (sin tooling ni dependencias nuevas).

```
public/models/kaykit/
  dungeon_texture.png     ← alt_texture_5_NightA.png renombrada
  wall.gltf + wall.bin
  … (~40 modelos)
  LICENSE-kaykit.txt
```

Los `.gltf` referencian la textura por URI relativa `dungeon_texture.png`, y
**todos usan el mismo nombre**, así que una única copia en la carpeta sirve para
los 40. Renombrar la variante NightA es todo el "recoloreado" que hace falta.

Dos detalles que hay que hacer bien o se nota:

1. **Ruta base.** `vite.config.ts` usa `base: './'` para GitHub Pages. Las URLs
   se construyen con `import.meta.env.BASE_URL + 'models/kaykit/…'`, nunca con
   una ruta absoluta.
2. **Material y textura compartidos.** Cargar N ficheros crea N materiales y N
   copias de la textura en GPU. La capa de kit (F1) **reasigna** a todas las
   mallas un único `MeshLambertMaterial` con una única `Texture` — respeta la
   política de "materiales creados una vez" de `assets.ts`, mantiene el
   presupuesto de 7 luces (nada de PBR) y deja el kit en 1 material / 1 textura.

La textura se sirve tal cual (17 KB); si el perfilado de F6 lo pide, se baja a
256² sin pérdida visible (son degradados).

---

## 4. Mapa de sustituciones

| Hoy (placeholder) | Fichero | Modelo KayKit |
|---|---|---|
| Suelo: plano liso | `RoomView.tsx` | `floor_tile_large` instanciada + `floor_tile_small_broken_A/B`, `_weeds_A/B`, `floor_tile_large_rocks` salpicadas |
| Muros: cajas instanciadas | `RoomView.tsx` | ~~`barrier`~~ → **`wall`** completo + `column` en esquinas (§7) |
| Portón cerrado (caja azul/dorada) | `RoomView.tsx` | ~~`floor_tile_grate`~~ → **`wall_doorway`**, nodo de la HOJA (§7) |
| Hueco de puerta | `RoomView.tsx` | `wall_doorway`, nodo del MARCO (siempre visible) |
| Rocas: cajas grises | `RoomView.tsx` | `rocks`, `rocks_small`, `rocks_decorated`, `rubble_half` |
| Columnas de la Reina (3 estados) | `QueenColumnsView.tsx` | `column` intacta → `column` + grieta → `rubble_half` de escombros |
| Barril explosivo | `HazardView.tsx` | `barrel_small` / `barrel_large`; `keg` como variante |
| Barriles del Guardián | `guardian/barrels.ts` | `barrel_large_decorated` |
| Campo de pinchos (conos) | `HazardView.tsx` | `floor_tile_big_spikes` en sus 2 nodos: losa fija + púas retráctiles (§7) |
| Foso (quad negro) | `HazardView.tsx` | **se mantiene** el quad negro (legibilidad, GDD §14) + reborde `floor_foundation_front/corner` |
| Barro / acelerador / charco | `HazardView.tsx`, `PuddleView.tsx` | **se mantienen** (quads emisivos, no hay equivalente) |
| Moneda (cilindro + canto) | `ItemView.tsx` | `coin`; `coin_stack_small` para montones grandes |
| Poción (esfera + cuello + tapón) | `ItemView.tsx` | `bottle_C_green` (el más ancho), paleta cálida sin tinte |
| Llave | `ItemView.tsx` | `key_gold` |
| Antorcha de muro (cera + llama) | `TorchView.tsx` | `torch_mounted`; la llama emisiva y el `GlowPuddle` **se mantienen** |
| Tendero (cono + esfera) | `ItemView.tsx` | puesto: `bartop_A_medium` + `shelves_decorated` + `chest_gold`; sin figura |
| — (salas vacías) | nuevo | atrezzo: `table_medium`, `stool`, `bench`, `crate_small`, `bookcase_single_decoratedA`, `banner_*`, `candle_triple`, `sword_shield` |

Héroe, 5 enemigos, 4 jefes, proyectiles, partículas, estelas, cera y ondas de
choque: **sin cambios**. El pack no los cubre.

---

## 5. Fases

Cada fase es un entregable jugable y verificable por separado. Se delegan a
sub-agentes sonnet (CLAUDE.md); F2 es la única candidata a opus si la geometría
de muros se resiste.

**F0 · Assets al repo.** Extraer los ~40 modelos elegidos + sus `.bin` a
`public/models/kaykit/`, con la NightA renombrada y la licencia. Sin código.
*Aceptación:* los ficheros están y `npm run build` sigue verde.

**F1 · Capa de kit.** `src/game/render/kit.ts`: carga bajo demanda vía
`GLTFLoader`, caché por nombre, material/textura únicos compartidos, y
`kitGeometry(name)` devolviendo la `BufferGeometry` ya centrada y escalada a
unidades de juego. Precarga en la pantalla de título (el GDD pide arranque
rápido: nada de tirones al empezar la run).
*Aceptación:* un test de humo monta una malla del kit; en escena, 1 material y
1 textura para todo el kit.

**F2 · Arquitectura.** `RoomView.tsx`: suelos, muros, postes de esquina,
portones y marcos de puerta. Un `InstancedMesh` por tipo de pieza **agrupado por
sala** (hoy se dibuja la mazmorra entera de golpe: agrupar devuelve el frustum
culling, que con un instanced global sería todo-o-nada). Helper puro
`wallModuleLayout(len)` con sus tests unitarios.
*Aceptación:* mazmorra completa con el kit, sombras correctas, sin regresión de
FPS y sin que el héroe se pierda tras un muro en ninguna esquina.

**F3 · Props de escenario.** Rocas, columnas de la Reina en sus 3 estados,
barriles (hazard y Guardián), campo de pinchos, reborde de foso.
*Aceptación:* los 3 estados de columna se distinguen de un vistazo (requisito de
playtest 2026-07-10) y el foso sigue leyéndose como agujero.

**F4 · Objetos y luz.** Moneda, poción, llave, antorcha de muro. La antorcha
conserva llama, parpadeo y `GlowPuddle`: solo cambia la geometría de la cera.
*Aceptación:* el presupuesto de luces sigue en 7 + 1 sombra.

**F5 · Tienda y atrezzo.** Puesto del tendero y decoración repartida por las
salas (contenido nuevo, no sustitución). El atrezzo es **visual puro, sin
colisión** — mismo criterio que `TorchPropsView`: la sim no lo conoce. Colocado
por sala desde el JSON de nivel o por siembra determinista con la semilla de la
run, para que el editor y los tests sigan siendo reproducibles.
*Aceptación:* ninguna pieza de atrezzo cae dentro de una trayectoria jugable ni
tapa un hazard.

**F6 · Créditos y perfilado.** Crédito a KayKit en `CreditsModal` y pasada de
FPS en móvil real con el contador que ya existe.

**La limpieza de `assets.ts` queda CANCELADA** (David, 2026-08-06: "no quiero
que se borren assets de momento porque hay bastantes que cambiaría"). Las
geometrías y materiales que hoy no usa nadie se quedan donde están: son
material de trabajo para las siguientes rondas de arte, no código muerto.
*Aceptación:* 60 fps estables en gama media (GDD §14, innegociable).

---

## 6. Presupuesto de rendimiento

Mazmorra de 6 salas de ~13 u, geometría estática:

| Capa | Por sala | Total (6 salas) |
|---|---|---|
| Suelo (16 baldosas grandes × 188) | 3.0 k tris | 18 k |
| Perímetro (16 módulos `barrier` × 90) | 1.4 k tris | 8.6 k |
| Postes, portones, marcos | ~0.6 k tris | 3.6 k |
| **Total estático** | **~5 k tris** | **~30 k tris** |

En 3-4 draw calls (uno por tipo de pieza y sala, con el mismo material). Muy por
debajo de lo que mueve un móvil de gama media a 60 fps, y del orden de lo que ya
cuesta hoy. El muro completo habría multiplicado esa cifra por cuatro: otra
razón para el parapeto.

---

## 7. Decisiones resueltas al ejecutar

*Se apuntan aquí, y no solo en el código, porque son las que el plan dejaba
abiertas — y porque en dos de las tres el playtest contradijo lo previsto.*

**Portón de puerta: `wall_gated`, no `floor_tile_grate`** (playtest de David,
2026-08-05). La rejilla se veía desde un lado y desaparecía desde el otro,
dejando solo las sombras de los barrotes en el suelo. La causa está en el
modelo: `floor_tile_grate` es una rejilla de SUELO y reparte su superficie de
forma muy asimétrica — 8.28 de área en la cara Y+ contra 1.32 en Y-. Puesta de
canto, la cara casi vacía es justo la que ve el jugador desde el otro lado del
muro. `wall_gated` es pieza de muro y está modelada simétrica (12.74 contra
12.68): se lee igual por las dos caras. Va a 1.7 u de alto, no a su altura
natural de 3.36 (taparía ~2.2 u de sala, el mismo problema de oclusión que
descartó los muros completos en §2).

**Lección transferible a las fases que quedan:** antes de dar por buena una
pieza del kit para un uso distinto de aquel para el que se modeló, mírale el
reparto de área por orientación. Una pieza pensada para verse desde arriba no
sirve de pieza vertical, por muy bien que encaje de tamaño.

**Suelo a media baldosa (`FLOOR_TILE_SCALE = 0.5`).** El kit está modelado
para un personaje humano de pie: su baldosa "grande" mide 3.36 u, SIETE veces
el diámetro del héroe (0.48 u), y la sala se leía como un pavimento gigantesco
con un bicho encima. A la mitad, cada baldosa es ~3.5 veces la bola, que es lo
que se lee bien desde la cámara cenital. Se estira la misma pieza en vez de
usar `floor_tile_small` porque la pequeña es una losa lisa y perdería el
relieve octogonal.

**Tinte global del kit (`KIT_TINT` en `kit.ts`).** La paleta NightA acertó en
el tono (azul frío) pero no en el nivel: su piedra es mucho más clara que el
`#464b67` que el juego tenía validado, y con la vela encima el suelo salía casi
blanco. Un gris neutro multiplicador lo devuelve a su sitio. Ojo al tocarlo:
three multiplica en espacio LINEAL, así que `#9a9a9a` (0.60 en sRGB) equivale a
multiplicar por ~0.32 la luz reflejada, no por 0.60.

### Segunda ronda de playtest (2026-08-06)

**Muro completo en vez de parapeto, y su consecuencia.** David eligió el muro
(`wall`, 3.36 u) sobre el parapeto: "me gusta más la opción del muro más que la
que has puesto con huecos". La oclusión que §2 anticipaba se cumplió al pie de
la letra — en la arena del Guardián el héroe desaparecía de pantalla por
completo. NO se resolvió bajando el muro, sino con **siluetas de oclusión**
(`render/occlusion-silhouette.ts`), idea de David: una copia de la malla con
`depthFunc = GreaterDepth` se ve exactamente donde el personaje está tapado, sin
postproceso ni stencil ni saber qué tapa a quién.

*Límite conocido y aceptado:* la silueta devuelve al personaje, no al SUELO. La
franja de sala detrás del muro sur —con sus monedas, hazards y proyectiles—
sigue oculta. Si molesta en playtest, bajar ESE lado a parapeto sigue siendo un
cambio de constante.

**Puerta con hoja.** `wall_doorway` trae marco y hoja como nodos separados, así
que el marco se pinta siempre y la hoja solo cuando la puerta está cerrada. Es
la misma API (`kitGeometryPart`) que hizo falta para los pinchos retráctiles.

**Variedad por sala.** Suelo, muro y puerta se eligen por hash del id de sala,
salado por categoría para que las tres elecciones no queden correlacionadas.

**Pinchos retráctiles.** La losa con agujeros se ve siempre (es la pista que
hace justa la trampa) y las púas asoman solo cuando algo pisa el área. Dos
fallos que costaron una ronda extra, ambos instructivos: la losa se alineaba
por su BASE mientras el suelo se alinea por su CARA SUPERIOR (flotaba 0.17 u), y
losa y púas se tileaban en rejillas distintas, así que la placa enseñaba 25
agujeros y asomaban 4 púas — el disparo se perdía como ruido. Son los dos nodos
del MISMO modelo: tileados igual, cada púa sale por su agujero.

**Regla de material, ya con tres casos.** `kitMaterial` (NightA azul) para la
piedra; `kitWarmMaterial` (atlas original) para madera y metal — barriles,
puertas, púas, puesto del tendero, moneda y poción; y material PLANO propio
solo donde el color es información pura y el atlas no lo tiene (la llave). El
error recurrente de toda la integración fue pintar de azul algo que no era
piedra y verlo desaparecer contra el muro.

**Pendiente:** el marco de hueco de puerta quedó cubierto por `wall_doorway`,
pero la limpieza de `assets.ts` (F6) queda EXPRESAMENTE cancelada por decisión
de David (2026-08-06): "no quiero que se borren assets de momento porque hay
bastantes que cambiaría".

## 8. Riesgos

1. **La paleta NightA no pega con los halos aditivos.** Los charcos de luz y las
   partículas están calibrados sobre los colores actuales. Mitigación: F2 se
   evalúa en la sala de un jefe (la más iluminada) antes de seguir; si hace
   falta, se retoca la opacidad de `glowPuddleMaterial`, no los modelos.
2. **Densidad visual = ruido.** El kit tiene mucho más detalle geométrico que
   una caja lisa, y el GDD §14 pone la legibilidad por encima de todo.
   Mitigación: el atrezzo (F5) es la última fase precisamente para poder cortarla
   entera si el juego se vuelve ilegible.
3. **Salto en el arranque.** 40 ficheros a la vez pueden retrasar la primera
   run. Mitigación: precarga en la pantalla de título (F1) y, si no basta,
   empaquetar en un `.glb` fusionado — el cambio quedaría contenido en `kit.ts`.
4. **Sombras.** Las mallas del kit necesitan `castShadow`/`receiveShadow`
   explícitos; olvidarlo reabre la fuga de luz que ya se cazó una vez en los
   portones (ver comentario en `RoomView.tsx::DoorGates`).
