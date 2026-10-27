import type {
  AnimeCatalogProvider, CatalogAnime, CatalogHome, CatalogPage, CatalogQuery,
} from '../../../shared/providers.js';
import { runtimeConfig } from '../config/runtime.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache, cache } from '../config/cache.js';

const MEDIA_FIELDS = `
  id type isAdult title { romaji english native }
  coverImage { extraLarge large } bannerImage description(asHtml: false)
  averageScore startDate { year } season format status episodes duration genres
`;

const HOME_QUERY = `query CatalogHome {
  trending: Page(page: 1, perPage: 12) { media(type: ANIME, isAdult: false, sort: TRENDING_DESC) { ${MEDIA_FIELDS} } }
  popular: Page(page: 1, perPage: 12) { media(type: ANIME, isAdult: false, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } }
  airing: Page(page: 1, perPage: 12) { media(type: ANIME, isAdult: false, status: RELEASING, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } }
  topRated: Page(page: 1, perPage: 12) { media(type: ANIME, isAdult: false, sort: SCORE_DESC) { ${MEDIA_FIELDS} } }
  upcoming: Page(page: 1, perPage: 12) { media(type: ANIME, isAdult: false, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } }
}`;

const SEARCH_QUERY = `query CatalogSearch(
  $search: String, $genre: String, $format: MediaFormat, $status: MediaStatus, $season: MediaSeason,
  $sort: [MediaSort], $page: Int, $dateStart: FuzzyDateInt, $dateEnd: FuzzyDateInt
) {
  Page(page: $page, perPage: 24) {
    pageInfo { currentPage hasNextPage total }
    media(type: ANIME, isAdult: false, search: $search, genre: $genre,
      format: $format, status: $status, sort: $sort, season: $season,
      startDate_greater: $dateStart, startDate_lesser: $dateEnd) { ${MEDIA_FIELDS} }
  }
}`;

const DETAILS_QUERY = `query CatalogDetails($id: Int) {
  Media(id: $id, type: ANIME, isAdult: false) {
    ${MEDIA_FIELDS}
    externalLinks { site url }
    characters(perPage: 12, sort: ROLE) { edges { role node { id name { full } image { medium } } } }
    relations { edges { relationType(version: 2) node { ${MEDIA_FIELDS} } } }
    recommendations(perPage: 12, sort: RATING_DESC) { nodes { mediaRecommendation { ${MEDIA_FIELDS} } } }
  }
}`;

const FORMATS = new Set(['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC']);
const STATUSES = new Set(['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS']);
const SORTS = { popular: 'POPULARITY_DESC', score: 'SCORE_DESC', trending: 'TRENDING_DESC', newest: 'START_DATE_DESC' };

export function validateAnimeId(id: string): string {
  if (!/^[1-9]\d{0,8}$/.test(id)) {
    throw new ApiError(400, 'INVALID_ANIME_ID', 'O identificador do anime deve ser um número positivo do AniList.');
  }
  return id;
}

