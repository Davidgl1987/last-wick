/**
 * Red de seguridad de la internacionalización (plan §5,
 * /Users/david/.claude/plans/drifting-conjuring-hummingbird.md): `t(...)` cae
 * en cascada a `es` y, si tampoco existe ahí, devuelve la CLAVE tal cual (ver
 * `lookupRaw`/`t` en `./index.ts`) — a propósito, para que un locale a medias
 * no rompa la partida. Eso significa que nada en tiempo de ejecución avisa de
 * un JSON desincronizado o un literal que se coló sin pasar por `t(...)`; el
 * jugador simplemente vería una clave cruda o una frase en el idioma
 * equivocado. Este fichero es el único sitio que sí lo comprueba.
 *
 * Cinco bloques independientes, cada uno cubriendo una forma distinta de que
 * la i18n se rompa en silencio:
 *
 *   1. Paridad de CLAVES entre locales — un `fr.json` a medias (o un `es.json`
 *      al que se le olvida borrar una rama al quitar una feature) se detecta
 *      al instante, con la lista exacta de lo que falta/sobra.
 *   2. Paridad de MARCADORES `{...}` — traducir puede perder un `{coins}` sin
 *      que nadie lo note hasta verlo en pantalla (o ni eso, si el hueco cae en
 *      medio de una frase que sigue leyéndose "bien").
 *   3. Cobertura CÓDIGO → JSON — un typo en `t('hus.hp')` no lo pilla
 *      TypeScript si la clave se parece lo bastante a otra válida... salvo que
 *      SÍ lo pilla, porque `TranslationKey` es un tipo cerrado (ver
 *      `./index.ts`). Este bloque existe para el día que alguien tipe `t(x as
 *      TranslationKey)` para saltarse el tipo, o para cualquier fork futuro
 *      que afloje esa garantía: la red de seguridad no debe depender de que
 *      nadie se salte el tipo.
 *   4. Claves de SALA completas — `rooms.<id>` no puede tiparse contra una
 *      unión literal (el id de sala es un string dinámico, editor incluido:
 *      ver el comentario de `TranslationKey` en `./index.ts`), así que es el
 *      único de los ~140 grupos de claves que TypeScript no protege por sí
 *      solo. Sala nueva en el pool sin su nombre en `es.json` → rojo aquí.
 *   5. Sin LITERALES sueltos en la capa de UI — el más valioso de los cinco:
 *      los cuatro anteriores validan que lo que YA está en `t(...)` sea
 *      consistente, pero nada les impide a un `<p>Cargando…</p>` a pelo
 *      colarse en un componente nuevo. Este es el que lo pilla.
 *
 * Los bloques 3 y 5 recorren el AST real (`typescript`, ya es devDependency
 * del proyecto — build/typecheck la usan) en vez de grep/regex: un regex
 * sobre "texto entre `>` y `<`" confunde genéricos (`useRef<Group>`),
 * comparaciones (`hp < prevHp`) y JSX anidado dentro de un condicional
 * (`{cond ? <p>texto</p> : null}`) con marcado real; el compilador no.
 * Verificado a mano contra este mismo fichero de reglas: un `<p>literal</p>`
 * anidado en un ternario SÍ lo encuentra el visitor de abajo.
 *
 * Todas las rutas se anclan a la ubicación de ESTE fichero (vía
 * `import.meta.url`), nunca a `process.cwd()` (puede variar según desde
 * dónde se invoque vitest).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

/**
 * `types/node-shim.d.ts` es un shim MÍNIMO a propósito — el proyecto no
 * incluye `@types/node` (la app es 100% navegador; ver cabecera de ese
 * fichero) y solo declara lo que el middleware de `vite.config.ts` y
 * `kit-models.test.ts` ya necesitaban: `readdirSync(path): string[]` sin
 * opciones, `resolve` y poco más — ni `readFileSync`, ni `dirname`/`join`, ni
 * `node:url`. Esta tarea solo puede tocar este fichero (encargo), así que en
 * vez de ampliar el shim compartido se AUMENTA aquí lo que hace falta y el
 * shim no cubre — mismo mecanismo `declare module` que ya usa
 * `node-shim.d.ts`, que TypeScript fusiona con lo ya declarado allí (la
 * nueva firma de `readdirSync` se suma como SOBRECARGA, no reemplaza la
 * existente). `node:url` queda fuera a propósito: un fichero con `import`
 * de nivel superior (éste lo es) solo puede AUMENTAR un módulo ambiental que
 * ya exista en algún sitio — `node:fs`/`node:path` existen (via el shim),
 * pero `node:url` no existe en ningún `.d.ts` del proyecto y no puede
 * crearse desde aquí; `new URL(import.meta.url).pathname` (API web, ya
 * tipada por `lib: ["DOM", ...]` de tsconfig.json) evita necesitarlo.
 * Tipado sin `any`, mismo criterio que el shim original.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  interface Dirent {
    name: string;
    isDirectory(): boolean;
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
}
declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}

// ── Rutas base ───────────────────────────────────────────────────────────

/** file://... → /ruta/absoluta (decodeURIComponent por si la ruta tuviera espacios/acentos). */
function fileUrlToPath(fileUrl: string): string {
  return decodeURIComponent(new URL(fileUrl).pathname);
}

