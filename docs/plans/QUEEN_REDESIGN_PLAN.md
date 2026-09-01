# Rediseño de la Reina del Enjambre (B2) — plan

Estado: **borrador para aprobar**. No implementar hasta el visto bueno de David.
Fecha: 2026-07-10. Asesoría de feel/legibilidad: Fable (advisor).

## Concepto en una frase

La vida del boss NO está en el boss, está en el escenario: **rompe las 8 columnas
embistiéndolas mientras la Reina te persigue y el enjambre + el rastro defienden
el acceso a las columnas**. Rematas cara a cara.

Así todos sus sistemas (rastro, larvas, persecución) pasan a tener una función
común: defender las columnas. La Reina es, por fin, un jefe de gestión de espacio.

---

## 1. Modelo de daño y vida (decisiones firmes de David)

- Vida del boss = 100 %. **Cada columna rota = −12 %** (instantáneo al romperse).
  8 columnas × 12 % = 96 %.
- El **4 % restante y el remate** se hacen con embestida directa al cuerpo.
- **Columnas: solo se rompen con embestida** (no proyectiles). Aguantan **2 golpes**;
  el 1.º las **agrieta** (telegrafía).
- **Al boss solo le daña la embestida directa (~1 %)**; los proyectiles **no le
  afectan** (rebotan con "clink"). Sin tope: un jugador paciente PUEDE matarla solo
  a embestidas, pero es durísimo estando perseguido → la vía real son las columnas.
- **Remate:** al caer la última columna (última cuerda), la Reina queda
  "desconectada" y la embestida al cuerpo sube a **~2 %** (2 golpes y fuera).

## 2. Las 3 válvulas de justicia (aporte de Fable — imprescindibles)

Persecución sin correa (×2.3 en fase 3) + rastro que frena + apuntado casi estático
puede cruzar de "intenso" a "injusto". Estas tres válvulas lo evitan **sin tocar
las decisiones firmes**:

1. **El dash cargado cruza el rastro casi sin penalización.** El rastro castiga el
   movimiento **lento/parado** encima, no el paso a alta velocidad. Niega *dónde te
   paras*, no *por dónde pasas*.
2. **Gracia ~0.5 s antes del daño por tiempo** del rastro (cruzar es gratis;
   quedarse, no).
3. **El rastro decae (~8–12 s)** — obligatorio: si no, la arena se llena y el modo
   paciente pasa de "durísimo" a softlock imposible.

Extra: **contacto de la Reina con wind-up ~0.3 s + empujón fuerte + daño moderado**
(no daño alto arbitrario; el empujón a veces te saca del charco: se autocorrige).

Pendiente de verificar: el juego tiene *aim-zoom* de cámara, pero **no** parece
ralentizar el tiempo al apuntar. Si en playtest el apuntado bajo persecución se
siente injusto, valorar leve dilatación temporal al apuntar o bajar la velocidad
de persecución. (No bloquea el primer pase.)

## 3. La cuerda: mecánica, no decorado

- Mientras una columna tiene cuerda, el cuerpo del boss "resiste" (el ~1 %). Al
  impactarle (dash o proyectil), **las cuerdas destellan** → "su fuerza viene de ahí"
  sin texto.
- **Al romper la columna, la cuerda restalla y ATURDE a la Reina ~1–1.5 s** →
  ventana de recompensa que además *enseña* que el remate al cuerpo existe. Es el
  mejor tutorial implícito.
- La cuerda que **pulsa** telegrafía qué columna va a **parir una larva**.
- **Barra de vida segmentada en 8 chunks**, cada uno ligado a su cuerda/columna; al
  romper, el chunk se drena **viajando por la cuerda**. Esto solo ya vende la mecánica.
- (2.ª iteración) **pulso reparador**: un pulso lento y muy visible viaja del boss a
  una columna agrietada y la repara a los ~10 s → castiga el "agrieto las 8 y luego
  remato". Solo si en playtest esa estrategia aplana el combate.

## 4. Rastro

- **Ralentiza + daño por tiempo** solo con movimiento lento/parado (ver válvulas).
- **Decae** (~8–12 s). **Cap de densidad** de charcos alrededor de cada columna
  intacta (cinturón anti-bloqueo).
- Color tóxico inconfundible + tinte en el héroe + SFX + partículas de "frenado".
- Base técnica: ya existe el pool `Puddle` (`queenStepTrail`, `stepPuddles`) y un
  `HazardKind 'slow'`. Se amplía, no se crea de cero.

## 5. Larvas — "nacen donde trabajan"

Regla de oro: **el origen define el rol**, y no se mezclan (el jugador aprende el
mapa mental en segundos).

