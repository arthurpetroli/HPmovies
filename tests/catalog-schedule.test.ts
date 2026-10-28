import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/aniwatch-apis/src/app';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import { AniListCatalogProvider } from '../src/aniwatch-apis/src/providers/anilist';
import type { AnimeCatalogProvider } from '../src/shared/providers';

const start = Date.parse('2026-10-26T03:00:00Z') / 1000;
const end = start + 7 * 86_400;
const media = (id = 1) => ({
  id, type: 'ANIME', isAdult: false, title: { english: `Anime sintético ${id}` },
  coverImage: { large: 'https://example.com/fixture-poster.jpg' }, genres: ['Action'],
  startDate: { year: 2026 }, status: 'RELEASING', format: 'TV',
});
const airing = (id = 1, airingAt = start, episode = 1) => ({ id, airingAt, episode, media: media(id) });
const response = (page: number, items: unknown[], hasNextPage = false) => new Response(JSON.stringify({
  data: { Page: { pageInfo: { currentPage: page, hasNextPage }, airingSchedules: items } },
}), { headers: { 'Content-Type': 'application/json' } });
const catalog = (): AnimeCatalogProvider => ({
  home: vi.fn(async () => ({ trending: [], popular: [], airing: [], topRated: [], upcoming: [] })),
  search: vi.fn(async () => ({ items: [], page: 1, hasNextPage: false })),
  details: vi.fn(async () => ({ id: '1', title: 'Fixture', poster: '', genres: [] })),
  genres: vi.fn(async () => []),
});

describe('catalog schedule route', () => {
  it.each([
    '', `start=${start}`, `end=${end}`, `start=-1&end=${end}`,
    `start=${start}.5&end=${end}`, `start=1e9&end=${end}`, `start=Infinity&end=${end}`,
    `start=${start * 1000}&end=${end * 1000}`, `start=${end}&end=${start}`,
    `start=${start}&end=${start + 9 * 86_400}`, `start=${start}&end=2147483648`,
    `start=${start}&start=${start}&end=${end}`, `start=${start}&end=${end}&timezone=UTC`,
    `start=2026-10-26&end=2026-11-02`,
  ])('rejects invalid or ambiguous schedule query before contacting the provider: %s', async query => {
    const source = catalog();
    source.schedule = vi.fn(async () => ({ start, end, items: [] }));
    const result = await createApp({ catalog: source }).request(`/api/catalog/schedule?${query}`);
    expect(result.status).toBe(400);
    expect((await result.json()).error).toBe('INVALID_SCHEDULE_RANGE');
    expect(source.schedule).not.toHaveBeenCalled();
  });

  it('passes explicit UTC instants to the provider and returns an honest empty schedule', async () => {
    const source = catalog();
    source.schedule = vi.fn(async () => ({ start, end, items: [] }));
    const result = await createApp({ catalog: source }).request(`/api/catalog/schedule?start=${start}&end=${end}`);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ data: { start, end, items: [] } });
    expect(source.schedule).toHaveBeenCalledWith(start, end);
  });

  it('reports an unsupported catalog instead of inventing schedule entries', async () => {
    const result = await createApp({ catalog: catalog() }).request(`/api/catalog/schedule?start=${start}&end=${end}`);
    expect(result.status).toBe(503);
    expect((await result.json()).error).toBe('SCHEDULE_UNAVAILABLE');
  });
});

describe('AniList original airing schedule', () => {
  it('includes the first instant, excludes the end, preserves episode zero and uses GraphQL variables', async () => {
    const fetcher = vi.fn(async () => response(1, [airing(1, start - 1), airing(2, start, 0), airing(3, end - 1), airing(4, end)]));
    const provider = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache() });
    const schedule = await provider.schedule(start, end);
    expect(schedule).toMatchObject({ start, end, items: [{ id: '2', airingAt: start, episode: 0 }, { id: '3', airingAt: end - 1 }] });
    expect(schedule.items).toHaveLength(2);
    expect(schedule.items[0].anime).toMatchObject({ id: '2', title: 'Anime sintético 2', status: 'RELEASING' });
    expect(schedule.items[0]).not.toHaveProperty('sources');
    expect(schedule.items[0]).not.toHaveProperty('audioLanguages');
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body.variables).toEqual({ page: 1, from: start - 1, end });
    expect(body.query).toContain('airingAt_greater: $from');
    expect(body.query).toContain('airingAt_lesser: $end');
    expect(body.query).toContain('perPage: 50');
    expect(body.query).toContain('sort: [TIME, ID]');
  });

  it('paginates, removes duplicate events and filters adult, manga and missing media without fabricating rows', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(1, [airing(3, start + 120), { ...airing(4), media: { ...media(4), isAdult: true } }, { ...airing(5), media: { ...media(5), type: 'MANGA' } }], true))
      .mockResolvedValueOnce(response(2, [airing(2, start), airing(1, start), airing(3, start + 120), null, { ...airing(6), media: null }]));
    const provider = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache() });
    const schedule = await provider.schedule(start, end);
    expect(schedule.items.map(item => item.id)).toEqual(['1', '2', '3']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(schedule.truncated).toBeUndefined();
  });

  it('bounds pagination and marks a partial schedule explicitly', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const page = JSON.parse(String(init?.body)).variables.page as number;
      return response(page, [airing(page, start + page)], true);
    });
    const provider = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache() });
    const schedule = await provider.schedule(start, end);
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(schedule.items).toHaveLength(10);
    expect(schedule.truncated).toBe(true);
  });

  it('caches each range for five minutes and refreshes expired schedules', async () => {
    let now = 0;
    const fetcher = vi.fn(async () => response(1, []));
    const provider = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache({ now: () => now }) });
    await provider.schedule(start, end);
    await provider.schedule(start, end);
    expect(fetcher).toHaveBeenCalledOnce();
    now = 300_000;
    await provider.schedule(start, end);
    await provider.schedule(start + 1, end + 1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not cache a partial result when a later page fails', async () => {
    let failed = false;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const page = JSON.parse(String(init?.body)).variables.page as number;
      if (page === 2 && !failed) { failed = true; return new Response('Temporary provider failure', { status: 503 }); }
      return response(page, [airing(page, start + page)], page === 1);
    });
    const provider = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache() });
    await expect(provider.schedule(start, end)).rejects.toMatchObject({ status: 502, code: 'CATALOG_UPSTREAM_ERROR' });
    await expect(provider.schedule(start, end)).resolves.toMatchObject({ items: [{ id: '1' }, { id: '2' }] });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([
    { id: 1, airingAt: start, episode: -1, media: media() },
    { id: 1, airingAt: start, episode: 1.5, media: media() },
    { id: 1, airingAt: start + .5, episode: 1, media: media() },
  ])('reports malformed event data instead of assigning a guessed time or episode', async item => {
    const fetcher = vi.fn(async () => response(1, [item]));
    const provider = new AniListCatalogProvider({ fetcher: fetcher as typeof fetch, cache: new AniwatchAPICache() });
    await expect(provider.schedule(start, end)).rejects.toMatchObject({ status: 502, code: 'INVALID_CATALOG_RESPONSE' });
  });
});
