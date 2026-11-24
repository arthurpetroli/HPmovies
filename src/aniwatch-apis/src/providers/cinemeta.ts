import type { CinemaCatalog, CinemaCatalogFilters, CinemaDetails, CinemaEpisode, CinemaProvider, CinemaQuery, CinemaTitle, CinemaType } from '../../../shared/cinema.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache } from '../config/cache.js';
import { JustWatchCatalog } from './justwatch-catalog.js';

const ORIGIN = 'https://v3-cinemeta.strem.io';
// The official v3 service redirects catalogs to this fixed first-party origin.
// Request it directly; unexpected redirects still remain refused.
const CATALOG_ORIGIN = 'https://cinemeta-catalogs.strem.io/top';
const IMDB = /^tt\d{5,12}$/;
const PAGE_SIZE = 50;
const MAX_BYTES = 4_000_000;
const record = (input: unknown): Record<string, unknown> | undefined => input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined;
const text = (input: unknown, max = 500): string | undefined => typeof input === 'string' && input.trim() && input.length <= max ? input.trim() : undefined;
const invalid = () => new ApiError(502, 'CINEMA_INVALID_RESPONSE', 'O catálogo de filmes e séries retornou dados incompatíveis. Tente novamente.');

export function validateCinemaType(input: string): CinemaType {
  if (input !== 'movie' && input !== 'series') throw new ApiError(400, 'INVALID_CINEMA_TYPE', 'Escolha filmes ou séries.');
  return input;
}

export function validateCinemaId(input: string): string {
  if (!IMDB.test(input)) throw new ApiError(400, 'INVALID_CINEMA_ID', 'Informe um identificador IMDb válido.');
  return input;
}

export function cinemaQuery(params: URLSearchParams): CinemaQuery {
  const allowed = ['type', 'search', 'page', 'provider', 'region'];
  if ([...params.keys()].some(key => !allowed.includes(key)) || allowed.some(key => params.getAll(key).length > 1)) {
    throw new ApiError(400, 'INVALID_CINEMA_QUERY', 'Filtro de filmes e séries inválido.');
  }
  const type = validateCinemaType(params.get('type') || 'movie');
  const search = (params.get('search') || '').trim();
  const page = params.get('page') || '1';
  const provider = params.get('provider') || undefined, region = params.get('region') || undefined;
  if (search.length > 120 || [...search].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || !/^[1-9]\d{0,3}$/.test(page) || Number(page) > 1000 ||
    provider && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(provider) || region && !['BR', 'US'].includes(region)) {
    throw new ApiError(400, 'INVALID_CINEMA_QUERY', 'Informe busca, streaming, país e página válidos.');
  }
  return { type, ...(search ? { search } : {}), page: Number(page), ...(provider ? { provider } : {}), ...(region ? { region } : {}) };
}

export function cinemaArtwork(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > 2000) return undefined;
  try {
    const url = new URL(input);
    const host = url.hostname;
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443') &&
      ['metahub.space', 'media-amazon.com', 'tmdb.org'].some(root => host === root || host.endsWith(`.${root}`)) ? url.href : undefined;
  } catch { return undefined; }
}

function title(input: unknown, type: CinemaType): CinemaTitle | undefined {
  const row = record(input);
  if (!row || row.type !== type || typeof row.id !== 'string' || !IMDB.test(row.id) || !text(row.name, 300)) return undefined;
  const genres = row.genres ?? row.genre;
  const rating = typeof row.imdbRating === 'string' && row.imdbRating.trim() ? Number(row.imdbRating) : row.imdbRating;
  return {
    id: row.id, type, title: text(row.name, 300)!,
    poster: cinemaArtwork(row.poster), background: cinemaArtwork(row.background), description: text(row.description, 20_000),
    year: text(row.releaseInfo, 50) ?? text(row.year, 50), runtime: text(row.runtime, 100),
    genres: Array.isArray(genres) ? genres.flatMap(value => text(value, 80) ? [text(value, 80)!] : []).slice(0, 30) : [],
    ...(typeof rating === 'number' && Number.isFinite(rating) && rating >= 0 && rating <= 10 ? { rating } : {}),
  };
}

