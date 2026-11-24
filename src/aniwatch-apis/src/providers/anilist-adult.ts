import type { CatalogAnime, CatalogPage } from '../../../shared/providers.js';
import type { AdultCatalogHome, AdultCatalogQuery } from '../../../shared/adult.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache, cache } from '../config/cache.js';
import { anilistRequest, normalizeDetails, normalizeMedia, record, validateAnimeId } from './anilist.js';
import { BLOCKED_ANILIST_TAGS, depictsMinors, isBlockedTag, minorCharacterAge } from './adult-safety.js';

/** Same fields as the general catalog, plus what the minors filter and source matching need. */
const FIELDS = `
  id type isAdult title { romaji english native } synonyms tags { name }
  characters(perPage: 10, sort: ROLE) { nodes { age } }
  coverImage { extraLarge large } bannerImage description(asHtml: false)
  averageScore startDate { year } season format status episodes duration genres
  nextAiringEpisode { episode }
`;
// AniList excludes blocked tags upstream; every result is still checked here.
const FILTER = 'type: ANIME, isAdult: true, tag_not_in: $blocked';

const HOME_QUERY = `query AdultCatalogHome($blocked: [String]) {
  trending: Page(page: 1, perPage: 24) { media(${FILTER}, sort: TRENDING_DESC) { ${FIELDS} } }
  popular: Page(page: 1, perPage: 24) { media(${FILTER}, sort: POPULARITY_DESC) { ${FIELDS} } }
  recent: Page(page: 1, perPage: 24) { media(${FILTER}, status_not: NOT_YET_RELEASED, sort: START_DATE_DESC) { ${FIELDS} } }
  topRated: Page(page: 1, perPage: 24) { media(${FILTER}, sort: SCORE_DESC) { ${FIELDS} } }
}`;

const SEARCH_QUERY = `query AdultCatalogSearch($blocked: [String], $search: String, $tag: String, $sort: [MediaSort], $page: Int) {
  Page(page: $page, perPage: 24) {
    pageInfo { currentPage hasNextPage total }
    media(${FILTER}, search: $search, tag: $tag, sort: $sort) { ${FIELDS} }
  }
}`;

const DETAILS_QUERY = `query AdultCatalogDetails($id: Int) {
  Media(id: $id, type: ANIME, isAdult: true) {
    ${FIELDS}
    popularity countryOfOrigin
    startDate { month day } endDate { year month day }
    studios(isMain: true) { nodes { name } }
    externalLinks { site url }
    relations { edges { relationType(version: 2) node { ${FIELDS} } } }
    recommendations(perPage: 12, sort: RATING_DESC) { nodes { mediaRecommendation { ${FIELDS} } } }
  }
}`;

const SORTS = { popular: 'POPULARITY_DESC', score: 'SCORE_DESC', trending: 'TRENDING_DESC', newest: 'START_DATE_DESC' } as const;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];

/** Fails closed: an entry without a readable tag list is never shown. */
export function blockedAdultMedia(node: Record<string, unknown>): boolean {
  if (!Array.isArray(node.tags)) return true;
  const tags = node.tags.flatMap(tag => tag && typeof tag === 'object' && typeof (tag as Record<string, unknown>).name === 'string' ? [(tag as Record<string, string>).name] : []);
  if (tags.length !== node.tags.length) return true;
  const title = node.title && typeof node.title === 'object' ? node.title as Record<string, unknown> : {};
  const characters = node.characters && typeof node.characters === 'object' ? (node.characters as Record<string, unknown>).nodes : undefined;
  const ages = Array.isArray(characters) ? characters.map(character => character && typeof character === 'object' ? (character as Record<string, unknown>).age : undefined) : [];
  return minorCharacterAge(ages) || depictsMinors({
    tags,
    texts: [title.english, title.romaji, title.native, ...strings(node.synonyms), node.description, ...ages].map(value => typeof value === 'string' ? value : undefined),
  });
}

function adultList(value: unknown): CatalogAnime[] {
  if (!Array.isArray(value)) throw new ApiError(502, 'INVALID_CATALOG_RESPONSE', 'Lista inválida recebida do catálogo.');
  return value.flatMap(media => {
    if (media === null) return [];
    const node = record(media);
    return blockedAdultMedia(node) ? [] : [{ ...normalizeMedia(node, true), synonyms: strings(node.synonyms).slice(0, 12) }];
  });
}

