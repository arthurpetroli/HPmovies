import type { ChapterQuery } from '../../../shared/content.js';
import type { NovelChapter, NovelChapterList, NovelPage, NovelProvider, NovelQuery, NovelReadingResult, NovelTitle } from '../../../shared/novel.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache, cache } from '../config/cache.js';

const ORIGIN = 'https://novelmania.com.br';
const SLUG = '[a-z0-9]+(?:[-_][a-z0-9]+)*';
const WORK = new RegExp(`^novelmania:(${SLUG})$`);
const CHAPTER = new RegExp(`^novelmania:(${SLUG})/(${SLUG})$`);
const MAX_BYTES = 3 * 1024 * 1024;
const CHAPTERS_PER_PAGE = 50;
const STATUSES: Record<string, string[]> = { RELEASING: ['Ativo'], FINISHED: ['Completo'], HIATUS: ['Parado', 'Pausado'] };
const SORTS: Record<string, string> = { popular: 'views_count_desc', newest: 'created_at_desc' };
const fail = () => new ApiError(502, 'INVALID_NOVELMANIA_RESPONSE', 'A Novel Mania retornou dados inesperados. Tente novamente mais tarde.');
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  return value as Record<string, unknown>;
};
const string = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', atilde: 'ã', otilde: 'õ', ccedil: 'ç', acirc: 'â', ecirc: 'ê', ocirc: 'ô' };
function decode(html: string): string {
  return html.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (all, name: string) => {
    if (!name.startsWith('#')) return entities[name] ?? all;
    const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}
const plain = (html: string) => decode(html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/[\t\r ]+/g, ' ').trim();
function attrs(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/(?:^|\s)([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+))/gi)) attributes[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '').trim();
  return attributes;
}
function firstBlock(html: string, predicate: (tag: string, attributes: Record<string, string>) => boolean): string | undefined {
  const tokens = /<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  let selected: { tag: string; start: number; depth: number } | undefined;
  for (const match of html.matchAll(tokens)) {
    const token = match[0], tag = match[1].toLowerCase(), closing = token.startsWith('</');
    if (!selected) {
      if (!closing && predicate(tag, attrs(token))) selected = { tag, start: match.index!, depth: 1 };
    } else if (tag === selected.tag && !token.endsWith('/>')) {
      if (closing) {
        if (--selected.depth === 0) return html.slice(selected.start, match.index! + token.length);
      } else selected.depth++;
    }
  }
  return undefined;
}
const explicit = (genres: string[], title: string) => genres.some(genre => /^(?:adulto|er[oó]tico|hentai|pornogr[aá]fico)$/i.test(genre)) || /(?:\+\s*18|18\s*\+|sem\s+censura)/i.test(title);