- **De columna → guardiana**: orbita su columna de nacimiento, lenta, silueta
  redonda/azulada. **Bloqueo físico**: la embestida la mata pero te **resta algo de
  velocidad** → 2 en línea pueden dejar tu golpe por debajo del umbral de rotura.
  Decisión real: "peino guardias o cebo a la Reina y cuelo el dash".
- **Del boss → perseguidora**: rápida, frágil, roja/puntiaguda. **Muere al
  atravesarla sin frenarte** (limpiar se siente bien, no corta el flow).
- Reparto por fase (cap duro ~6 vivas):
  - **F1**: guardiana solo al **agrietar** una columna (la grieta "sangra" su
    defensora) + 1 perseguidora por oleada.
  - **F2**: 1 guardiana por columna intacta + 2 perseguidoras.
  - **F3**: 3 perseguidoras + las grietas gotean más.

## 6. Curva por fases

- **F1 (columnas 1–3): aula.** Reina lenta, rastro escaso y efímero, casi sin larvas.
  Que el jugador ejecute el bucle 2–3 veces sin castigo serio.
- **F2: presión de espacio.** Rastro más persistente/ancho, guardianas en todas las
  columnas; la Reina ya obliga a cebar de verdad.
- **F3: presión de nervio.** Velocidad ×2.3; (2.ª iter) embestida telegrafiada de la
  Reina que rompe órbitas. La última columna es el pico: enrage visual + audio.
- **Remate como escena, no fase 4:** al caer la última cuerda, **todas las larvas
  mueren/huyen** (limpia la sala para el duelo), la Reina queda aturdida y expuesta,
  y la embestida al cuerpo sube a ~2 %. Rápido y catártico. Si se alarga, vuelve a la
  furia pero sin larvas nuevas.

## 7. Telegrafías mínimas (sin tutorial)

1. **Proyectil vs boss:** rebote visible + "clink" metálico + destello de cuerdas.
   **Nada de números pequeños** (un "1" enseña "insiste": peor que nada).
2. **Barra segmentada en 8 chunks** conectados a sus cuerdas; el chunk se drena
   viajando por la cuerda al romper.
3. **Al agrietar:** hit-stop generoso + la Reina se retuerce/chilla (reacciona aunque
   no pierda vida) + grieta que gotea.
4. **Rastro:** color tóxico + tinte en héroe + SFX al pisar.
5. **Contacto de la Reina:** flash/wind-up ~0.3 s antes de que dañe.
6. **Estado desconectado:** cambio de postura/color + resaltado del chunk restante
   ("ahora sí, al cuerpo").

---

## 8. Alcance

### Primer pase (MVP jugable y divertido)
1. Columnas = vida (2 golpes, grieta, −12 %) + **aturdimiento de la Reina al romper**
   (el latigazo de la cuerda).
2. Persecución con **pathing alrededor de columnas** + contacto con wind-up y empujón.
3. Rastro con **decaimiento + dash inmune al slow + gracia de DoT**.
4. Larvas mínimas: guardianas desde grietas, perseguidoras desde el boss (1/2/3),
   cap total, mueren de un dash.
5. **Cuerdas visuales + barra de 8 chunks + "clink" antiproyectiles.**
6. **Remate:** desconexión = larvas fuera + aturdida + 2 % por golpe.

### Segunda iteración
Pulso reparador de grietas · embestida telegrafiada de la Reina (F3) · escombros
persistentes que alteran rutas · micro-enrage por columna rota · guardianas que
restan velocidad al dash · música/efectos de clímax · tuning fino de caps/decaimientos.

---

## 9. Plan técnico de troceo (para delegar luego, sonnet)

Mapa a los sistemas actuales del código. Cada tarea será un sub-agente con tests.

- **T1 — Columnas destructibles + vida por columnas + barra segmentada.**
  Hoy las columnas son hazards `'rock'` → `Obstacle` sólido no destructible
  (`world.ts:566`). Darles HP (2), estado agrietado, rotura solo por embestida; al
  romper: −12 % al boss, evento de rotura, engancha T2/T4. Proyectiles al boss = 0
  (queen def); embestida directa ~1 %. Segmentar `BossHealthBar` en 8 chunks.
- **T2 — Cuerdas.** Estado (intacta/rota) + render línea boss→columna + aturdir a la
  Reina al romper + destello al impactar + pulso de spawn. Desconexión = todas rotas.
