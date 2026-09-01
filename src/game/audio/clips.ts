/**
 * Manifiesto de clips de audio (David trajo el pack de sonidos ya
 * convertido, ver `public/audio/*.mp3`: 51 ficheros, mono 44.1 kHz, MP3
 * 96 kbps, silencios de los extremos recortados y pico normalizado. Esos
 * ficheros NO se tocan desde el código: este módulo solo los cataloga).
 *
 * Módulo PURO a propósito, mismo patrón EXACTO que `render/kit-models.ts`:
 * nada de `import.meta.env.BASE_URL` aquí dentro (rompería los tests del
 * entorno `node` de vitest, ver `vite.config.ts`); la base servida se recibe
 * como PARÁMETRO en `clipUrl`. Quien conoce `import.meta.env.BASE_URL` es
 * `sfxEngine.ts` (equivalente a `kit.ts` para el catálogo de modelos).
 *
 * La lista sale de `ls public/audio/*.mp3` sin extensión. El test de este
 * módulo (`clips.test.ts`) comprueba que no hay nombres duplicados y que
 * `clipUrl` compone bien con distintas bases servidas.
 */

/** Carpeta de audio, relativa a la base servida. Con barra final: se concatena directamente delante del nombre de fichero. */
export const AUDIO_DIR = 'audio/';

export const SFX_CLIP_NAMES = [
  'aim-pull',
  'barrel-explosion',
  'boss-barrel-charge-stun',
  'boss-barrel-land',
  'boss-barrel-spawn',
  'boss-column-broken',
  'boss-column-cracked',
  'boss-columns-cleared',
  'boss-defeated',
  'boss-door-sealed',
  'boss-hit',
  'boss-immune-hit',
  'boss-phase-changed',
  'boss-shard-burst',
  'boss-telegraph',
  'boss-wave-spawn',
  'door-locked',
  'door-unlocked',
  'doors-open',
  'dungeon-cleared',
  'enemy-died-1',
  'enemy-died-2',
  'enemy-hit-1',
  'enemy-hit-2',
  'enemy-hit-3',
  'enemy-shot',
  'godmode-revive',
  'launch-arrow',
  'launch-body',
  'launch-spell',
  'level-start',
  'pickup-coin',
  'pickup-key',
  'pickup-potion',
  'pit-fall',
  'pit-respawn',
  'player-damaged',
  'player-died',
  'projectile-wall-arrow',
  'projectile-wall-spell',
  'room-cleared',
  'shield-block',
  'shop-opened',
  'spikes-hit',
  'thunder',
  'ui-cancel',
  'ui-click',
  'upgrade-applied',
  'upgrade-purchased',
  'victory',
  'wall-bounce',
] as const;

export type SfxClipName = (typeof SFX_CLIP_NAMES)[number];

/**
 * URL de un clip a partir de una base servida (`base`), pasada como
 * PARÁMETRO (ver cabecera del fichero). Contrato simple a propósito: `base`
 * siempre llega con barra final desde `import.meta.env.BASE_URL` (Vite la
 * garantiza), así que la composición es concatenación directa, igual que
 * documenta la firma en el encargo.
 */
export function clipUrl(name: SfxClipName, base: string): string {
  return `${base}${AUDIO_DIR}${name}.mp3`;
}
