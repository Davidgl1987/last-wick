/**
 * Internacionalización (i18n) del juego: snapshot inmutable + `Set` de
 * listeners + `useSyncExternalStore` + persistencia en localStorage — MISMO
 * patrón exacto que `game/audio/audioSettings.ts`/`game/render/postSettings.ts`.
 * El idioma activo no es distinto de un volumen o un toggle visual: una
 * preferencia de baja frecuencia que unos pocos componentes necesitan leer
 * de forma reactiva.
 *
 * Registro automático por directorio (mismo espíritu que
 * `game/features/dungeon/rooms.ts` con las salas de serie): cualquier
 * `locales/*.json` que se suelte en esta carpeta entra al selector de idioma
 * sin tocar una línea de código. El código del idioma sale del NOMBRE DE
 * FICHERO (`./locales/es.json` → `'es'`); su nombre nativo para el
 * desplegable sale de la clave `$meta.name` dentro del propio JSON.
 *
 * `es.json` es el idioma BASE: además de entrar por el glob como cualquier
 * otro, se importa también de forma ESTÁTICA para (a) derivar el tipo
 * `TranslationKey` de su forma real vía `typeof` (`resolveJsonModule` ya
 * está activo) — así `t('titl.play')`, con una errata, no compila — y (b)
 * servir de fallback garantizado cuando el idioma activo no tiene todavía
 * una clave (traducción a medias, ver `t`/`lookupRaw`).
 *
 * SOLO la capa de UI puede importar este módulo: usa `useSyncExternalStore`
 * (React), así que un fichero de sim (`engine/`, `world/`, los `.ts` de cada
 * feature) que lo importara rompería la regla ★ de docs/ARCHITECTURE.md
 * ("los archivos de sim NUNCA importan React"). `session/store.ts` importa
 * el TIPO `TranslationKey` con `import type` — no arrastra React al bundle,
 * y store.ts ya es capa de UI (zustand) de todos modos.
 */

import { useMemo, useSyncExternalStore } from 'react';
import esTranslations from './locales/es.json';

const STORAGE_KEY = 'last-wick:lang';

// ── Tipado de claves ───────────────────────────────────────────────────────

/**
 * Todas las rutas "a.b.c" que llegan a un valor string dentro de un árbol de
 * traducciones anidado (la forma de un locale JSON, sin su rama `$meta`).
 * Recursivo sobre la FORMA de `es.json`: cada nivel de objeto añade un
 * segmento a la ruta, cada hoja string cierra una rama de la unión.
 */
type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? LeafPaths<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

/**
 * Derivada del `typeof` de `es.json`: una clave que no existe en el árbol
 * real (typo, rama movida) no compila. Excluye expresamente `$meta`: es
 * metadato del propio locale (nombre nativo para el desplegable), nunca una
 * etiqueta traducible — por eso `AVAILABLE_LOCALES` lo lee aparte y `t()` no
 * debe poder apuntar ahí.
 *
 * Las claves dinámicas de `upgrades.<id>.name/.desc` y `bosses.<id>.name`
 * siguen tipadas: como `UpgradeId`/`BossId` son uniones literales finitas,
 * TypeScript expande `t(\`upgrades.${def.id}.name\`)` a la unión de
 * combinaciones reales y la valida contra `TranslationKey` igual que una
 * clave escrita a mano. `rooms.<roomId>` NO puede tiparse así (el id de sala
 * es un string dinámico sin unión literal — sala del editor incluida): por
 * eso `tRoomName` existe aparte, sin pasar por `t`.
 */
export type TranslationKey = LeafPaths<Omit<typeof esTranslations, '$meta'>>;

// ── Registro de locales (glob automático) ──────────────────────────────────

interface LocaleModule {
  default: Record<string, unknown>;
}

const LOCALE_MODULES = import.meta.glob('./locales/*.json', { eager: true }) as Record<string, LocaleModule>;

