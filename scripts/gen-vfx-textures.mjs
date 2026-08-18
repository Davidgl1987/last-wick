// Generador de texturas VFX propias (copo de nieve, rayo, llama).
// PNG RGBA 8-bit escrito a mano: no hay ImageMagick ni PIL en esta máquina.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 256;

// ── Encoder PNG mínimo ────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(path, rgba, size = SIZE) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// ── Utilidades de dibujo ──────────────────────────────────────────────────
/** Distancia de un punto al segmento AB. */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}
function makeField() {
  return new Float32Array(SIZE * SIZE);
}
/** Pinta un segmento de grosor `w` (con borde suave de 1.5px) acumulando el máximo. */
function stroke(field, ax, ay, bx, by, w) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - w - 3));
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx) + w + 3));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - w - 3));
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by) + w + 3));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = distSeg(x + 0.5, y + 0.5, ax, ay, bx, by);
      const v = Math.max(0, Math.min(1, (w - d) / 1.5 + 0.5));
      const i = y * SIZE + x;
      if (v > field[i]) field[i] = v;
    }
  }
}
/** Campo → PNG blanco recortado por alfa (para Splats / alphaTest). */
function fieldToWhiteAlpha(field) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < field.length; i++) {
    const a = Math.round(Math.max(0, Math.min(1, field[i])) * 255);
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = a;
  }
  return rgba;
}
/** Campo → PNG en escala de grises sobre negro opaco (para Light Masks aditivas). */
function fieldToLuminance(field) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < field.length; i++) {
    const v = Math.round(Math.max(0, Math.min(1, field[i])) * 255);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

// ── 1. Copo de nieve: 6 brazos con ramitas, simetría hexagonal real ───────
function snowflake() {
  const f = makeField();
  const cx = 128;
  const cy = 128;
  const R = 108;
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const ex = cx + Math.cos(a) * R;
    const ey = cy + Math.sin(a) * R;
    stroke(f, cx, cy, ex, ey, 4.2); // eje del brazo
    // Ramitas a 60° del eje, decrecientes hacia la punta.
    for (const [t, len] of [
      [0.34, 34],
      [0.55, 27],
      [0.75, 19],
    ]) {
      const bx = cx + Math.cos(a) * R * t;
      const by = cy + Math.sin(a) * R * t;
      for (const s of [-1, 1]) {
        const ba = a + (s * Math.PI) / 3;
        stroke(f, bx, by, bx + Math.cos(ba) * len, by + Math.sin(ba) * len, 3.0);
      }
    }
    // Punta en flecha, para que el brazo no acabe en romo.
    for (const s of [-1, 1]) {
      const ba = a + (s * Math.PI) / 3;
      stroke(f, ex, ey, ex + Math.cos(ba) * 13, ey + Math.sin(ba) * 13, 2.4);
    }
  }
  // Núcleo hexagonal.
  for (let k = 0; k < 6; k++) {
    const a1 = (k * Math.PI) / 3;
    const a2 = ((k + 1) * Math.PI) / 3;
    stroke(f, cx + Math.cos(a1) * 15, cy + Math.sin(a1) * 15, cx + Math.cos(a2) * 15, cy + Math.sin(a2) * 15, 3.4);
  }
  return f;
}

// ── 2. Rayo: zigzag principal + 2 ramas, grosor decreciente ───────────────
function bolt() {
  const f = makeField();
  // RNG determinista (mismo criterio que titleDustGeometry en assets-dark.ts).
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const pts = [];
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = 14 + t * 228;
    // Jitter alterno (izq/dcha) en vez de aleatorio puro: da el zigzag limpio
    // de un rayo en vez de una línea borracha.
    const side = i % 2 === 0 ? -1 : 1;
    const jitter = i === 0 || i === N ? 0 : side * (20 + rnd() * 18);
    pts.push([128 + jitter, y]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const w = 5.2 - 2.6 * (i / (pts.length - 1)); // se afila hacia abajo
    stroke(f, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w);
  }
  // Dos ramas laterales que nacen de vértices intermedios.
  for (const [from, dx, dy, steps] of [
    [3, -1, 1, 3],
    [6, 1, 1, 2],
  ]) {
    let [x, y] = pts[from];
    for (let s = 0; s < steps; s++) {
      const nx = x + dx * (26 + rnd() * 20);
      const ny = y + dy * (22 + rnd() * 16);
      stroke(f, x, y, nx, ny, 2.8 - s * 0.7);
      x = nx;
      y = ny;
    }
  }
  return f;
}

