import { describe, expect, it, vi } from 'vitest';
import type { TokoConfig } from '../src/aniwatch-apis/src/config/integrations.js';
import { TokoHttpClient } from '../src/aniwatch-apis/src/providers/toko-http.js';
import type { TokoStream } from '../src/aniwatch-apis/src/providers/toko-http.js';
import { normalizeTokoLanguage, normalizeTokoSource } from '../src/aniwatch-apis/src/providers/toko.js';

const config = (): TokoConfig => ({
  enabled: true, contentAuthorized: true, baseUrl: 'http://127.0.0.1:8099', timeoutMs: 8000, retries: 0,
  allowedProviders: ['source'], allowedMediaHosts: ['cdn.example.org'], allowedRequestOrigins: ['https://player.example.org'],
});
const source = (): TokoStream => ({
  providerKey: 'source', providerName: 'Source', url: 'https://cdn.example.org/master.m3u8', type: 'hls',
  quality: 'auto', audioLanguage: 'Japanese', requiresHeaders: false, subtitles: [],
});
const subtitle = (url: string, format?: string) => ({ url, format, label: 'English', language: 'English' });

describe('Toko subtitle compatibility', () => {
  it('preserves explicit formats and infers the original path before replacing it with a media ticket', async () => {
    const settings = config();
    const payload = { sources: [{ ...source(), headers: { Referer: 'https://player.example.org/' }, subtitles: [
      subtitle('https://cdn.example.org/english.SRT?signature=private'),
      subtitle('https://cdn.example.org/opaque', 'srt'),
      subtitle('https://cdn.example.org/actually.srt', 'vtt'),
      subtitle('https://cdn.example.org/unsupported.srt', 'ttml'),
      subtitle('https://cdn.example.org/ass.ass'),
    ] }] };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }));
    const response = await new TokoHttpClient(settings, { fetcher: fetcher as typeof fetch }).streams(1, 1);
    expect(response.sources[0].subtitles[1].format).toBe('srt');
    const normalized = normalizeTokoSource(response.sources[0], settings)!;
    expect(normalized.subtitles.map(track => track.format)).toEqual(['srt', 'srt', 'vtt']);
    for (const track of normalized.subtitles) {
      expect(track.url).toMatch(/^\/api\/streaming\/media\/[0-9a-f-]{36}$/);
      expect(track.language).toBe('en');
    }
  });

  it('keeps direct ASS conversion available and drops malformed or unsupported subtitle URLs and formats', () => {
    const normalized = normalizeTokoSource({ ...source(), subtitles: [
      subtitle('https://cdn.example.org/direct.ass'),
      subtitle('https://cdn.example.org/direct.ssa'),
      subtitle('https://cdn.example.org/default'),
      subtitle('https://cdn.example.org/rejected.srt', ''),
      subtitle('not a URL'),
    ] }, config())!;
    expect(normalized.subtitles.map(track => track.format)).toEqual(['ass', 'ass', 'vtt']);
  });

  it.each([
    ['English', 'en'], ['Japanese', 'ja'], ['Portuguese (Brazil)', 'pt-BR'], ['Português(Brasil)', 'pt-BR'],
    ['sub', 'und'], ['dub', 'und'], ['Brazilian Portuguese', 'und'], ['English dub', 'und'], ['en glish', 'und'],
  ])('normalizes only an explicit supported language name: %s', (input, expected) => {
    expect(normalizeTokoLanguage(input)).toBe(expected);
  });

  it('distinguishes automatic-quality sources by their provider and explicit audio language', () => {
    expect(normalizeTokoSource(source(), config())?.label).toBe('Source · ja · auto');
    expect(normalizeTokoSource({ ...source(), audioLanguage: 'English' }, config())?.label).toBe('Source · en · auto');
    expect(normalizeTokoSource({ ...source(), audioLanguage: 'dub' }, config())?.label).toBe('Source · auto');
  });
});
