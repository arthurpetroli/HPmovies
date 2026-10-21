import { randomUUID } from 'node:crypto';
import type {
  MangaCatalogProvider, MangaChapterProvider, MangaChapter, MangaChapterPage, MangaChapterPages,
  MangaHome, MangaImageProvider, MangaPage, MangaQuery, MangaTag, MangaTitle,
} from '../../../shared/manga.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache, cache } from '../config/cache.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/;
const PAGE_SIZE = 24;
const CHAPTER_PAGE_SIZE = 100;
const SORTS = { popular: 'followedCount', rating: 'rating', latest: 'latestUploadedChapter', newest: 'createdAt' } as const;
const STATUSES = new Set(['ongoing', 'completed', 'hiatus', 'cancelled']);
const RATINGS = new Set(['safe', 'suggestive']);
const fail = () => new ApiError(502, 'INVALID_MANGA_RESPONSE', 'O MangaDex retornou dados inesperados. Tente novamente.');
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  return value as Record<string, unknown>;
};
const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const integer = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const list = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw fail(); return value; };
const localized = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const text = value as Record<string, unknown>;
  return string(text['pt-br']) ?? string(text.pt) ?? string(text.en) ?? string(Object.values(text).find((entry) => typeof entry === 'string' && entry.trim()));
};
const plain = (value: string | undefined) => value?.replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').slice(0, 8000);
const externalUrl = (value: unknown): string | undefined => {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
};

export function validateMangaId(id: string): string {
  if (!UUID.test(id)) throw new ApiError(400, 'INVALID_MANGA_ID', 'Identificador MangaDex inválido.');
  return id.toLowerCase();
}
export function validateMangaLanguage(language: string): string {
  if (!LANG.test(language) || language.length > 10) throw new ApiError(400, 'INVALID_LANGUAGE', 'Idioma de edição inválido.');
  return language;
}
export function validateMangaPage(page: unknown, chapter = false): number {
  const value = Number(page ?? 1);
  if (!/^\d+$/.test(String(page ?? 1)) || !Number.isInteger(value) || value < 1 || value > (chapter ? 100 : 416)) {
    throw new ApiError(400, 'INVALID_PAGE', 'Página fora do intervalo permitido pelo MangaDex.');
  }
  return value;
}
export function validateMangaQuery(params: Record<string, string>): MangaQuery {
  const allowed = new Set(['search', 'tag', 'status', 'sort', 'page']);
  if (Object.keys(params).some((key) => !allowed.has(key))) throw new ApiError(400, 'INVALID_FILTER', 'Filtro de mangás desconhecido.');
  const result: MangaQuery = { page: validateMangaPage(params.page) };
  const search = params.search?.trim();
  if (search && (search.length > 120 || [...search].some((character) => character.charCodeAt(0) < 32))) throw new ApiError(400, 'INVALID_FILTER', 'Título de busca inválido.');
  if (search) result.search = search;
  if (params.tag) result.tag = validateMangaId(params.tag);
  if (params.status) {
    if (!STATUSES.has(params.status)) throw new ApiError(400, 'INVALID_FILTER', 'Status inválido.');
    result.status = params.status as MangaQuery['status'];
  }
  if (params.sort) {
    if (!Object.hasOwn(SORTS, params.sort)) throw new ApiError(400, 'INVALID_FILTER', 'Ordenação inválida.');
    result.sort = params.sort as MangaQuery['sort'];
  }
  return result;
}