// ── 3. Llama: MISMA silueta que el icono 'flame' del HUD (Light Mask aditiva) ──
/**
 * Encargo de David (2026-08-17, con captura): "podríamos reutilizar el mismo
 * asset que se usa para las llamas de vida y darle algo de movimiento/
 * escalado para que simule una llama" — quiere que la llama 3D del héroe deje
 * de tener su propia silueta (las tres "lenguas" con base redondeada de la
 * ronda anterior, `tongue()`, ya retirada de aquí) y use la MISMA forma que
 * el icono de vida del HUD, para que un jugador reconozca el mismo símbolo en
 * los dos sitios.
 *
 * Ese icono es el caso `'flame'` de `renderGlyph` en `src/ui/Icon.tsx`,
 * viewBox 24×24, path exacto (se cita aquí para que se vea de dónde sale la
 * forma, no se parsea en tiempo de ejecución — este script no tiene canvas ni
 * parser SVG):
 *
 *   M12 2C9.8 5.5 6 10 6 14c0 2.8 1.6 5 3.6 6.3.7-1.6 1.4-3.3 2.4-4.5
 *   1 1.2 1.7 2.9 2.4 4.5C16.4 19 18 16.8 18 14c0-4-3.8-8.5-6-12Z
 *
 * Desglosando ese path a mano (M = punta, dos C simétricas bajan por los
 * lados hasta el ancho máximo, dos c/c encadenadas trazan la hendidura
 * central de la base): punta en (12,2); ancho máximo (medio ancho 6, de
 * x=6 a x=18) en y=14; de ahí el contorno EXTERIOR sigue bajando y
 * estrechándose hasta los dos "dedos" del borde inferior, en (9.6,20.3) y
 * (14.4,20.3); entre esos dos puntos el borde INTERIOR de la hendidura sube
 * hasta un pico en (12,15.8) — la muesca en forma de V que separa los dos
 * dedos.
 *
 * PRIMER INTENTO (descartado): aproximar la forma con dos perfiles
 * analíticos — un ancho exterior unimodal por altura y una "hendidura" en
 * coseno por columna. Al mirar el PNG resultante, David lo describió así:
 * "sale un rombo de lados casi rectos con un agujero CIRCULAR enorme en la
 * base". Causa: `Math.pow` con exponentes fijos da lados casi RECTOS (un
 * rombo/cometa, no el contorno bulboso real) y el coseno de la hendidura
 * subía en TODO el ancho de cada fila en vez de solo cerca del eje, así que
 * la muesca estrecha en V del icono se convertía en un semicírculo enorme.
 * Dos fórmulas inventadas nunca iban a reproducir seis curvas de Bézier
 * concretas más que por casualidad — se abandona la aproximación.
 *
 * ARREGLO: RASTERIZAR EL PATH DE VERDAD. Las seis curvas cúbicas de arriba
 * se muestrean (`BEZIER_STEPS` pasos cada una, fórmula estándar de Bézier
 * cúbica) y se acumulan en un polígono cerrado; cada píxel se resuelve con
 * un test punto-en-polígono (ray casting, par-impar) con supersampling para
 * el antialiasado. Es más caro que una fórmula cerrada, pero determinista y
 * EXACTO — la única forma de que la hendidura salga estrecha en vez de un
 * agujero, y de que los lados salgan curvos en vez de rectos.
 */
