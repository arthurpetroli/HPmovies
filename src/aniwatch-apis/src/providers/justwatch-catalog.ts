import type { CinemaCatalog, CinemaCatalogFilters, CinemaQuery, CinemaTitle } from '../../../shared/cinema.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache } from '../config/cache.js';

const ENDPOINT = 'https://apis.justwatch.com/graphql';
const LIMIT = 50;
const IMDB = /^tt\d{5,12}$/;
const REGIONS = [{ id: 'BR', label: 'Brasil' }, { id: 'US', label: 'Estados Unidos' }];
const GENRES: Record<string, string> = {
  act: 'Ação', ani: 'Animação', cmy: 'Comédia', crm: 'Crime', doc: 'Documentário', drm: 'Drama',
  fml: 'Família', fnt: 'Fantasia', hrr: 'Terror', hst: 'História', msc: 'Música', rma: 'Romance',
  scf: 'Ficção científica', spt: 'Esporte', trl: 'Thriller', war: 'Guerra', wst: 'Faroeste',
};
const PACKAGES = `query HPmoviesProviders($country: Country!) {
  packages(country: $country, platform: WEB, includeAddons: false) {
    shortName clearName monetizationTypes hasTitles(country: $country, platform: WEB)
  }
}`;
const CATALOG = `query HPmoviesCatalog($country: Country!, $filter: TitleFilter!, $offset: Int!) {
  popularTitles(country: $country, language: pt, first: 51, offset: $offset, sortBy: POPULAR, filter: $filter) {
    edges { node { objectType content(country: $country, language: pt) {
      title shortDescription originalReleaseDate externalIds { imdbId }
      genres { shortName } posterUrl(profile: S718, format: JPG)
    } } }
  }
}`;
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown, limit = 300): string | undefined => typeof value === 'string' && value.trim() && value.length <= limit ? value.trim() : undefined;
const invalid = () => new ApiError(502, 'CINEMA_INVALID_RESPONSE', 'O catálogo de filmes e séries retornou dados incompatíveis. Tente novamente.');

function poster(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return undefined;
  try {
    const url = new URL(value, 'https://images.justwatch.com');
    return url.origin === 'https://images.justwatch.com' && !url.username && !url.password && !url.search && !url.hash && url.pathname.startsWith('/poster/') ? url.href : undefined;
  } catch { return undefined; }
}

/** Public metadata only. No account, authentication, browser impersonation or client-supplied origin. */
export class JustWatchCatalog {
  private readonly fetcher: typeof fetch;
  private readonly cache: AniwatchAPICache;
  constructor(options: { fetcher?: typeof fetch; cache?: AniwatchAPICache } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.cache ?? new AniwatchAPICache({ maxEntries: 128 });
  }

  private json(query: string, variables: Record<string, unknown>, ttl = 300): Promise<Record<string, unknown>> {
    return this.cache.getOrSet(async () => {
      let response: Response | undefined;
      try {
        response = await this.fetcher(ENDPOINT, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }), credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(12_000) });
        if (!response.ok || response.redirected) throw new ApiError(503, 'CINEMA_UNAVAILABLE', 'O catálogo por streaming está indisponível. Tente novamente.');
        if (!/^application\/(?:[a-z0-9.-]+\+)?json\b/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length') || 0) > 4_000_000) throw invalid();
        const reader = response.body?.getReader();
        if (!reader) throw invalid();
        const parts: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > 4_000_000) throw invalid();
            parts.push(next.value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        let payload: Record<string, unknown> | undefined;
        try { payload = object(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { throw invalid(); }
        if (!payload || payload.errors !== undefined || !object(payload.data)) throw invalid();
        return object(payload.data)!;
      } catch (error) {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, 'CINEMA_CONNECTION_ERROR', 'Não foi possível consultar o catálogo por streaming. Tente novamente.');
      }
    }, `justwatch:${query}:${JSON.stringify(variables)}`, ttl);
  }

  async filters(): Promise<CinemaCatalogFilters> {
    const providers = new Map<string, { id: string; label: string; regions: string[] }>();
    const regions = await Promise.all(REGIONS.map(async region => {
      const data = await this.json(PACKAGES, { country: region.id }, 3600);
      if (!Array.isArray(data.packages) || data.packages.length > 1000) throw invalid();
      return { region: region.id, packages: data.packages };
    }));
    for (const { region, packages } of regions) for (const value of packages) {
      const row = object(value);
      if (!row || row.hasTitles !== true || !Array.isArray(row.monetizationTypes) || !row.monetizationTypes.includes('FLATRATE') ||
        typeof row.shortName !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(row.shortName) || !text(row.clearName, 120)) continue;
      const previous = providers.get(row.shortName);
      providers.set(row.shortName, { id: row.shortName, label: text(row.clearName, 120)!, regions: [...new Set([...(previous?.regions ?? []), region])] });
    }
    return { providers: [...providers.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')), regions: REGIONS.map(region => ({ ...region })) };
  }

  async catalog(query: CinemaQuery): Promise<CinemaCatalog> {
    const region = query.region || 'BR';
    if (!REGIONS.some(item => item.id === region)) throw new ApiError(400, 'INVALID_CINEMA_QUERY', 'Escolha Brasil ou Estados Unidos para consultar o catálogo.');
    if (query.provider) {
      const filters = await this.filters();
      if (!filters.providers.some(provider => provider.id === query.provider && provider.regions?.includes(region))) {
        throw new ApiError(400, 'INVALID_CINEMA_PROVIDER', 'Este streaming não está disponível no país escolhido.');
      }
    }
    const filter = { objectTypes: [query.type === 'movie' ? 'MOVIE' : 'SHOW'],
      ...(query.search ? { searchQuery: query.search } : {}),
      ...(query.provider ? { packages: [query.provider], monetizationTypes: ['FLATRATE'] } : {}),
    };
    const data = await this.json(CATALOG, { country: region, filter, offset: (query.page - 1) * LIMIT });
    const connection = object(data.popularTitles);
    if (!connection || !Array.isArray(connection.edges) || connection.edges.length > LIMIT + 1) throw invalid();
    const items = connection.edges.slice(0, LIMIT).flatMap((edge): CinemaTitle[] => {
      const row = object(object(edge)?.node), content = object(row?.content), id = object(content?.externalIds)?.imdbId;
      if (!row || row.objectType !== (query.type === 'movie' ? 'MOVIE' : 'SHOW') || !content || typeof id !== 'string' || !IMDB.test(id) || !text(content.title)) return [];
      const date = text(content.originalReleaseDate, 40);
      const genres = Array.isArray(content.genres) ? content.genres.flatMap(value => {
        const code = object(value)?.shortName; return typeof code === 'string' && GENRES[code] ? [GENRES[code]] : [];
      }) : [];
      return [{ id, type: query.type, title: text(content.title)!, description: text(content.shortDescription, 20_000),
        poster: poster(content.posterUrl), ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { year: date.slice(0, 4) } : {}), genres }];
    });
    return { items: [...new Map(items.map(item => [item.id, item])).values()], page: query.page, hasNextPage: connection.edges.length > LIMIT,
      notice: `Catálogo JustWatch · ${region === 'BR' ? 'Brasil' : 'Estados Unidos'}. A associação ao streaming pode mudar; o vídeo é consultado separadamente nas fontes.` };
  }
}
