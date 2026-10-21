import { describe, expect, it } from 'vitest';
import { hasValidIntro, preferredSubtitleId } from '../src/frontend/components/player/playbackUtils';
import type { StreamSubtitle } from '../src/shared/providers';

const subtitle = (id: string, language: string, label = id): StreamSubtitle => ({ id, language, label, url: `/${id}.vtt` });

describe('subtitle language verification', () => {
  it('prefers verified PT-BR over the first track and normalizes region notation', () => {
    expect(preferredSubtitleId([subtitle('english', 'en'), subtitle('brazilian', 'PT_br')])).toBe('brazilian');
  });
  it('does not infer Brazilian Portuguese from a sub category or a display label', () => {
    expect(preferredSubtitleId([subtitle('sub', 'en', 'Português Brasileiro'), subtitle('portuguese', 'pt'), subtitle('european', 'pt-PT')])).toBe('off');
  });
  it('keeps captions disabled when no tracks exist', () => {
    expect(preferredSubtitleId([])).toBe('off');
  });
});

describe('intro skip metadata', () => {
  it('allows only a real interval within the playable duration', () => {
    expect(hasValidIntro({ start: 12, end: 80 }, 120)).toBe(true);
    expect(hasValidIntro({ start: 0, end: 120 }, 120)).toBe(true);
  });
  it('rejects missing, reversed, negative and out-of-bounds intervals', () => {
    expect(hasValidIntro(undefined, 120)).toBe(false);
    expect(hasValidIntro({ start: 80, end: 12 }, 120)).toBe(false);
    expect(hasValidIntro({ start: -1, end: 12 }, 120)).toBe(false);
    expect(hasValidIntro({ start: 12, end: 130 }, 120)).toBe(false);
  });
  it('does not show a skip control before finite duration is available', () => {
    expect(hasValidIntro({ start: 0, end: 90 }, 0)).toBe(false);
    expect(hasValidIntro({ start: 0, end: 90 }, Infinity)).toBe(false);
    expect(hasValidIntro({ start: NaN, end: 90 }, 120)).toBe(false);
  });
});
