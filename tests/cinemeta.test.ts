import { describe, expect, it, vi } from 'vitest';
import { CinemetaProvider, cinemaQuery } from '../src/aniwatch-apis/src/providers/cinemeta';
import { createApp } from '../src/aniwatch-apis/src/app';
import { StreamingRegistry } from '../src/aniwatch-apis/src/providers/registry';
import { StremioStreamingProvider } from '../src/aniwatch-apis/src/providers/stremio';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const row = { id: 'tt1234567', name: 'Título QA', type: 'series', poster: 'https://images.metahub.space/poster/tt1234567/img', genres: ['Drama'], imdbRating: '8.5' };

describe('Cinemeta metadata, independent of stream availability', () => {
  it('keeps exact series episode identities, deduplicates and preserves release dates', async () => {
    const provider = new CinemetaProvider({ fetcher: vi.fn(async () => json({ meta: { ...row, videos: [
      { id: 'tt1234567:2:2', season: 2, episode: 2, name: 'Segundo', released: '2099-01-01T00:00:00Z' },
      { id: 'tt1234567:2:1', season: 2, episode: 1, name: 'Primeiro' },
      { id: 'tt1234567:2:1', season: 2, episode: 1, name: 'Duplicado' },
      { id: 'tt7654321:1:1', season: 1, episode: 1, name: 'Outra obra' },
      { id: 'tt1234567:0:1', season: 0, episode: 1, name: 'Especial' },
      { id: 'tt1234567:2:1.5', season: 2, episode: 1.5 },
    ] } })) as typeof fetch });
    const data = await provider.details('series', row.id);
    expect(data).toMatchObject({ title: row.name, rating: 8.5, genres: ['Drama'] });
    expect(data.episodes.map(episode => episode.id)).toEqual(['tt1234567:0:1', 'tt1234567:2:1', 'tt1234567:2:2']);
    expect(data.episodes[2].released).toBe('2099-01-01T00:00:00.000Z');
  });

  it('refuses a foreign metadata identity or media type', async () => {
    for (const meta of [{ ...row, id: 'tt7654321' }, { ...row, type: 'movie' }]) {
      const provider = new CinemetaProvider({ fetcher: vi.fn(async () => json({ meta })) as typeof fetch });
      await expect(provider.details('series', row.id)).rejects.toMatchObject({ code: 'CINEMA_INVALID_RESPONSE' });
    }
  });

  it('pages the full upstream catalog and caches identical requests', async () => {
    const fetcher = vi.fn(async () => json({ metas: [row, row, { ...row, type: 'movie' }], hasMore: true }));
    const provider = new CinemetaProvider({ fetcher: fetcher as typeof fetch });
    const query = { type: 'series' as const, page: 2 };
    expect(await provider.catalog(query)).toMatchObject({ items: [{ id: row.id }], page: 2, hasNextPage: true });
    await provider.catalog(query);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://cinemeta-catalogs.strem.io/top/catalog/series/top/skip=50.json');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
  });

  it('uses catalog pages rather than a fixed editorial set or per-title requests', async () => {
    const fetcher = vi.fn(async (url: string) => json({ metas: url.includes('skip=0')
      ? Array.from({ length: 50 }, (_, index) => ({ ...row, id: `tt${1234500 + index}`, type: 'movie' }))
      : [{ ...row, id: 'tt7654321', type: 'movie' }], hasMore: url.includes('skip=0') }));
    const provider = new CinemetaProvider({ fetcher: fetcher as typeof fetch });
    const result = await provider.catalog({ type: 'movie', page: 1 });
    expect(result.items).toHaveLength(50);
    expect(result.notice).toBeUndefined();
    expect(result.hasNextPage).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await provider.catalog({ type: 'movie', page: 2 })).toMatchObject({ items: [{ id: 'tt7654321' }], hasNextPage: false });
  });

  it('shows the actual catalog failure without falling back to a fabricated selection', async () => {
    const provider = new CinemetaProvider({ fetcher: vi.fn(async () => json({}, 403)) as typeof fetch });
    await expect(provider.catalog({ type: 'movie', page: 1 })).rejects.toMatchObject({ code: 'CINEMA_UNAVAILABLE' });
  });

  it('rejects redirects, non-JSON and oversized responses', async () => {
    const responses = [
      new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }),
      new Response('<html>upstream</html>', { headers: { 'Content-Type': 'text/html' } }),
      new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '4000001' } }),
    ];
    for (const response of responses) {
      const provider = new CinemetaProvider({ fetcher: vi.fn(async () => response) as typeof fetch });
      await expect(provider.details('series', row.id)).rejects.toMatchObject({ status: expect.any(Number) });
    }
  });

  it('drops untrusted images and does not invent a rating or episode index', async () => {
    const provider = new CinemetaProvider({ fetcher: vi.fn(async () => json({ meta: { ...row, poster: 'http://127.0.0.1/private', imdbRating: 'N/A' } })) as typeof fetch });
    const data = await provider.details('series', row.id);
    expect(data.poster).toBeUndefined();
    expect(data.rating).toBeUndefined();
    expect(data.episodes).toEqual([]);
  });

  it('validates filters and rejects duplicate parameters', () => {
    for (const params of ['type=anime', 'page=0', 'page=1.5', 'page=1001', 'page=1&page=2', 'url=http://127.0.0.1', 'search=%00', 'region=XX', 'provider=local:server', 'provider=nfx&provider=dnp']) {
      expect(() => cinemaQuery(new URLSearchParams(params))).toThrow();
    }
    expect(cinemaQuery(new URLSearchParams('type=series&search=Test&page=2'))).toEqual({ type: 'series', search: 'Test', page: 2 });
    expect(cinemaQuery(new URLSearchParams('type=series&provider=hlu&region=US&page=10'))).toEqual({ type: 'series', provider: 'hlu', region: 'US', page: 10 });
  });
});

