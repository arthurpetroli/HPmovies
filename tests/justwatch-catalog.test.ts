import { describe, expect, it, vi } from 'vitest';
import { JustWatchCatalog } from '../src/aniwatch-apis/src/providers/justwatch-catalog';

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
const title = (id: string, type = 'MOVIE') => ({ node: { objectType: type, content: { title: 'Título de teste', shortDescription: 'Descrição QA', originalReleaseDate: '2020-01-01',
  externalIds: { imdbId: id }, genres: [{ shortName: 'act' }], posterUrl: '/poster/123/s718/test.jpg' } } });
const packages = [
  { shortName: 'nfx', clearName: 'Netflix', monetizationTypes: ['FLATRATE'], hasTitles: true },
  { shortName: 'rent', clearName: 'Somente aluguel QA', monetizationTypes: ['RENT'], hasTitles: true },
  { shortName: 'empty', clearName: 'Sem títulos QA', monetizationTypes: ['FLATRATE'], hasTitles: false },
];

describe('JustWatch streaming metadata contracts', () => {
  it('builds a real provider/region union and keeps Hulu limited to its reported country', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const variables = JSON.parse(String(init.body)).variables;
      return json({ packages: [...packages, ...(variables.country === 'US' ? [{ shortName: 'hlu', clearName: 'Hulu', monetizationTypes: ['FLATRATE'], hasTitles: true }] : [])] });
    });
    const provider = new JustWatchCatalog({ fetcher: fetcher as typeof fetch });
    expect(await provider.filters()).toEqual({ providers: [
      { id: 'hlu', label: 'Hulu', regions: ['US'] }, { id: 'nfx', label: 'Netflix', regions: ['BR', 'US'] },
    ], regions: [{ id: 'BR', label: 'Brasil' }, { id: 'US', label: 'Estados Unidos' }] });
    await provider.filters();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('combines selected service, country and search on the server and requests the next actual offset', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      return payload.query.includes('HPmoviesProviders') ? json({ packages }) : json({ popularTitles: { edges: Array.from({ length: 51 }, (_, index) => title(`tt${1234500 + index}`)) } });
    });
    const provider = new JustWatchCatalog({ fetcher: fetcher as typeof fetch });
    const result = await provider.catalog({ type: 'movie', provider: 'nfx', region: 'BR', search: 'A/B & C', page: 4 });
    expect(result.items).toHaveLength(50);
    expect(result.hasNextPage).toBe(true);
    const [url, init] = fetcher.mock.calls.at(-1)!;
    expect(url).toBe('https://apis.justwatch.com/graphql');
    expect(JSON.parse(String(init.body)).variables).toEqual({ country: 'BR', offset: 150, filter: { objectTypes: ['MOVIE'], packages: ['nfx'], monetizationTypes: ['FLATRATE'], searchQuery: 'A/B & C' } });
    expect(init).toMatchObject({ redirect: 'manual', credentials: 'omit' });
    expect(init.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
  });

  it('refuses an unreported service/country combination before querying titles', async () => {
    const fetcher = vi.fn(async () => json({ packages }));
    const provider = new JustWatchCatalog({ fetcher: fetcher as typeof fetch });
    await expect(provider.catalog({ type: 'movie', provider: 'hlu', region: 'BR', page: 1 })).rejects.toMatchObject({ code: 'INVALID_CINEMA_PROVIDER' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(provider.catalog({ type: 'movie', region: 'XX', page: 1 })).rejects.toMatchObject({ code: 'INVALID_CINEMA_QUERY' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('requires an explicit matching type and IMDb identity and does not invent poster hosts', async () => {
    const valid = title('tt1234567', 'SHOW');
    valid.node.content.posterUrl = 'https://private.invalid/poster/1';
    const fetcher = vi.fn(async () => json({ popularTitles: { edges: [valid, title('tt1234567', 'SHOW'), title('tt7654321', 'MOVIE'), title('tmdb:12', 'SHOW')] } }));
    const result = await new JustWatchCatalog({ fetcher: fetcher as typeof fetch }).catalog({ type: 'series', search: 'teste', page: 1 });
    expect(result.items.map(item => item.id)).toEqual(['tt1234567']);
    expect(result.hasNextPage).toBe(false);
    expect(result.items[0]).toMatchObject({ year: '2020', genres: ['Ação'] });
  });

  it('keeps a real empty search separate from a GraphQL/HTTP failure', async () => {
    const empty = new JustWatchCatalog({ fetcher: vi.fn(async () => json({ popularTitles: { edges: [] } })) as typeof fetch });
    expect(await empty.catalog({ type: 'movie', search: 'ausente', page: 1 })).toMatchObject({ items: [], hasNextPage: false });
    const failure = new JustWatchCatalog({ fetcher: vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'QA error' }], data: {} }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch });
    await expect(failure.catalog({ type: 'movie', search: 'teste', page: 1 })).rejects.toMatchObject({ code: 'CINEMA_INVALID_RESPONSE' });
    const denied = new JustWatchCatalog({ fetcher: vi.fn(async () => json({}, 403)) as typeof fetch });
    await expect(denied.catalog({ type: 'movie', search: 'teste', page: 1 })).rejects.toMatchObject({ code: 'CINEMA_UNAVAILABLE' });
  });

  it('refuses redirects and oversized GraphQL responses', async () => {
    for (const response of [new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }),
      new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '4000001' } })]) {
      const provider = new JustWatchCatalog({ fetcher: vi.fn(async () => response) as typeof fetch });
      await expect(provider.catalog({ type: 'movie', search: 'teste', page: 1 })).rejects.toMatchObject({ status: expect.any(Number) });
    }
  });
});