/** Pasos de muestreo por curva de Bézier — suficientes para que el polígono se vea curvo, no facetado, incluso ampliado. */
const BEZIER_STEPS = 64;
/** Supersampling por eje (4×4 = 16 muestras/píxel) para el antialiasado por cobertura real, en vez de heurísticas de distancia al borde. */
const SUPERSAMPLE = 4;
function flame() {
  const f = makeField();
  const baseY = 232;
  const tipY = 16;
  const H = baseY - tipY;
  const cx = 128;
  // Escala UNIFORME del viewBox 24×24 al canvas: el rango y∈[2,20.3] (altura
  // real 18.3, ver comentario grande de arriba) debe caer en [tipY,baseY]
  // (H=216px), y la MISMA escala se usa en X para no deformar la silueta —
  // estirar un eje distinto del otro es precisamente lo que ya salió mal en
  // el primer intento (ahí el problema era la fórmula, no la escala, pero la
  // lección es la misma: no tocar la proporción real del icono).
  const iconScale = H / 18.3;
  const toPx = (px, py) => ({ x: cx + (px - 12) * iconScale, y: tipY + (py - 2) * iconScale });

  // Los 6 tramos del path, ya en absoluto (verificados segmento a segmento):
  // cada uno es [control1, control2, fin] — el punto de PARTIDA de cada
  // tramo es el `fin` del anterior (o (12,2) para el primero, la punta).
  const SEGMENTS = [
    [{ x: 9.8, y: 5.5 }, { x: 6, y: 10 }, { x: 6, y: 14 }],
    [{ x: 6, y: 16.8 }, { x: 7.6, y: 19 }, { x: 9.6, y: 20.3 }],
    [{ x: 10.3, y: 18.7 }, { x: 11.0, y: 17.0 }, { x: 12.0, y: 15.8 }],
    [{ x: 13.0, y: 17.0 }, { x: 13.7, y: 18.7 }, { x: 14.4, y: 20.3 }],
    [{ x: 16.4, y: 19 }, { x: 18, y: 16.8 }, { x: 18, y: 14 }],
    [{ x: 18, y: 10 }, { x: 14.2, y: 5.5 }, { x: 12, y: 2 }],
  ];
  let start = { x: 12, y: 2 };
  const poly = [toPx(start.x, start.y)];
  for (const [c1, c2, end] of SEGMENTS) {
    for (let i = 1; i <= BEZIER_STEPS; i++) {
      // Fórmula estándar de Bézier cúbica: B(t) = (1−t)³P0 + 3(1−t)²tP1 +
      // 3(1−t)t²P2 + t³P3.
      const t = i / BEZIER_STEPS;
      const mt = 1 - t;
      const a = mt * mt * mt;
      const b = 3 * mt * mt * t;
      const c = 3 * mt * t * t;
      const d = t * t * t;
      const px = a * start.x + b * c1.x + c * c2.x + d * end.x;
      const py = a * start.y + b * c1.y + c * c2.y + d * end.y;
      poly.push(toPx(px, py));
    }
    start = end;
  }

  // Bounding box del polígono (+2px de margen) para no recorrer los 256×256
  // enteros: la silueta real ocupa solo ~142×216px.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  minX = Math.max(0, Math.floor(minX) - 2);
  maxX = Math.min(SIZE - 1, Math.ceil(maxX) + 2);
  minY = Math.max(0, Math.floor(minY) - 2);
  maxY = Math.min(SIZE - 1, Math.ceil(maxY) + 2);

  // Punto-en-polígono por ray casting, regla par-impar: cuenta cuántas
  // aristas cruza la semirrecta horizontal hacia +X desde (px,py).
  const inside = (px, py) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };

  const WMAX_PX = 6 * iconScale; // medio ancho máximo del icono, referencia para el núcleo de abajo (no para el relleno)
  for (let y = minY; y <= maxY; y++) {
    const t = Math.max(0, Math.min(1, (baseY - y) / H)); // 0 base, 1 punta — para el núcleo
    for (let x = minX; x <= maxX; x++) {
      // Cobertura real del polígono en este píxel, por supersampling —
      // ANTIALIASADO EXACTO, no una heurística de distancia al borde como
      // usaba el intento anterior (esas heurísticas fueron justo lo que
      // convirtió una hendidura estrecha en un agujero enorme).
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        const py = y + (sy + 0.5) / SUPERSAMPLE;
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = x + (sx + 0.5) / SUPERSAMPLE;
          if (inside(px, py)) hits++;
        }
      }
      if (hits === 0) continue;
      const coverage = hits / (SUPERSAMPLE * SUPERSAMPLE);
      // Núcleo brillante hacia el eje y hacia la parte baja (donde arde
      // fuerte) — mismo espíritu que todas las versiones anteriores de esta
      // textura: sin núcleo, una silueta de cobertura plana se lee como una
      // calcomanía recortada, no como fuego con volumen.
      const absdx = Math.abs(x + 0.5 - cx);
      const core = Math.pow(Math.max(0, 1 - absdx / WMAX_PX), 1.4) * (0.40 + 0.60 * Math.pow(1 - t, 1.1));
      const val = coverage * (0.30 + 0.70 * core);
      const i = y * SIZE + x;
      if (val > f[i]) f[i] = val;
    }
  }
  return f;
}

