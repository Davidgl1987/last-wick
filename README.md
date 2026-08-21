# Last Wick

*«La última mecha»*

https://davidgl1987.github.io/last-wick/

Roguelite de tirachinas por salas, **móvil primero** (navegador). Lanzas al héroe como una bola de billar: apuntas arrastrando, sueltas, rebotas por la sala y embistes enemigos con la propia velocidad. Limpia cada sala, elige una mejora, encuentra la llave, abre la puerta del jefe y termina la run.

- **Diseño del juego:** [docs/GDD.md](docs/GDD.md)
- **Arquitectura técnica:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Cómo se juega

1. **Apunta** tocando (o clicando) en cualquier parte del tablero y arrastra hacia atrás, como un tirachinas: la línea de puntos muestra dirección y fuerza.
2. **Suelta** para disparar el modo de arma activo:
   - **Cuerpo (azul):** te lanzas tú; a partir de ~2.5 u/s de impacto la embestida daña (más velocidad, más daño).
   - **Flecha (amarilla):** proyectil rápido que atraviesa 1 enemigo.
   - **Hechizo (violeta):** más daño, rebota 1 vez en las paredes.
3. Cambia de arma con los **3 botones inferiores** (cada uno con su barra de recarga).
4. Limpia la sala (todos los enemigos muertos) → elige **1 de 3 mejoras** → sigue por las puertas.
5. La **llave** (sala custodiada) abre la puerta dorada del **jefe**. Derrótalo y sigue a la siguiente mazmorra (o gana la run si era el último).

### Los 4 jefes

Una run entera encadena **una mazmorra por cada jefe**, en **orden fijo de dificultad creciente** (mazmorras aleatorias entre uno y otro; ver [GDD §15](docs/GDD.md)):

1. **Guardián de Canto** — el jefe de embestida: patrulla, telegrafía, carga en línea recta y queda aturdido al chocar contra roca/pared (su ventana). Examina rebote y embestida, el pilar más antiguo del juego.
2. **Reina del Enjambre** — el jefe de control de espacio: invoca oleadas de larvas y deja un rastro grande que ensucia la sala; su vida real vive en las columnas destructibles de su arena, no en su cuerpo. Examina gestionar el terreno bajo presión, no solo esquivar.
3. **El Prisma** — el jefe de las 3 armas: escudo de color rotatorio (azul/amarillo/violeta) donde solo el arma del color activo hace daño de verdad. Examina dominar y alternar cuerpo/flecha/hechizo.
4. **La Tormenta** — el jefe de esquive puro (bullet hell): tres patrones de balas (espiral, anillos, ráfaga radial) con pasillo siempre garantizado; cualquier arma le hace daño, el examen es sobrevivir. El más difícil, por eso cierra la run.

Cuidado con los hazards: fosos (casi negros, con reborde de piedra), pinchos y **barriles explosivos** (la herramienta táctica estrella: embiste uno rodeado de enemigos). Cada enemigo tiene color y silueta propios; el botón de **pausa** (arriba a la derecha) muestra la leyenda completa y tus mejoras acumuladas.

Funciona igual con ratón en escritorio (Pointer Events unificados).

## Ejecutar

```bash
npm install
npm run dev        # dev server (Vite), se abre en la red local con --host
```

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con HMR |
| `npm run build` | Typecheck (`tsc -b`) + build de producción en `dist/` |
| `npm run preview` | Sirve la build de producción en local |
| `npm test` | Tests headless de la simulación (vitest) |
| `npm run typecheck` | Solo comprobación de tipos |

## Editor de niveles

En **`#/editor`** (enlace "✎ Editor" dentro del juego) vive el editor visual de salas:

- Rejilla 1×1 con snap; coloca/arrastra/duplica el inicio, los 5 enemigos, los 4 hazards y los 3 objetos.
- Propiedades por entidad (HP, radio, tamaño, dirección de púa) y **destino de patrulla arrastrable** en el lienzo.
- Huecos de puerta por lado (máx. 2), validaciones en vivo y autoguardado del borrador.
- **▶ Probar**: playtest inmediato de la sala y vuelta al editor.
- **Exportar/Importar** la sala como JSON; las salas exportadas entran al pool del generador procedural. En dev, "Guardar en src/levels" escribe el fichero directamente en el repo.

## Idiomas

El juego está en **español e inglés**; se cambia con el desplegable de la esquina superior derecha de la pantalla de título, o desde el modal de pausa. La elección se guarda en `localStorage`; la primera vez se deduce del idioma del navegador (`es*` → español, resto → inglés).

Todo el texto vive en `src/i18n/locales/<código>.json` — nombres de mejoras, jefes y salas incluidos. **Añadir un idioma es añadir un fichero**:

1. Copia `src/i18n/locales/es.json` a `src/i18n/locales/<código>.json` (p. ej. `fr.json`; el nombre del fichero ES el código de idioma).
2. Traduce los valores. Deja intactos los marcadores `{hp}`, `{coins}`, `{n}`… y pon en `$meta.name` el nombre del idioma *en ese idioma* ("Français"), que es lo que se lee en el desplegable.
3. Ya está: el registro es automático por glob y la opción aparece sola en los dos selectores.

`npm test` comprueba que todos los idiomas tienen exactamente las mismas claves y marcadores que `es.json` (el idioma base y el fallback cuando a una traducción le falta algo), que ninguna sala del pool se queda sin nombre, y que no se ha colado ningún literal suelto en la UI.

El **editor de niveles está solo en español** a propósito: es herramienta interna. Las salas que crees ahí no tienen clave de traducción, así que en el juego se muestran con el `name` que les pongas.

## Depuración

Parámetros de URL, combinables entre sí (herramientas de playtest):

- **`?seed=N`** fuerza la semilla de la mazmorra (misma run reproducible, también tras reiniciar). Ej.: `http://localhost:5173/?seed=42`.
- **`?boss=<id|alias>`** salta directo a la arena de un jefe suelto, en modo sala única, sin recorrer la mazmorra: `guardian`/`queen`/`prisma`/`storm` (o los alias cortos `b1`/`b2`/`b3`/`b4`; `b0`/`test` solo en dev, el jefe de pruebas del framework).
- **`?phase=2|3`** (solo junto a `?boss=`) fuerza la fase inicial del jefe forzado, para probar su comportamiento de fase 2/3 sin tener que bajarle la vida a mano.
- **`?godmode`** (presencia = activo, sin valor) activa el modo dios de playtest: el daño se aplica normal (hp baja, vignette, knockback) pero al llegar a 0 hp el héroe revive a vida máxima en vez de game-over — para ver cuánto quita cada ataque en una run completa (los 4 jefes seguidos). Un badge "GOD" junto a los corazones marca que la run es de testeo. Combina con `?seed=N` (run completa) y `?boss=<id>` (arena de jefe suelta).
- **`?upgrades=id:nivel,...`** fuerza niveles de mejora al crear la sesión (ej. `?upgrades=cuerpo-dano:3,escudo:2`), para verificar su feedback visual sin tener que jugar hasta conseguirlas.
- En dev, `window.__lastwick` expone la sesión y helpers (`tick(segundos)`, `frame(dt)`) para avanzar la sim desde la consola, incluso con el tab oculto.

## Arquitectura en una línea

Simulación 2D propia, pura y determinista a 60 Hz (`src/game/sim/`, sin React ni three.js, testeada con vitest) + render "tonto" con React Three Fiber que la lee e interpola (`src/game/render/`), juice por cola de eventos (`src/game/juice/`) y HUD en DOM (`src/game/ui/`). Detalles y presupuesto de rendimiento en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
