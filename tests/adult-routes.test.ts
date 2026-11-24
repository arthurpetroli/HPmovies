import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/aniwatch-apis/src/app';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import { ApiError } from '../src/aniwatch-apis/src/config/apiError';
import { BLOCKED_ANILIST_TAGS } from '../src/aniwatch-apis/src/providers/adult-safety';
import { AniListAdultCatalogProvider } from '../src/aniwatch-apis/src/providers/anilist-adult';
import type { AdultCatalogProvider } from '../src/aniwatch-apis/src/providers/anilist-adult';
import type { HentaiApiProvider } from '../src/aniwatch-apis/src/providers/hentai-api';
import { AdultSitesProvider } from '../src/aniwatch-apis/src/providers/adult-sites';
import { loadIntegrationsConfig } from '../src/aniwatch-apis/src/config/integrations';
import { PortugueseSubtitleProvider } from '../src/aniwatch-apis/src/providers/portuguese-subtitles';
import { StreamingRegistry } from '../src/aniwatch-apis/src/providers/registry';
import type { CatalogAnime, Playback } from '../src/shared/providers';

const consent = { 'X-HPMovies-Adult': '18+' };
const anime: CatalogAnime = { id: '5', title: 'Office Affair', titleOriginal: 'Office Affair', poster: '', genres: ['Hentai'], episodeCount: 2, synonyms: ['Shokuba no Himitsu'] };
const playback = (url: string, number = 1): Playback => ({ episode: { id: `x:${number}`, title: `Episódio ${number}`, number }, sources: [{ url, type: 'hls', label: url }], subtitles: [], audioLanguages: [], isDemo: false });

function adultCatalog(overrides: Partial<AdultCatalogProvider> = {}): AdultCatalogProvider {
  return {
    home: vi.fn(async () => ({ trending: [anime], popular: [], recent: [], topRated: [] })),
    search: vi.fn(async () => ({ items: [anime], page: 1, hasNextPage: false })),
    details: vi.fn(async () => anime),
    tags: vi.fn(async () => ['Tentacles']),
    ...overrides,
  };
}

function hentai(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    episodes: vi.fn(async () => [{ provider: 'hanime', key: 'office-affair-2', number: 2, title: 'Office Affair 2' }]),
    playback: vi.fn(async () => playback('/api/streaming/media/hentai', 2)),
    diagnostic: vi.fn(async () => ({ id: 'hentai-api', name: 'hentai-api', enabled: true, state: 'available', technicalAvailable: true, authorized: true, checkedAt: '', message: '', capabilities: [] })),
    ...overrides,
  } as unknown as HentaiApiProvider;
}

function app(options: { enabled?: boolean; catalog?: AdultCatalogProvider; hentaiApi?: HentaiApiProvider; registry?: StreamingRegistry } = {}) {
  const registry = options.registry ?? new StreamingRegistry({ subtitles: new PortugueseSubtitleProvider({ enabled: false }) });
  // A developer's .env must never enable the live sites here.
  const adultSites = new AdultSitesProvider({ config: loadIntegrationsConfig({}).adultSites });
  return createApp({ adult: { enabled: options.enabled ?? true }, adultCatalog: options.catalog ?? adultCatalog(), hentaiApi: options.hentaiApi ?? hentai(), adultSites, registry });
}

