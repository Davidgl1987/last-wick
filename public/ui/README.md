# Assets de interfaz — Kenney Fantasy UI Borders

Origen: [Kenney — Fantasy UI Borders](https://kenney.nl) (CC0, ver `LICENSE-kenney.txt`
en este mismo directorio).

Está el **pack completo** en PNG (el único formato que traemos; el original
incluye además un SVG con todo el spritesheet, que no se usa), organizado como
lo publica Kenney:

```
default/  border/ · panel/ · transparent-border/ · transparent-center/ · divider/ · divider-fade/
double/   (las mismas familias, con trazo doble)
```

Son 280 ficheros y 52 KB en total, así que se guarda entero a propósito: elegir
otro marco es cambiar una URL, sin volver a tocar el pack original. Ojo al
elegir: **`border/` es la familia con el centro 100% transparente**, la única
apta para enmarcar un elemento que pone su propio fondo. `transparent-center/`
tiene el interior a blanco al 50% de alfa (se estira por el borde y lo ensucia)
y `panel/` lo tiene relleno opaco.

Los ficheros están **sin modificar** respecto al pack
original: mismo contenido, mismo nombre de fichero. El pack viene en blanco
puro con el centro 100% transparente, pensado para 9-slice (slice de 16px
sobre un lienzo de 48x48). El color NO se hornea en el PNG: lo aplica CSS en
tiempo de ejecución mediante el primitivo `src/ui/frame.css` (componente
`Frame`, kit de UI en `src/ui/`), que usa cada marco como máscara
(`mask-border`/`-webkit-mask-box-image`, con `border-image` como *fallback*
en Firefox) rellenada con la variable `--ui-frame-color`. Así un mismo asset
sirve para cualquier tinte sin duplicar PNGs por color.

## Qué usa la UI hoy

| Fichero | Variante de `Frame` | Uso |
| --- | --- | --- |
| `default/border/panel-border-029.png` | `ornate` | Greca elegante — botón primario (Jugar, Continuar, Reintentar...) |
| `default/border/panel-border-009.png` | `plain` | Marco sobrio, esquinas con cuadrito — botones secundarios y de icono (Editor, Créditos, pausa, selector de armas) |
| `default/border/panel-border-026.png` | `rich` | Greca doble rica — panel de todos los modales |
| `default/border/panel-border-021.png` | `inset` | Greca hacia dentro — marco decorativo ambiental de la pantalla de título |
| `default/divider-fade/divider-fade-003.png` | (componente `Divider`) | Divisor de 96x22 bajo el título (ornamento en el extremo derecho, desvanecido hacia la izquierda) |
