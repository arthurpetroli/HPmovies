import { describe, expect, it, vi } from 'vitest';
import { loadIntegrationsConfig } from '../src/aniwatch-apis/src/config/integrations';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import { TokoHttpClient } from '../src/aniwatch-apis/src/providers/toko-http';
import type { TokoStream } from '../src/aniwatch-apis/src/providers/toko-http';
import { normalizeTokoLanguage, normalizeTokoSource, permittedMediaUrl, TokoStreamingProvider } from '../src/aniwatch-apis/src/providers/toko';
import { TatakaiStreamingProvider } from '../src/aniwatch-apis/src/providers/tatakai';
import { streamMediaGateway } from '../src/aniwatch-apis/src/providers/stream-media';
import { ApiError } from '../src/aniwatch-apis/src/config/apiError';

const config = () => loadIntegrationsConfig({
  TOKO_ENABLED: 'true', TOKO_API_URL: 'http://127.0.0.1:8099',
  TOKO_CONTENT_AUTHORIZED: 'true', TOKO_ALLOWED_PROVIDERS: 'permitted',
  TOKO_ALLOWED_MEDIA_HOSTS: 'media.example.com,captions.example.com',
  TOKO_RETRIES: '1',
}).toko;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const health = { ok: true, toko: true, service: 'toko-api' };
const index = { provider: 'permitted', episodeCount: 2, episodes: [{ number: 1, title: 'Começo' }, { number: 2 }] };
const stream = (): TokoStream => ({
  url: 'https://media.example.com/episode.m3u8', type: 'hls', providerKey: 'permitted', providerName: 'Permitted',
  audioLanguage: 'ja', quality: '1080p', requiresHeaders: false,
  subtitles: [{ url: 'https://captions.example.com/pt-br.vtt', label: 'Português (Brasil)', language: 'pt-br' }],
});

