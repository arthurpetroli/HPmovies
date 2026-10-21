import { describe, expect, it, vi } from 'vitest';
import { StremioStreamingProvider, parseStremioEpisodeId } from '../src/aniwatch-apis/src/providers/stremio';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const addon = { id: 'allowed', name: 'Allowed HTTP addon', manifestUrl: 'https://addon.example.com/manifest.json', authorized: true, allowedMediaHosts: ['media.example.com'] };
const manifest = { id: 'test.allowed', name: 'Test', version: '1.0.0', resources: ['stream'], types: ['series'], idPrefixes: ['tt'] };
const request = { imdbId: 'tt1234567', season: 1, episode: 2 };

describe('HTTP addon streaming', () => {
  it('normalizes only direct allowed media and preserves explicit subtitle languages', async () => {
    const fetcher = vi.fn(async (raw: string) => raw.endsWith('/manifest.json') ? json(manifest) : json({ streams: [
      { url: 'https://media.example.com/video.m3u8', subtitles: [{ url: 'https://media.example.com/sub.srt', lang: 'pt' }, { url: 'https://media.example.com/br.vtt', lang: 'pt-BR' }] },
      { infoHash: 'abc', url: 'https://media.example.com/torrent.mp4' },
      { url: 'https://evil.example.com/no.mp4' },
      { url: 'https://media.example.com/login.mp4', headers: { Authorization: 'secret' } },
    ] }));
    const provider = new StremioStreamingProvider({ addons: [addon], fetcher: fetcher as typeof fetch });
    const result = await provider.playback(request);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ type: 'hls', providerId: 'allowed' });
    expect(result.subtitles.map(track => track.language)).toEqual(['pt-BR', 'pt']);
    expect(result.episode.id).toBe('stremio:allowed:tt1234567:1:2');
    await provider.playback(request);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe('https://addon.example.com/stream/series/tt1234567%3A1%3A2.json');
  });
  it('does not request unpermitted content or confuse metadata with streaming', async () => {
    const fetcher = vi.fn(async () => json({ ...manifest, resources: ['meta', 'catalog'] }));
    const provider = new StremioStreamingProvider({ addons: [addon], fetcher: fetcher as typeof fetch });
    expect(await provider.diagnostic()).toMatchObject({ state: 'unavailable', technicalAvailable: true });
    const denied = new StremioStreamingProvider({ addons: [{ ...addon, authorized: false }], fetcher: fetcher as typeof fetch });
    await expect(denied.playback(request)).rejects.toMatchObject({ code: 'STREMIO_UNAUTHORIZED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('isolates addon failures and refuses redirect transports', async () => {
    const fetcher = vi.fn(async (raw: string) => raw.includes('broken.example.com') ? new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }) : raw.endsWith('/manifest.json') ? json(manifest) : json({ streams: [{ url: 'https://media.example.com/video.mp4' }] }));
    const provider = new StremioStreamingProvider({ addons: [{ ...addon, id: 'broken', manifestUrl: 'https://broken.example.com/manifest.json' }, addon], fetcher: fetcher as typeof fetch });
    const playback = await provider.playback(request);
    expect(playback.sources).toHaveLength(1);
    expect(playback.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'stremio:broken', state: 'connection_error' }), expect.objectContaining({ id: 'stremio:allowed', state: 'available' })]));
    for (const [, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) expect(init.redirect).toBe('manual');
  });
  it('validates stable IDs and operator origins before network access', () => {
    expect(parseStremioEpisodeId('stremio:allowed:tt1234567:1:2')).toEqual({ ...request, provider: 'allowed' });
    expect(() => parseStremioEpisodeId('stremio:allowed:https://127.0.0.1:1:2')).toThrow();
    expect(() => new StremioStreamingProvider({ addons: [{ ...addon, manifestUrl: 'http://127.0.0.1/manifest.json' }] })).toThrow();
    expect(() => new StremioStreamingProvider({ addons: [{ ...addon, manifestUrl: 'https://user:password@addon.example.com/manifest.json' }] })).toThrow();
  });
});
