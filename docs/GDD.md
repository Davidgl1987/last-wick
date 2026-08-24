# LAST WICK — Game Design Document

*Slingshot dungeon crawler para móvil (navegador). Este documento describe **cómo se juega**: es la única fuente de verdad de diseño para cualquier implementación. No contiene decisiones técnicas.*

---

## 1. Visión

Eres una bola héroe en una mazmorra vista desde arriba. No caminas: **te lanzas** con un tirachinas, como una carambola de billar. Cada lanzamiento es una decisión: la trayectoria, los rebotes contra las paredes, los enemigos que arrollarás a tu paso y los fosos que debes esquivar. Runs cortas (5–10 min), controles de un dedo, sensación física satisfactoria.

**Pilares de diseño:**

1. **Un dedo, todo el juego.** Arrastrar y soltar es la única interacción de juego. Todo lo demás son botones grandes.
2. **La física es el combate.** El daño nace de la velocidad; los rebotes son herramienta, no castigo.
3. **Cada sala es un puzzle de billar.** Leer la sala (enemigos, fosos, obstáculos) antes de tirar es el juego.
4. **Juice constante.** Cada impacto, muerte y rebote se siente: sacudida, partículas, flash, pausa de impacto.
5. **Contenido editable.** Las salas se crean en un editor visual y se combinan proceduralmente en mazmorras.

**Sesión objetivo:** una run encadena varias mazmorras de ~6 salas cada una (una por cada jefe del pool, en orden fijo de dificultad creciente — la mazmorra en sí es aleatoria; ver §10.2), muerte permanente, mejoras ganadas al derrotar jefes y compradas en tienda, jefe final de la run da la victoria.

---

## 2. Loop de juego

```
Apuntar (arrastrar) → Soltar (lanzarse/disparar) → Resolver física (rebotes, impactos, daño)
→ Repetir hasta limpiar la sala (abre puertas, sin elección de mejora) → Cruzar puerta a la siguiente sala
→ ... → (opcional: visitar la sala de tienda para comprar mejoras con las monedas recogidas)
→ Sala del jefe → jefe NO final: elige 1 de hasta 3 mejoras gratis → siguiente mazmorra (nuevo mapa, progreso conservado)
→ ... → jefe final → Victoria (o muerte en cualquier punto → Game Over → nueva run)
```

No hay turnos: el mundo es en tiempo real. Los enemigos se mueven siempre, también mientras apuntas. Apuntar no pausa ni ralentiza el juego (y al menos un enemigo se vuelve *más* agresivo cuando te ve apuntar).

---

## 3. Controles

- **Apuntar:** arrastra desde cualquier punto de la pantalla (no hace falta tocar al personaje). El vector de tiro es el arrastre invertido, estilo tirachinas/Angry Birds: arrastras hacia atrás, sales disparado hacia delante.
- **Fuerza:** proporcional a la longitud del arrastre, con un tope máximo (~2.8 unidades de arrastre = fuerza 100%). Un arrastre demasiado corto (<8% del máximo) se cancela con aviso, para evitar tiros accidentales.
- **Indicador de puntería:** mientras arrastras se ve la dirección y la fuerza (línea/puntos de trayectoria + intensidad). Debe leerse bien bajo el dedo en móvil.
- **Soltar fuera / gesto de cancelar:** anula el tiro sin coste.
- **Se puede apuntar y disparar en movimiento** (los modos de disparo con proyectil no requieren estar parado; el lanzamiento corporal tampoco, aunque en la práctica encadena la nueva velocidad).
- **Selector de modo de arma:** 3 botones grandes en la parte inferior (cuerpo / flecha / hechizo), cada uno con su barra de recarga visible. En escritorio, además: teclas **1/2/3** y **rueda del ratón** (cicla entre armas) — el teclado sigue sin ser necesario para jugar, es comodidad de PC/playtest.
- **Paseo WASD/flechas (solo escritorio):** ayuda de recolocación, nunca un sustituto del tirachinas ni una forma de combatir — velocidad deliberadamente baja (2.0 u/s: por debajo de cualquier enemigo que persiga y por debajo del umbral de embestida; la garantía real de que nunca hace daño de contacto es que caminar es cinemático y jamás toca la velocidad física del héroe). Lumora mira hacia la dirección en la que camina mientras lo hace. Bloqueado mientras se apunta y fuera de la fase de juego (pausa/modales). Al terminar un lanzamiento el paseo no retoma el control de golpe: se desvanece hacia dentro de forma continua, mezclándose solo en cuanto el deslizamiento ya va más lento que el propio paso, así que no queda costura perceptible entre "frenar" y "seguir caminando". Detectado por CAPACIDADES del dispositivo (`(hover: hover) and (pointer: fine)`), nunca por `userAgent`: en táctil no se registra ni un solo listener.
- **Pausa:** botón en esquina superior. La pausa muestra las mejoras acumuladas y una leyenda del juego.
- El juego debe ser 100% jugable táctil, sin teclado. Ratón funciona igual que el dedo; el WASD de arriba es una comodidad de escritorio añadida, nunca un requisito.

---

## 4. Lanzamiento, movimiento y rebotes

- **El héroe es una bola que desliza, no rueda.** Piensa en un disco de hockey/billar visto desde arriba.
- **Velocidad de salida** proporcional a la fuerza del arrastre: incluso un tiro flojo tiene un mínimo apreciable (~35% del potencial), un tiro a tope sale a ~2× el flojo. Rango de sensación: de "empujoncito de ajuste" a "cañonazo que cruza la sala".
- **Deslizamiento:** al soltar, la bola desliza perdiendo velocidad de forma suave y continua (decaimiento exponencial). Un cañonazo recorre una sala grande con 1–2 rebotes antes de pararse. Cuando la velocidad baja de un umbral mínimo, se detiene del todo (nada de arrastrarse eternamente).
- **Rebotes contra paredes y rocas:** reflejo limpio del ángulo con pérdida pequeña de energía (~86% de la velocidad se conserva). Los rebotes son parte del plan de tiro: carambolas intencionadas para golpear enemigos fuera de línea de visión directa.
- **Cooldown de lanzamiento:** muy corto para el cuerpo (0.2 s) — el ritmo lo marca la propia física, no el cooldown.
- **Tope de velocidad global** para que ninguna combinación de mejoras/empujones rompa la legibilidad (~1.7× la velocidad máxima de lanzamiento).

