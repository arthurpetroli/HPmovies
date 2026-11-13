import { describe, expect, it, vi } from 'vitest';
import { StremioStreamingProvider, parseStremioEpisodeId, stremioEpisodeId } from '../src/aniwatch-apis/src/providers/stremio';
import type { StremioAddonConfig, StremioPlaybackRequest } from '../src/aniwatch-apis/src/providers/stremio';
import { configuredStremioOptions } from '../src/aniwatch-apis/src/config/stremio';
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
    expect(result.episode.id).toBe('stremio:all:tt1234567:1:2');
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

  it('resolves movies only through a compatible movie resource and preserves configured URL paths', async () => {
    const fetcher = vi.fn(async (raw: string) => raw.includes('/manifest.json')
      ? json({ ...manifest, resources: [{ name: 'stream', types: ['movie'], idPrefixes: ['tt'] }], types: ['movie', 'series'] })
      : json({ streams: [{ url: 'https://media.example.com/movie.mp4' }] }));
    const provider = new StremioStreamingProvider({
      addons: [{ ...addon, manifestUrl: 'https://addon.example.com/configured/manifest.json?setting=public' }], fetcher: fetcher as typeof fetch,
    });
    const playback = await provider.playback({ type: 'movie', imdbId: 'tt1234567', provider: addon.id });
    expect(playback.episode).toMatchObject({ id: 'stremio:allowed:movie:tt1234567', title: 'Filme · tt1234567' });
    expect(playback.episode.number).toBeUndefined();
    expect(fetcher.mock.calls[1][0]).toBe('https://addon.example.com/configured/stream/movie/tt1234567.json?setting=public');
    await expect(provider.playback(request)).rejects.toMatchObject({ code: 'STREMIO_STREAM_UNSUPPORTED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps aggregate selection stable when the player reloads a returned episode ID', async () => {
    const fetcher = vi.fn(async (raw: string) => raw.endsWith('/manifest.json') ? json(manifest)
      : json({ streams: [{ url: `https://media.example.com/${raw.includes('second') ? 'second' : 'first'}.mp4` }] }));
    const provider = new StremioStreamingProvider({ addons: [addon, { ...addon, id: 'second', manifestUrl: 'https://second.example.com/manifest.json' }], fetcher: fetcher as typeof fetch });
    const first = await provider.playback(request);
    expect(first.sources).toHaveLength(2);
    expect(first.episode.id).toBe('stremio:all:tt1234567:1:2');
    const reloaded = await provider.playback(first.episode.id);
    expect(reloaded.sources.map(source => source.providerId)).toEqual(['allowed', 'second']);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const specific = await provider.playback({ ...request, provider: 'second' });
    expect(specific.episode.id).toBe('stremio:second:tt1234567:1:2');
    expect(specific.sources.map(source => source.providerId)).toEqual(['second']);
  });

  it('does not confuse subtitle or label languages with declared audio', async () => {
    const fetcher = vi.fn(async (raw: string) => raw.endsWith('/manifest.json') ? json(manifest) : json({ streams: [{
      url: 'https://media.example.com/video.m3u8', name: 'FMHY 1080p\nPortuguês',
      subtitles: [{ url: 'https://media.example.com/sub.srt', lang: 'pt-BR' }], behaviorHints: { notWebReady: true },
    }] }));
    const playback = await new StremioStreamingProvider({ addons: [addon], fetcher: fetcher as typeof fetch }).playback(request);
    expect(playback.audioLanguages).toEqual([]);
    expect(playback.sources[0].audioLanguage).toBe('und');
    expect(playback.subtitles[0].language).toBe('pt-BR');
  });

  it('rejects header-dependent streams even when their URL points to a permitted relay', async () => {
    const fetcher = vi.fn(async (raw: string) => raw.endsWith('/manifest.json') ? json(manifest) : json({ streams: [
      { url: 'https://media.example.com/video.m3u8', behaviorHints: { proxyHeaders: { request: { Referer: 'https://website.example.com/' } } } },
      { url: 'https://media.example.com/other.mp4', requestHeaders: { Cookie: 'private' } },
    ] }));
    await expect(new StremioStreamingProvider({ addons: [addon], fetcher: fetcher as typeof fetch }).playback(request)).rejects.toMatchObject({ code: 'STREMIO_DIRECT_SOURCE_REQUIRED' });
  });

  it('honors manifest resource prefixes before issuing a stream request', async () => {
    const fetcher = vi.fn(async () => json({ ...manifest, resources: [{ name: 'stream', types: ['series'], idPrefixes: ['kitsu:'] }] }));
    const provider = new StremioStreamingProvider({ addons: [addon], fetcher: fetcher as typeof fetch });
    await expect(provider.playback(request)).rejects.toMatchObject({ code: 'STREMIO_STREAM_UNSUPPORTED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requires a configured manifest when the addon declares configurationRequired', async () => {
    const fetcher = vi.fn(async () => json({ ...manifest, behaviorHints: { configurationRequired: true } }));
    const provider = new StremioStreamingProvider({ addons: [addon], fetcher: fetcher as typeof fetch });
    expect(await provider.diagnostic()).toMatchObject({ state: 'unauthorized', technicalAvailable: true });
    await expect(provider.playback(request)).rejects.toMatchObject({ code: 'STREMIO_UNAUTHORIZED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requires explicit local access and allows relay media only at the exact configured local origin', async () => {
    const localAddon = { ...addon, manifestUrl: 'http://127.0.0.1:7010/manifest.json', allowedMediaHosts: [] };
    expect(() => new StremioStreamingProvider({ addons: [localAddon] })).toThrow();
    const fetcher = vi.fn(async (raw: string) => raw.endsWith('/manifest.json') ? json(manifest) : json({ streams: [
      { url: 'http://127.0.0.1:7010/hls-relay/fixture/playlist.m3u8' },
      { url: 'http://127.0.0.1:7011/hls-relay/fixture/playlist.m3u8' },
      { url: 'http://localhost:7010/hls-relay/fixture/playlist.m3u8' },
      { url: 'http://192.168.1.10:7010/hls-relay/fixture/playlist.m3u8' },
      { url: 'http://127.0.0.1:7010@outside.example.com/playlist.m3u8' },
      { url: 'https://media.example.com/video.mp4' },
    ] }));
    const provider = new StremioStreamingProvider({ addons: [localAddon], fetcher: fetcher as typeof fetch, allowLoopback: true });
    expect(await provider.diagnostic()).toMatchObject({ state: 'available', authorized: true });
    const playback = await provider.playback(request);
    expect(playback.sources.map(source => source.url)).toEqual(['http://127.0.0.1:7010/hls-relay/fixture/playlist.m3u8']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not permit local media from a public manifest or without content permission', async () => {
    const fetcher = vi.fn(async (raw: string) => raw.endsWith('/manifest.json') ? json(manifest) : json({ streams: [{ url: 'http://127.0.0.1:7010/video.mp4' }] }));
    await expect(new StremioStreamingProvider({ addons: [addon], fetcher: fetcher as typeof fetch, allowLoopback: true }).playback(request)).rejects.toMatchObject({ code: 'STREMIO_DIRECT_SOURCE_REQUIRED' });
    const denied = new StremioStreamingProvider({ addons: [{ ...addon, authorized: false, manifestUrl: 'http://127.0.0.1:7010/manifest.json', allowedMediaHosts: [] }], allowLoopback: true, fetcher: fetcher as typeof fetch });
    await expect(denied.playback(request)).rejects.toMatchObject({ code: 'STREMIO_UNAUTHORIZED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('validates the signature and MIME type of same-origin progressive binary relays', async () => {
    const localAddon = { ...addon, manifestUrl: 'http://127.0.0.1:7010/manifest.json', allowedMediaHosts: [] };
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    const fetcher = vi.fn(async (raw: string) => raw.endsWith('/manifest.json') ? json(manifest)
      : raw.includes('/stream/') ? json({ streams: [
        { url: 'http://127.0.0.1:7010/hls-relay/valid/media.bin' },
        { url: 'http://127.0.0.1:7010/hls-relay/wrong-mime/media.bin' },
        { url: 'http://127.0.0.1:7010/hls-relay/html/media.bin' },
        { url: 'http://127.0.0.1:7010/hls-relay/redirect/media.bin' },
        { url: 'http://127.0.0.1:7010/arbitrary.bin' },
      ] })
        : raw.includes('/redirect/') ? new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1:8000/private' } })
          : new Response(raw.includes('/html/') ? '<html>not media</html>' : bytes, { status: 206, headers: { 'Content-Type': raw.includes('/wrong-mime/') ? 'application/octet-stream' : 'video/mp4' } }));
    const playback = await new StremioStreamingProvider({ addons: [localAddon], fetcher: fetcher as typeof fetch, allowLoopback: true }).playback(request);
    expect(playback.sources).toMatchObject([{ url: 'http://127.0.0.1:7010/hls-relay/valid/media.bin', type: 'mp4' }]);
    expect(playback.sources).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(6);
    for (const [raw, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init).toMatchObject({ redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (raw.endsWith('/media.bin')) expect(init.headers).toEqual({ Accept: 'video/mp4', Range: 'bytes=0-65535' });
    }
  });

  it('cancels a progressive relay once its prefix is inspected', async () => {
    const cancel = vi.fn();
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    const fetcher = vi.fn(async (raw: string) => raw.endsWith('/manifest.json') ? json(manifest)
      : raw.includes('/stream/') ? json({ streams: [{ url: 'https://addon.example.com/hls-relay/media.bin' }] })
        : new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); }, cancel }), { status: 200, headers: { 'Content-Type': 'video/mp4' } }));
    const provider = new StremioStreamingProvider({ addons: [{ ...addon, allowedMediaHosts: ['addon.example.com'] }], fetcher: fetcher as typeof fetch });
    expect((await provider.playback(request)).sources).toHaveLength(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('bounds progressive binary probes and preserves playable HLS when all binary candidates fail', async () => {
    const fetcher = vi.fn(async (raw: string) => raw.endsWith('/manifest.json') ? json(manifest)
      : raw.includes('/stream/') ? json({ streams: [
        ...Array.from({ length: 20 }, (_, i) => ({ url: `https://addon.example.com/hls-relay/${i}/media.bin` })),
        { url: 'https://media.example.com/working.m3u8' },
      ] }) : new Response('not video', { headers: { 'Content-Type': 'video/mp4' } }));
    const provider = new StremioStreamingProvider({ addons: [{ ...addon, allowedMediaHosts: ['addon.example.com', 'media.example.com'] }], fetcher: fetcher as typeof fetch });
    expect((await provider.playback(request)).sources.map(source => source.type)).toEqual(['hls']);
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it.each([
    ['invalid JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } }), 'STREMIO_INVALID_RESPONSE'],
    ['HTML body', () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }), 'STREMIO_INVALID_RESPONSE'],
    ['oversized body', () => new Response('x'.repeat(1_000_001), { headers: { 'Content-Type': 'application/json' } }), 'STREMIO_RESPONSE_TOO_LARGE'],
  ])('rejects %s from addon endpoints', async (_name, response, code) => {
    const provider = new StremioStreamingProvider({ addons: [addon], fetcher: vi.fn(async () => response()) as typeof fetch });
    await expect(provider.playback(request)).rejects.toMatchObject({ code });
  });

  it('validates movie and aggregate IDs without accepting seasonless series or fractional episodes', () => {
    expect(stremioEpisodeId(undefined, { type: 'movie', imdbId: 'tt1234567' })).toBe('stremio:all:movie:tt1234567');
    expect(parseStremioEpisodeId('stremio:all:movie:tt1234567')).toEqual({ type: 'movie', imdbId: 'tt1234567' });
    expect(parseStremioEpisodeId('stremio:allowed:movie:tt1234567')).toEqual({ type: 'movie', imdbId: 'tt1234567', provider: 'allowed' });
    expect(parseStremioEpisodeId('stremio:all:tt1234567:0:1')).toEqual({ imdbId: 'tt1234567', season: 0, episode: 1 });
    for (const id of ['stremio:all:movie:tt1234567:1', 'stremio:all:tt1234567', 'stremio:all:tt1234567:1:1.5', 'stremio:all:tt1234567:1001:1']) expect(() => parseStremioEpisodeId(id)).toThrow();
  });

  it('rejects invalid operator configuration and request objects before making network requests', async () => {
    const fetcher = vi.fn();
    for (const candidate of [null, { ...addon, id: 'all' }, { ...addon, allowedMediaHosts: ['127.0.0.1'] }, { ...addon, manifestUrl: 'http://192.168.1.1:7010/manifest.json' }]) {
      expect(() => new StremioStreamingProvider({ addons: [candidate as StremioAddonConfig], allowLoopback: true, fetcher })).toThrow();
    }
    const provider = new StremioStreamingProvider({ addons: [addon], fetcher });
    for (const candidate of [{ ...request, episode: 1.5 }, { ...request, season: -1 }, { type: 'movie', imdbId: 'tt1234567', season: 1 }, null]) {
      await expect(provider.playback(candidate as StremioPlaybackRequest)).rejects.toMatchObject({ code: 'INVALID_STREMIO_EPISODE' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads local opt-in and the FMHY-compatible timeout only from operator configuration', () => {
    expect(configuredStremioOptions({})).toMatchObject({ addons: [], allowLoopback: false, timeoutMs: 35000 });
    expect(configuredStremioOptions({ STREMIO_ALLOW_LOOPBACK: 'true', STREMIO_TIMEOUT_MS: '45000', STREMIO_ADDONS_JSON: JSON.stringify([addon]) })).toMatchObject({ addons: [addon], allowLoopback: true, timeoutMs: 45000 });
    for (const value of ['-1', '0', '249', '45001', 'NaN', '1000.5', '1000ms', '']) expect(() => configuredStremioOptions({ STREMIO_TIMEOUT_MS: value })).toThrow();
    expect(() => configuredStremioOptions({ STREMIO_ALLOW_LOOPBACK: '1' })).toThrow();
    expect(() => configuredStremioOptions({ STREMIO_ADDONS_JSON: '{}' })).toThrow();
  });
});
