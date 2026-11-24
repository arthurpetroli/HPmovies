import { describe, expect, it, vi } from 'vitest';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import { loadIntegrationsConfig } from '../src/aniwatch-apis/src/config/integrations';
import type { HentaiApiConfig } from '../src/aniwatch-apis/src/config/integrations';
import { HentaiApiProvider } from '../src/aniwatch-apis/src/providers/hentai-api';
import { StreamMediaGateway } from '../src/aniwatch-apis/src/providers/stream-media';

const config = (overrides: Partial<HentaiApiConfig> = {}): HentaiApiConfig => ({
  enabled: true, baseUrl: 'http://127.0.0.1:3000', timeoutMs: 5000, retries: 0, contentAuthorized: true,
  allowedProviders: ['hanime', 'hentaihaven'], allowedMediaHosts: [], allowedStreamDomains: ['video.example.org'], allowedRequestOrigins: [],
  ...overrides,
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const episode = (slug: string, name: string) => ({ slug, name, thumbnailUrl: `https://img.example.org/${slug}.jpg` });

/** Routes requests by path like a hentai-api instance; unknown paths answer its generic 500. */
function api(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const route = routes[decodeURIComponent(path)];
    return route ? route() : json({ error: 'Internal server error' }, 500);
  });
}

const provider = (fetcher: ReturnType<typeof api>, overrides: Partial<HentaiApiConfig> = {}) => new HentaiApiProvider({
  config: config(overrides), fetcher: fetcher as unknown as typeof fetch, cache: new AniwatchAPICache({ maxEntries: 64 }), gateway: new StreamMediaGateway(),
});

const franchise = (tags: unknown = [{ id: 1, text: 'milf' }, { id: 2, text: 'vanilla' }]) => json({
  title: 'Office Affair', slug: 'office-affair', description: 'Two coworkers.', tags,
  episodes: { all: [episode('office-affair-1', 'Office Affair 1'), episode('office-affair-2', 'Office Affair 2')] },
});