export function validateAdultCatalogQuery(params: Record<string, string>): AdultCatalogQuery {
  if (Object.keys(params).some(key => !['search', 'tag', 'sort', 'page'].includes(key))) {
    throw new ApiError(400, 'INVALID_FILTER', 'Filtro de catálogo desconhecido.');
  }
  const result: AdultCatalogQuery = {};
  const search = params.search?.trim();
  if (search) {
    if (search.length > 120 || [...search].some(character => character.charCodeAt(0) < 32)) throw new ApiError(400, 'INVALID_FILTER', 'A busca é longa demais ou contém caracteres inválidos.');
    result.search = search;
  }
  const tag = params.tag?.trim();
  if (tag) {
    if (tag.length > 50 || !/^[\p{L}\p{N}][\p{L}\p{N} '&/.-]*$/u.test(tag)) throw new ApiError(400, 'INVALID_FILTER', 'Tag inválida.');
    if (isBlockedTag(tag)) throw new ApiError(400, 'ADULT_TAG_BLOCKED', 'Esta tag não está disponível: o HPmovies bloqueia obras que retratam menores.');
    result.tag = tag;
  }
  if (params.sort) {
    if (!Object.prototype.hasOwnProperty.call(SORTS, params.sort)) throw new ApiError(400, 'INVALID_FILTER', 'Ordenação inválida.');
    result.sort = params.sort as AdultCatalogQuery['sort'];
  }
  if (params.page !== undefined && params.page !== '') {
    const page = Number(params.page);
    if (!/^\d+$/.test(params.page) || !Number.isInteger(page) || page < 1 || page > 500) throw new ApiError(400, 'INVALID_FILTER', 'Página inválida.');
    result.page = page;
  }
  return result;
}

export interface AdultCatalogProvider {
  home(): Promise<AdultCatalogHome>;
  search(query: AdultCatalogQuery): Promise<CatalogPage>;
  details(id: string): Promise<CatalogAnime>;
  tags(): Promise<string[]>;
}

interface Options { fetcher?: typeof fetch; cache?: AniwatchAPICache; timeoutMs?: number }

/** AniList titles marked isAdult. Never mixed into the general catalog or its caches. */
export class AniListAdultCatalogProvider implements AdultCatalogProvider {
  private readonly fetcher: typeof fetch;
  private readonly cache: AniwatchAPICache;
  private readonly timeoutMs: number;

  constructor(options: Options = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.cache ?? cache;
    this.timeoutMs = options.timeoutMs ?? 12000;
  }

  private request(query: string, variables: Record<string, unknown> = {}) {
    return anilistRequest(this.fetcher, this.timeoutMs, query, variables);
  }

  home(): Promise<AdultCatalogHome> {
    return this.cache.getOrSet(async () => {
      const data = await this.request(HOME_QUERY, { blocked: [...BLOCKED_ANILIST_TAGS] });
      return {
        trending: adultList(record(data.trending).media), popular: adultList(record(data.popular).media),
        recent: adultList(record(data.recent).media), topRated: adultList(record(data.topRated).media),
      };
    }, 'catalog:anilist:adult:home:v1', 600);
  }

  search(query: AdultCatalogQuery): Promise<CatalogPage> {
    if (query.tag && isBlockedTag(query.tag)) throw new ApiError(400, 'ADULT_TAG_BLOCKED', 'Esta tag não está disponível: o HPmovies bloqueia obras que retratam menores.');
    const variables = {
      ...(query.search ? { search: query.search } : {}), ...(query.tag ? { tag: query.tag } : {}),
      sort: [SORTS[query.sort ?? 'popular']], page: query.page ?? 1,
    };
    return this.cache.getOrSet(async () => {
      const page = record((await this.request(SEARCH_QUERY, { ...variables, blocked: [...BLOCKED_ANILIST_TAGS] })).Page);
      const info = record(page.pageInfo);
      if (typeof info.hasNextPage !== 'boolean' || !Number.isInteger(info.currentPage)) {
        throw new ApiError(502, 'INVALID_CATALOG_RESPONSE', 'Paginação inválida recebida do catálogo.');
      }
      return { items: adultList(page.media), page: Number(info.currentPage), hasNextPage: info.hasNextPage };
    }, `catalog:anilist:adult:search:v1:${JSON.stringify(variables)}`, 300);
  }

  async details(id: string): Promise<CatalogAnime> {
    validateAnimeId(id);
    const result = await this.cache.getOrSet(async (): Promise<{ anime?: CatalogAnime }> => {
      const data = await this.request(DETAILS_QUERY, { id: Number(id) });
      if (data.Media === null) throw new ApiError(404, 'ANIME_NOT_FOUND', 'Título não encontrado no catálogo adulto.');
      const media = record(data.Media);
      if (blockedAdultMedia(media)) return {};
      return { anime: { ...normalizeDetails(media, { adult: true, accept: node => !blockedAdultMedia(node) }), synonyms: strings(media.synonyms).slice(0, 12) } };
    }, `catalog:anilist:adult:details:v1:${id}`, 3600);
    if (!result.anime) throw new ApiError(404, 'ADULT_TITLE_BLOCKED', 'Este título não está disponível: o HPmovies bloqueia obras que retratam menores.');
    return result.anime;
  }

  tags(): Promise<string[]> {
    return this.cache.getOrSet(async () => {
      const data = await this.request('query AdultCatalogTags { MediaTagCollection { name isAdult } }');
      if (!Array.isArray(data.MediaTagCollection)) throw new ApiError(502, 'INVALID_CATALOG_RESPONSE', 'Lista de tags inválida recebida do catálogo.');
      return [...new Set(data.MediaTagCollection.flatMap(value => {
        const tag = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        return tag.isAdult === true && typeof tag.name === 'string' && !isBlockedTag(tag.name) ? [tag.name] : [];
      }))].sort();
    }, 'catalog:anilist:adult:tags:v1', 86400);
  }
}
