# Assets 3D — KayKit Dungeon Asset Pack 1.1

Origen: [KayKit — Dungeon Asset Pack](https://kaylousberg.com) de Kay Lousberg
(CC0, ver `LICENSE-kaykit.txt` en este mismo directorio). Plan de integración:
`docs/plans/ART_KIT_PLAN.md`.

Están los **283 modelos del pack en glTF** (8.8 MB), no solo los que el juego
usa hoy — decisión de David (2026-08-05): *"deja el kit entero en public, y ya
veremos qué usamos"*. Del pack original (40 MB) se descartan los formatos fbx y
obj, que three.js no necesita. Cada `.gltf` viene con su `.bin` hermano, sin
modificar.

**Tener un modelo en esta carpeta NO significa que el juego lo cargue.** La
lista de lo que se precarga es `KIT_MODELS` en
`src/game/render/kit-models.ts`; precargar los 283 costaría los 8.8 MB enteros
en el arranque, y el GDD §14 pide entrar a jugar en segundos. Para probar una
pieza nueva basta con añadir su nombre a esa lista — ya está en disco, no hay
que volver al zip original.

## Los dos ficheros que no son del pack tal cual

- **`dungeon_texture.png` es `alt_texture_5_NightA.png` renombrada.** Los 283
  modelos comparten un único atlas de paleta (degradados planos: el detalle vive
  en la geometría, no en la textura) y todos lo referencian por la misma URI
  relativa `dungeon_texture.png`. Por eso una sola copia sirve para los 46
  modelos, y por eso renombrar la variante nocturna del propio pack **recolorea
  el kit entero** a azules fríos, casi calcados a los `#3b4266` / `#464b67` del
  estilo oscuro del juego. Ese es todo el trabajo de paleta que hay: no se ha
  editado ni un píxel.
- Este README.

## Qué carga el juego hoy

| Familia | Modelos | Uso |
| --- | --- | --- |
| Perímetro | `barrier`, `barrier_half`, `barrier_corner`, `barrier_column` | Muros de sala (parapeto bajo, ver §2 del plan: el muro completo de 4 u taparía al héroe) |
| Verticales | `column`, `pillar` | Postes de esquina y junto a puertas |
| Suelo | `floor_tile_large`, `floor_tile_small`, `floor_tile_small_broken_A/B`, `floor_tile_small_weeds_A/B`, `floor_tile_large_rocks` | Baldosas instanciadas + variantes salpicadas |
| Puertas | `floor_tile_grate`, `wall_gated`, `wall_doorway` | Portón cerrado (reja) y marco del hueco |
| Hazards | `floor_tile_big_spikes`, `floor_foundation_front/corner` | Campo de pinchos, reborde de foso |
| Rocas | `rocks`, `rocks_small`, `rocks_decorated`, `rubble_half` | Obstáculos y escombros de las columnas de la Reina |
| Barriles/cajas | `barrel_small`, `barrel_large`, `barrel_large_decorated`, `keg`, `crate_small`, `crate_large`, `box_small` | Barriles explosivos (hazard y Guardián) y atrezzo |
| Objetos | `coin`, `coin_stack_small`, `key_gold`, `bottle_A_labeled_green` | Monedas, llave, poción |
| Luz | `torch_mounted`, `candle_triple` | Cera de las antorchas (la llama y el `GlowPuddle` siguen siendo propios) |
| Tienda y atrezzo | `bartop_A_medium`, `shelves_decorated`, `chest_gold`, `table_medium`, `stool`, `bench`, `bookcase_single_decoratedA`, `banner_red`, `banner_blue`, `sword_shield` | Puesto del tendero y decoración de salas |

Todo lo demás del pack (el resto de muros, suelos, escaleras, mobiliario,
estandartes...) está en disco sin registrar, a la espera de decidir qué se usa.

El pack **no incluye personajes**: enemigos y jefes siguen siendo geometría
propia de `src/game/render/assets.ts`.