/** './locales/es.json' → 'es'. El código de idioma ES el nombre de fichero. */
function localeCodeFromPath(path: string): string {
  const filename = path.slice(path.lastIndexOf('/') + 1);
  return filename.slice(0, filename.lastIndexOf('.'));
}

/**
 * Aplana un árbol de traducciones anidado a claves "a.b.c" (recursivo),
 * saltando la rama `$meta` de nivel raíz (metadato del locale, nunca una
 * clave de traducción — ver `TranslationKey`).
 */
function flatten(tree: Record<string, unknown>, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const key of Object.keys(tree)) {
    if (prefix === '' && key === '$meta') continue;
    const value = tree[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[path] = value;
    } else if (value !== null && typeof value === 'object') {
      flatten(value as Record<string, unknown>, path, out);
    }
  }
  return out;
}

interface LoadedLocale {
  code: string;
  name: string;
  flat: Record<string, string>;
}

function loadLocales(): Map<string, LoadedLocale> {
  const map = new Map<string, LoadedLocale>();
  // Orden alfabético de ruta explícito (no depender del orden interno del
  // glob de Vite), mismo motivo que rooms.ts.
  for (const path of Object.keys(LOCALE_MODULES).sort()) {
    const code = localeCodeFromPath(path);
    const tree = LOCALE_MODULES[path].default;
    const meta = tree['$meta'] as { name?: string } | undefined;
    map.set(code, { code, name: meta?.name ?? code, flat: flatten(tree) });
  }
  return map;
}

const LOCALES: Map<string, LoadedLocale> = loadLocales();

/**
 * `[{ code: 'es', name: 'Español' }, …]`, ordenado alfabéticamente por
 * código — el desplegable de idioma se rellena SOLO con esto: soltar un
 * `fr.json` en `locales/` basta para que aparezca una opción nueva, sin
 * tocar ni TitleScreen ni PauseModal.
 */
export const AVAILABLE_LOCALES: readonly { code: string; name: string }[] = Array.from(LOCALES.values())
  .map(({ code, name }) => ({ code, name }))
  .sort((a, b) => a.code.localeCompare(b.code));

const BASE_LOCALE = 'es';

/**
 * Traducciones base, aplanadas del import ESTÁTICO (no del glob): es el
 * fallback que SIEMPRE existe pase lo que pase con el registro dinámico —
 * ver cabecera del módulo, punto (b).
 */
const BASE_TRANSLATIONS: Record<string, string> = flatten(esTranslations as unknown as Record<string, unknown>);

// ── Detección de idioma inicial ─────────────────────────────────────────────

/**
 * localStorage (elección ya guardada del jugador) → `navigator.language`
 * (`es*` → 'es', cualquier otra cosa → 'en') → 'es' si ese código no
 * estuviera cargado entre los locales disponibles.
 */
function detectInitialLang(): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && LOCALES.has(stored)) return stored;
  }
  const navLang = typeof navigator !== 'undefined' ? navigator.language : '';
  const guess = navLang.toLowerCase().startsWith('es') ? 'es' : 'en';
  return LOCALES.has(guess) ? guess : BASE_LOCALE;
}

// ── Snapshot reactivo (mismo patrón que audioSettings.ts) ──────────────────

let currentLang: string = detectInitialLang();

/** Listeners registrados por `subscribe` (usados por useSyncExternalStore). */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  return currentLang;
}

/** Claves ya avisadas por `t()` en DEV, para no repetir el mismo warning en cada render/frame — ver `t`. */
const warnedMissingKeys = new Set<string>();

/** Busca una clave (sin tipar) en el idioma activo, cayendo a `es` — compartido por `t` y `tRoomName`. */
function lookupRaw(key: string): string | undefined {
  const locale = LOCALES.get(currentLang);
  return locale?.flat[key] ?? BASE_TRANSLATIONS[key];
}