function relationships(entity: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(entity.relationships) ? entity.relationships.map(record) : [];
}
export function normalizeManga(value: unknown): MangaTitle {
  const manga = record(value);
  const id = string(manga.id);
  const attrs = record(manga.attributes);
  const title = localized(attrs.title);
  const rating = string(attrs.contentRating);
  if (!id || !UUID.test(id) || manga.type !== 'manga' || !title || !rating || !RATINGS.has(rating)) throw fail();
  const relations = relationships(manga);
  const cover = relations.find((relation) => relation.type === 'cover_art');
  const filename = cover?.attributes ? string(record(cover.attributes).fileName) : undefined;
  const poster = filename && /^[\w.-]+$/.test(filename) ? `https://uploads.mangadex.org/covers/${id}/${filename}.256.jpg` : '';
  const languages = Array.isArray(attrs.availableTranslatedLanguages) ? attrs.availableTranslatedLanguages.filter((lang): lang is string => typeof lang === 'string' && LANG.test(lang)) : [];
  return {
    id, title, originalTitle: localized(attrs.altTitles && Array.isArray(attrs.altTitles) ? attrs.altTitles[0] : undefined),
    poster, description: plain(localized(attrs.description)), status: string(attrs.status), year: integer(attrs.year),
    originalLanguage: string(attrs.originalLanguage), availableLanguages: [...new Set(languages)].sort((a, b) => a === 'pt-br' ? -1 : b === 'pt-br' ? 1 : a.localeCompare(b)),
    tags: Array.isArray(attrs.tags) ? attrs.tags.flatMap((value) => {
      const tag = record(value); const name = localized(record(tag.attributes).name);
      return UUID.test(String(tag.id)) && name ? [{ id: String(tag.id), name }] : [];
    }) : [],
    authors: relations.filter((relation) => relation.type === 'author' || relation.type === 'artist')
      .flatMap((relation) => { const name = relation.attributes ? string(record(relation.attributes).name) : undefined; return name ? [name] : []; })
      .filter((name, index, authors) => authors.indexOf(name) === index),
    contentRating: rating as MangaTitle['contentRating'], sourceUrl: `https://mangadex.org/title/${id}`,
  };
}
export function normalizeChapter(value: unknown): MangaChapter {
  const chapter = record(value); const attrs = record(chapter.attributes); const relations = relationships(chapter);
  const id = string(chapter.id); const mangaId = string(relations.find((rel) => rel.type === 'manga')?.id);
  const language = string(attrs.translatedLanguage); const pages = integer(attrs.pages);
  if (!id || !UUID.test(id) || chapter.type !== 'chapter' || !mangaId || !UUID.test(mangaId) || !language || !LANG.test(language) || pages === undefined) throw fail();
  return {
    id, mangaId, title: string(attrs.title) ?? (attrs.chapter ? `Capítulo ${String(attrs.chapter)}` : 'Capítulo especial'),
    chapter: string(attrs.chapter) ?? null, volume: string(attrs.volume) ?? null, language, pages,
    groups: relations.filter((rel) => rel.type === 'scanlation_group').flatMap((rel) => { const name = rel.attributes ? string(record(rel.attributes).name) : undefined; return name ? [name] : []; }),
    publishedAt: string(attrs.publishAt), externalUrl: externalUrl(attrs.externalUrl),
  };
}