### Sensación objetivo (tuning de referencia)

| Parámetro | Valor de referencia |
|---|---|
| Radio del héroe | 0.38 u |
| Velocidad de lanzamiento | 3.6 – 7.5 u/s según fuerza |
| Velocidad máxima absoluta | 13.5 u/s |
| Fricción (decaimiento exponencial) | factor 1.42 |
| Umbral de parada total | 0.17 u/s |
| Restitución de rebote | 0.86 |
| Arrastre máximo | 2.8 u |

*(“u” = unidad de mundo; una sala pequeña mide 9×9 u.)*

---

## 5. Armas y modos de tiro

El mismo gesto (arrastrar y soltar) tiene tres modos, seleccionables en cualquier momento:

| Modo | Qué hace | Daño base | Recarga | Riesgo/recompensa |
|---|---|---|---|---|
| **Cuerpo** | Te lanzas tú. El daño crece con la velocidad de impacto. | 1 + bono por velocidad | 0.2 s | Alto daño y control de posición, pero te expone al contacto |
| **Flecha** | Disparas un proyectil rápido y recto desde tu posición. Te produce un pequeño retroceso (te desplaza hacia atrás). | 1 | 0.5 s | Seguro y rápido; daño bajo |
| **Hechizo** | Proyectil más lento y gordo que **rebota una vez** en paredes. | 2 | 1.0 s | Potente y permite carambolas, pero lento de recargar |

**Detalles de proyectiles:**

- La fuerza del arrastre también module la velocidad del proyectil (~70%–120% de su velocidad base).
- Los proyectiles tienen vida limitada (~2.8 s) y desaparecen al agotarla o al chocar con pared/roca (salvo el rebote del hechizo).
- **Flecha:** atraviesa 1 enemigo (se detiene en el segundo).
- **Hechizo:** 1 rebote en pared con pérdida de fuerza; cada rebote le acorta la vida.
- **Retroceso de flecha/hechizo:** empuja al héroe hacia atrás ligeramente — sirve como micro-movimiento defensivo intencionado (disparar para alejarse).
- Los proyectiles enemigos son visualmente distintos y dañan solo al jugador.

---

## 6. El héroe

- **Vida:** 5 corazones al empezar (máximo ampliable hasta 9).
- **Daño por embestida:** al chocar con un enemigo a velocidad suficiente (≥ ~2.5 u/s) le haces daño: base 1 + bono proporcional a la velocidad (un cañonazo a máxima velocidad hace ~4). Por debajo del umbral no dañas: chocar lento con un enemigo es peligro, no ataque.
- **Daño por contacto recibido:** los enemigos hacen 1 de daño al tocarte de forma sostenida (con ~0.4 s entre "ticks" de daño).
- **Invulnerabilidad tras daño:** 0.7 s de inmunidad con feedback visual claro (parpadeo), para evitar muertes por "trituradora".
- **Escudo (mejora):** cargas que bloquean el siguiente golpe por completo (cualquier fuente), con invulnerabilidad breve tras bloquear.
- **Knockback a enemigos:** todo golpe empuja al enemigo golpeado y le hace un flash blanco.
- **Muerte:** a 0 corazones → pantalla de fin de run con estadísticas (salas limpiadas, monedas, puntuación) y botón de reinicio inmediato.

---

## 7. Enemigos

Cinco arquetipos, cada uno con silueta y color propios e inconfundibles. Todos rodean obstáculos con inteligencia (no se atascan contra rocas, no caen solos a los fosos y **no pisan pinchos ni barriles sin explotar**: los esquivan al navegar). Que un enemigo muera por un hazard solo debe poder ocurrir si el jugador lo provoca (knockback, explosión encadenada) — nunca por decisión propia de la IA. Todos reciben knockback al ser golpeados. Al morir sueltan monedas (según su dureza, ver §9) y estallan en partículas.

### 7.1 Dummy (rojo) — el básico
- 2 HP. Lento.
- **Patrulla** un tramo corto (elige el eje con más espacio libre). Si el héroe se acerca (~2.3 u) **le persigue**, pero con correa: si la persecución le aleja demasiado de su zona (~2.2 u), vuelve a patrullar.
- Velocidades: patrulla 0.8 u/s, persecución 1.7 u/s.
- Rol: carne de cañón, enseña la embestida.

### 7.2 Chaser (naranja) — el perseguidor
- 3 HP.
- **Te persigue siempre**, desde cualquier distancia, rodeando obstáculos.
- Velocidad 2.35 u/s… y **se acelera a 3.0 u/s cuando detecta que estás apuntando**. Castiga apuntar demasiado tiempo.
- Rol: presión de tiempo; convierte el apuntado en una decisión con coste.

### 7.3 Spike (gris, con púa direccional) — el erizo
- 3 HP. Solo patrulla (0.95 u/s), nunca persigue.
- Tiene una **cara peligrosa**: su **arco trasero** (la espalda, opuesta a la púa/ojo). Chocar contra su espalda **te daña a ti** (1); solo se le puede hacer daño golpeándole **por delante** (el lado de la púa/ojo) — de frente o por los flancos, con embestida, flecha o hechizo; los proyectiles que le llegan por la espalda no le hacen daño (mecánica invertida 2026-07-20, playtest: "que si le atacas por detrás te pinche").
- Rol: obliga a leer orientación y a tirar con ángulo, no en línea recta.

### 7.4 Trail (verde) — el babosa
- 3–4 HP. Patrulla lenta (0.86 u/s).
- **Deja un rastro dañino** tras de sí: charcos que persisten ~3.2 s y hacen 1 de daño al pisarlos.
- Rol: control de área; ensucia las líneas de tiro y te obliga a moverte.

### 7.5 Shooter (negro) — el tirador
- 3–4 HP.
- Ciclo: **persigue 1 s → se detiene y carga 1 s (telegrafiado visible) → dispara** un proyectil directo hacia ti (daño 1, velocidad media, esquivable).
- Velocidad de persecución baja (1.45 u/s).
- Rol: único peligro a distancia; te obliga a no acampar.