describe('Cinema and Stremio HTTP routes', () => {
  it('serves cinema metadata with no streaming availability claim', async () => {
    const cinema = { catalog: vi.fn(async () => ({ items: [], page: 1, hasNextPage: false })), details: vi.fn(async () => ({ id: row.id, title: 'QA', type: 'series' as const, genres: [], episodes: [] })) };
    const app = createApp({ cinema });
    expect((await app.request('/api/cinema/catalog?type=series')).status).toBe(200);
    expect((await app.request(`/api/cinema/series/${row.id}`)).status).toBe(200);
    for (const path of ['/api/cinema/anime/tt1234567', '/api/cinema/movie/123', '/api/cinema/movie/tt1234567?url=http://127.0.0.1', '/api/cinema/catalog?type=movie&type=series']) {
      expect((await app.request(path)).status).toBe(400);
    }
    expect(cinema.details).toHaveBeenCalledTimes(1);
  });

  it('routes films and rejects malformed Stremio requests before addon access', async () => {
    const stremio = new StremioStreamingProvider({ addons: [] });
    const playback = vi.spyOn(stremio, 'playback').mockResolvedValue({ episode: { id: 'stremio:all:movie:tt1234567', title: 'Filme QA' }, sources: [], subtitles: [], audioLanguages: [], isDemo: false });
    const app = createApp({ registry: new StreamingRegistry({ stremio }) });
    expect((await app.request('/api/content/stremio/movie/tt1234567?provider=qa')).status).toBe(200);
    expect(playback).toHaveBeenCalledWith({ type: 'movie', imdbId: 'tt1234567', provider: 'qa' });
    for (const path of ['/api/content/stremio/tt1234567/1e1/2', '/api/content/stremio/tt1234567/1/1.5', '/api/content/stremio/movie/tt1234567?url=http://127.0.0.1', '/api/content/stremio/tt1234567/1/1?provider=a&provider=b']) {
      expect((await app.request(path)).status).toBe(400);
    }
    expect(playback).toHaveBeenCalledTimes(1);
  });
});