function interpolate(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Traduce una clave FUERA de React (useGameLoop, sfxEngine, document.title,
 * rAF imperativos como BossHealthBar/WeaponBar…): lee el idioma ACTUAL en
 * cada llamada, sin suscribirse a cambios. Un componente que solo llamara a
 * `t` en su cuerpo de render no se re-renderizaría al cambiar de idioma —
 * para eso está `useT()`.
 *
 * Fallback en cascada: idioma activo → es (`BASE_TRANSLATIONS`) → la propia
 * clave devuelta tal cual. En DEV (`import.meta.env.DEV`) avisa por consola
 * UNA SOLA VEZ por clave ausente: ayuda de desarrollo deliberada para pillar
 * etiquetas que se quedaron sin traducir en un idioma a medias (p.ej.
 * `en.json` mientras T2 no llegue) — nunca se dispara en producción ni
 * inunda la consola en cada frame.
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  let raw = lookupRaw(key);
  if (raw === undefined) {
    if (import.meta.env.DEV && !warnedMissingKeys.has(key)) {
      warnedMissingKeys.add(key);
      console.warn(`[i18n] clave ausente en todos los locales: "${key}"`);
    }
    raw = key;
  }
  return params ? interpolate(raw, params) : raw;
}

/**
 * Nombre traducido de una sala por su id de RUNTIME. Aparte de `t` a
 * propósito: el id de sala es un string dinámico (de serie, de test, o
 * creado/importado por el editor) que no puede acotarse a una unión
 * literal, así que esta clave nunca puede tiparse como `TranslationKey`.
 *
 * Cascada:
 * 1) existe `rooms.<roomId>` en el idioma activo o en `es` → esa traducción.
 * 2) `roomId` empieza por 'fallback-' (salas de emergencia del generador
 *    procedural, ver dungeon.ts) → `rooms.fallback` con `{n} = número + 1`.
 * 3) cualquier otro caso (sala del editor sin clave propia) → `fallbackName`,
 *    el `name` que ya trae su RoomData — así una sala creada o importada por
 *    el jugador sigue mostrando su propio nombre.
 */
export function tRoomName(roomId: string, fallbackName: string): string {
  const raw = lookupRaw(`rooms.${roomId}`);
  if (raw !== undefined) return raw;
  if (roomId.startsWith('fallback-')) {
    const n = Number(roomId.slice('fallback-'.length));
    return t('rooms.fallback', { n: n + 1 });
  }
  return fallbackName;
}

/** `document.documentElement.lang` + título de pestaña — aplicado al arrancar el módulo y en cada `setLang`. Guardas de `typeof document`: vitest corre en entorno `node`, sin DOM. */
function applyGlobalEffects(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = currentLang;
  document.title = t('meta.title');
}

/** Cambia el idioma activo, persiste en localStorage y notifica a los listeners (useT/useLang se re-renderizan vía useSyncExternalStore). No-op si `code` no es un locale cargado o ya es el activo. */
export function setLang(code: string): void {
  if (!LOCALES.has(code) || code === currentLang) return;
  currentLang = code;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, code);
  }
  applyGlobalEffects();
  for (const listener of listeners) listener();
}

/** Snapshot del código de idioma activo sin engancharse a React (mismo espíritu que `getAudioSettings`). */
export function getLang(): string {
  return currentLang;
}

/** Hook de lectura reactiva del código de idioma activo — re-renderiza al cambiar (ver `setLang`). */
export function useLang(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook de traducción: se suscribe al idioma activo, así que TODO componente
 * que llame a `useT()` re-renderiza (y re-traduce) al cambiar de idioma.
 * Devuelve una función ESTABLE por idioma (memoizada por código, no una
 * nueva por render): puede pasarse a deps de useEffect/useMemo sin
 * re-disparar en cada pintado normal, solo cuando el idioma cambia de verdad.
 */
export function useT(): (key: TranslationKey, params?: Record<string, string | number>) => string {
  const lang = useLang();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `lang` no se lee en el cuerpo (t() ya consulta currentLang), pero SÍ es la dependencia que debe forzar una identidad nueva cuando cambia el idioma.
  return useMemo(() => (key: TranslationKey, params?: Record<string, string | number>) => t(key, params), [lang]);
}

applyGlobalEffects();