**Regla de oro de la IA:** el comportamiento debe ser **legible y consistente**. El jugador debe poder predecir qué hará cada enemigo en el próximo segundo. Nada de comportamiento errático.

---

## 8. Hazards (peligros del escenario)

| Hazard | Aspecto | Efecto en el héroe | Efecto en enemigos |
|---|---|---|---|
| **Foso (pit)** | Agujero oscuro | Si tu centro entra (con un pequeño margen de perdón respecto al borde visual), caes: animación de caída, pierdes 1 corazón y reapareces en tu última posición segura | Los enemigos que caen mueren al instante |
| **Pinchos (spikes)** | Zona de púas | 1 de daño + empujón fuerte hacia fuera | 1 de daño periódico si los pisan |
| **Barril (barrel)** | Barril explosivo | Explota al contacto (tuyo, de un proyectil o de un enemigo): daño 3 en un área generosa (~2 u de radio) | Igual — herramienta táctica principal: lanzarse a un barril rodeado de enemigos |
| **Roca (rock)** | Bloque sólido | Obstáculo: rebotas en él como en una pared | Lo rodean; también bloquea proyectiles |

**Notas de diseño:**

- El **margen de perdón del foso** es deliberado: el borde visual perdona un poco antes de tragarte. No debe ajustarse al borde exacto — probado y descartado por sensación injusta.
- La **posición segura** para reaparecer del foso se actualiza continuamente cuando el héroe pisa suelo firme y controlable.
- Los barriles son el "combo" del juego: colocar enemigos + barril en una sala crea el momento estrella (una embestida → explosión en cadena → sala limpia).

---

## 9. Objetos

- **Moneda:** se recoge al contacto. Suma al **monedero** gastable del héroe (se pierde al morir, viaja intacto entre mazmorras de la misma run) y +1 a la **puntuación**. Los enemigos sueltan monedas al morir, en una cantidad según su dureza: Dummy 1, Chaser/Trail 2, Spike/Shooter 3, jefe 10 (esparcidas alrededor del cadáver). También se colocan monedas sueltas en las salas. La mejora **Canto de Urraca** (imán, §11) las atrae desde más lejos según su nivel.
- **Poción:** cura 1 corazón al recogerla (con su efecto visual de curación).
- **Llave:** objeto de progresión — abre la puerta del jefe. Se coloca en una sala concreta de la mazmorra ("sala de la llave"), custodiada.

**Economía de la puntuación** *(decisión de David, 2026-07-13)*: recoger una moneda suma +1 a la puntuación como siempre, pero **comprar una mejora en la tienda resta su precio a la puntuación** (con tope en 0, nunca baja de cero). La puntuación final de la run premia terminar sin gastar: acumular monedero sin tocarlo puntúa más que vaciarlo en mejoras.

---

## 10. Salas, mazmorra y progresión de la run

### 10.1 Salas

- Una sala es un recinto rectangular con paredes, de dimensiones variables (mínimo 5×5 u, lados impares; referencia 9×9 a 9×13).
- Contenido de una sala: punto de inicio del jugador (para la sala inicial), enemigos con sus rutas, hazards, objetos, y **huecos de puerta** en los bordes (norte/sur/este/oeste, hasta 2 por lado, con posición a lo largo del borde).
- Etiquetas de sala: **inicio**, **combate**, **llave**, **recompensa**, **jefe**, **tienda** — definen su papel en la mazmorra.

### 10.2 Mazmorra procedural

- Cada **mazmorra** encadena **~6 salas** elegidas de un pool (salas hechas a mano en el editor + salas incluidas de serie): inicio → combates → sala de la llave → … → jefe, más la sala de tienda colgada aparte (ver "Tienda" más abajo).
- Una **run** encadena **varias mazmorras**, una por cada jefe del pool de jefes en orden FIJO de dificultad creciente (§15.1, punto 9; decisión tomada tras playtest de David 2026-07-15): al derrotar el jefe de una mazmorra que no es la última, se genera la siguiente mazmorra (mapa nuevo y ALEATORIO, misma regla de ~6 salas) y el héroe conserva vida, mejoras y monedero (§10.3).
- Las salas se conectan por puertas alineadas formando un **mapa con al menos un ciclo** (que se pueda rodear, no un pasillo lineal), y el jefe como callejón final.
- **Reglas de validación del mapa:** todo alcanzable; el jefe solo accesible con la llave; la llave alcanzable sin pasar por el jefe; sin solapes de salas.
- **Flujo de puertas:** las puertas de una sala se abren al limpiarla (matar a todos sus enemigos). Cruzar una puerta te lleva físicamente a la sala contigua (mundo continuo, sin pantalla de carga). Aviso con el nombre de la sala al entrar.
- **Limpiar una sala** = eliminar todos sus enemigos → suena la recompensa y se abren sus puertas (salvo la del jefe, que exige la llave). Limpiar una sala **no** ofrece elección de mejora — las mejoras se ganan de otras dos formas, ver §11 y "Tienda" más abajo.

### 10.3 Victoria y derrota

- **Derrotar al jefe de una mazmorra:**
  - Si **no** es el jefe final de la run: se ofrece la recompensa gratis de jefe (§11) y, tras elegirla (o si no hay nada que ofrecer), la run avanza a la **siguiente mazmorra** — vida, mejoras y monedero del héroe se conservan; la llave no (cada mazmorra tiene la suya).
  - Si es el jefe final de la run (última mazmorra de la secuencia): **Victoria** directa, sin recompensa (no habría mazmorra siguiente donde gastarla). Pantalla de victoria con estadísticas.
- **Derrota:** morir en cualquier sala, de cualquier mazmorra de la run. Sin checkpoints: la run entera se reinicia desde la primera mazmorra (permadeath) — el monedero y las mejoras acumuladas se pierden.
- **Puntuación:** daño infligido, salas limpiadas (+50), monedas recogidas y mejoras suman puntos; comprar en la tienda resta puntuación (§9).