export function validateCatalogQuery(params: Record<string, string>): CatalogQuery {
  const allowed = new Set(['search', 'genre', 'year', 'season', 'format', 'status', 'sort', 'page']);
  if (Object.keys(params).some((key) => !allowed.has(key))) {
    throw new ApiError(400, 'INVALID_FILTER', 'Filtro de catálogo desconhecido.');
  }
  const result: CatalogQuery = {};
  for (const field of ['search', 'genre'] as const) {
    const value = params[field]?.trim();
    if (value && (value.length > (field === 'search' ? 120 : 50) || [...value].some((character) => character.charCodeAt(0) < 32))) {
      throw new ApiError(400, 'INVALID_FILTER', 'O filtro informado é longo demais ou contém caracteres inválidos.');
    }
    if (value) result[field] = value;
  }
  for (const [field, minimum, maximum] of [['page', 1, 1000], ['year', 1900, 2100]] as const) {
    if (params[field] !== undefined && params[field] !== '') {
      const value = Number(params[field]);
      if (!/^\d+$/.test(params[field]) || !Number.isInteger(value) || value < minimum || value > maximum) {
        throw new ApiError(400, 'INVALID_FILTER', `Valor inválido para ${field}.`);
      }
      result[field] = value;
    }
  }
  if (params.season) {
    if (!['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(params.season)) throw new ApiError(400, 'INVALID_FILTER', 'Temporada inválida.');
    result.season = params.season as CatalogQuery['season'];
  }
  if (params.format) {
    if (!FORMATS.has(params.format)) throw new ApiError(400, 'INVALID_FILTER', 'Formato de anime inválido.');
    result.format = params.format;
  }
  if (params.status) {
    if (!STATUSES.has(params.status)) throw new ApiError(400, 'INVALID_FILTER', 'Status de anime inválido.');
    result.status = params.status;
  }
  if (params.sort) {
    if (!Object.prototype.hasOwnProperty.call(SORTS, params.sort)) throw new ApiError(400, 'INVALID_FILTER', 'Ordenação inválida.');
    result.sort = params.sort as CatalogQuery['sort'];
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(502, 'INVALID_CATALOG_RESPONSE', 'O catálogo respondeu com dados inválidos. Tente novamente.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function plainDescription(value: unknown): string | undefined {
  const description = text(value);
  return description?.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 6000);
}

function normalizeMedia(value: unknown): CatalogAnime {
  const media = record(value);
  const id = number(media.id);
  const titles = record(media.title);
  const title = text(titles.english) ?? text(titles.romaji) ?? text(titles.native);
  if (!id || !Number.isInteger(id) || !title || media.type !== 'ANIME' || media.isAdult !== false) {
    throw new ApiError(502, 'INVALID_CATALOG_RESPONSE', 'O catálogo respondeu com dados inválidos. Tente novamente.');
  }
  const cover = media.coverImage ? record(media.coverImage) : {};
  const startDate = media.startDate ? record(media.startDate) : {};
  return {
    id: String(id), title, titleOriginal: text(titles.romaji) ?? text(titles.native),
    poster: safeUrl(cover.extraLarge) ?? safeUrl(cover.large) ?? '',
    banner: safeUrl(media.bannerImage), description: plainDescription(media.description),
    score: number(media.averageScore), year: number(startDate.year),
    format: text(media.format), status: text(media.status), season: text(media.season),
    genres: Array.isArray(media.genres) ? media.genres.filter((genre): genre is string => typeof genre === 'string') : [],
    episodeCount: number(media.episodes), duration: number(media.duration),
  };
}

function normalizeList(value: unknown): CatalogAnime[] {
  if (!Array.isArray(value)) throw new ApiError(502, 'INVALID_CATALOG_RESPONSE', 'Lista inválida recebida do catálogo.');
  return value.filter((media) => media !== null).map(normalizeMedia);
}

interface AniListOptions {
  fetcher?: typeof fetch;
  cache?: AniwatchAPICache;
  timeoutMs?: number;
}

export class AniListCatalogProvider implements AnimeCatalogProvider {
  private readonly fetcher: typeof fetch;
  private readonly cache: AniwatchAPICache;
  private readonly timeoutMs: number;

  constructor(options: AniListOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.cache ?? cache;
    this.timeoutMs = options.timeoutMs ?? 12000;
  }

  private async request(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher(runtimeConfig.anilistUrl, {
        redirect: 'error', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        throw new ApiError(504, 'CATALOG_TIMEOUT', 'O catálogo demorou a responder. Tente novamente.');
      }
      throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Não foi possível conectar ao AniList. Verifique sua conexão e tente novamente.');
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After')) || 60;
      throw new ApiError(503, 'CATALOG_RATE_LIMIT', 'O AniList está limitando as consultas. Aguarde um momento e tente novamente.', Math.min(3600, Math.max(1, retryAfter)));
    }
    if (response.status === 403) throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'O AniList recusou o acesso à API. O serviço pode estar temporariamente indisponível. Tente novamente mais tarde.');
    if (response.status === 404) throw new ApiError(404, 'ANIME_NOT_FOUND', 'Anime não encontrado no catálogo.');
    if (!response.ok) throw new ApiError(502, 'CATALOG_UPSTREAM_ERROR', 'O AniList está indisponível no momento. Tente novamente.');
    let payload: Record<string, unknown>;
    try {
      payload = record(await response.json());
    } catch {
      throw new ApiError(502, 'INVALID_CATALOG_RESPONSE', 'O catálogo respondeu com dados inválidos. Tente novamente.');
    }
    if (Array.isArray(payload.errors) && payload.errors.length) {
      const isNotFound = payload.errors.some((error) => error && typeof error === 'object' && 'status' in error && error.status === 404);
      if (isNotFound) throw new ApiError(404, 'ANIME_NOT_FOUND', 'Anime não encontrado no catálogo.');
      throw new ApiError(502, 'CATALOG_UPSTREAM_ERROR', 'Não foi possível consultar o catálogo. Tente novamente.');
    }
    return record(payload.data);
  }

  home(): Promise<CatalogHome> {
    return this.cache.getOrSet(async () => {
      const data = await this.request(HOME_QUERY);
      return {
        trending: normalizeList(record(data.trending).media),
        popular: normalizeList(record(data.popular).media),
        airing: normalizeList(record(data.airing).media),
        topRated: normalizeList(record(data.topRated).media),
        upcoming: normalizeList(record(data.upcoming).media),
      };
    }, 'catalog:anilist:home', 300);
  }

  search(query: CatalogQuery): Promise<CatalogPage> {
    const variables = {
      // AniList treats explicit null filters as values; omit every unused filter.
      ...(query.search ? { search: query.search } : {}),
      ...(query.genre ? { genre: query.genre } : {}),
      ...(query.season ? { season: query.season } : {}),
      ...(query.format ? { format: query.format } : {}),
      ...(query.status ? { status: query.status } : {}),
      sort: [SORTS[query.sort ?? 'popular']], page: query.page ?? 1,
      ...(query.year ? { dateStart: query.year * 10000 + 100, dateEnd: query.year * 10000 + 1232 } : {}),
    };
    return this.cache.getOrSet(async () => {
      const data = await this.request(SEARCH_QUERY, variables);
      const page = record(data.Page);
      const info = record(page.pageInfo);
      if (typeof info.hasNextPage !== 'boolean' || !Number.isInteger(info.currentPage)) {
        throw new ApiError(502, 'INVALID_CATALOG_RESPONSE', 'Paginação inválida recebida do catálogo.');
      }
      return { items: normalizeList(page.media), page: Number(info.currentPage), hasNextPage: info.hasNextPage, total: number(info.total) };
    }, `catalog:anilist:search:${JSON.stringify(variables)}`, 300);
  }

  details(id: string): Promise<CatalogAnime> {
    validateAnimeId(id);
    return this.cache.getOrSet(async () => {
      const data = await this.request(DETAILS_QUERY, { id: Number(id) });
      if (data.Media === null) throw new ApiError(404, 'ANIME_NOT_FOUND', 'Anime não encontrado no catálogo.');
      const media = record(data.Media);
      const anime = normalizeMedia(media);
      const relations = media.relations ? record(media.relations).edges : undefined;
      const recommendations = media.recommendations ? record(media.recommendations).nodes : undefined;
      anime.relations = Array.isArray(relations) ? relations.flatMap((value) => {
        if (!value) return [];
        const edge = record(value);
        if (!edge.node) return [];
        const node = record(edge.node);
        if (node.type !== 'ANIME' || node.isAdult !== false) return [];
        return [{ relation: text(edge.relationType) ?? 'RELATED', anime: normalizeMedia(node) }];
      }) : [];
      anime.recommendations = Array.isArray(recommendations) ? recommendations.flatMap((value) => {
        if (!value) return [];
        const recommendation = record(value).mediaRecommendation;
        if (!recommendation) return [];
        const node = record(recommendation);
        return node.type === 'ANIME' && node.isAdult === false ? [normalizeMedia(node)] : [];
      }) : [];
      anime.externalLinks = Array.isArray(media.externalLinks) ? media.externalLinks.flatMap((value) => {
        if (!value) return [];
        const link = record(value);
        const url = safeUrl(link.url);
        const site = text(link.site);
        return url && site ? [{ url, site }] : [];
      }) : [];
      const characters = media.characters ? record(media.characters).edges : undefined;
      anime.characters = Array.isArray(characters) ? characters.flatMap(value => {
        if (!value) return [];
        const edge = record(value);
        if (!edge.node) return [];
        const node = record(edge.node);
        const name = node.name ? text(record(node.name).full) : undefined;
        const id = number(node.id);
        const image = node.image ? safeUrl(record(node.image).medium) : undefined;
        return id && name ? [{ id: String(id), name, image, role: text(edge.role) }] : [];
      }) : [];
      return anime;
    }, `catalog:anilist:details:${id}`, 3600);
  }

  genres(): Promise<string[]> {
    return this.cache.getOrSet(async () => {
      const data = await this.request('query CatalogGenres { GenreCollection }');
      if (!Array.isArray(data.GenreCollection) || data.GenreCollection.some((value) => typeof value !== 'string')) {
        throw new ApiError(502, 'INVALID_CATALOG_RESPONSE', 'Lista de gêneros inválida recebida do catálogo.');
      }
      return (data.GenreCollection as string[]).filter((genre) => genre !== 'Hentai').sort();
    }, 'catalog:anilist:genres', 86400);
  }
}