const I18N_DIR = dirname(fileUrlToPath(import.meta.url)); // src/i18n
const LOCALES_DIR = join(I18N_DIR, 'locales');
const SRC_DIR = dirname(I18N_DIR); // src
const REPO_ROOT = dirname(SRC_DIR);
const BASE_LOCALE = 'es';

/** Ruta relativa a REPO_ROOT con '/' siempre (mensajes estables entre SO), solo para los `expect` de abajo. */
function relPath(absPath: string): string {
  return absPath.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
}

/** Recorre un directorio entero, ficheros de cualquier profundidad, orden alfabético explícito en cada nivel (mismo criterio que rooms.ts/i18n/index.ts: no depender del orden del propio FS). */
function walk(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ── Locales: mismo aplanado que ./index.ts, reimplementado a propósito ────
//
// Este fichero valida los DATOS (los .json); si importara `flatten`/`t` de
// `./index.ts` para hacerlo, un bug en esa función podría ocultar justo el
// tipo de desincronización que este test existe para pillar. Se duplica la
// lógica (small, ~10 líneas) en vez de compartirla.

type LocaleTree = Record<string, unknown>;

/** `{ "a": { "b": "c" } }` → `Map{ "a.b" → "c" }`. Salta `$meta` de nivel raíz: es metadato del locale (nombre nativo para el desplegable), nunca una clave traducible — igual que en `./index.ts`. */
function flattenLocale(tree: LocaleTree, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const key of Object.keys(tree)) {
    if (prefix === '' && key === '$meta') continue;
    const value = tree[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, value);
    } else if (value !== null && typeof value === 'object') {
      flattenLocale(value as LocaleTree, path, out);
    }
  }
  return out;
}

interface LoadedLocale {
  code: string;
  flat: Map<string, string>;
}

/** Descubre los locales LEYENDO EL DIRECTORIO (nunca una lista escrita a mano): soltar un `fr.json` nuevo en `locales/` lo mete en la red sin tocar este fichero. */
function loadLocales(): LoadedLocale[] {
  return readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((filename) => {
      const code = filename.slice(0, -'.json'.length);
      const tree = JSON.parse(readFileSync(join(LOCALES_DIR, filename), 'utf8')) as LocaleTree;
      return { code, flat: flattenLocale(tree) };
    });
}

const LOCALES = loadLocales();
const BASE = LOCALES.find((l) => l.code === BASE_LOCALE);
if (!BASE) {
  throw new Error(`No se encuentra el locale base "${BASE_LOCALE}.json" en ${LOCALES_DIR} — toda la suite depende de él.`);
}
const BASE_KEYS = new Set(BASE.flat.keys());
const NON_BASE_LOCALES = LOCALES.filter((l) => l.code !== BASE_LOCALE);

// ── TypeScript AST: utilidades compartidas por los bloques 3, 4 y 5 ────────