describe('adult routes', () => {
  it('exposes only the server flag without consent', async () => {
    expect(await (await app({ enabled: false }).request('/api/adult/status')).json()).toEqual({ data: { enabled: false } });
    const response = await app().request('/api/adult/status');
    expect(await response.json()).toEqual({ data: { enabled: true } });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not exist while the operator keeps adult content disabled', async () => {
    const catalog = adultCatalog();
    const response = await app({ enabled: false, catalog }).request('/api/adult/catalog/home', { headers: consent });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'ADULT_CONTENT_DISABLED' });
    expect(catalog.home).not.toHaveBeenCalled();
  });

  it.each([{}, { 'X-HPMovies-Adult': '1' }, { 'X-HPMovies-Adult': 'true' }])('requires the browser consent header %#', async (headers) => {
    const catalog = adultCatalog();
    const response = await app({ catalog }).request('/api/adult/catalog/home', { headers });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'ADULT_CONSENT_REQUIRED' });
    expect(catalog.home).not.toHaveBeenCalled();
  });

  it('serves the adult catalog privately after consent', async () => {
    const response = await app().request('/api/adult/catalog/home', { headers: consent });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await response.json()).data.trending[0].id).toBe('5');
  });

  it('validates search filters and refuses blocked tags', async () => {
    const catalog = adultCatalog();
    const blocked = await app({ catalog }).request('/api/adult/catalog/search?tag=School', { headers: consent });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ error: 'ADULT_TAG_BLOCKED' });
    expect((await app({ catalog }).request('/api/adult/catalog/search?genre=x', { headers: consent })).status).toBe(400);
    expect((await app({ catalog }).request('/api/adult/catalog/search?search=office&tag=Tentacles&sort=score&page=2', { headers: consent })).status).toBe(200);
    expect(catalog.search).toHaveBeenCalledTimes(1);
    expect(catalog.search).toHaveBeenCalledWith({ search: 'office', tag: 'Tentacles', sort: 'score', page: 2 });
  });

  it('merges the existing sources and the hentai-api by episode number', async () => {
    const registry = new StreamingRegistry({ subtitles: new PortugueseSubtitleProvider({ enabled: false }) });
    vi.spyOn(registry, 'episodes').mockResolvedValue({ available: true, episodes: [{ id: 'tatakai:5:1', number: 1, title: 'Primeiro' }] });
    const response = await app({ registry }).request('/api/adult/anime/5/episodes', { headers: consent });
    const { data } = await response.json();
    expect(data.available).toBe(true);
    expect(data.episodes.map((episode: { id: string; title: string }) => [episode.id, episode.title])).toEqual([['adult:5:1', 'Primeiro'], ['adult:5:2', 'Office Affair 2']]);
    expect(registry.episodes).toHaveBeenCalledWith('5', ['Office Affair', 'Shokuba no Himitsu']);
  });

  it('sends at most five title hints, the limit of the anime sources', async () => {
    const registry = new StreamingRegistry({ subtitles: new PortugueseSubtitleProvider({ enabled: false }) });
    const resolve = vi.spyOn(registry, 'resolve').mockResolvedValue(playback('/api/streaming/media/tatakai', 1));
    const many = { ...anime, titleNative: 'オフィス', synonyms: ['One', 'Two', 'Three', 'Four', 'Five'] };
    await app({ registry, catalog: adultCatalog({ details: vi.fn(async () => many) }) }).request('/api/adult/anime/5/episodes/1', { headers: consent });
    expect(resolve.mock.calls[0][3]).toEqual(['Office Affair', 'オフィス', 'One', 'Two', 'Three']);
  });

  it('falls back to the catalog episode count when no source has an index', async () => {
    const registry = new StreamingRegistry({ subtitles: new PortugueseSubtitleProvider({ enabled: false }) });
    vi.spyOn(registry, 'episodes').mockResolvedValue({ available: false, episodes: [], state: 'unavailable' });
    const hentaiApi = hentai({ episodes: vi.fn(async () => { throw new ApiError(404, 'HENTAI_API_NOT_FOUND', 'Não encontrado.'); }) });
    const { data } = await (await app({ registry, hentaiApi }).request('/api/adult/anime/5/episodes', { headers: consent })).json();
    expect(data).toMatchObject({ available: false, catalogFallback: true, message: 'Não encontrado.' });
    expect(data.episodes.map((episode: { id: string }) => episode.id)).toEqual(['adult:5:1', 'adult:5:2']);
  });

  it('plays sources from every connected source for one episode', async () => {
    const registry = new StreamingRegistry({ subtitles: new PortugueseSubtitleProvider({ enabled: false }) });
    vi.spyOn(registry, 'resolve').mockResolvedValue(playback('/api/streaming/media/tatakai', 2));
    const response = await app({ registry }).request('/api/adult/anime/5/episodes/2', { headers: consent });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.episode).toMatchObject({ id: 'adult:5:2', number: 2 });
    expect(data.sources.map((source: { url: string }) => source.url)).toEqual(['/api/streaming/media/tatakai', '/api/streaming/media/hentai']);
  });

  it('explains why no source played and checks the title before any source', async () => {
    const registry = new StreamingRegistry({ subtitles: new PortugueseSubtitleProvider({ enabled: false }) });
    vi.spyOn(registry, 'resolve').mockRejectedValue(new ApiError(404, 'EPISODE_UNAVAILABLE', 'Sem vídeo.'));
    const hentaiApi = hentai({ playback: vi.fn(async () => { throw new ApiError(502, 'HENTAI_API_SCHEMA_ERROR', 'Schema quebrado.'); }) });
    const failed = await app({ registry, hentaiApi }).request('/api/adult/anime/5/episodes/1', { headers: consent });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: 'HENTAI_API_SCHEMA_ERROR' });

    const catalog = adultCatalog({ details: vi.fn(async () => { throw new ApiError(404, 'ADULT_TITLE_BLOCKED', 'Bloqueado.'); }) });
    const resolve = vi.spyOn(registry, 'resolve');
    resolve.mockClear();
    const blocked = await app({ registry, catalog }).request('/api/adult/anime/5/episodes/1', { headers: consent });
    expect(blocked.status).toBe(404);
    expect(resolve).not.toHaveBeenCalled();
    expect((await app({ registry }).request('/api/adult/anime/5/episodes/0', { headers: consent })).status).toBe(400);
    expect((await app({ registry }).request('/api/adult/anime/5/episodes/1?source=x', { headers: consent })).status).toBe(400);
  });
});