### 10.4 Tienda

*Sección nueva (decisión de David, 2026-07-13).*

- Cada mazmorra tiene **una sala de tienda**, colgada como callejón sin salida fuera del camino obligatorio (bucle de salas ↔ jefe): el jugador la encuentra sin desviarse mucho, pero nunca es de paso obligado.
- Dentro vive un **tendero placeholder** (marcador de posición a la espera de un NPC futuro con arte y personalidad propios). Tocarlo abre el **modal de tienda**; no se "recoge", así que el modal es reabrible el resto de la mazmorra.
- El modal muestra un **stock de 4 mejoras** sorteadas del pool completo (todas las categorías, incluidos los consumibles) al generar la mazmorra — el stock no se vuelve a sortear al reabrir la tienda, solo cambian los precios/niveles a medida que compras.
- Cada mejora del stock se compra con el **precio de su siguiente nivel**: descuenta monedas del monedero y resta esa misma cantidad a la puntuación (§9). Sin saldo suficiente, o con la mejora ya al máximo, no se puede comprar.
- **Precios de referencia:** mejoras de cuerpo/flecha/hechizo, 10/20/30 según el nivel (nivel × 10); Burbuja de Cuarzo (escudo) 8 fijo; Ascua Vital (corazón) 12 fijo; Canto de Urraca (imán) 10/15/20 según el nivel.
- "Salir" cierra el modal y devuelve el control al jugador sin perder el stock ni las compras ya hechas.

---

## 11. Mejoras (upgrades)

*Sección reescrita (decisión de David, 2026-07-13): ya no se ofrece mejora al limpiar una sala. Las mejoras se ganan de dos formas — gratis al derrotar un jefe, o comprándolas en la tienda (§10.4) — y tienen **niveles** en vez de ser un pick único.*

### Cómo se obtienen

- **Recompensa gratis de jefe no final:** al derrotar un jefe que no es el último de la run, se ofrece **1 elección entre hasta 3 tarjetas**, una mejora aleatoria no maximizada por cada **categoría de ataque** (cuerpo, flecha, hechizo — los consumibles no entran aquí, solo se compran). Si alguna categoría ya está toda al máximo se omite, así que puede haber menos de 3 opciones. El jefe final de la run no ofrece nada: da la victoria directamente (§10.3).
- **Tienda:** cualquier mejora del pool completo (incluidos los consumibles) se puede comprar con monedas, con precio creciente por nivel (§10.4).

### Persistencia

Las mejoras y sus niveles **persisten entre las mazmorras de una misma run** (igual que el monedero) y **se pierden por completo al morir** (nueva run, todo a nivel 0).

### Pool de mejoras (12)

Cada mejora tiene un **máximo de nivel**, un icono/badge propio y pips de nivel (●●○) visibles en el modal de recompensa de jefe, en la tienda y en el resumen de pausa/fin de run.

| Categoría | Mejora | Efecto por nivel | Máx. nivel |
|---|---|---|---|
| Cuerpo | **Erizo de Acero** | +1 daño de embestida | 3 |
| Cuerpo | **Estela de Cometa** | +1 u/s de velocidad de lanzamiento corporal | 3 |
| Cuerpo | **Canto Rodado** | Menos retroceso al recibir daño | 3 |
| Flecha | **Colmillo de Hierro** | +1 daño de flecha | 3 |
| Flecha | **Bandada** | +1 flecha en ángulo por disparo | 3 |
| Flecha | **Aguja Fantasma** | +1 enemigo atravesado por la flecha (base 1 → máx 4) | 3 |
| Hechizo | **Orbe Voraz** | +1 daño de hechizo y proyectil más ancho | 3 |
| Hechizo | **Coro Arcano** | +1 hechizo en ángulo por disparo | 3 |
| Hechizo | **Eco Errante** | +1 rebote del hechizo (base 1 → máx 4) | 3 |
| Consumible | **Burbuja de Cuarzo** (escudo) | +1 carga de escudo: bloquea el próximo golpe | sin tope (acumula cargas) |
| Consumible | **Ascua Vital** (corazón) | Cura 1 corazón; con la vida llena, +1 vida máxima (tope 9) | hasta 9 de vida máxima |
| Consumible | **Canto de Urraca** (imán) | Atrae monedas desde más lejos | 3 |

Las mejoras de **cuerpo/flecha/hechizo** solo se ofrecen como recompensa de jefe; los **consumibles** (escudo, corazón, imán) solo se compran en tienda.

---

## 12. Juice y feedback

Todo evento del juego tiene respuesta audiovisual inmediata. Mínimos exigidos:

- **Lanzamiento:** estela/streaks al salir disparado.
- **Impacto de embestida:** explosión de partículas + sacudida de cámara proporcional a la velocidad + flash blanco del enemigo + micro pausa de impacto (hit-stop) en golpes fuertes.
- **Rebote en pared:** efecto en el punto de contacto, sacudida leve.
- **Muerte de enemigo:** burst grande de partículas + moneda que salta.
- **Explosión de barril:** el evento más gordo del juego — gran onda, sacudida fuerte.
- **Daño recibido:** flash rojo, sacudida fuerte, parpadeo de invulnerabilidad.
- **Recogida/curación/escudo:** bursts con color propio (dorado/rosa/azul).
- **Trail del héroe:** estela sutil mientras va rápido, que comunica su velocidad.
- **Sacudida de cámara:** siempre breve y amortiguada; nunca mareante. Escala con la importancia del evento (leve al rebotar, máxima en explosiones).
- **Vibración háptica** en móvil para impactos fuertes (si el dispositivo lo permite).
- **Sonido:** (fase posterior; el diseño debe dejar hueco a SFX por evento).

**HUD (táctil, dedos gordos):**

- Corazones (llenos/vacíos) y monedas arriba.
- Sala actual / total, nombre de sala y mensajes contextuales.
- Icono de llave cuando la llevas.
- 3 botones de arma abajo al centro con barra de recarga visual.
- Botón de pausa arriba a la derecha.