function scriptKindFor(path: string): ts.ScriptKind {
  return path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Parseo SINTÁCTICO (no type-check: no hace falta un Program completo para esto, y es muchísimo más barato). */
function parseFile(path: string): ts.SourceFile {
  const text = readFileSync(path, 'utf8');
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, scriptKindFor(path));
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isSourceFile(path: string): boolean {
  return /\.tsx?$/.test(path);
}

function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Paridad de claves entre locales
// ═══════════════════════════════════════════════════════════════════════
//
// `t()` cae en cascada a `es` si a un locale le falta una clave (ver cabecera
// del fichero), así que un `en.json` incompleto NUNCA rompe la build ni un
// test que solo juegue en español: se traduciría en silencio a español. Este
// es el único sitio que lo hace visible.

describe('1. Paridad de claves entre locales', () => {
  it('hay al menos un locale además de "es" en src/i18n/locales/ (si esto falla, el resto del bloque pasa vacío y oculta el problema real)', () => {
    expect(NON_BASE_LOCALES.length).toBeGreaterThan(0);
  });

  for (const locale of NON_BASE_LOCALES) describe(`${locale.code}.json`, () => {
    it('tiene exactamente el mismo conjunto de claves que es.json', () => {
      const localeKeys = new Set(locale.flat.keys());
      const missing = [...BASE_KEYS].filter((k) => !localeKeys.has(k)).sort();
      const extra = [...localeKeys].filter((k) => !BASE_KEYS.has(k)).sort();
      const detail = [
        missing.length ? `faltan (${missing.length}): ${missing.join(', ')}` : '',
        extra.length ? `sobran (${extra.length}): ${extra.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' | ');
      expect([...missing, ...extra], `${locale.code}.json desincronizado de es.json — ${detail}`).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Paridad de marcadores de interpolación {...}
// ═══════════════════════════════════════════════════════════════════════
//
// Mismo regex que `interpolate()` en ./index.ts (\{(\w+)\}): "qué cuenta como
// marcador" lo define el motor real, no una idea aparte de lo que debería
// serlo. Si `en.json` traduce "Coins: {coins}" a "Coins" a secas, `t('shop.
// balance', { coins })` seguiría devolviendo un string (ver fallback de `t`),
// solo que sin la cifra — un bug silencioso que ningún test de tipos pilla.

const MARKER_RE = /\{(\w+)\}/g;

function markersOf(text: string): Set<string> {
  return new Set([...text.matchAll(MARKER_RE)].map((m) => m[1]!));
}

function setEquals(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

describe('2. Paridad de marcadores de interpolación {...}', () => {
  for (const locale of NON_BASE_LOCALES) describe(`${locale.code}.json`, () => {
    it('usa los mismos {marcadores} que es.json en cada clave compartida', () => {
      // Solo claves presentes en AMBOS: una clave ausente ya la reporta el
      // bloque 1 — duplicarla aquí (con "marcadores: [] vs [algo]") solo
      // añadiría ruido al fallo real.
      const problems: string[] = [];
      for (const key of BASE_KEYS) {
        const localeText = locale.flat.get(key);
        if (localeText === undefined) continue;
        const baseMarkers = markersOf(BASE.flat.get(key)!);
        const localeMarkers = markersOf(localeText);
        if (setEquals(baseMarkers, localeMarkers)) continue;
        const missing = [...baseMarkers].filter((m) => !localeMarkers.has(m));
        const extra = [...localeMarkers].filter((m) => !baseMarkers.has(m));
        const detail = [missing.length ? `faltan {${missing.join('}, {')}}` : '', extra.length ? `sobran {${extra.join('}, {')}}` : '']
          .filter(Boolean)
          .join('; ');
        problems.push(`${key} (${detail}) — es: "${BASE.flat.get(key)}" / ${locale.code}: "${localeText}"`);
      }
      expect(problems, `${locale.code}.json: claves con marcadores desincronizados de es.json:\n${problems.join('\n')}`).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Cobertura código → JSON: toda clave t('literal') usada existe en es.json
// ═══════════════════════════════════════════════════════════════════════
//
// `TranslationKey` (./index.ts) ya hace esto imposible de compilar para una
// clave ESCRITA A MANO — este bloque es la red de respaldo si algún día esa
// garantía de tipos se debilita (un `as TranslationKey`, un `t(key as any)`
// de emergencia...), y cubre además el caso de que alguien mueva/renombre una
// clave en es.json sin `grep` previo del código que la usaba.
//
// Excluye `*.test.ts` (fixtures de test pueden usar claves ficticias a
// propósito) y `src/i18n/` entera (su propio código interno, incluida esta
// suite: la cabecera de ./index.ts documenta a propósito una clave INVÁLIDA
// de ejemplo — `t('titl.play')` — dentro de un comentario, que un escaneo
// ingenuo confundiría con una llamada real).

/** Toda llamada `t(<string literal>)` de un AST ya parseado. Ignora deliberadamente template literals (`` t(`upgrades.${id}.name`) ``): esas ya las valida TypeScript contra `TranslationKey` (ver cabecera de ./index.ts) — reproducirlo aquí a mano solo añadiría una segunda fuente de verdad que mantener sincronizada. */
function collectLiteralTCalls(sourceFile: ts.SourceFile): { key: string; line: number }[] {
  const calls: { key: string; line: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't' &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      calls.push({ key: (node.arguments[0] as ts.StringLiteral).text, line: lineOf(sourceFile, node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

describe('3. Cobertura código → JSON', () => {
  const files = walk(SRC_DIR).filter((p) => isSourceFile(p) && !isTestFile(p) && !relPath(p).startsWith('src/i18n/'));
  const usages = files.flatMap((path) => collectLiteralTCalls(parseFile(path)).map((c) => ({ ...c, file: path })));

  it('se han encontrado llamadas t(\'clave-literal\') en el código (si esto da 0, el escaneo está roto, no es que el juego dejara de usar i18n)', () => {
    expect(usages.length).toBeGreaterThan(0);
  });

  it('toda clave t(\'literal\') usada en el código existe en es.json', () => {
    const orphans = usages.filter((u) => !BASE_KEYS.has(u.key));
    const detail = orphans.map((o) => `${relPath(o.file)}:${o.line} → t('${o.key}')`);
    expect(detail, `claves usadas en código que no existen en es.json:\n${detail.join('\n')}`).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Claves de sala completas: rooms.<id> para toda sala del pool
// ═══════════════════════════════════════════════════════════════════════
//
// `rooms.<roomId>` no puede tiparse como unión literal cerrada (el id de sala
// es un string dinámico — sala del editor incluida, ver el comentario de
// `TranslationKey` en ./index.ts) — es el ÚNICO grupo de claves de los ~140
// que TypeScript no protege por sí solo. `tRoomName` ya cae a `fallbackName`
// (el `name` de autor del JSON) si falta la clave, así que una sala nueva sin
// traducir NUNCA rompe el juego, solo se muestra en español a un jugador en
// inglés — exactamente el tipo de bug silencioso que este bloque expone.

const LEVELS_DIR = join(SRC_DIR, 'game/features/dungeon/levels');
const ROOMS_TS_PATH = join(SRC_DIR, 'game/features/dungeon/rooms.ts');

/** Lee el `id` de cada sala de serie DIRECTAMENTE del JSON (no del nombre de fichero, aunque hoy coincidan por convención — ver room-pool-integrity.test.ts): es el campo que `tRoomName` usa en runtime. */
function loadLevelRoomIds(): { filename: string; id: string }[] {
  return readdirSync(LEVELS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((filename) => {
      const data = JSON.parse(readFileSync(join(LEVELS_DIR, filename), 'utf8')) as { id?: unknown };
      if (typeof data.id !== 'string') {
        throw new Error(`${filename}: "id" ausente o no es string — no se puede comprobar su clave de traducción.`);
      }
      return { filename, id: data.id };
    });
}

/** Extrae `testRoom.id` del propio AST de rooms.ts (en vez de escribir 'test-fase-2' a mano aquí): si David le cambia el id algún día, este test lo sigue solo en vez de quedarse comprobando un id que ya no existe. */
function loadTestRoomId(): string {
  const sourceFile = parseFile(ROOMS_TS_PATH);
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'testRoom' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const prop of node.initializer.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'id' && ts.isStringLiteral(prop.initializer)) {
          found = prop.initializer.text;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (found === undefined) {
    throw new Error(`No se pudo extraer testRoom.id de ${relPath(ROOMS_TS_PATH)} — ¿cambió de forma (dejó de ser un object literal con "id")?`);
  }
  return found;
}

describe('4. Toda sala del pool de serie tiene su clave rooms.<id>', () => {
  const levelRooms = loadLevelRoomIds();

  it('se han encontrado salas de serie en levels/*.json (salvaguarda del propio escaneo)', () => {
    expect(levelRooms.length).toBeGreaterThan(0);
  });

  it.each(levelRooms)('$filename (id "$id") tiene clave rooms.<id> en es.json', ({ id }) => {
    expect(BASE_KEYS.has(`rooms.${id}`), `falta la clave "rooms.${id}" en es.json`).toBe(true);
  });

  it('la Sala de Pruebas de rooms.ts (testRoom, fase 2) tiene su clave rooms.<id>', () => {
    const testRoomId = loadTestRoomId();
    expect(BASE_KEYS.has(`rooms.${testRoomId}`), `falta la clave "rooms.${testRoomId}" en es.json`).toBe(true);
  });

  it('existe rooms.fallback (salas de emergencia del generador procedural, ver tRoomName en ./index.ts)', () => {
    expect(BASE_KEYS.has('rooms.fallback'), 'falta la clave "rooms.fallback" en es.json').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Sin literales sueltos en la capa de UI
// ═══════════════════════════════════════════════════════════════════════
//
// El test más valioso de los cinco: los cuatro anteriores validan que lo que
// YA pasa por `t(...)` sea consistente, pero ninguno impide que un
// `<p>Cargando…</p>` a pelo se cuele en un componente nuevo el mes que viene.
// Dos patrones (calcados del encargo, nada más — ver cabecera del fichero):
//   - nodos de texto JSX con al menos una letra Unicode (evita falsos
//     positivos con separadores puramente simbólicos como "×" o "/"),
//   - los atributos aria-label / title / placeholder / alt / label con un
//     STRING LITERAL (no `={...}`, que ya es dinámico por construcción).
//
// Recorre el AST real en vez de regex — ver cabecera del fichero para el
// porqué (genéricos, comparaciones y JSX anidado en condicionales confunden
// a un regex de "texto entre `>` y `<`", no a un parser de verdad).

const TARGET_ATTRS: ReadonlySet<string> = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label']);

/** Al menos una letra Unicode (incluye acentos/ñ): "×", "%", "/" o espacios en blanco NO cuentan como texto de usuario — es justo lo que deja pasar sin necesidad de allowlist a los formateadores de los sliders. */
const HAS_LETTER_RE = /\p{L}/u;

interface LiteralViolation {
  file: string;
  line: number;
  kind: 'texto JSX' | 'atributo';
  text: string;
}

function collectLiteralViolations(sourceFile: ts.SourceFile): LiteralViolation[] {
  const violations: LiteralViolation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim().replace(/\s+/g, ' ');
      if (text !== '' && HAS_LETTER_RE.test(text)) {
        violations.push({ file: sourceFile.fileName, line: lineOf(sourceFile, node), kind: 'texto JSX', text });
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (TARGET_ATTRS.has(name) && node.initializer && ts.isStringLiteral(node.initializer)) {
        violations.push({
          file: sourceFile.fileName,
          line: lineOf(sourceFile, node),
          kind: 'atributo',
          text: `${name}="${node.initializer.text}"`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function tsxFilesUnder(dir: string): string[] {
  return walk(dir).filter((p) => p.endsWith('.tsx'));
}

const UI_SCAN_FILES: string[] = [
  ...tsxFilesUnder(join(SRC_DIR, 'game/ui')),
  join(SRC_DIR, 'app/App.tsx'),
  ...tsxFilesUnder(join(SRC_DIR, 'ui')),
  join(SRC_DIR, 'game/features/bosses/BossHealthBar.tsx'),
].sort();

/**
 * Excepciones concretas, nunca ficheros enteros (eso anularía el test justo
 * donde más falta hace) — cada entrada con su motivo, añadida SOLO tras verla
 * saltar de verdad (nunca especulando, ver informe de la tarea T3).
 */
const ALLOWED_LITERALS: ReadonlySet<string> = new Set<string>([
  // VACÍA a propósito, y así debería seguir: el único literal que llegó a
  // entrar aquí ('-- FPS', el placeholder del contador de FpsCounter.tsx) se
  // migró a la clave `hud.fps` en cuanto este test lo destapó. Antes de añadir
  // una excepción, plantéate migrar el texto: es casi siempre menos trabajo
  // que justificar por qué ese literal concreto puede quedarse sin traducir.
]);

describe('5. Sin literales sueltos en la capa de UI', () => {
  const allViolations = UI_SCAN_FILES.flatMap((path) => collectLiteralViolations(parseFile(path)));
  const real = allViolations.filter((v) => !ALLOWED_LITERALS.has(v.text));

  it('se ha escaneado al menos un fichero de la capa de UI (salvaguarda del propio escaneo)', () => {
    expect(UI_SCAN_FILES.length).toBeGreaterThan(0);
  });

  it('toda entrada de ALLOWED_LITERALS sigue apareciendo de verdad (si no, sobra: la allowlist no es un cementerio)', () => {
    const seen = new Set(allViolations.map((v) => v.text));
    const stale = [...ALLOWED_LITERALS].filter((s) => !seen.has(s));
    expect(stale, `entradas de ALLOWED_LITERALS que ya no hacen falta (borrarlas): ${stale.join(', ')}`).toEqual([]);
  });

  it('todo texto de usuario sale de t(...) — nada de prosa suelta fuera de la allowlist', () => {
    const detail = real.map((v) => `${relPath(v.file)}:${v.line} [${v.kind}] ${v.text}`);
    expect(detail, `literales de UI sin traducir fuera de la allowlist:\n${detail.join('\n')}`).toEqual([]);
  });
});
