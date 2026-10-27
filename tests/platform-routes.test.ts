import { describe, expect, it, vi } from 'vitest';
import { MangaDexProvider } from '../src/aniwatch-apis/src/providers/mangadex';
import { createApp } from '../src/aniwatch-apis/src/app';
import { validateCatalogQuery, AniListCatalogProvider } from '../src/aniwatch-apis/src/providers/anilist';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import type { AnimeCatalogProvider } from '../src/shared/providers';

const catalog: AnimeCatalogProvider = {
  home: async () => ({ trending: [], popular: [], airing: [], topRated: [], upcoming: [] }),
  search: async () => ({ items: [], page: 1, hasNextPage: false }),
  details: async () => ({ id: '1', title: 'Teste', poster: '', genres: [] }),
  genres: async () => ['Action'],
};

describe('platform boundaries', () => {
  it('allows scoped images on a separate frontend origin while retaining ordinary resource isolation', async () => {
    const manga = new MangaDexProvider();
    const image = vi.spyOn(manga, 'image').mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png', cacheControl: 'private, max-age=300' });
    const app = createApp({ catalog, manga });
    const token = '00000000-0000-0000-0000-000000000001';
    const result = await app.request(`/api/manga/image/${token}?url=http://127.0.0.1:22`, { headers: { Origin: 'http://localhost:5173' } });
    expect(result.status).toBe(200);
    expect(image).toHaveBeenCalledWith(token);
    expect(result.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect((await app.request('/health')).headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
  });
  it('limits the actual client and ignores forged forwarding headers, keeping health available', async () => {
    const app = createApp({ catalog, rateLimit: 1 });
    expect((await app.request('/api/catalog/genres')).status).toBe(200);
    const limited = await app.request('/api/catalog/genres', { headers: { 'X-Forwarded-For': '203.0.113.42' } });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await app.request('/health')).status).toBe(200);
  });
  it('keeps media fetching independent of the catalog quota while still limiting media requests', async () => {
    const manga = new MangaDexProvider();
    vi.spyOn(manga, 'image').mockResolvedValue({ bytes: new Uint8Array([1]), contentType: 'image/png', cacheControl: 'private, max-age=300' });
    const app = createApp({ catalog, manga, rateLimit: 1, mediaRateLimit: 2 });
    const path = '/api/manga/image/00000000-0000-0000-0000-000000000001';
    expect((await app.request(path)).status).toBe(200);
    expect((await app.request(path)).status).toBe(200);
    expect((await app.request('/api/catalog/genres')).status).toBe(200);
    expect((await app.request(path, { headers: { 'X-Forwarded-For': '203.0.113.42' } })).status).toBe(429);
    expect((await app.request('/api/catalog/genres')).status).toBe(429);
  });
  it('never contacts providers for invalid manga IDs or unsafe language filters', async () => {
    const app = createApp({ catalog });
    expect((await app.request('/api/manga/not-a-uuid')).status).toBe(400);
    expect((await app.request('/api/manga/00000000-0000-0000-0000-000000000001/chapters?language=../../etc')).status).toBe(400);
    expect((await app.request('/api/manga/search?sort=constructor')).status).toBe(400);
  });
  it('serves original novel chapters independently of external catalogs and never invents real novel text', async () => {
    const app = createApp({ catalog });
    const demo = await app.request('/api/novels/demo/chapters/1/content');
    expect(demo.status).toBe(200);
    expect(demo.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await demo.json()).data).toMatchObject({ available: true, isDemo: true });
    const actual = await app.request('/api/novels/30001/chapters');
    expect((await actual.json()).data).toMatchObject({ available: false, status: 'not_authorized', chapters: [] });
  });
});

describe('AniList extended filters', () => {
  it('validates seasons and separates cache entries for each season', async () => {
    expect(validateCatalogQuery({ season: 'FALL' })).toEqual({ season: 'FALL' });
    expect(() => validateCatalogQuery({ season: 'AUTUMN' })).toThrow('Temporada');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, media: [] } } })));
    const provider = new AniListCatalogProvider({ fetcher, cache: new AniwatchAPICache() });
    await provider.search({ season: 'FALL', year: 2026 });
    await provider.search({ season: 'FALL', year: 2026 });
    await provider.search({ season: 'SPRING', year: 2026 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request[1].body)).variables.season).toBe('FALL');
  });
});
