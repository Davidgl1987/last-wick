import { describe, expect, it } from 'vitest';
import { AUDIO_DIR, clipUrl, SFX_CLIP_NAMES } from './clips';

describe('clips (manifiesto de audio)', () => {
  it('no tiene nombres duplicados', () => {
    const unique = new Set(SFX_CLIP_NAMES);
    expect(unique.size).toBe(SFX_CLIP_NAMES.length);
  });

  it('tiene los 51 clips activos del pack', () => {
    expect(SFX_CLIP_NAMES.length).toBe(51);
    expect(SFX_CLIP_NAMES).not.toContain('hero-slide-loop');
  });

  it('clipUrl compone bien con base "/"', () => {
    expect(clipUrl('ui-click', '/')).toBe('/audio/ui-click.mp3');
  });

  it('clipUrl compone bien con base "/last-wick/"', () => {
    expect(clipUrl('thunder', '/last-wick/')).toBe('/last-wick/audio/thunder.mp3');
  });

  it('clipUrl usa AUDIO_DIR y la extensión .mp3', () => {
    for (const name of SFX_CLIP_NAMES) {
      expect(clipUrl(name, '/')).toBe(`/${AUDIO_DIR}${name}.mp3`);
    }
  });
});
