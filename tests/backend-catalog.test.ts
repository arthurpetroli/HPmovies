import { describe, expect, it, vi } from 'vitest';
import { HiAnime, HiAnimeError } from 'aniwatch';
import { createApp } from '../src/aniwatch-apis/src/app';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import { AniListCatalogProvider } from '../src/aniwatch-apis/src/providers/anilist';
import type { AnimeCatalogProvider } from '../src/shared/providers';

function media(id = 1) {
  return { id, type: 'ANIME', isAdult: false, title: { english: 'Cowboy Bebop', romaji: 'Cowboy Bebop' },
    coverImage: { large: 'https://example.com/poster.jpg' }, startDate: { year: 1998 },
    description: 'Space<br>adventure', genres: ['Action'], averageScore: 86, episodes: 26 };
}

function providerResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
}

const catalogMock = (): AnimeCatalogProvider => ({
  home: vi.fn(async () => ({ trending: [], popular: [], airing: [], topRated: [], upcoming: [] })),
  search: vi.fn(async () => ({ items: [], page: 1, hasNextPage: false })),
  details: vi.fn(async () => ({ id: '1', title: 'Cowboy Bebop', poster: '', genres: [] })),
  genres: vi.fn(async () => ['Action']),
});

describe('catalog routes', () => {
  it.each([
    '/api/catalog/search?page=0', '/api/catalog/search?page=2.5',
    '/api/catalog/search?year=Infinity', '/api/catalog/search?sort=constructor',
    '/api/catalog/search?format=INVALID', '/api/catalog/search?status=INVALID',
    '/api/catalog/search?unknown=value', '/api/catalog/anime/not-an-id',
  ])('rejects invalid request %s before contacting the provider', async (url) => {
    const catalog = catalogMock();
    const response = await createApp({ catalog }).request(url);
    expect(response.status).toBe(400);
    expect(catalog.search).not.toHaveBeenCalled();
    expect(catalog.details).not.toHaveBeenCalled();
  });

  it('normalizes valid filters and exposes the data response contract', async () => {
    const catalog = catalogMock();
    const response = await createApp({ catalog }).request('/api/catalog/search?search=naruto&year=2002&sort=score&page=2&format=TV');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { items: [], page: 1, hasNextPage: false } });
    expect(catalog.search).toHaveBeenCalledWith({ search: 'naruto', year: 2002, sort: 'score', page: 2, format: 'TV' });
  });

  it('never invents playable episodes for catalog titles', async () => {
    const response = await createApp({ catalog: catalogMock() }).request('/api/streaming/anime/1/episodes');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { available: false, episodes: [] } });
  });

  it('returns a marked demo with attribution, real sources and an explanatory caption track', async () => {
    const response = await createApp({ catalog: catalogMock() }).request('/api/streaming/episodes/demo');
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.isDemo).toBe(true);
    expect(data.attribution.license).toContain('CC BY 3.0');
    expect(data.sources.map((source: { type: string }) => source.type)).toEqual(['hls', 'mp4']);
    expect(data.audioLanguages).toEqual([]);
    expect(data.subtitles[0].label).toContain('guia do player');
    const unavailable = await createApp({ catalog: catalogMock() }).request('/api/streaming/episodes/anime-episode');
    expect(unavailable.status).toBe(404);
  });

  it('disables legacy routes and removes arbitrary proxies even when legacy is enabled', async () => {
    const app = createApp({ catalog: catalogMock(), legacyEnabled: false });
    expect((await app.request('/api/v2/hianime/home')).status).toBe(503);
    for (const legacyEnabled of [true, false]) {
      const response = await createApp({ catalog: catalogMock(), legacyEnabled }).request('/api/v2/hianime/proxy-stream?url=http://127.0.0.1:22');
      expect(response.status).toBe(410);
      expect((await response.json()).error).toBe('STREAM_PROXY_REMOVED');
    }
  });

  it('keeps the legacy-enabled local API healthy while reporting an external provider failure as 503', async () => {
    const upstreamError = new HiAnimeError('fetchError: timeout', 'getHomePage', 500);
    const home = vi.spyOn(HiAnime.Scraper.prototype, 'getHomePage').mockRejectedValue(upstreamError);
    try {
      const app = createApp({ catalog: catalogMock(), legacyEnabled: true });
      const health = await app.request('/health');
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ status: 'OK', legacyEnabled: true });
      const response = await app.request('/api/v2/hianime/home');
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'ANIWATCH_UPSTREAM_UNAVAILABLE',
        message: 'O provedor externo Aniwatch/HiAnime está indisponível ou não respondeu. A API local continua ativa; não foi possível carregar o conteúdo legado.',
      });
      expect(home).toHaveBeenCalledOnce();
      expect((await app.request('/health')).status).toBe(200);
    } finally {
      home.mockRestore();
    }
  });

  it('allows localhost browser origins and rejects unrelated origins', async () => {
    const app = createApp({ catalog: catalogMock() });
    const local = await app.request('/health', { headers: { Origin: 'http://localhost:5173' } });
    expect(local.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    const foreign = await app.request('/health', { headers: { Origin: 'https://example.com' } });
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('AniList catalog integration', () => {
  it('omits every unused filter because AniList treats null as a filter value', async () => {
    const fetcher = vi.fn(async () => providerResponse({ Page: { pageInfo: { currentPage: 1, hasNextPage: false }, media: [] } }));
    const provider = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache() });
    await provider.search({ search: 'Frieren' });
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const { variables } = JSON.parse(String(request[1].body));
    expect(variables).not.toHaveProperty('dateStart');
    expect(variables).not.toHaveProperty('dateEnd');
    expect(variables).not.toHaveProperty('genre');
    expect(variables).not.toHaveProperty('format');
    expect(variables).not.toHaveProperty('status');
  });

  it('uses GraphQL variables for filters, normalizes metadata and caches distinct searches separately', async () => {
    const fetcher = vi.fn(async () => providerResponse({ Page: { pageInfo: { currentPage: 1, hasNextPage: true, total: 30 }, media: [media()] } }));
    const provider = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache() });
    const one = await provider.search({ search: 'bebop', year: 1998 });
    await provider.search({ search: 'bebop', year: 1998 });
    await provider.search({ search: 'naruto', year: 2002 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(one.items[0]).toMatchObject({ id: '1', title: 'Cowboy Bebop', year: 1998, description: 'Space\nadventure', episodeCount: 26 });
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(request[1].body));
    expect(body.variables).toMatchObject({ search: 'bebop', dateStart: 19980100, dateEnd: 19981232 });
    expect(body.query).toContain('isAdult: false');
  });

  it('provides related anime and recommendations while dropping manga, adult titles and unsafe links', async () => {
    const fetcher = vi.fn(async () => providerResponse({ Media: {
      ...media(),
      relations: { edges: [{ relationType: 'SEQUEL', node: media(2) }, { relationType: 'ADAPTATION', node: { ...media(3), type: 'MANGA' } }] },
      recommendations: { nodes: [{ mediaRecommendation: media(4) }, { mediaRecommendation: { ...media(5), isAdult: true } }] },
      externalLinks: [{ site: 'Official', url: 'https://example.com' }, { site: 'Unsafe', url: 'javascript:alert(1)' }],
    } }));
    const provider = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache() });
    const anime = await provider.details('1');
    expect(anime.relations?.map((relation) => relation.anime.id)).toEqual(['2']);
    expect(anime.recommendations?.map((item) => item.id)).toEqual(['4']);
    expect(anime.externalLinks).toEqual([{ site: 'Official', url: 'https://example.com/' }]);
  });

  it.each([
    [async () => new Response('not json'), 502, 'INVALID_CATALOG_RESPONSE'],
    [async () => providerResponse({ Page: { pageInfo: {}, media: [] } }), 502, 'INVALID_CATALOG_RESPONSE'],
    [async () => new Response('busy', { status: 429, headers: { 'Retry-After': '30' } }), 503, 'CATALOG_RATE_LIMIT'],
    [async () => new Response('upstream down', { status: 500 }), 502, 'CATALOG_UPSTREAM_ERROR'],
    [async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }, 504, 'CATALOG_TIMEOUT'],
    [async () => { throw new TypeError('fetch failed'); }, 503, 'CATALOG_UNAVAILABLE'],
  ])('reports meaningful failure for upstream status %s', async (fetcher, status, code) => {
    const catalog = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache() });
    const response = await createApp({ catalog }).request('/api/catalog/search');
    expect(response.status).toBe(status);
    expect((await response.json()).error).toBe(code);
    if (code === 'CATALOG_RATE_LIMIT') expect(response.headers.get('Retry-After')).toBe('30');
  });

  it('reports missing details as 404 and does not cache failures', async () => {
    const fetcher = vi.fn(async () => providerResponse({ Media: null }));
    const catalog = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache() });
    const app = createApp({ catalog });
    expect((await app.request('/api/catalog/anime/1')).status).toBe(404);
    expect((await app.request('/api/catalog/anime/1')).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