export const NOVELMANIA_SOURCE = { id: 'novelmania', name: 'Novel Mania', url: ORIGIN } as const;
export function validateNovelManiaId(id: string, chapter = false): string {
  if (typeof id !== 'string' || id.length > 400 || !(chapter ? CHAPTER : WORK).test(id)) throw new ApiError(400, 'INVALID_NOVEL_ID', 'Identificador da Novel Mania inválido.');
  return id;
}
function image(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'assets.novelmania.com.br' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname.startsWith('/uploads/') ? url.href : undefined;
  } catch { return undefined; }
}
function categories(value: unknown): { id: string; name: string; slug: string }[] {
  if (!Array.isArray(value)) throw fail();
  return value.map(entry => {
    const row = record(entry), id = string(row.id), name = string(row.name), slug = string(row.slug);
    if (!id || !name || !slug) throw fail();
    return { id, name, slug };
  });
}
function normalizeNovel(value: unknown, expectedSlug?: string): NovelTitle {
  const data = record(value), slug = string(data.slug), title = string(data.title);
  if (!slug || !new RegExp(`^${SLUG}$`).test(slug) || !title || expectedSlug !== undefined && slug !== expectedSlug) throw fail();
  const genres = data.categories !== undefined ? categories(data.categories).map(category => category.name) : data.category ? [string(record(data.category).name) ?? ''].filter(Boolean) : [];
  if (explicit(genres, title)) throw new ApiError(404, 'NOVEL_NOT_FOUND', 'Esta obra tem classificação explícita e não está disponível neste catálogo.');
  const cover = data.cover ? record(data.cover) : {};
  const sourceStatus = string(data.status);
  const status = sourceStatus === 'Ativo' ? 'RELEASING' : sourceStatus === 'Completo' ? 'FINISHED' : ['Parado', 'Pausado'].includes(sourceStatus ?? '') ? 'HIATUS' : undefined;
  return {
    id: `novelmania:${slug}`, title, poster: image(cover.large) ?? image(cover.small) ?? image(cover.original) ?? '',
    description: string(data.synopsis) ? plain(String(data.synopsis)).slice(0, 8000) : undefined,
    genres, status, chapterCount: integer(data.chaptersCount), authors: string(data.author) ? [String(data.author)] : [],
    externalLinks: [{ site: NOVELMANIA_SOURCE.name, url: `${ORIGIN}/novels/${slug}` }],
    sourceUrl: `${ORIGIN}/novels/${slug}`, providerId: 'novelmania', providerName: NOVELMANIA_SOURCE.name, availableLanguages: ['pt-br'],
  };
}
interface ChapterData { chapter: NovelChapter; sourceTitle: string; position: number; credits: string[] }
function normalizeChapter(value: unknown, novelSlug: string, index: number): ChapterData {
  const data = record(value), slug = string(data.slug), title = string(data.longTitle) ?? string(data.title);
  if (!slug || !new RegExp(`^${SLUG}$`).test(slug) || !title) throw fail();
  const number = /cap[ií]tulo\s*(\d+(?:[.,]\d+)?)/i.exec(string(data.title) ?? title)?.[1];
  const credits: string[] = [];
  for (const [field, label] of [['translators', 'Tradução'], ['editors', 'Revisão']] as const) {
    if (data[field] !== undefined && !Array.isArray(data[field])) throw fail();
    const names = (data[field] as unknown[] | undefined)?.map(person => string(record(person).username)).filter((name): name is string => !!name) ?? [];
    if (names.length) credits.push(`${label}: ${[...new Set(names)].join(', ')}`);
  }
  return { chapter: { id: `novelmania:${novelSlug}/${slug}`, title, displayLabel: plain(string(data.title) ?? title), number: number ? Number(number.replace(',', '.')) : index + 1, language: 'pt-br' }, sourceTitle: string(data.title) ?? title, position: typeof data.position === 'number' && Number.isFinite(data.position) ? data.position : index, credits };
}
function languageAvailable(query: ChapterQuery): boolean {
  if (query.provider && query.provider !== 'novelmania') throw new ApiError(400, 'INVALID_NOVEL_PROVIDER', 'Esta obra pertence à Novel Mania.');
  const language = query.language?.toLowerCase();
  return language === undefined || language === 'all' || language === 'pt' || language === 'pt-br';
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) { promise.catch(() => undefined); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
interface NovelManiaOptions { fetcher?: typeof fetch; cache?: AniwatchAPICache; timeoutMs?: number; requestIntervalMs?: number }

/** Public catalog/index JSON and public SSR reading pages remain independent; protected chapter API routes are not used. */
export class NovelManiaProvider implements NovelProvider {
  private readonly fetcher: typeof fetch;
  private readonly store: AniwatchAPICache;
  private readonly timeoutMs: number;
  private readonly interval: number;
  private queue: Promise<void> = Promise.resolve();
  private lastRequest = 0;
  private cooldownUntil = 0;
  constructor(options: NovelManiaOptions = {}) {
    this.fetcher = options.fetcher ?? fetch; this.store = options.cache ?? cache;
    this.timeoutMs = options.timeoutMs ?? 15_000; this.interval = options.requestIntervalMs ?? 300;
  }

  private async request(path: string, kind: 'json' | 'html' = 'json'): Promise<unknown> {
    const previous = this.queue; let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; }); await previous;
    try {
      if (this.cooldownUntil > Date.now()) throw new ApiError(503, 'NOVELMANIA_RATE_LIMIT', 'A Novel Mania limitou as consultas. Aguarde um momento.', Math.ceil((this.cooldownUntil - Date.now()) / 1000));
      const delay = this.lastRequest + this.interval - Date.now(); if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      this.lastRequest = Date.now();
    } finally { release(); }
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || url.username || url.password || url.hash) throw fail();
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await abortable(this.fetcher(url.href, { signal: controller.signal, redirect: 'error', headers: { Accept: kind === 'json' ? 'application/json' : 'text/html', 'User-Agent': 'HPmovies/2.0 (local novel reader)' } }), controller.signal);
      if (response.status === 429) {
        const retry = Math.max(1, Math.min(300, Number(response.headers.get('retry-after')) || 60)); this.cooldownUntil = Date.now() + retry * 1000;
        void response.body?.cancel().catch(() => undefined); throw new ApiError(503, 'NOVELMANIA_RATE_LIMIT', 'A Novel Mania limitou as consultas. Aguarde um momento.', retry);
      }
      if (response.status === 404) { void response.body?.cancel().catch(() => undefined); throw new ApiError(404, 'NOVEL_NOT_FOUND', 'A obra ou capítulo não está disponível na Novel Mania.'); }
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new ApiError(503, 'NOVELMANIA_UNAVAILABLE', 'A Novel Mania não disponibilizou este conteúdo. Tente abrir a fonte ou consultar mais tarde.'); }
      const expectedType = kind === 'json' ? 'application/json' : 'text/html';
      if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes(expectedType) || Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) { void response.body?.cancel().catch(() => undefined); throw fail(); }
      reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0, body = '';
      while (true) {
        const part = await abortable(reader.read(), controller.signal); if (part.done) break;
        bytes += part.value.length; if (bytes > MAX_BYTES) throw fail(); body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
      if (kind === 'html') return body.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
      const data = record(JSON.parse(body)); if (data.success !== true) throw fail(); return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? 'NOVELMANIA_TIMEOUT' : 'INVALID_NOVELMANIA_RESPONSE', controller.signal.aborted ? 'A Novel Mania demorou para responder. Tente novamente.' : 'A Novel Mania retornou dados inesperados. Tente novamente mais tarde.');
    } finally { clearTimeout(timer); void reader?.cancel().catch(() => undefined); }
  }

  private categoryList() {
    return this.store.getOrSet(async () => categories(record(await this.request('/api/categories')).data).filter(category => !explicit([category.name], '')), 'novelmania:categories', 3600);
  }
  async genres(): Promise<string[]> { return (await this.categoryList()).map(category => category.name).sort((a, b) => a.localeCompare(b, 'pt-BR')); }

  async search(query: NovelQuery): Promise<NovelPage> {
    const page = query.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Página de novels inválida.');
    if (query.year !== undefined) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'A Novel Mania não oferece filtro por ano.');
    if (query.sort !== undefined && !Object.hasOwn(SORTS, query.sort)) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'A Novel Mania oferece ordenação por popularidade ou adição recente.');
    if (query.status !== undefined && !Object.hasOwn(STATUSES, query.status)) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Este status não está disponível nos filtros da Novel Mania.');
    const search = query.search?.trim() ?? '';
    if (search.length > 120 || [...search].some(character => character.charCodeAt(0) < 32)) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Título de busca inválido.');
    const params = new URLSearchParams({ page: String(page), items: '24', sort: SORTS[query.sort ?? 'popular'] });
    if (search) params.set('q', search);
    if (query.genre) {
      const wanted = query.genre.toLocaleLowerCase('pt-BR');
      const category = (await this.categoryList()).find(category => category.name.toLocaleLowerCase('pt-BR') === wanted || category.slug === wanted);
      if (!category) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Categoria da Novel Mania não encontrada.');
      params.append('categories[]', category.id);
    }
    for (const status of STATUSES[query.status ?? ''] ?? []) params.append('statuses[]', status);
    return this.store.getOrSet(async () => {
      const payload = record(await this.request(`/api/novels?${params}`)), meta = record(payload.meta);
      if (!Array.isArray(payload.data) || integer(meta.page) !== page || integer(meta.pages) === undefined || integer(meta.count) === undefined) throw fail();
      const items: NovelTitle[] = [];
      for (const entry of payload.data) {
        try { items.push(normalizeNovel(entry)); } catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
      }
      return { items, page, hasNextPage: page < Number(meta.pages), total: Number(meta.count) };
    }, `novelmania:search:${params}`, 180);
  }

  async details(id: string): Promise<NovelTitle> {
    validateNovelManiaId(id); const slug = WORK.exec(id)![1];
    return this.store.getOrSet(async () => normalizeNovel(record(await this.request(`/api/novels/${slug}`)).data, slug), `novelmania:details:${slug}`, 300);
  }

  private chapterIndex(id: string): Promise<ChapterData[]> {
    validateNovelManiaId(id); const slug = WORK.exec(id)![1];
    return this.store.getOrSet(async () => {
      await this.details(id);
      const chapters = new Map<string, ChapterData>(); let expectedPages = 1; let expectedCount: number | undefined;
      for (let page = 1; page <= expectedPages; page++) {
        const params = new URLSearchParams({ page: String(page), items: String(CHAPTERS_PER_PAGE) });
        const payload = record(await this.request(`/api/novels/${slug}/chapters?${params}`)), meta = record(payload.meta);
        const count = integer(meta.count), pages = integer(meta.pages);
        if (!Array.isArray(payload.data) || integer(meta.page) !== page || count === undefined || pages === undefined || pages > 200 || count > 10_000 || expectedCount !== undefined && (count !== expectedCount || pages !== expectedPages)) throw fail();
        expectedPages = Math.max(1, pages); expectedCount = count;
        const offset = (page - 1) * CHAPTERS_PER_PAGE;
        for (let index = 0; index < payload.data.length; index++) {
          const row = normalizeChapter(payload.data[index], slug, offset + index);
          if (chapters.has(row.chapter.id)) throw fail();
          chapters.set(row.chapter.id, row);
        }
        if (page < expectedPages && payload.data.length === 0) throw fail();
      }
      if (chapters.size !== expectedCount) throw fail();
      return [...chapters.values()].sort((a, b) => a.position - b.position || a.chapter.id.localeCompare(b.chapter.id, 'pt-BR', { numeric: true }));
    }, `novelmania:chapters:${slug}`, 180);
  }

  async chapters(id: string, query: ChapterQuery = {}): Promise<NovelChapterList> {
    validateNovelManiaId(id);
    if (!languageAvailable(query)) return { available: false, status: 'unavailable', providerId: 'novelmania', message: 'A Novel Mania fornece estas edições em português brasileiro. Escolha PT-BR para consultar os capítulos.', chapters: [] };
    const chapters = await this.chapterIndex(id);
    return { available: chapters.length > 0, status: chapters.length ? 'available' : 'unavailable', providerId: 'novelmania', message: chapters.length ? 'Capítulos em português retornados pela Novel Mania. A leitura depende da disponibilidade de cada edição na fonte.' : 'Esta obra não possui capítulos publicados na Novel Mania.', chapters: chapters.map(row => row.chapter) };
  }

  async content(id: string, chapterId: string, query: ChapterQuery = {}): Promise<NovelReadingResult> {
    validateNovelManiaId(id); validateNovelManiaId(chapterId, true);
    if (!chapterId.startsWith(`${id}/`)) throw new ApiError(400, 'INVALID_NOVEL_CHAPTER', 'Este capítulo pertence a outra obra.');
    if (!languageAvailable(query)) return { available: false, status: 'unavailable', providerId: 'novelmania', message: 'Esta edição está disponível em português brasileiro na fonte. Escolha PT-BR.', paragraphs: [] };
    const [, slug, chapterSlug] = CHAPTER.exec(chapterId)!;
    const [novel, index] = await Promise.all([this.details(id), this.chapterIndex(id)]);
    const position = index.findIndex(row => row.chapter.id === chapterId);
    if (position < 0) throw new ApiError(404, 'NOVEL_CHAPTER_NOT_FOUND', 'Este capítulo não está listado para a obra na Novel Mania.');
    const path = `/novels/${slug}/capitulos/${chapterSlug}`;
    const paragraphs = await this.store.getOrSet(async () => {
      const html = String(await this.request(path, 'html'));
      const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attrs(match[0])).find(attributes => attributes.rel === 'canonical');
      if (!canonical || canonical.href !== `${ORIGIN}${path}`) throw fail();
      const heading = firstBlock(html, (tag, attributes) => tag === 'h1' && attributes.id === 'reader-chapter-title');
      if (!heading) throw fail();
      const normalizedHeading = (value: string) => plain(value).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const visibleHeading = heading.replace(/<span\b[^>]*class=["'][^"']*\bsr-only\b[^"']*["'][^>]*>[\s\S]*?<\/span\s*>/gi, '');
      if (normalizedHeading(visibleHeading) !== normalizedHeading(index[position].sourceTitle)) throw fail();
      const main = firstBlock(html, tag => tag === 'main');
      if (!main) throw fail();
      const section = firstBlock(main, (tag, attributes) => tag === 'div' && (attributes.class?.split(/\s+/).includes('rich-text-content') ?? false));
      if (!section) throw new ApiError(503, 'NOVELMANIA_TEXT_UNAVAILABLE', 'A fonte não disponibilizou o texto desta edição. Abra o capítulo na Novel Mania.');
      const clean = section.replace(/<(?:iframe|svg|form|nav|aside)\b[^>]*>[\s\S]*?<\/(?:iframe|svg|form|nav|aside)\s*>/gi, '');
      const result = [...clean.matchAll(/<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map(match => plain(match[2])).filter(Boolean);
      if (!result.length || result.length > 10_000 || result.some(paragraph => paragraph.length > 30_000) || result.join('').length > 2_000_000) throw new ApiError(503, 'NOVELMANIA_TEXT_UNAVAILABLE', 'Esta edição não possui texto compatível com o leitor. Abra o capítulo na Novel Mania.');
      return result;
    }, `novelmania:content:${chapterId}`, 300);
    const selected = index[position];
    return { available: true, status: 'available', providerId: 'novelmania', message: 'Texto fornecido pela página pública da Novel Mania.', paragraphs, novel, chapter: selected.chapter, previousChapterId: index[position - 1]?.chapter.id, nextChapterId: index[position + 1]?.chapter.id, isDemo: false, attribution: [NOVELMANIA_SOURCE.name, ...selected.credits].join(' · '), sourceUrl: `${ORIGIN}${path}` };
  }
}
