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

// ── 3. Llama: silueta de llama con núcleo brillante (Light Mask aditiva) ──
function flame() {
  const f = makeField();
  const baseY = 232;
  const tipY = 16;
  const H = baseY - tipY;
  /**
   * Una sola lengua de fuego: eje CURVADO (una llama nunca sube recta) y ancho
   * con ondulación de amplitud alta, para que el contorno tenga lóbulos en vez
   * de ser la silueta de una gota — el defecto exacto que hay que evitar
   * ("que no se vea un cono tal cual").
   */
  const tongue = (xOff, scale, lean, wob, heightMul, gain) => {
    for (let y = 0; y < SIZE; y++) {
      const yb = baseY;
      const yt = baseY - H * heightMul;
      if (y < yt || y > yb) continue;
      const t = (yb - y) / (yb - yt); // 0 base, 1 punta
      // Eje curvado: se inclina progresivamente y ondula.
      const cx = 128 + xOff + lean * Math.pow(t, 1.7) * 26 + Math.sin(t * 4.1 + wob) * 7 * t;
      // Ancho: hombro ancho abajo, cintura, y lóbulos por la ondulación.
      const base = 58 * scale * Math.pow(1 - t, 0.42) * (1 - Math.pow(t, 3.2));
      const lobes = 1 + 0.30 * Math.sin(t * 8.5 + wob * 2.3) + 0.16 * Math.sin(t * 15.0 + wob);
      const w = base * lobes;
      if (w <= 0.5) continue;
      for (let x = 0; x < SIZE; x++) {
        const dx = Math.abs(x + 0.5 - cx);
        if (dx > w + 2) continue;
        const edge = Math.max(0, Math.min(1, (w - dx) / 2.2 + 0.5));
        // Núcleo brillante en el eje y en la parte baja (donde arde fuerte).
        const core = Math.pow(Math.max(0, 1 - dx / Math.max(w, 1)), 1.4) * (0.40 + 0.60 * Math.pow(1 - t, 1.1));
        const v = edge * (0.26 + 0.74 * core) * gain;
        const i = y * SIZE + x;
        if (v > f[i]) f[i] = v;
      }
    }
  };
  // Lengua principal + dos secundarias más bajas y estrechas: el conjunto se
  // lee como fuego vivo, no como una forma sólida.
  tongue(0, 1.0, 0.35, 0.0, 1.0, 1.0);
  tongue(-26, 0.52, -0.9, 2.1, 0.62, 0.9);
  tongue(24, 0.44, 1.1, 4.3, 0.5, 0.85);
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