interface ImageTicket { source: string; expiresAt: number }
function trustedImageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
    || !(url.hostname === 'uploads.mangadex.org' || url.hostname.endsWith('.mangadex.network'))) throw fail();
  return url;
}
interface MangaDexOptions { fetcher?: typeof fetch; cache?: AniwatchAPICache; timeoutMs?: number; baseUrl?: string; requestIntervalMs?: number; blockedGroupIds?: string[] }
/** Public v5 client. The scoped image gateway follows MangaDex policy, with no arbitrary URL input or disk cache. */
export class MangaDexProvider implements MangaCatalogProvider, MangaChapterProvider, MangaImageProvider {
  private readonly fetcher: typeof fetch;
  private readonly store: AniwatchAPICache;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly interval: number;
  private lastRequest = 0;
  private lastAtHomeRequest = 0;
  private queue: Promise<void> = Promise.resolve();
  private cooldownUntil = 0;
  private readonly blockedGroupIds: Set<string>;
  private readonly imageTickets = new Map<string, ImageTicket>();
  private readonly imageSources = new Map<string, string>();
  private readonly pendingImages = new Map<string, Promise<Awaited<ReturnType<MangaImageProvider['image']>>>>();
  constructor(options: MangaDexOptions = {}) {
    this.fetcher = options.fetcher ?? fetch; this.store = options.cache ?? cache; this.timeoutMs = options.timeoutMs ?? 12000;
    const base = new URL(options.baseUrl ?? process.env.MANGADEX_API_URL ?? 'https://api.mangadex.org');
    if (base.protocol !== 'https:' || base.hostname !== 'api.mangadex.org' || base.username || base.password || base.port || base.search || base.hash || (base.pathname !== '/' && base.pathname !== '')) {
      throw new Error('MANGADEX_API_URL deve apontar para https://api.mangadex.org.');
    }
    this.baseUrl = base.origin; this.interval = options.requestIntervalMs ?? 250;
    const blocked = options.blockedGroupIds ?? (process.env.MANGADEX_BLOCKED_GROUP_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    this.blockedGroupIds = new Set(blocked.map(validateMangaId));
  }
  private blockedChapter(value: unknown): boolean {
    return relationships(record(value)).some((relation) => relation.type === 'scanlation_group' && typeof relation.id === 'string' && this.blockedGroupIds.has(relation.id.toLowerCase()));
  }
  private issueImage(source: string, ttlSeconds = 3600): string {
    trustedImageUrl(source);
    const existing = this.imageSources.get(source);
    if (existing) {
      const ticket = this.imageTickets.get(existing);
      if (ticket && ticket.expiresAt > Date.now() + 60000) {
        this.imageTickets.delete(existing); this.imageTickets.set(existing, ticket);
        return `/api/manga/image/${existing}`;
      }
    }
    for (const [token, ticket] of this.imageTickets) {
      if (ticket.expiresAt <= Date.now()) { this.imageTickets.delete(token); if (this.imageSources.get(ticket.source) === token) this.imageSources.delete(ticket.source); }
    }
    while (this.imageTickets.size >= 2048) {
      const first = this.imageTickets.entries().next().value;
      if (!first) break;
      this.imageTickets.delete(first[0]); if (this.imageSources.get(first[1].source) === first[0]) this.imageSources.delete(first[1].source);
    }
    const token = randomUUID();
    this.imageTickets.set(token, { source, expiresAt: Date.now() + ttlSeconds * 1000 }); this.imageSources.set(source, token);
    return `/api/manga/image/${token}`;
  }
  private withImage(manga: MangaTitle): MangaTitle {
    return { ...manga, poster: manga.poster ? this.issueImage(manga.poster) : '' };
  }
  image(token: string): ReturnType<MangaImageProvider['image']> {
    if (!UUID.test(token)) return Promise.reject(new ApiError(404, 'MANGA_IMAGE_NOT_FOUND', 'Imagem não encontrada.'));
    const ticket = this.imageTickets.get(token);
    if (!ticket || ticket.expiresAt <= Date.now()) {
      if (ticket && this.imageSources.get(ticket.source) === token) this.imageSources.delete(ticket.source);
      this.imageTickets.delete(token);
      return Promise.reject(new ApiError(404, 'MANGA_IMAGE_EXPIRED', 'A imagem expirou. Atualize a obra ou o capítulo.'));
    }
    const existing = this.pendingImages.get(token); if (existing) return existing;
    if (this.pendingImages.size >= 12) return Promise.reject(new ApiError(503, 'MANGA_IMAGES_BUSY', 'Há muitas páginas carregando. Tente novamente em instantes.'));
    const task = this.loadImage(ticket).finally(() => this.pendingImages.delete(token));
    this.pendingImages.set(token, task); return task;
  }
  private async loadImage(ticket: ImageTicket): ReturnType<MangaImageProvider['image']> {
    const source = trustedImageUrl(ticket.source); const started = Date.now();
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 14000);
    let bytes = 0; let success = false; let cached = false;
    try {
      const response = await this.fetcher(source.href, { headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif', 'User-Agent': 'HPmovies/2.0 (local MangaDex API client)' }, signal: controller.signal, redirect: 'error' });
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
      if (!response.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(mime) || !response.body || Number(response.headers.get('content-length')) > 20_000_000) {
        void response.body?.cancel(); throw new ApiError(502, 'MANGA_IMAGE_UNAVAILABLE', 'A fonte não disponibilizou esta imagem. Atualize o capítulo e tente novamente.');
      }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 20_000_000) { await reader.cancel(); throw new ApiError(502, 'MANGA_IMAGE_TOO_LARGE', 'A imagem excede o limite de leitura. Abra a edição na fonte oficial.'); }
        chunks.push(part.value);
      }
      if (!bytes) throw fail();
      const result = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      success = true; cached = response.headers.get('x-cache')?.startsWith('HIT') ?? false;
      return { bytes: result, contentType: mime, cacheControl: 'private, max-age=300' };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(controller.signal.aborted ? 504 : 503, 'MANGA_IMAGE_UNAVAILABLE', 'Não foi possível carregar a imagem. Tente novamente ou atualize o capítulo.');
    } finally {
      clearTimeout(timeout);
      // Required network health reporting for MangaDex@Home nodes; never send cookies or auth tokens.
      if (source.hostname !== 'uploads.mangadex.org') {
        void this.fetcher('https://api.mangadex.network/report', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'HPmovies/2.0 (local MangaDex API client)' }, body: JSON.stringify({ url: source.href, success, cached, bytes, duration: Date.now() - started }), redirect: 'error', signal: AbortSignal.timeout(1500) }).catch(() => undefined);
      }
    }
  }
  private async pace(atHome = false) {
    if (this.cooldownUntil > Date.now()) throw new ApiError(503, 'MANGA_RATE_LIMIT', 'O MangaDex limitou as consultas. Aguarde antes de tentar novamente.', Math.ceil((this.cooldownUntil - Date.now()) / 1000));
    const task = this.queue.then(async () => {
      const delay = Math.max(this.lastRequest + this.interval, atHome ? this.lastAtHomeRequest + Math.max(this.interval, 1600) : 0) - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      this.lastRequest = Date.now();
      if (atHome) this.lastAtHomeRequest = this.lastRequest;
    });
    this.queue = task.catch(() => undefined); await task;
    if (this.cooldownUntil > Date.now()) throw new ApiError(503, 'MANGA_RATE_LIMIT', 'O MangaDex limitou as consultas. Aguarde antes de tentar novamente.');
  }
  private async request(path: string, params = new URLSearchParams()): Promise<Record<string, unknown>> {
    await this.pace(path.startsWith('/at-home/'));
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}${params.size ? `?${params}` : ''}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'HPmovies/2.0 (local MangaDex API client)' },
        signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error',
      });
    } catch (error) {
      const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      throw new ApiError(timeout ? 504 : 503, timeout ? 'MANGA_TIMEOUT' : 'MANGA_UNAVAILABLE', timeout ? 'O MangaDex demorou para responder. Tente novamente.' : 'Não foi possível conectar ao MangaDex. Tente novamente mais tarde.');
    }
    if (response.status === 429) {
      const retry = Number(response.headers.get('Retry-After'));
      const reset = Number(response.headers.get('X-RateLimit-Retry-After'));
      const seconds = Math.min(3600, Math.max(1, retry || (reset ? reset - Date.now() / 1000 : 60)));
      this.cooldownUntil = Date.now() + seconds * 1000;
      throw new ApiError(503, 'MANGA_RATE_LIMIT', 'O MangaDex está limitando as consultas. Aguarde e tente novamente.', Math.ceil(seconds));
    }
    if (response.status === 404) throw new ApiError(404, 'MANGA_NOT_FOUND', 'Mangá ou capítulo não encontrado no MangaDex.');
    if (response.status === 403 || response.status === 401) {
      this.cooldownUntil = Date.now() + 60000;
      throw new ApiError(503, 'MANGA_ACCESS_RESTRICTED', 'O MangaDex restringiu o acesso. Abra a obra no site oficial ou tente novamente mais tarde.', 60);
    }
    if (!response.ok) throw new ApiError(503, 'MANGA_UNAVAILABLE', 'O MangaDex está indisponível no momento. Sua biblioteca continua salva neste dispositivo.');
    const length = Number(response.headers.get('content-length'));
    if (length > 4_000_000) throw fail();
    let data: Record<string, unknown>;
    try { const body = await response.text(); if (body.length > 4_000_000) throw fail(); data = record(JSON.parse(body)); }
    catch { throw fail(); }
    if (data.result !== 'ok') throw fail();
    return data;
  }
  private catalogParams(): URLSearchParams {
    return new URLSearchParams([['contentRating[]', 'safe'], ['contentRating[]', 'suggestive'], ['includes[]', 'cover_art'], ['includes[]', 'author'], ['includes[]', 'artist']]);
  }
  search(query: MangaQuery): Promise<MangaPage> {
    const page = validateMangaPage(query.page); const params = this.catalogParams();
    params.set('limit', String(PAGE_SIZE)); params.set('offset', String((page - 1) * PAGE_SIZE));
    params.set(`order[${SORTS[query.sort ?? 'popular']}]`, 'desc');
    if (query.search) params.set('title', query.search);
    if (query.tag) params.append('includedTags[]', validateMangaId(query.tag));
    if (query.status) params.append('status[]', query.status);
    return this.store.getOrSet(async () => {
      const data = await this.request('/manga', params); const total = integer(data.total);
      if (total === undefined) throw fail();
      // Respect safe catalog policy even if an upstream ignores contentRating filters.
      const items = list(data.data).filter((value) => RATINGS.has(String(record(record(value).attributes).contentRating))).map(normalizeManga);
      return { items, page, total, hasNextPage: page * PAGE_SIZE < Math.min(10000, total) };
    }, `manga:mangadex:search:${params}`, 300).then((result) => ({ ...result, items: result.items.map((manga) => this.withImage(manga)) }));
  }
  async home(): Promise<MangaHome> {
    const results = await Promise.allSettled([
      this.search({ sort: 'popular' }), this.search({ sort: 'rating' }), this.search({ sort: 'popular', status: 'ongoing' }), this.search({ sort: 'latest' }),
    ]);
    const ok = results.some((result) => result.status === 'fulfilled');
    if (!ok) throw (results[0] as PromiseRejectedResult).reason;
    const items = (index: number) => results[index].status === 'fulfilled' ? results[index].value.items : [];
    return { popular: items(0), topRated: items(1), ongoing: items(2), latest: items(3), warnings: results.some((r) => r.status === 'rejected') ? ['Algumas seleções do MangaDex não puderam ser carregadas.'] : [] };
  }
  details(id: string): Promise<MangaTitle> {
    id = validateMangaId(id);
    return this.store.getOrSet(async () => {
      const data = await this.request(`/manga/${id}`, new URLSearchParams([['includes[]', 'cover_art'], ['includes[]', 'author'], ['includes[]', 'artist']]));
      const attrs = record(record(data.data).attributes);
      if (!RATINGS.has(String(attrs.contentRating))) throw new ApiError(404, 'MANGA_NOT_FOUND', 'Esta obra não está disponível no catálogo.');
      return normalizeManga(data.data);
    }, `manga:mangadex:details:${id}`, 1800).then((manga) => this.withImage(manga));
  }
  tags(): Promise<MangaTag[]> {
    return this.store.getOrSet(async () => {
      const data = await this.request('/manga/tag');
      return list(data.data).flatMap((value) => { const tag = record(value); const name = localized(record(tag.attributes).name); return UUID.test(String(tag.id)) && name ? [{ id: String(tag.id), name }] : []; }).sort((a, b) => a.name.localeCompare(b.name));
    }, 'manga:mangadex:tags', 86400);
  }
  chapters(mangaId: string, language = 'pt-br', page = 1): Promise<MangaChapterPage> {
    mangaId = validateMangaId(mangaId); language = validateMangaLanguage(language); page = validateMangaPage(page, true);
    const params = new URLSearchParams([
      ['limit', String(CHAPTER_PAGE_SIZE)], ['offset', String((page - 1) * CHAPTER_PAGE_SIZE)], ['translatedLanguage[]', language],
      ['order[volume]', 'asc'], ['order[chapter]', 'asc'], ['includes[]', 'scanlation_group'], ['includeExternalUrl', '1'], ['includeEmptyPages', '1'],
      ['contentRating[]', 'safe'], ['contentRating[]', 'suggestive'],
    ]);
    return this.store.getOrSet(async () => {
      await this.details(mangaId);
      const data = await this.request(`/manga/${mangaId}/feed`, params); const total = integer(data.total);
      if (total === undefined) throw fail();
      const items = list(data.data).filter((value) => !this.blockedChapter(value)).map(normalizeChapter).filter((item) => item.language === language && item.mangaId === mangaId);
      return { items, language, page, total, hasNextPage: page * CHAPTER_PAGE_SIZE < Math.min(10000, total) };
    }, `manga:mangadex:chapters:${mangaId}:${params}:policy:${[...this.blockedGroupIds].sort().join(',')}`, 120);
  }
  private async navigation(chapter: MangaChapter): Promise<MangaChapterPages['navigation']> {
    const entries = await this.store.getOrSet(async () => {
      const data = await this.request(`/manga/${chapter.mangaId}/aggregate`, new URLSearchParams([['translatedLanguage[]', chapter.language]]));
      const volumes = record(data.volumes);
      return Object.values(volumes).flatMap((volume) => {
        const chapters = record(record(volume).chapters);
        return Object.values(chapters).filter((value) => record(value).isUnavailable !== true).map((value) => {
          const item = record(value); const id = string(item.id); const number = string(item.chapter);
          if (!id || !UUID.test(id)) throw fail();
          const others = Array.isArray(item.others) ? item.others.filter((id): id is string => typeof id === 'string' && UUID.test(id)) : [];
          return { id, number: number ?? '', others, volume: string(record(volume).volume) ?? '' };
        });
      }).sort((a, b) => a.volume.localeCompare(b.volume, undefined, { numeric: true }) || a.number.localeCompare(b.number, undefined, { numeric: true }));
    }, `manga:mangadex:navigation:${chapter.mangaId}:${chapter.language}`, 120);
    const index = entries.findIndex((entry) => entry.id === chapter.id || entry.others.includes(chapter.id));
    return index < 0 ? {} : { previousId: entries[index - 1]?.id, nextId: entries[index + 1]?.id };
  }
  pages(chapterId: string): Promise<MangaChapterPages> {
    chapterId = validateMangaId(chapterId);
    return this.store.getOrSet(async () => {
      const entity = await this.request(`/chapter/${chapterId}`, new URLSearchParams([['includes[]', 'scanlation_group']]));
      if (this.blockedChapter(entity.data)) throw new ApiError(404, 'MANGA_EDITION_REMOVED', 'Esta edição foi removida a pedido do grupo de tradução.');
      const chapter = normalizeChapter(entity.data); await this.details(chapter.mangaId);
      if (chapter.externalUrl) return { chapter, pages: [], sourceUrl: chapter.externalUrl };
      if (chapter.pages === 0) return { chapter, pages: [], sourceUrl: `https://mangadex.org/chapter/${chapterId}` };
      const data = await this.request(`/at-home/server/${chapterId}`, new URLSearchParams({ forcePort443: 'true' })); const imageData = record(data.chapter);
      const base = externalUrl(data.baseUrl); const hash = string(imageData.hash);
      if (!base || !hash || !/^[\w-]+$/.test(hash)) throw fail();
      const imageHost = trustedImageUrl(base);
      if (!/^[\w./-]*$/.test(imageHost.pathname)) throw fail();
      const files = list(imageData.data);
      if (files.length > 1000 || files.some((file) => typeof file !== 'string' || !/^[\w.-]+\.(?:jpg|jpeg|png|webp|gif)$/i.test(file))) throw fail();
      // Chapter navigation has its own failure boundary: an aggregate outage cannot hide readable pages.
      const navigation = await this.navigation(chapter).catch(() => undefined);
      return { chapter, pages: (files as string[]).map((file) => `${imageHost.href.replace(/\/$/, '')}/data/${hash}/${file}`), sourceUrl: `https://mangadex.org/chapter/${chapterId}`, navigation };
    }, `manga:mangadex:pages:${chapterId}:policy:${[...this.blockedGroupIds].sort().join(',')}`, 30).then((result) => ({ ...result, pages: result.pages.map((source) => this.issueImage(source, 600)) }));
  }
}
