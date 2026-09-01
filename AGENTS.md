# Protocolo para agentes implementadores (Last Wick v2)

*Todo sub-agente que implemente en este repo DEBE leer este fichero primero y cumplirlo. El prompt de cada tarea solo contiene el QUÉ; el CÓMO vive aquí.*

## Fuentes de verdad (leer antes de escribir código)

1. `docs/GDD.md` — diseño jugable completo. Tu spec de comportamiento. La sección relevante se indica en el prompt de la tarea.
2. `docs/ARCHITECTURE.md` — contrato técnico: estructura de módulos, presupuesto de rendimiento, prohibiciones. No negociable.
3. El código actual de `src/` — respeta sus patrones al pie de la letra: sim pura en `engine/` + `game/world/` + los `.ts` de cada `game/features/*/` (sin imports de React/three; árbol completo en ARCHITECTURE.md), eventos por ring buffer (`engine/events.ts`), render que muta `object3D` en `useFrame` sin setState por frame, pools preasignados (cero `new`/arrays/closures por frame), geometrías y materiales compartidos en `game/render/assets.ts`, zustand solo para UI de baja frecuencia.

## Reglas de proceso (su incumplimiento arruinó fases anteriores)

- **NO uses la herramienta Agent** ni lances sub-agentes. NO esperes "notificaciones" de nadie: no hay nadie más trabajando. TODO lo implementas TÚ, de principio a fin, ahora.
- **NO toques git** salvo lecturas (`status`/`diff`/`log`). Los commits los hace el orquestador.
- **NO arranques ni mates servidores.** El dev server del puerto 5180 puede estar sirviendo un túnel ngrok del usuario. Si ves HMR recompilando mientras editas, es normal.
- **NO ejecutes `npm install`** (y menos en background). Si crees imprescindible una dependencia nueva: párate y dilo en el informe.
- **vitest SIEMPRE con `run`**: `npm test` o `npx vitest run <fichero>`. `npx vitest <fichero>` a secas entra en modo WATCH y no termina nunca → el watchdog de inactividad te mata a los 600 s (pasó tres veces seguidas el 2026-07-06). En general: ningún comando que pueda quedarse >5 min sin emitir salida.
- **NO mires código de ramas antiguas** (main, rapier-rewrite) ni el historial git. Este juego se implementa solo desde los docs + el código actual de la rama.
- Conserva funcionales los puentes dev-only `window.__lastwick` (useGameLoop.ts) y `window.__lastwickScene` (GameRoot.tsx).

## Trampas conocidas de este código (aprendidas a base de bugs)

- **`setPointerCapture` SIEMPRE en try/catch** (revienta con punteros sintéticos y punteros perdidos; ya mordió dos veces).
- **Sombras/meshes hijos de un grupo posicionado usan coordenadas LOCALES**, nunca de mundo (bug de la sombra a 2× posición).
- **Vistas con lookup por id** (`world.enemies.find(...)`): si el lookup falla, `group.visible = false` y return — nunca dejes grupos huérfanos en el origen.
- **Lo visual debe prometer lo mecánico**: radios de efecto visibles (explosiones, telegrafiados) = radios de daño reales.
- La IA nunca debe suicidarse contra hazards (fosos, pinchos, barriles vivos): la zona vetada incluye el radio del cuerpo.
- Ids de entidad namespaced por sala (`sala:id`) en mundo multi-sala.
- **Vistas contenedoras que hacen `.map` sobre un array que crece por `.push` en runtime** (p. ej. `world.barrels`/`world.items` cuando `guardianSpawnBarrel`/`dropPotionAt`/`dropCoinAt` añaden entidades a mitad de partida) necesitan su propio trigger de re-render por `.length`: un `useState` con el último length visto + comparación dentro de un `useFrame` que solo llama a `setState` cuando cambia (nunca por frame). Sin esto, `session` es una ref estable creada una vez y nada dispara `setState` de React al hacer `push` — las entidades nacidas tras el montaje del componente no reciben mesh NUNCA (bug confirmado en playtest B1.6: barriles/pociones/monedas invisibles). Patrón ya aplicado en `BarrelViews`/`ItemViews` (render/HazardView.tsx, render/ItemView.tsx).
- **Mapa de jefes:** un jefe = una entrada en `bosses/registry.ts::BOSS_DEFS` que implementa el contrato `BossDef` (`bosses/types.ts`, JSDoc completo por campo ahí: `stepPattern` obligatorio; `stepState`, `onPhaseChanged`, `onInit` opcionales) + su propia carpeta `bosses/<id>/` (`pattern.ts`, `constants.ts`, `BossView.tsx`, tests — y lo que necesite: `guardian/barrels.ts`, `queen/columns.ts`+`larvae.ts`). Los jefes nunca pasan por `stepEnemyAi`: reutilizan campos genéricos de `Enemy` pensados para enemigos normales (`patrolTo`/`patrolFrom`, `bossTimer`, `bossStage`, `bossCounter`, `bossTelegraphUntil`/`Kind`, `facing`…) como almacenamiento propio de su patrón, en vez de ampliar `Enemy` con campos `boss*` nuevos — el significado de cada campo para un jefe concreto lo documenta la cabecera de SU `pattern.ts`, no hay tabla común.
- **Todo `GameEventType` nuevo (`engine/events.ts`) hay que darlo de alta en 2 tablas independientes, o algo se rompe:** `features/effects/burstTable.ts::BURST_BY_EVENT` es un `Record<GameEventType, BurstSpec>` total — si falta una clave, falla el TYPECHECK (usa la entrada `NONE` si el evento no tiene burst propio). `audio/eventSfx.ts` reparte cada evento entre `SFX_BY_EVENT` (con su clip) o `SILENT_EVENTS` (mudo a propósito, con el motivo en comentario) — ese reparto no es exhaustivo por tipos (`SFX_BY_EVENT` es `Partial`), lo exige `eventSfx.test.ts` en runtime.
- **`audio/clips.ts` solo cataloga los MP3 que ya existen en `public/audio/`**, no es una lista de deseos: no se puede inventar un `SfxClipName` sin fichero real detrás. Un sonido nuevo reutiliza el clip existente que más se le parezca; traer un fichero de audio nuevo es decisión de David, no del agente.

## Criterios de aceptación (verifícalos TÚ antes del informe final)

```
npm run typecheck   # limpio, sin any
npm test            # TODOS en verde (los existentes + los tuyos nuevos)
npm run build       # limpio
```

- Toda lógica de sim nueva lleva tests headless en vitest (`src/**/*.test.ts`, entorno node, sin DOM/three).
- Sin `console.log` ni instrumentación olvidada en `src/`.
- Repasa tus `useFrame`: cero asignaciones por frame.

## Informe final (formato)

1. Ficheros creados/modificados (con 1 línea de por qué cada grupo).
2. Salida resumida de typecheck/test/build (números literales).
3. Decisiones que tomaste no cubiertas por el GDD, con su motivo.
4. Causa raíz de cualquier bug que arreglaras (no "lo arreglé": el porqué).
5. Qué debe verificar visualmente el orquestador, punto por punto, y cómo (el puente `__lastwick.tick(s)` permite avanzar la sim aunque el tab esté oculto; `?seed=N` fija la mazmorra).