/**
 * Disco liso: círculo sólido con borde antialiasado, para que una partícula
 * billboard se vea EXACTAMENTE como la esfera lisa que había antes de meter
 * texturas (David: "las explosiones... las texturas le dan un aire irreal,
 * casi que prefiero los círculos anteriores"). Sin degradado interior: la
 * esfera anterior era de color plano.
 */
function disc() {
  const f = makeField();
  const r = 118;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x + 0.5 - 128, y + 0.5 - 128);
      f[y * SIZE + x] = Math.max(0, Math.min(1, (r - d) / 1.8 + 0.5));
    }
  }
  return f;
}

// ── Estelas de proyectil: pensadas para ESTIRARSE en X ───────────────────
// El rastro de un proyectil pasa de ser N marcas sueltas a UN trazo por tramo
// de trayectoria (origen→rebote→final), escalado a lo largo del segmento. Por
// eso estas dos son horizontales y sus formas se leen bien al alargarse: los
// detalles corren a lo LARGO del eje X, no perpendiculares a él.

/** Rayo horizontal en zigzag con dos ramas: estela del arma Hechizo. */
function boltStreak() {
  const f = makeField();
  let seed = 0x51ed270b;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const pts = [];
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = 8 + t * 240;
    const side = i % 2 === 0 ? -1 : 1;
    // Los extremos convergen al eje: así el trazo empalma limpio con el
    // siguiente tramo tras un rebote.
    const taper = Math.sin(Math.PI * t);
    const jitter = side * (16 + rnd() * 22) * taper;
    pts.push([x, 128 + jitter]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / (pts.length - 1);
    const w = 6.5 * Math.sin(Math.PI * t) + 1.6; // afilado en los dos extremos
    stroke(f, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w);
  }
  for (const [from, dy] of [
    [2, -1],
    [5, 1],
  ]) {
    const [x, y] = pts[from];
    stroke(f, x, y, x + 26 + rnd() * 16, y + dy * (30 + rnd() * 18), 2.6);
  }
  return f;
}

/**
 * Veta de escarcha horizontal: vetas longitudinales + agujas de hielo. Las
 * vetas corren a lo largo del eje X para que estirar el quad las alargue de
 * forma natural en vez de deformar un dibujo compacto (que es lo que pasaría
 * con un copo suelto).
 */
function frostStreak() {
  const f = makeField();
  let seed = 0x2f9e44c1;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  // Tres vetas longitudinales onduladas.
  for (const [yc, amp, w] of [
    [128, 16, 3.6],
    [104, 11, 2.4],
    [152, 13, 2.2],
  ]) {
    let px = 6;
    let py = yc;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const nx = 6 + t * 244;
      const ny = yc + Math.sin(t * 6.0 + yc) * amp * Math.sin(Math.PI * t);
      stroke(f, px, py, nx, ny, w * Math.sin(Math.PI * t) + 0.7);
      px = nx;
      py = ny;
    }
  }
  // Agujas de hielo perpendiculares, cortas y de tamaños distintos.
  for (let i = 0; i < 22; i++) {
    const t = 0.08 + rnd() * 0.84;
    const x = 6 + t * 244;
    const y = 128 + (rnd() - 0.5) * 46;
    const len = (9 + rnd() * 20) * Math.sin(Math.PI * t);
    const dir = rnd() < 0.5 ? -1 : 1;
    const skew = (rnd() - 0.5) * 12;
    stroke(f, x, y, x + skew, y + dir * len, 1.9);
  }
  return f;
}

const out = process.argv[2];
writePng(`${out}/disc.png`, fieldToWhiteAlpha(disc()));
writePng(`${out}/bolt_streak.png`, fieldToWhiteAlpha(boltStreak()));
writePng(`${out}/frost_streak.png`, fieldToWhiteAlpha(frostStreak()));
writePng(`${out}/snowflake.png`, fieldToWhiteAlpha(snowflake()));
writePng(`${out}/bolt.png`, fieldToWhiteAlpha(bolt()));
writePng(`${out}/flame.png`, fieldToLuminance(flame()));
console.log('generadas: snowflake.png (alfa), bolt.png (alfa), flame.png (luminancia)');
