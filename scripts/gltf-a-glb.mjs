/**
 * Empaqueta los modelos del kit de `.gltf` + `.bin` a un único `.glb` por
 * pieza, y borra el par original.
 *
 * Por qué (petición de David, 2026-08-06: "elimina los archivos .bin si no se
 * van a usar" + "haz un commit de los gltf para que no salgan 43000 cambios"):
 * un `.gltf` es JSON de TEXTO y su `.bin` hermano guarda los vértices, así que
 * el par no se puede separar — borrar los `.bin` dejaría los modelos
 * inservibles. Pero sí se pueden FUSIONAR: eso es exactamente un `.glb`, el
 * mismo contenido en un contenedor binario. Se gana:
 *   - la mitad de ficheros y ni un `.bin` suelto;
 *   - git los trata como binarios, así que el pack deja de aparecer como
 *     decenas de miles de líneas de diff cada vez que se toca;
 *   - una petición de red por modelo en vez de dos.
 *
 * La TEXTURA se deja fuera a propósito (el `.glb` la sigue referenciando por
 * URI relativa): es un único atlas compartido por las 283 piezas, y
 * empotrarlo en cada `.glb` lo duplicaría 283 veces.
 *
 * Formato GLB (spec 2.0): cabecera de 12 bytes ('glTF', versión, tamaño
 * total) + chunk JSON + chunk BIN, cada uno con su cabecera de 8 bytes
 * (tamaño, tipo) y relleno hasta múltiplo de 4 — el JSON con espacios, el
 * binario con ceros, como exige la spec.
 *
 * Uso: node scripts/gltf-a-glb.mjs <directorio> [--dry]
 */

import { readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

function alinear(buffer, relleno) {
  const resto = buffer.length % 4;
  if (resto === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - resto, relleno)]);
}

function empaquetar(gltf, bin) {
  // El buffer pasa a ser interno: se le quita el `uri` y se deja solo su
  // tamaño, que es como la spec identifica al chunk BIN del propio GLB.
  const json = structuredClone(gltf);
  if (json.buffers?.length) {
    delete json.buffers[0].uri;
    json.buffers[0].byteLength = bin.length;
  }
  const jsonChunk = alinear(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = alinear(bin, 0x00);

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const salida = Buffer.alloc(total);
  let o = 0;
  salida.writeUInt32LE(GLB_MAGIC, o); o += 4;
  salida.writeUInt32LE(2, o); o += 4;
  salida.writeUInt32LE(total, o); o += 4;
  salida.writeUInt32LE(jsonChunk.length, o); o += 4;
  salida.writeUInt32LE(CHUNK_JSON, o); o += 4;
  jsonChunk.copy(salida, o); o += jsonChunk.length;
  salida.writeUInt32LE(binChunk.length, o); o += 4;
  salida.writeUInt32LE(CHUNK_BIN, o); o += 4;
  binChunk.copy(salida, o);
  return salida;
}

const dir = process.argv[2];
const dry = process.argv.includes('--dry');
if (!dir) {
  console.error('uso: node scripts/gltf-a-glb.mjs <directorio> [--dry]');
  process.exit(1);
}

const nombres = readdirSync(dir).filter((f) => f.endsWith('.gltf')).map((f) => f.slice(0, -5));
let antes = 0;
let despues = 0;
for (const nombre of nombres) {
  const rutaGltf = join(dir, `${nombre}.gltf`);
  const rutaBin = join(dir, `${nombre}.bin`);
  const gltf = JSON.parse(readFileSync(rutaGltf, 'utf8'));
  const bin = readFileSync(rutaBin);
  antes += statSync(rutaGltf).size + statSync(rutaBin).size;

  const glb = empaquetar(gltf, bin);
  despues += glb.length;
  if (!dry) {
    writeFileSync(join(dir, `${nombre}.glb`), glb);
    unlinkSync(rutaGltf);
    unlinkSync(rutaBin);
  }
}
const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`${nombres.length} modelos · ${mb(antes)} MB en ${nombres.length * 2} ficheros → ${mb(despues)} MB en ${nombres.length} ${dry ? '(simulado)' : ''}`);