- **T3 — Rastro con slow/DoT + válvulas.** Ampliar `Puddle`/`queenStepTrail`/
  `stepPuddles`: slow + DoT al héroe lento sobre charco, gracia ~0.5 s, decaimiento,
  inmunidad a alta velocidad, cap de densidad junto a columnas. Reusar `HazardKind 'slow'`.
- **T4 — Larvas guardiana vs perseguidora + reparto por fase.** Dos comportamientos;
  origen columna (guardiana orbital, resta velocidad al morir) vs boss (perseguidora).
  Cap ~6. Reparto F1/F2/F3.
- **T5 — Persecución con pathing + contacto wind-up.** Reutilizar
  `guardianMoveTowardWithAvoidance` (evasión ya probada del Guardián) para que la Reina
  rodee columnas. Contacto con wind-up ~0.3 s + empujón.
- **T6 — Remate/desconexión + telegrafías/juice.** Eventos nuevos (clink, grieta,
  rotura-columna, desconexión, drenado de chunk) + `burstTable`/`reactToEvent`. Limpieza
  de larvas al remate + subida a 2 %.

Orden sugerido: T1 → (T2, T3, T4 en paralelo si no chocan de fichero) → T5 → T6.

## 10. Valores a fijar antes de implementar

- Daño embestida directa al cuerpo: **1 %** (¿y 2 % en desconexión?). ¿Confirmado?
- Rastro: velocidad de slow, DoT/s, gracia (0.5 s), decaimiento (¿8, 10, 12 s?).
- Aturdimiento de la Reina al romper columna: 1–1.5 s.
- Velocidades de larva guardiana vs perseguidora; "resta de velocidad" al matar guardiana.
- Cap de larvas vivas (~6) y umbrales de oleada por fase.
- Contacto de la Reina: daño y fuerza del empujón; wind-up 0.3 s.

---

## Nota de estado (2026-08-31)

Este plan se aprobó e implementó el 2026-07-10 (ver `docs/plans/BOSSES_PLAN.md`, sección "Estado", bullet B2): pese al encabezado de arriba ("borrador para aprobar. No implementar hasta el visto bueno de David"), lleva bastante tiempo en producción y esta nota documenta el estado ACTUAL, más simplificado que lo que describe el resto del documento.

**Simplificación 2026-08-31** (playtest de David: "eliminar el rol guardiana") retira buena parte del reparto de larvas de §5/§6: desaparece POR COMPLETO el rol guardiana (§5, "de columna → guardiana": órbita alrededor de su columna, bloqueo físico, resta de velocidad al morir) — confirmado en el código actual, que documenta la eliminación de `queenActivateGuardian`, las constantes `QUEEN_GUARDIAN_*`, el evento `boss-guardian-charge` y sus materiales de render. Sin la guardiana, el reparto por fase que proponía §5/§6 (F1 solo al agrietar + 1 perseguidora; F2 1 guardiana por columna + 2 perseguidoras; F3 3 perseguidoras) ya no aplica: queda un ÚNICO rol, perseguidora, que nace del BORDE de la columna que la pare (nunca del cuerpo del jefe, a diferencia de la "perseguidora ← boss" de §5).

La oleada de invocación única (el disparador implícito de todo el reparto de §5/§6) también desaparece: cada columna VIVA para minions con su propio reloj (`QueenColumn.spawnTimer`, cadencia 6/5/4 s por fase, desfasada por columna) — código eliminado: `queenSpawnChasers`, `queenStepWaves`, `QUEEN_WAVE_INTERVAL`, `QUEEN_CHASER_PER_WAVE_BY_PHASE`. Una columna rota deja de parir.

Otros ajustes de la misma pasada:
- Cupo total de larvas vivas: 10 → 8 (ya no hace falta reservar plazas para guardianas y perseguidoras a la vez).
- Columnas: **2 golpes** (el valor que ya pedía §1 de este plan) — en algún momento posterior a 2026-07-10 habían subido a 3, con un tercer estado visual "leve" en el render que esta pasada también retira.
- Velocidad de acecho por columna rota (§10 la dejaba como "valor a fijar"): quedó en 0.38 u/s por columna al implementarse; el playtest 2026-08-31 la bajó a 0.15 — la original llegaba a más que doblar `HERO_WALK_SPEED` con las 8 columnas rotas.
- Telegrafías nuevas, no previstas en §7: temblor visual de columna al parir un minion o al recibir un impacto de embestida, y un grito/pulso de dolor del propio cuerpo de la Reina al perder una columna — sustituye al "pulso de invocación" (el anillo que acompañaba la oleada única), que quedó sin uso al desaparecer esa oleada.

Comportamiento actual completo: `docs/GDD.md` §15.3 (puesta al día en esta misma pasada).