describe('integration configuration and permission separation', () => {
  it('keeps content and providers disabled unless explicitly configured', () => {
    const settings = loadIntegrationsConfig({});
    expect(settings.toko).toMatchObject({ enabled: false, contentAuthorized: false, allowedProviders: [], allowedMediaHosts: [] });
    expect(settings.tatakai).toMatchObject({ enabled: true, baseUrl: 'http://127.0.0.1:8099', namespace: 'toko', contentAuthorized: false, allowedProviders: [] });
    expect(settings.toko.baseUrl).toBe('http://127.0.0.1:8099');
  });

  it.each([
    { TOKO_ENABLED: 'yes' }, { TOKO_TIMEOUT_MS: '0' }, { TOKO_RETRIES: 'Infinity' },
    { TOKO_API_URL: 'file:///tmp/service' }, { TOKO_API_URL: 'http://secret:password@localhost:8099' },
    { TOKO_ALLOWED_MEDIA_HOSTS: '*.example.com' }, { TOKO_ALLOWED_MEDIA_HOSTS: 'https://example.com' },
  ])('rejects invalid configuration %s', (env) => expect(() => loadIntegrationsConfig(env)).toThrow());

  it('distinguishes a responding HTTP service from a loaded provider bundle', async () => {
    const fetcher = vi.fn(async () => json({ ...health, toko: false }));
    const provider = new TokoStreamingProvider({ probe: async () => {}, client: new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch }) });
    const diagnostic = await provider.diagnostic();
    expect(diagnostic).toMatchObject({ state: 'unavailable', technicalAvailable: false });
    expect((await provider.episodes('1')).available).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('allows health diagnostics without granting playback or probing sources', async () => {
    const settings = { ...config(), contentAuthorized: false };
    const fetcher = vi.fn(async () => json(health));
    const provider = new TokoStreamingProvider({ probe: async () => {}, client: new TokoHttpClient(settings, { fetcher: fetcher as typeof fetch }) });
    expect(await provider.diagnostic()).toMatchObject({ state: 'unauthorized', technicalAvailable: true, authorized: false });
    expect(await provider.episodes('1')).toMatchObject({ available: false, state: 'unauthorized', episodes: [] });
    await expect(provider.playback('toko:1:1')).rejects.toMatchObject({ code: 'TOKO_UNAUTHORIZED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps disabled Toko and undocumented Tatakai adapters independent of network access', async () => {
    const fetcher = vi.fn();
    const provider = new TokoStreamingProvider({ probe: async () => {}, client: new TokoHttpClient({ ...config(), enabled: false }, { fetcher }) });
    expect(await provider.episodes('1')).toMatchObject({ state: 'unavailable', available: false });
    expect(fetcher).not.toHaveBeenCalled();
    const tatakai = new TatakaiStreamingProvider({ enabled: true, baseUrl: 'https://api.tatakai.me' });
    expect(await tatakai.diagnostic()).toMatchObject({ state: 'unauthorized', technicalAvailable: false, authorized: false });
    expect((await tatakai.episodes('1')).available).toBe(false);
    await expect(tatakai.playback('anything')).rejects.toMatchObject({ code: 'TATAKAI_UNAVAILABLE' });
  });
});

describe('source normalization', () => {
  it.each([
    ['pt-br', 'pt-BR'], ['pt', 'pt'], ['ja', 'ja'], ['sub', 'und'], ['dub', 'und'], ['Brazilian Portuguese', 'und'], [undefined, 'und'],
  ])('normalizes explicit language %s as %s without inventing PT-BR', (raw, expected) => expect(normalizeTokoLanguage(raw)).toBe(expected));

  it.each([
    'http://media.example.com/stream', 'https://user:password@media.example.com/stream',
    'https://media.example.com.evil.org/stream', 'https://evil.org/stream',
    'https://127.0.0.1/stream', 'https://[::1]/stream', 'https://media.example.com:8443/stream',
    'file:///etc/passwd', 'javascript:alert(1)',
  ])('blocks an unpermitted media destination %s', (url) => expect(permittedMediaUrl(url, config().allowedMediaHosts)).toBeUndefined());

  it('requires a permitted provider, direct media type and no replay headers', () => {
    const source = normalizeTokoSource(stream(), config());
    expect(source).toMatchObject({ providerId: 'permitted', audioLanguage: 'ja', subtitles: [{ language: 'pt-BR' }], available: true });
    expect(source).not.toHaveProperty('height');
    expect(normalizeTokoSource({ ...stream(), providerKey: 'unknown' }, config())).toBeUndefined();
    expect(normalizeTokoSource({ ...stream(), requiresHeaders: true }, config())).toBeUndefined();
    expect(normalizeTokoSource({ ...stream(), type: 'embed' }, config())).toBeUndefined();
    expect(normalizeTokoSource({ ...stream(), type: 'torrent' }, config())).toBeUndefined();
    expect(normalizeTokoSource({ ...stream(), subtitles: [{ url: 'https://evil.org/sub.vtt', language: 'pt-br', label: 'PT-BR' }] }, config())?.subtitles).toEqual([]);
  });
});

describe('verified Toko JSON HTTP contract', () => {
  it('uses real routes and parameters, verifies media before availability and normalizes playable sources', async () => {
    const fetcher = vi.fn(async (raw: string) => {
      const url = new URL(raw);
      if (url.pathname === '/api/v3/health') return json(health);
      if (url.pathname === '/api/v3/toko/index/episodes') return json(index);
      if (url.pathname === '/api/v3/toko/stream') return json({ sources: [{ ...stream(), audioLanguage: 'sub' }], providerStatus: [] });
      throw new Error(`Unexpected endpoint ${url.pathname}`);
    });
    const provider = new TokoStreamingProvider({ probe: async () => {}, client: new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch }) });
    expect(await provider.episodes('1')).toMatchObject({
      available: true, state: 'available', episodes: [{ id: 'toko:1:1', number: 1, available: true }, { id: 'toko:1:2' }],
    });
    const playback = await provider.playback('toko:1:1');
    expect(playback).toMatchObject({ isDemo: false, audioLanguages: [], subtitles: [{ language: 'pt-BR' }] });
    expect(playback.sources[0]).toMatchObject({ providerId: 'permitted', type: 'hls', audioLanguage: 'und' });
    expect(playback.nextEpisodeId).toBe('toko:1:2');
    expect(playback.previousEpisodeId).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
    const calls = fetcher.mock.calls.map(([url]) => new URL(url));
    expect(calls[1].searchParams.get('anilistId')).toBe('1');
    expect(calls[2].searchParams.get('stream')).toBe('0');
    expect(calls[2].searchParams.get('episode')).toBe('1');
    expect(calls[2].searchParams.get('maxRetries')).toBe('0');
  });

  it('navigates only between episodes returned in the index, including fractional specials', async () => {
    const fetcher = vi.fn(async (raw: string) => {
      if (raw.includes('/health')) return json(health);
      if (raw.includes('/index/episodes')) return json({ provider: 'permitted', episodeCount: 3, episodes: [{ number: 0.5 }, { number: 1 }, { number: 3 }] });
      return json({ sources: [stream()] });
    });
    const provider = new TokoStreamingProvider({ probe: async () => {}, client: new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch }) });
    expect(await provider.playback('toko:1:1')).toMatchObject({ previousEpisodeId: 'toko:1:0.5', nextEpisodeId: 'toko:1:3' });
    const special = await provider.playback('toko:1:0.5');
    expect(special.nextEpisodeId).toBe('toko:1:1');
    expect(special.previousEpisodeId).toBeUndefined();
  });

  it('does not claim the presence of an episode index means playback permission', async () => {
    const fetcher = vi.fn(async (raw: string) => {
      if (raw.includes('/health')) return json(health);
      if (raw.includes('/index/episodes')) return json(index);
      return json({ sources: [{ ...stream(), providerKey: 'unpermitted' }] });
    });
    const provider = new TokoStreamingProvider({ probe: async () => {}, client: new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch }) });
    expect(await provider.episodes('1')).toMatchObject({ available: false, state: 'unauthorized' });
    await expect(provider.playback('toko:1:1')).rejects.toMatchObject({ code: 'TOKO_UNAUTHORIZED' });
  });

  it('uses scoped gateway verification by default and discards returned sources that fail it', async () => {
    const fetcher = vi.fn(async (raw: string) => raw.includes('/health') ? json(health)
      : raw.includes('/index/episodes') ? json(index) : json({ sources: [stream()] }));
    const probe = vi.spyOn(streamMediaGateway, 'probe').mockRejectedValue(new ApiError(502, 'STREAM_MEDIA_UNAVAILABLE', 'Unavailable'));
    try {
      const provider = new TokoStreamingProvider({ client: new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch }) });
      expect(await provider.episodes('1')).toMatchObject({ available: false, state: 'connection_error', episodes: [{ available: false }, {}] });
      await expect(provider.playback('toko:1:1')).rejects.toMatchObject({ code: 'STREAM_MEDIA_UNAVAILABLE' });
      expect(probe.mock.calls[0][0]).toMatch(/^\/api\/streaming\/media\/[0-9a-f-]{36}$/);
      expect(probe.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    } finally { probe.mockRestore(); }
  });

  it('returns only verified candidates with at most two simultaneous probes', async () => {
    const candidates = ['first.m3u8', 'broken.mp4', 'third.m3u8', 'fourth.m3u8'].map((path, i) => ({ ...stream(), url: `https://media.example.com/${path}`, quality: String(i), type: i === 1 ? 'mp4' : 'hls' }));
    const fetcher = vi.fn(async (raw: string) => raw.includes('/health') ? json(health)
      : raw.includes('/index/episodes') ? json(index) : json({ sources: candidates }));
    let active = 0; let maximum = 0;
    const probe = vi.fn(async (source: { quality?: string }) => {
      active++; maximum = Math.max(maximum, active);
      try { await new Promise(resolve => setTimeout(resolve, 5)); if (source.quality === '1') throw new Error('302 redirect'); }
      finally { active--; }
    });
    const provider = new TokoStreamingProvider({ probe, client: new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch }) });
    const playback = await provider.playback('toko:1:1');
    expect(playback.sources.map(source => source.quality)).toEqual(['0', '2', '3']);
    expect(maximum).toBe(2); expect(probe).toHaveBeenCalledTimes(4);
    expect(playback.sources.every(source => source.url.startsWith('/api/streaming/media/'))).toBe(true);
  });

  it('stops stalled candidates within one shared preflight budget and cancels the active probes', async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({ ...stream(), url: `https://media.example.com/${i}.m3u8` }));
    const fetcher = vi.fn(async (raw: string) => raw.includes('/health') ? json(health)
      : raw.includes('/index/episodes') ? json(index) : json({ sources: candidates }));
    const signals: AbortSignal[] = [];
    const probe = vi.fn(async (_source: unknown, signal: AbortSignal) => { signals.push(signal); return new Promise<void>(() => {}); });
    const provider = new TokoStreamingProvider({ probe, probeBudgetMs: 10, client: new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch }) });
    await expect(provider.playback('toko:1:1')).rejects.toMatchObject({ code: 'STREAM_MEDIA_UNAVAILABLE' });
    expect(probe).toHaveBeenCalledTimes(2); expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it('deduplicates simultaneous queries, isolates parameters and expires successful cached requests', async () => {
    let now = 0;
    const fetcher = vi.fn(async () => json(index));
    const client = new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache({ now: () => now }) });
    await Promise.all([client.episodes(1), client.episodes(1), client.episodes(2)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    now = 120_001;
    await client.episodes(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('retries temporary server failures once and does not cache failed calls', async () => {
    const fetcher = vi.fn(async () => json({ error: 'unavailable' }, 503));
    const client = new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch, retryDelayMs: 0 });
    await expect(client.health()).rejects.toMatchObject({ code: 'TOKO_UPSTREAM_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(client.health()).rejects.toMatchObject({ code: 'TOKO_UPSTREAM_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([
    [() => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1:22' } }), 'TOKO_REDIRECT_REFUSED'],
    [() => json({}, 403), 'TOKO_UNAUTHORIZED'],
    [() => new Response('event: done\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), 'TOKO_INVALID_RESPONSE'],
    [() => json({ ok: true }), 'TOKO_INVALID_RESPONSE'],
    [() => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }), 'TOKO_INVALID_RESPONSE'],
    [() => new Response('x', { headers: { 'Content-Type': 'application/json', 'Content-Length': '2000001' } }), 'TOKO_RESPONSE_TOO_LARGE'],
  ])('rejects redirects, denied access and incompatible responses without retry', async (respond, code) => {
    const fetcher = vi.fn(async () => respond());
    const client = new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch });
    await expect(client.health()).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('bounds distinct in-flight requests while deduplicating identical keys', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => { await pending; return json(index); });
    const client = new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch });
    const tasks = [1, 2, 3, 4].map((id) => client.episodes(id));
    const same = client.episodes(1);
    await expect(client.episodes(5)).rejects.toMatchObject({ code: 'TOKO_BUSY' });
    release();
    await Promise.all([...tasks, same]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('bounds timeout retries and converts connection failures into isolated availability states', async () => {
    const fetcher = vi.fn(async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); });
    const provider = new TokoStreamingProvider({ probe: async () => {}, client: new TokoHttpClient(config(), { fetcher: fetcher as typeof fetch, retryDelayMs: 0 }) });
    expect(await provider.episodes('1')).toMatchObject({ available: false, state: 'connection_error' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('isolates chapter cache entries per permitted provider and refuses arbitrary chapter keys', async () => {
    const settings = { ...config(), allowedProviders: ['one', 'two'] };
    const fetcher = vi.fn(async () => json({ chapterCount: 2, chapters: [
      { provider: 'one', chapterKey: 'one:chapter-1', number: 1, language: 'pt-br' },
      { provider: 'two', chapterKey: 'two:chapter-1', number: 1, language: 'en' },
    ] }));
    const client = new TokoHttpClient(settings, { fetcher: fetcher as typeof fetch });
    expect((await client.chapters('manga', 1, 'one')).chapters.map((chapter) => chapter.provider)).toEqual(['one']);
    expect((await client.chapters('manga', 1, 'two')).chapters.map((chapter) => chapter.provider)).toEqual(['two']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(() => client.mangaPages('one:https://127.0.0.1/private', 'one')).toThrow('listagem autorizada');
    expect(() => client.novelContent('one:chapter-1', 'one')).toThrow('listagem autorizada');
  });
});