function episodes(input: unknown, imdbId: string): CinemaEpisode[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 20_000) throw invalid();
  const rows = input.flatMap((value): CinemaEpisode[] => {
    const row = record(value);
    if (!row || !Number.isInteger(row.season) || !Number.isInteger(row.episode) || Number(row.season) < 0 || Number(row.season) > 1000 || Number(row.episode) < 1 || Number(row.episode) > 100_000) return [];
    const season = Number(row.season), episode = Number(row.episode), id = `${imdbId}:${season}:${episode}`;
    // Never silently rewrite a foreign video's identity into this series.
    if (row.id !== id) return [];
    const date = text(row.released, 100);
    return [{ id, season, episode, title: text(row.title, 300) ?? text(row.name, 300) ?? `Episódio ${episode}`,
      ...(date && Number.isFinite(Date.parse(date)) ? { released: new Date(date).toISOString() } : {}), thumbnail: cinemaArtwork(row.thumbnail) }];
  });
  return [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

export class CinemetaProvider implements CinemaProvider {
  private readonly fetcher: typeof fetch;
  private readonly cache: AniwatchAPICache;
  private readonly streamingCatalog: JustWatchCatalog;
  constructor(options: { fetcher?: typeof fetch; cache?: AniwatchAPICache } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.cache ?? new AniwatchAPICache({ maxEntries: 128 });
    this.streamingCatalog = new JustWatchCatalog({ fetcher: this.fetcher, cache: this.cache });
  }

  private async json(path: string): Promise<unknown> {
    return this.cache.getOrSet(async () => {
      let response: Response | undefined;
      try {
        response = await this.fetcher(`${path.startsWith('/catalog/') ? CATALOG_ORIGIN : ORIGIN}${path}`, {
          headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(8000),
        });
        if (response.status === 404) throw new ApiError(404, 'CINEMA_NOT_FOUND', 'Este título não foi encontrado no catálogo.');
        if (!response.ok || response.redirected) throw new ApiError(503, 'CINEMA_UNAVAILABLE', 'O catálogo de filmes e séries está indisponível. Tente novamente.');
        if (!/^application\/(?:[a-z0-9.-]+\+)?json\b/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw invalid();
        const reader = response.body?.getReader();
        if (!reader) throw invalid();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > MAX_BYTES) throw invalid();
            chunks.push(part.value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw invalid(); }
      } catch (error) {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, 'CINEMA_CONNECTION_ERROR', 'Não foi possível conectar ao catálogo de filmes e séries. Tente novamente.');
      }
    }, `cinemeta:${path}`, 300);
  }

  async details(type: CinemaType, id: string): Promise<CinemaDetails> {
    validateCinemaType(type); validateCinemaId(id);
    const data = record(await this.json(`/meta/${type}/${id}.json`));
    const work = title(data?.meta, type);
    if (!work || work.id !== id) throw invalid();
    return { ...work, episodes: type === 'series' ? episodes(record(data?.meta)?.videos, id) : [] };
  }

  async catalog(query: CinemaQuery): Promise<CinemaCatalog> {
    const checked = cinemaQuery(new URLSearchParams({ type: query.type, page: String(query.page), ...(query.search ? { search: query.search } : {}),
      ...(query.provider ? { provider: query.provider } : {}), ...(query.region ? { region: query.region } : {}) }));
    if (checked.provider || checked.search) return this.streamingCatalog.catalog(checked);
    const extra = new URLSearchParams({ skip: String((checked.page - 1) * PAGE_SIZE) });
    const data = record(await this.json(`/catalog/${checked.type}/top/${extra}.json`));
    if (!data || !Array.isArray(data.metas) || data.metas.length > 500) throw invalid();
    const items = [...new Map(data.metas.flatMap(row => {
      const item = title(row, checked.type); return item ? [[item.id, item] as const] : [];
    })).values()];
    return { items, page: checked.page, hasNextPage: typeof data.hasMore === 'boolean' ? data.hasMore : data.metas.length >= PAGE_SIZE };
  }

  filters(): Promise<CinemaCatalogFilters> { return this.streamingCatalog.filters(); }
}