describe('AniList adult catalog', () => {
  const node = (id: number, tags: unknown, extra: Record<string, unknown> = {}) => ({
    id, type: 'ANIME', isAdult: true, title: { romaji: `Title ${id}`, english: null, native: null }, synonyms: [], tags,
    characters: { nodes: [] }, coverImage: { large: 'https://example.com/p.jpg' }, genres: ['Hentai'], description: 'Adults only.', ...extra,
  });
  const response = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });

  it('asks AniList to exclude blocked tags and still filters every entry', async () => {
    const fetcher = vi.fn(async () => response({
      trending: { media: [node(1, [{ name: 'Tentacles' }]), node(2, [{ name: 'School' }]), node(3, undefined), null] },
      popular: { media: [node(4, [], { characters: { nodes: [{ age: '15' }] } })] }, recent: { media: [] }, topRated: { media: [] },
    }));
    const provider = new AniListAdultCatalogProvider({ fetcher: fetcher as unknown as typeof fetch, cache: new AniwatchAPICache({ maxEntries: 8 }) });
    const home = await provider.home();
    expect(home.trending.map(item => item.id)).toEqual(['1']);
    expect(home.popular).toEqual([]);
    const body = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.variables.blocked).toEqual([...BLOCKED_ANILIST_TAGS]);
    expect(body.query).toContain('isAdult: true');
  });

  it('refuses blocked details and never accepts general catalog entries', async () => {
    const blocked = new AniListAdultCatalogProvider({ fetcher: vi.fn(async () => response({ Media: node(9, [{ name: 'Primarily Teen Cast' }]) })) as unknown as typeof fetch, cache: new AniwatchAPICache({ maxEntries: 8 }) });
    await expect(blocked.details('9')).rejects.toMatchObject({ status: 404, code: 'ADULT_TITLE_BLOCKED' });
    const general = new AniListAdultCatalogProvider({ fetcher: vi.fn(async () => response({ Media: node(10, [], { isAdult: false }) })) as unknown as typeof fetch, cache: new AniwatchAPICache({ maxEntries: 8 }) });
    await expect(general.details('10')).rejects.toMatchObject({ code: 'INVALID_CATALOG_RESPONSE' });
  });
});