**Modales:** recompensa de jefe (hasta 3 tarjetas grandes de mejora gratis), tienda (stock con precios, comprar/salir), mazmorra superada (avanzar a la siguiente mazmorra de la run), pausa (mejoras acumuladas + leyenda), fin de run (estadísticas + reinicio). Todos usables con el pulgar.

---

## 13. Editor de niveles

Herramienta imprescindible del proyecto: las salas del juego se fabrican aquí.

**Requisitos funcionales:**

- Editor visual de salas accesible desde el propio juego (ruta propia).
- Definir dimensiones de la sala (forzando mínimos y validez).
- Colocar/mover/duplicar/borrar sobre una rejilla de 1×1: punto de inicio, los 5 tipos de enemigo, los 4 hazards, los 3 objetos.
- Editar propiedades por entidad: vida, radio, tamaño (hazards rectangulares), dirección (púa del Spike), ruta de patrulla (punto objetivo).
- Definir huecos de puerta por lado (máx. 2 por lado, separación mínima), para que la sala sea conectable en la mazmorra procedural.
- **Validaciones en vivo:** identificador y nombre obligatorios, inicio no encima de un hazard, IDs únicos, patrullas con destino, tamaño válido.
- **Guardado persistente automático** del borrador (no perder trabajo al cerrar).
- **Exportar la sala como archivo de datos** (formato de sala estándar del juego) e importarla; las salas exportadas entran en el pool de la generación procedural.
- **Playtest inmediato:** botón para jugar la sala que estás editando y volver al editor.

**Formato de sala (contrato de datos, agnóstico):** identificador, nombre, dimensiones, inicio del jugador, etiquetas, huecos de puerta, y listas de enemigos / hazards / objetos con sus propiedades. Debe ser serializable a un archivo legible y estable, porque es la moneda de intercambio entre editor, juego y generador procedural.

---

## 14. Plataforma y calidad de experiencia