describe('hentai-api client', () => {
  it('stays disabled without HENTAI_API_URL and validates its configuration', async () => {
    const loaded = loadIntegrationsConfig({});
    expect(loaded.hentaiApi.enabled).toBe(false);
    expect((await new HentaiApiProvider({ config: loaded.hentaiApi }).diagnostic()).state).toBe('unavailable');
    expect(loadIntegrationsConfig({ HENTAI_API_URL: 'http://127.0.0.1:3000/', HENTAI_API_ALLOWED_STREAM_DOMAINS: 'Video.Example.org' }).hentaiApi)
      .toMatchObject({ enabled: true, baseUrl: 'http://127.0.0.1:3000', allowedStreamDomains: ['video.example.org'], contentAuthorized: false });
    expect(() => loadIntegrationsConfig({ HENTAI_API_URL: 'ftp://example.org' })).toThrow();
    expect(() => loadIntegrationsConfig({ HENTAI_API_ALLOWED_STREAM_DOMAINS: '*.example.org' })).toThrow();
  });

  it('reports connection, authorization and readiness states', async () => {
    const offline = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect((await new HentaiApiProvider({ config: config(), fetcher: offline as unknown as typeof fetch }).diagnostic()).state).toBe('connection_error');
    const online = api({ '/': () => new Response('Welcome to Hentai API!') });
    expect((await provider(online, { contentAuthorized: false }).diagnostic()).state).toBe('unauthorized');
    expect((await provider(online, { allowedStreamDomains: [] }).diagnostic()).state).toBe('unauthorized');
    expect((await provider(online).diagnostic()).state).toBe('available');
  });

  it('derives the HAnime slug from the title and lists its episodes', async () => {
    const fetcher = api({ '/api/hanime/office-affair-1': () => franchise() });
    const episodes = await provider(fetcher).episodes(['Office Affair']);
    expect(episodes.map(item => [item.provider, item.number, item.key])).toEqual([['hanime', 1, 'office-affair-1'], ['hanime', 2, 'office-affair-2']]);
  });

  it('blocks franchises tagged with minors and fails closed without tags', async () => {
    await expect(provider(api({ '/api/hanime/office-affair-1': () => franchise([{ id: 1, text: 'loli' }]) })).episodes(['Office Affair']))
      .rejects.toMatchObject({ code: 'ADULT_TITLE_BLOCKED' });
    await expect(provider(api({ '/api/hanime/office-affair-1': () => franchise(null) })).episodes(['Office Affair']))
      .rejects.toMatchObject({ code: 'ADULT_TITLE_BLOCKED' });
  });

  it('falls back to HentaiHaven and explains the published schema failure', async () => {
    const broken = api({ '/api/hh/search/Office Affair': () => json({ error: [] }, 422) });
    await expect(provider(broken).episodes(['Office Affair'])).rejects.toMatchObject({ code: 'HENTAI_API_SCHEMA_ERROR' });
    const fixed = api({
      '/api/hh/search/Office Affair': () => json([{ id: 'office-affair', title: 'Office Affair', alternative: '' }]),
      '/api/hh/office-affair': () => json({ title: 'Office Affair', summary: 'Two coworkers.', genres: [{ name: 'Vanilla' }], episodes: [{ id: 'b2ZmaWNlLWFmZmFpci9lcGlzb2RlLTE=', number: 1, title: 'Episode 1' }] }),
      '/api/hh/sources/b2ZmaWNlLWFmZmFpci9lcGlzb2RlLTE=': () => json({ sources: [{ src: 'https://cdn.video.example.org/ep1/master.m3u8', type: 'application/x-mpegURL', label: '720p' }] }),
    });
    const playback = await provider(fixed).playback(['Office Affair'], 1);
    expect(playback.sources).toEqual([expect.objectContaining({ type: 'hls', providerId: 'hentai-api:hentaihaven', url: expect.stringMatching(/^\/api\/streaming\/media\//) })]);
  });

  it('issues gateway tickets only for allowed stream domains', async () => {
    const streams = [
      { url: 'https://cdn.video.example.org/office/1080/master.m3u8', extension: 'm3u8', height: 1080 },
      { url: 'https://cdn.video.example.org/office/720/master.m3u8', extension: 'm3u8', height: 720 },
      { url: 'https://elsewhere.example.net/office.m3u8', extension: 'm3u8', height: 480 },
    ];
    const fetcher = api({ '/api/hanime/office-affair-1': () => franchise(), '/api/hanime/streams/office-affair-2': () => json(streams) });
    const playback = await provider(fetcher).playback(['Office Affair'], 2);
    expect(playback.episode).toMatchObject({ number: 2, title: 'Office Affair 2' });
    expect(playback.sources.map(source => source.height)).toEqual([1080, 720]);
    expect(playback.sources.every(source => source.url.startsWith('/api/streaming/media/'))).toBe(true);
    const denied = api({ '/api/hanime/office-affair-1': () => franchise(), '/api/hanime/streams/office-affair-1': () => json([streams[2]]) });
    await expect(provider(denied).playback(['Office Affair'], 1)).rejects.toMatchObject({ code: 'HENTAI_API_MEDIA_NOT_PERMITTED' });
  });

  it('requires content authorization before returning media', async () => {
    const fetcher = api({ '/api/hanime/office-affair-1': () => franchise() });
    await expect(provider(fetcher, { contentAuthorized: false }).playback(['Office Affair'], 1)).rejects.toMatchObject({ code: 'HENTAI_API_UNAUTHORIZED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops at connection failures and reports rate limits', async () => {
    const limited = api({ '/api/hanime/office-affair-1': () => json({ error: 'Rate limit exceeded' }, 429) });
    await expect(provider(limited).episodes(['Office Affair'])).rejects.toMatchObject({ code: 'HENTAI_API_RATE_LIMIT' });
    expect(limited).toHaveBeenCalledTimes(1);
  });
});
