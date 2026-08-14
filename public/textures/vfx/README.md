# Texturas de VFX — Kenney Light Masks + Splat Pack

Origen: [Kenney — Light Masks](https://kenney.nl/assets/light-masks) (1.0, 152
PNG en la carpeta `Default/` del zip) y [Kenney — Splat Pack](https://kenney.nl/assets/splat-pack)
(36 PNG en `PNG/Default (256px)/`). Ambos CC0 (ver `LICENSE-kenney.txt` en
este mismo directorio: es el texto literal del pack de Light Masks: el Splat
Pack trae su propia `License.txt` dentro del zip, pero es el mismo CC0
palabra por palabra — mismo autor, mismo boilerplate — así que no se
duplica). Plan de integración: `docs/plans/VFX_PLAN.md`.

De los 188 ficheros de ambos packs entran **16** (8 Light Masks + 8 Splats),
elegidos en el plan mirando los contactos de cada uno. Los nombres son
literales del zip, conservados tal cual para trazabilidad con el pack
original. Las Light Masks se reescalaron de 512² a 256² con
`sips -z 256 256` (son manchas difusas: 256 sobra de resolución y ahorra
~la mitad de peso); los Splats ya venían a 256² y no se han tocado.

## Regla de blending — CRÍTICA, leer antes de usar un fichero nuevo de aquí

El canal alfa de las Light Masks es **inconsistente dentro del propio pack**:
`circle_c`, `circle_rings_a`, `shape_*` y `cone_composed_a` son RGB **sin
alfa**; solo algunos ficheros del pack completo (no todos los que están aquí)
traen RGBA fiable.

> **Toda Light Mask se usa SIEMPRE con `blending: THREE.AdditiveBlending`**
> (nunca blending normal): el aditivo trata el negro como transparente por
> definición, así que el alfa (fiable o no) es irrelevante. Usar una Light
> Mask con blending normal pinta un **cuadrado negro** en pantalla.
>
> **Todo Splat se usa SIEMPRE con blending NORMAL** (`transparent: true`):
> ahí el alfa sí es fiable y uniforme (blanco puro recortado por alfa).

En código, esta regla la hace cumplir `src/game/render/vfx-textures.ts`: sus
dos helpers de material están tipados para que un nombre de Light Mask no
pueda pasarse al helper de Splats ni viceversa.

## Qué usa (o usará) cada archivo en el juego

| Fichero | Tipo | Destino en el juego | Estado |
| --- | --- | --- | --- |
| `circle_c.png` | Light Mask | Halo de luz falsa (`glowHaloTexture`, `render/assets.ts`) — proyectiles, enemigos, antorchas, `GlowPuddle` | **Integrado (T0)** |
| `circle_rings_a.png` | Light Mask | Fogonazo de explosión | Pendiente (T3) |
| `ring_a.png` | Light Mask | Onda expansiva | Pendiente (T2) |
| `shape_e.png` | Light Mask | Destello de impacto normal | Pendiente (T3) |
| `shape_g.png` | Light Mask | Destello de impacto fuerte | Reservado en §2 del plan, sin tarea numerada asignada todavía |
| `shape_c.png` | Light Mask | Humo | Pendiente (T6) |
| `window_i_blur.png` | Light Mask | Cookie de ventana (luz de tormenta) | Pendiente (T5) |
| `cone_composed_a.png` | Light Mask | Haz de antorcha | Reservado en §2 del plan ("fase 3"), sin tarea numerada asignada todavía |
| `splat00.png` / `splat05.png` / `splat08.png` / `splat12.png` | Splat | Cera del rastro (los 4 más redondeados: gota caída, no salpicadura violenta) | Pendiente (T1) |
| `splat02.png` / `splat20.png` / `splat26.png` / `splat34.png` | Splat | Hollín e impactos (con pinchos/gotas satélite: proyección, no goteo) | Pendiente (T4) |

Todo lo demás de ambos packs (144 Light Masks + 28 Splats) se queda sin
copiar: no hay pieza del plan que lo necesite hoy. Si hace falta un fichero
nuevo de cualquiera de los dos packs, se copia igual que estos — nombre del
zip sin modificar, misma carpeta.