- **Objetivo primario: móvil en navegador** (retrato o apaisado según viewport, pantalla completa, sin scroll ni zoom accidental).
- **Fluidez innegociable:** 60 fps estables en un móvil de gama media. Si hay que elegir entre un efecto y los fps, ganan los fps.
- La cámara sigue al héroe con suavidad, ligeramente elevada y en ángulo (vista clara del tablero, con profundidad 3D).
- Legibilidad ante todo: paleta de colores consistente (cada entidad se identifica por color/silueta a primera vista incluso en pantalla pequeña de 5").
- Arranque rápido: del enlace a jugar en segundos.
- Debe funcionar igual de bien con ratón en escritorio (herramienta de desarrollo y de playtest del editor).

---

## 15. Jefes

*Sección nueva (2026-07-05): hasta ahora la "sala del jefe" era una sala de combate normal con enemigos duros. Esta sección la sustituye por jefes de verdad: enemigos únicos, con nombre, patrones propios y una pelea que se lee y se aprende, no una esponja de vida.*

### 15.1 Principios (no negociables para cualquier jefe futuro)

1. **Un jefe es un puzzle de física a mayor escala, no una barra de vida más larga.** Se le vence leyendo su patrón y usando la sala (rebotes, hazards, embestida), igual que a un enemigo normal — solo que con más margen para el error y una coreografía más larga.
2. **Todo ataque se telegrafía** con tiempo de sobra para leer y reaccionar (mínimo ~0.6 s entre el aviso visual y que el ataque haga daño). Nada de golpes que no se puedan ver venir.
3. **Tres fases por umbral de vida** (100–66 %, 66–33 %, 33–0 %). Cada fase **intensifica o añade una arista** a los patrones que ya conoces; nunca sustituye el repertorio entero de golpe. El jugador siempre reconoce al jefe que empezó a pelear.
4. **Ventana de vulnerabilidad explícita.** Tras resolver su ataque (al chocar, al disparar, al invocar…), el jefe queda expuesto un instante — ahí es donde se concentra el daño grande. Acercarse en el momento justo se premia; acercarse en cualquier otro momento, se castiga.
5. **El jefe usa la sala como arma.** Las mismas piezas que el jugador usa contra los enemigos normales (rocas para rebotar, barriles, fosos, pinchos) el jefe las convierte en amenaza propia. El diseño de la arena es parte del combate, no decoración de fondo.
6. **Ningún ataque de jefe mata de un golpe con vida llena.** Techo de daño de un único impacto: 60 % de la vida máxima del héroe en la fase 1 (escala un poco en fases posteriores, nunca hasta el 100 %). Perder debe sentirse "me confié", nunca "no pude hacer nada".
7. **La puerta de la sala del jefe se sella al entrar** y solo se abre al vencerlo — no hay ir y volver a por mejoras a mitad combate. Si mueres, la run entera se reinicia como siempre (sin checkpoint intra-jefe): coherente con la permadeath del resto del juego.
8. **La derrota del jefe es el clímax audiovisual de la mazmorra**: la mayor combinación de partículas, sacudida de cámara y pausa de impacto de todo el juego, una cosecha grande de monedas, y la puerta trasera que abre paso; la modal de recompensa/siguiente mazmorra se retrasa unos ~2.5 s de tiempo de sim tras este clímax, con un pequeño gesto de victoria del héroe, para que se pueda disfrutar antes de que la tape (playtest de David 2026-07-15: "debería salir con un poco de retraso, para poder ver el efecto al matar al jefe y quizá algún gesto de victoria antes de la modal que lo tapa todo"). Si el jefe **no** es el último de la run, además se ofrece la recompensa gratis de mejora (§11) antes de pasar a la mazmorra siguiente; el jefe final de la run no ofrece mejora — da la victoria directamente (§10.3), porque no habría mazmorra donde usarla.
9. **Un pool de cuatro jefes, uno por mazmorra, encadenados dentro de la misma run** *(actualizado; antes cada run sorteaba un único jefe)*: los jefes de esta sección entran como salas de la etiqueta "jefe" en el pool de la mazmorra procedural. Una run encadena una mazmorra por cada jefe de diseño DISPONIBLE en el pool, en **orden FIJO de dificultad creciente: Guardián → Reina → Prisma → Tormenta** *(actualizado tras playtest de David 2026-07-15: "como este [La Tormenta] es el más difícil, me gustaría que estuviera el último, así que mejor los jefes por orden, y entre jefes, mazmorras aleatorias"; antes el orden se barajaba con la semilla de la run)* — el jugador se enfrenta a todos antes de que la run termine, cada vez con una mazmorra ALEATORIA nueva alrededor. Cada jefe enseña un pilar distinto: rebote/embestida (Guardián), gestión de espacio (Reina), dominio de las 3 armas (Prisma), esquive puro (Tormenta) — y ese mismo orden es también el de dificultad creciente.

### 15.2 Guardián de Canto — el jefe de embestida

*Enseña el pilar más antiguo del juego llevado al extremo: rebotes y embestida como arma principal.*

- **Arena:** sala grande y cuadrada, cuatro rocas medianas **separadas de los muros, hacia el centro** (playtest 2026-07-06: pegadas a las esquinas la arena se sentía sosa y vacía en medio) — reparten el espacio central y multiplican los ángulos de choque para la carga. Sin fosos: el choque debe sentirse limpio y legible. **Regla anti-trampa:** ningún hueco de la arena (roca-muro, roca-roca, hueco de puerta) puede ser transitable para el héroe e intransitable para el Guardián — o caben los dos con holgura, o no cabe ninguno.
- **Barriles rodantes (playtest 2026-07-06):** cada ~8 s **cae un barril del cielo** sobre uno de un conjunto de **puntos fijos** (las 4 esquinas de la arena + los 4 puntos medios de los bordes, entre las rocas) — nunca dos barriles solapados; se elige el punto libre más alejado de los barriles vivos. Primero aparece su sombra en el suelo creciendo (~0.8 s de aviso, se lee desde cualquier parte de la sala) y luego aterriza con rebote y polvo. Si la carga del Guardián lo arrolla, explota: daño al jefe y **aturdimiento largo** (~2.2 s en vez de 1.4). Colocarte para que su carga cruce el barril es la jugada inteligente — la carga es a ciegas, el Guardián NO esquiva barriles (a diferencia de los enemigos normales).
- **Vida de recompensa:** al cruzar a fase 2 y a fase 3, el Guardián suelta una poción en el punto del cambio — sostiene la pelea larga y premia el progreso.
- **El barril castiga fuerte (playtest 2026-07-06):** arrollar un barril con la carga le hace **daño extra** (bastante más que un golpe normal de arma) además del aturdimiento largo — es la vía rápida de matarlo y recompensa colocar bien la carga.
- **Comportamiento base:** patrulla despacio por el perímetro. Cuando el héroe entra en su rango medio, se prepara (brilla y vibra ~0.8 s: el aviso) y luego **carga en línea recta** a gran velocidad hacia la última posición vista del héroe.
  - **No carga si tiene una roca/muro demasiado cerca en la dirección de tiro** (playtest 2026-07-06): en ese caso no telegrafía; primero **reposiciona** (se aparta buscando línea despejada) y solo carga cuando tiene recorrido. Evita el exploit de estrellarlo una y otra vez contra una roca pegada mientras el héroe le pega gratis al lado.
  - Si la carga golpea una roca o una pared: el Guardián queda **aturdido ~1.4 s** — su ventana de vulnerabilidad.
  - Si la carga golpea al héroe: empujón fuerte + daño (por debajo del techo de un golpe, nunca letal a vida llena).
- **Fase 2 (66 %):** encadena **dos cargas seguidas** con una pausa corta entre ellas — obliga a leer el ritmo completo, no solo el primer golpe.
- **Fase 3 (33 %):** las rocas de las esquinas, tras cada choque, sueltan una zona de esquirlas afiladas temporal (como un campo de pinchos breve) — el suelo se vuelve más hostil según se enfada.
- **Debilidad:** casi inmune a cualquier daño mientras patrulla o carga; solo es vulnerable de verdad durante el aturdimiento tras el choque. Ahí, la embestida del héroe (o unas flechas rápidas) hacen el daño grueso.
- **Lectura para el jugador:** "provócalo, hazlo chocar, castiga el aturdimiento" — el jefe más "de manual", pensado para ser el primero que un jugador se encuentra.

### 15.3 Reina del Enjambre — el jefe de control de espacio

*Enseña a gestionar la sala y los hazards en vez de solo esquivar golpes; contrapunto del Guardián, que es puro reflejo.*

- **Arena:** sala alargada, dos pasillos laterales y un foco central donde vive la Reina. Se mueve poco: no es una persecución, es una gestión de terreno.
- **Comportamiento base:** cada pocos segundos invoca una oleada de larvas — versiones débiles y de 1 solo golpe de un Dummy, sin peligro individual serio — que **persiguen al héroe desde el primer momento** (playtest 2026-07-06: en línea recta no amenazaban; el reto llegaba tarde). No son la amenaza real por sí solas: son **ruido que ensucia la sala** si se dejan acumular, y sirven de escudo involuntario o de "moneda de cambio" para rebotes.
- **La Reina te acecha:** no persigue agresiva, pero **deriva lentamente hacia el héroe** (con correa a su zona central), así que plantarse en un punto fijo a disparar deja de ser seguro — te va cerrando el espacio y acercando el rastro. Sigue siendo control de espacio, no un boss de reflejos.
- Mientras se desplaza, deja tras de sí un **rastro grande y duradero** (como el Trail, pero mayor) que va cerrando el espacio limpio de la arena.
- **Escalada de larvas por fase:** máximo simultáneo **2 en fase 1, 4 en fase 2, 6 en fase 3** — la presión del enjambre crece con el combate.
- **Fase 2 (66 %):** el rastro se genera más rápido; las larvas persiguen más rápido y son más numerosas (4).
- **Fase 3 (33 %):** modo pánico — la Reina se mueve más y traza su rastro buscando rodear al jugador; hasta 6 larvas agresivas. Ganar significa limpiar hueco a tiros y arrinconarla.
- **Debilidad:** no tiene fase de aturdimiento clásica — es golpeable en todo momento, pero tiene mucha vida y ningún ataque directo fuerte. El peligro es indirecto: quedarte sin sala limpia donde maniobrar. Premia jugar rápido y ordenado, castiga el tanteo lento.
- **Lectura para el jugador:** "no dejes que la sala se ensucie" — el jefe que obliga a usar el espacio con cabeza, no los reflejos.

### 15.4 El Prisma — el jefe de las 3 armas

*Obliga a dominar y alternar los tres modos de tiro. Conecta con la identidad visual ya existente: el héroe cambia de color según el arma (azul cuerpo / amarillo flecha / violeta hechizo).*

- **Arena:** sala mediana y simétrica, un par de rocas para rebotes. Sin hazards ruidosos: el foco es el propio jefe y su color.
- **Núcleo con escudo elemental rotatorio:** en cada momento el Prisma tiene UN color activo — azul, amarillo o violeta — y **solo es vulnerable al arma de ese color**; las otras dos rebotan sin efecto (con feedback visual claro de "inmune"). Exactamente un arma correcta en cada instante: la señal es nítida y de verdad obliga a rotar las tres.
- **Rotación telegrafiada:** cada modo dura unos segundos; ~1.5 s antes del cambio, el núcleo brilla y "tartamudea" hacia el color siguiente — da tiempo a anticipar y cambiar de arma antes de que llegue.
- **Ataques temáticos por modo** (densidad moderada — el reto de este jefe es el cambio de arma, no el esquive masivo). Sus proyectiles (Viento/Sombra) salen teñidos del color de su gate activo, mismo mapeo arma↔color que el propio héroe:
  - **Piedra (azul):** se vuelve pesado y hace embestidas cortas hacia el héroe. Se responde con la embestida propia (cuerpo contra cuerpo).
  - **Viento (amarillo):** se mueve rápido y dispara ráfagas cortas de dardos, teñidos de amarillo. Se responde a flechazos manteniendo la distancia.
  - **Sombra (violeta):** lanza arcos lentos que rebotan en las paredes, teñidos de violeta. Se responde con el hechizo, usando también sus rebotes.
- **Fase 2 (66 %):** la rotación se acelera y los ataques se densifican ligeramente.
- **Fase 3 (33 %):** breves solapes de dos colores a la vez — ventana de riesgo/recompensa: si aciertas el arma correcta durante el solape, golpe doble.
- **Sin ventana de vulnerabilidad** *(actualizado tras playtest de David 2026-07-17: "quita la ventana de vulnerabilidad, haz que sólo le afecten los ataques de su color, pero siempre con el daño normal"; antes, además del color correcto, había que esperar al instante de exposición al final de cada ataque para el daño grande — igual que el resto de jefes)*: el Prisma es dañable SIEMPRE, en cualquier punto de su ciclo, con el ÚNICO filtro del color activo — arma correcta = daño normal completo en el acto, arma incorrecta = 0. Es el único jefe sin fase "apenas daña"/"daño completo"; su reto sigue siendo puramente de puntería de color, no de timing de ventana.
- **Lectura para el jugador:** "mira su color, cambia de arma, golpea cuando quieras" — el jefe que examina el arsenal completo.

### 15.5 La Tormenta — el jefe de esquive puro (bullet hell)

*El único jefe donde no hay puzzle de daño: cualquier arma le hace daño siempre. El examen es sobrevivir a sus patrones.*

- **Arena:** sala circular/octogonal completamente despejada — los patrones son la arquitectura; cualquier obstáculo los volvería injustos.
- **Comportamiento base:** flota lentamente cerca del centro encadenando patrones de proyectiles densos pero legibles, cada uno anunciado con tiempo de sobra (~1 s en fase 1, ~0.8 s en fases 2-3; subido tras playtest 2026-07-15, antes ~0.6-0.7 s). Rediseño del telegraph tras playtest 2026-07-15 (David: "el anillo giraba pero se veía vertical, mal"): el aro que rodea al jefe es SIEMPRE un anillo horizontal (plano del suelo, estilo anillo de Saturno, nunca inclinado) compuesto de secciones que se iluminan exactamente por donde va a disparar el patrón que viene — lo visual promete lo mecánico al pie de la letra — ya insinuando el patrón desde la segunda mitad de la recarga anterior, no solo durante el propio aviso. Cada bala lleva su propio halo de luz falsa (mismo truco barato que las monedas/llaves/pociones) y un color fijo POR PATRÓN *(añadido tras playtest de David 2026-07-17: "me gustaría que cada bola tuviera su luz. Además, pon en cada ataque los proyectiles de un color")*:
  - **Espiral giratoria** (violeta): brazos de balas que rotan; se sobrevive encontrando el hueco y girando con él. El aro ilumina 4 secciones (una por brazo).
  - **Anillos concéntricos** (azul hielo): ondas que se expanden desde su posición; se teje entre los huecos de cada anillo. El aro ilumina TODO el anillo menos el hueco de diseño del primer anillo — así siempre acaba dejando pasar por ahí.
  - **Ráfaga radial** (ámbar): explosión lenta y densa en todas direcciones; se esquiva leyendo los pasillos entre balas. El aro ilumina las 3 zonas con balas y apaga los 3 pasillos.
  - Densidad de balas bajada ~20-25 % en los tres patrones en la misma tanda *(David: "si tienes que lanzar menos proyectiles puedes hacerlo")*: con luz y color propios cada bala se lee mejor, así que menos balas mantienen la misma sensación de "muro" sin perder legibilidad — los pasillos garantizados (huecos, nº de brazos/pasillos) no se tocan, solo cuánto se rellena el resto.
- **Recarga = ventana de vulnerabilidad completa:** tras cada patrón, se detiene a recargar ~1.8 s (subido desde ~1.2 s tras playtest 2026-07-15: "demasiado difícil, más ventana de daño") con un aviso visual claro (aro verde uniforme) — ahí entra el daño COMPLETO de cualquier arma. Tuning post-playtest 2026-07-15 (David: "que los ataques siempre hagan daño, pero hagan más daño cuando esté con la luz verde"): FUERA de la ventana también se le puede dañar, pero solo un 20 % del golpe (mismo criterio que Guardián/Prisma) — la embestida en la ventana sigue siendo lo que más rinde, pero ya no hace falta esperar a la recarga para que un golpe cuente.
- **Fase 2 (66 %):** los patrones se densifican y la recarga se acorta.
- **Fase 3 (33 %):** combina dos patrones seguidos sin pausa (espiral → anillos) antes de recargar; la ventana es la misma pero llegar vivo a ella cuesta más. Tuning post-playtest 2026-07-15 (David: "en la fase 3, cuando concatenas ataques diferentes, haz que la ventana donde no se lancen bolas esté lo más cerca posible del jugador"): el anillo ENCADENADO (el segundo patrón de la cadena) abre su hueco apuntando al ángulo real del héroe respecto al jefe en ese instante, en vez de sortearlo al azar como el resto de patrones — el primer patrón del ciclo sigue siendo aleatorio.
- **Regla de honestidad:** las balas son lentas comparadas con el héroe (esquivables en todo momento con movimiento normal), los huecos siempre existen (los patrones se generan con pasillo garantizado) y ninguna bala aparece a bocajarro sin aviso. Pasillos ensanchados tras playtest 2026-07-15 (David: "sigue siendo demasiado difícil quizá"): margen de pasillo subido de 0.6 a 0.85 u (más ancho en todos los patrones que lo usan) y densidad de fase 1 aflojada ~10 % (intervalo de espiral y espaciado de relleno de anillos).
- **Lectura para el jugador:** "sobrevive al patrón, castiga la recarga" — el jefe de reflejos y sangre fría, el examen de esquive del juego.

### 15.6 Datos de referencia (borrador, pendiente de playtest — ninguno validado aún jugando)

| Jefe | Vida | Daño de golpe (fase 1 → 3) | Ventana de vulnerabilidad | Ritmo de patrón |
|---|---|---|---|---|
| Guardián de Canto | 40 | 1 → 2 (empuje de carga; bajado de 2→3 tras playtest 2026-07-06) | ~1.4 s tras chocar (~2.2 s si arrolla un barril) | carga cada ~2.5 s, encadenada en fase 2; barril perimetral cada ~8 s |
| Reina del Enjambre | 55 | sin ataque directo fuerte; larvas 1 daño de contacto | *(actualizado, rediseño 2026-07-10: vida en 8 columnas)* 15 % del daño del arma en todo momento; al romper una columna, aturdida 1.4 s (daño completo); rotas las 8, vulnerable permanente | oleada cada ~3 s, rastro continuo, guardianas de columna embisten cada ~2.5 s |
| El Prisma | 45 | 1–2 según modo | ninguna: dañable siempre, solo filtra el color correcto *(sin ventana desde 2026-07-17)* | modo cada ~6 s (→ ~4 s en fase 3), solapes en fase 3 |
| La Tormenta | 40 | 1 por bala | recarga ~1.8 s tras cada patrón (subida de ~1.2 s tras playtest 2026-07-15); daño completo ahí, 20 % fuera de ventana (tuning 2026-07-15, antes 0 = inmune) | patrón cada ~4.8 s de media (~3.2 s ráfaga, ~5.6 s espiral/anillos); balas ≤ 3.9 u/s (bajado de 4.5 tras playtest 2026-07-15, "sigue siendo demasiado difícil quizá") |

*Vida alta comparada con los enemigos normales (Dummy 2, Chaser 3) a propósito: un jefe debe aguantar varias coreografías completas, no morir en el primer aturdimiento. Estos números son el punto de partida para implementar y ajustar jugando — igual que el resto de la tabla de tuning del apéndice.*

---

## Apéndice: tabla maestra de tuning

*Valores de referencia validados por playtesting de la versión original. Cualquier reimplementación debe partir de aquí y ajustar solo tras probar.*

**Héroe:** radio 0.38 · 5 HP (máx 9) · lanzamiento 3.6–7.5 u/s · tope 13.5 u/s · fricción exp 1.42 · parada < 0.17 u/s · umbral embestida 2.5 u/s · daño embestida 1 + 0.32/u/s · invulnerabilidad 0.7 s · cooldown contacto 0.42 s

**Rebotes:** restitución 0.86 (héroe/paredes/rocas)

**Armas:** cuerpo cd 0.2 s · flecha 10.8 u/s, daño 1, cd 0.5 s, atraviesa 1 · hechizo 8.3 u/s, daño 2, cd 1.0 s, 1 rebote (×0.65) · vida proyectil 2.8 s · retroceso ~1.15 · fuerza→velocidad proyectil 70–120%

**Enemigos:** Dummy 2 HP, patrulla 0.8, caza 1.7, detección 2.35, correa 2.2 · Chaser 3 HP, 2.35 (3.0 si apuntas) · Spike 3 HP, patrulla 0.95, cono peligroso trasero (solo daña por delante) · Trail 3–4 HP, 0.86, rastro cada 0.55 s (radio 0.45, vida 3.2 s) · Shooter 3–4 HP, caza 1.45, ciclo 1 s + 1 s, proyectil 6.6 u/s · knockback al golpe: empuje 2.4 u/s + 0.18 u

**Hazards:** foso 1 daño, margen de perdón 0.18 u, caída ~1.05 s · pinchos 1 daño + empuje 5.2 u/s · barril daño 3, radio 2.0

**Mundo:** ~6 salas/mazmorra · puerta 2.0 u de ancho · muro 0.42 u · una mazmorra por jefe de la run, jefes en orden fijo de dificultad (Guardián → Reina → Prisma → Tormenta, playtest 2026-07-15), mazmorras entre jefes aleatorias

**Economía (§9, §10.4, §11):** drops de moneda al morir por dureza — Dummy 1, Chaser/Trail 2, Spike/Shooter 3, jefe 10 (esparcidas radio 0.25–0.6 u) · recompensa de jefe no final: 1 de hasta 3 (una por categoría de ataque) · stock de tienda: 4 mejoras sorteadas por mazmorra · precio cuerpo/flecha/hechizo: nivel × 10 (10/20/30) · precio escudo 8 fijo · precio corazón 12 fijo · precio imán 5 + nivel × 5 (10/15/20) · imán: radio por nivel 2.5/4/6 u, velocidad de atracción 7 u/s · comprar resta el precio a la puntuación (clamp 0)
