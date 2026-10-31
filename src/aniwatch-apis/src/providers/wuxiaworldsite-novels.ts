import type { ChapterQuery } from '../../../shared/content.js';
import type { NovelChapter, NovelChapterList, NovelPage, NovelProvider, NovelQuery, NovelReadingResult, NovelTitle } from '../../../shared/novel.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache, cache } from '../config/cache.js';

const ORIGIN = 'https://wuxiaworld.site';
const SLUG = '[a-z0-9]+(?:[-_][a-z0-9]+)*';
const WORK = new RegExp(`^wuxiaworldsite:(${SLUG})$`);
const CHAPTER = new RegExp(`^wuxiaworldsite:(${SLUG})/(${SLUG})$`);
const MAX_BYTES = 3 * 1024 * 1024;
const STATUSES: Record<string, string> = { RELEASING: 'on-going', FINISHED: 'end', HIATUS: 'on-hold', CANCELLED: 'canceled', NOT_YET_RELEASED: 'upcoming' };
const SORTS: Record<string, string> = { popular: 'views', newest: 'new-manga' };
const SOURCE_STATUSES: Record<string, string> = { ongoing: 'RELEASING', completed: 'FINISHED', 'on hold': 'HIATUS', canceled: 'CANCELLED', cancelled: 'CANCELLED', upcoming: 'NOT_YET_RELEASED' };
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const fail = () => new ApiError(502, 'INVALID_WUXIAWORLDSITE_RESPONSE', 'A WuxiaWorld.site retornou dados inesperados. Tente novamente mais tarde.');
const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×', copy: '©' };
function decode(html: string): string {
  return html.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (all, name: string) => {
    if (!name.startsWith('#')) return entities[name.toLowerCase()] ?? all;
    const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}
const cleanDocument = (html: string) => html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
const plain = (html: string) => decode(cleanDocument(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
function attrs(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/(?:^|\s)([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+))/gi)) attributes[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '').trim();
  return attributes;
}
interface Block { tag: string; attributes: Record<string, string>; outer: string; inner: string }
/** Select balanced elements, including nested divs, without executing upstream markup. */
function blocks(html: string, predicate: (tag: string, attributes: Record<string, string>) => boolean): Block[] {
  const result: Block[] = [];
  let selected: { tag: string; attributes: Record<string, string>; start: number; innerStart: number; depth: number } | undefined;
  for (const match of html.matchAll(/<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const token = match[0], tag = match[1].toLowerCase(), closing = token.startsWith('</');
    if (!selected) {
      if (!closing) {
        const attributes = attrs(token);
        if (predicate(tag, attributes)) {
          if (VOID_TAGS.has(tag) || token.endsWith('/>')) result.push({ tag, attributes, outer: token, inner: '' });
          else selected = { tag, attributes, start: match.index!, innerStart: match.index! + token.length, depth: 1 };
        }
      }
    } else if (tag === selected.tag && !token.endsWith('/>')) {
      if (closing) {
        if (--selected.depth === 0) {
          result.push({ tag, attributes: selected.attributes, outer: html.slice(selected.start, match.index! + token.length), inner: html.slice(selected.innerStart, match.index!) });
          selected = undefined;
        }
      } else selected.depth++;
    }
  }
  if (selected) throw fail();
  return result;
}
const hasClass = (attributes: Record<string, string>, name: string) => attributes.class?.split(/\s+/).includes(name) ?? false;
const byClass = (html: string, name: string) => blocks(html, (_tag, attributes) => hasClass(attributes, name));
const links = (html: string) => blocks(html, tag => tag === 'a');
const explicit = (genres: string[], title: string) => genres.some(genre => /^(?:adult|adults|erotica?|hentai|pornograph(?:ic|y)|smut)$/i.test(genre)) || /(?:\+\s*18|18\s*\+|uncensored)/i.test(title);
function sourceUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value, ORIGIN); } catch { throw fail(); }
  if (url.origin !== ORIGIN || url.username || url.password || url.port || url.hash) throw fail();
  return url;
}
function workFromUrl(value: string): string {
  const url = sourceUrl(value), match = new RegExp(`^/novel/(${SLUG})/$`).exec(url.pathname);
  if (!match || url.search) throw fail();
  return `wuxiaworldsite:${match[1]}`;
}
function chapterFromUrl(value: string, workId: string): string {
  const url = sourceUrl(value), match = new RegExp(`^/novel/(${SLUG})/(${SLUG})/$`).exec(url.pathname);
  if (!match || url.search || `wuxiaworldsite:${match[1]}` !== workId) throw fail();
  return `${workId}/${match[2]}`;
}
function image(value?: string): string {
  if (!value) return '';
  try { const url = sourceUrl(value); return url.pathname.startsWith('/wp-content/uploads/') && !url.search ? url.href : ''; } catch { return ''; }
}
function canonical(html: string, path: string) {
  const rows = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attrs(match[0])).filter(attributes => attributes.rel?.toLowerCase() === 'canonical');
  if (rows.length !== 1 || rows[0].href !== `${ORIGIN}${path}`) throw fail();
}
function field(html: string, name: string): string | undefined {
  for (const row of byClass(html, 'post-content_item')) {
    const label = byClass(row.inner, 'summary-heading')[0];
    if (label && plain(label.inner).toLowerCase().replace(/\s+/g, ' ') === name) return byClass(row.inner, 'summary-content')[0]?.inner;
  }
  return undefined;
}
const sourceStatus = (value: string) => SOURCE_STATUSES[value.toLowerCase().replace(/[-\s]+/g, ' ')];
function metadata(html: string, expectedId?: string): NovelTitle {
  const titleContainer = byClass(html, 'post-title')[0];
  const titleLink = titleContainer ? links(titleContainer.inner)[0] : undefined;
  const heading = titleContainer ? blocks(titleContainer.inner, tag => tag === 'h1')[0] : undefined;
  const title = plain(titleLink?.inner ?? heading?.inner ?? '');
  let id = expectedId;
  if (titleLink) {
    const linkedId = workFromUrl(titleLink.attributes.href ?? '');
    if (id && linkedId !== id) throw fail();
    id = linkedId;
  }
  if (!id || !title || title.length > 500) throw fail();
  const genres = links(field(html, 'genres') ?? field(html, 'genre(s)') ?? '').map(link => plain(link.inner)).filter(Boolean);
  if (explicit(genres, title)) throw new ApiError(404, 'NOVEL_NOT_FOUND', 'Esta obra tem classificação explícita e não está disponível neste catálogo.');
  const cover = byClass(html, 'summary_image')[0] ?? byClass(html, 'tab-thumb')[0];
  const coverTag = cover?.inner.match(/<img\b[^>]*>/i)?.[0], coverAttrs = coverTag ? attrs(coverTag) : {};
  const description = byClass(html, 'summary__content')[0];
  const authors = links(field(html, 'author(s)') ?? field(html, 'authors') ?? '').map(link => plain(link.inner)).filter(Boolean);
  const status = sourceStatus(plain(field(html, 'status') ?? ''));
  const yearValue = plain(field(html, 'release') ?? ''), year = /^\d{4}$/.test(yearValue) ? Number(yearValue) : undefined;
  const scoreBlock = byClass(html, 'total_votes')[0], score = scoreBlock ? Number(plain(scoreBlock.inner)) : undefined;
  const path = `/novel/${WORK.exec(id)![1]}/`;
  return {
    id, title, poster: image(coverAttrs['data-src']) || image(coverAttrs.src), genres, authors, status,
    description: description ? plain(description.inner).slice(0, 8000) : undefined,
    year, score: score !== undefined && Number.isFinite(score) && score >= 0 && score <= 5 ? score * 20 : undefined,
    providerId: 'wuxiaworldsite', providerName: WUXIAWORLDSITE_SOURCE.name, sourceUrl: `${ORIGIN}${path}`,
    externalLinks: [{ site: WUXIAWORLDSITE_SOURCE.name, url: `${ORIGIN}${path}` }], availableLanguages: ['en'],
  };
}
function languageAvailable(query: ChapterQuery): boolean {
  if (query.provider && query.provider !== 'wuxiaworldsite') throw new ApiError(400, 'INVALID_NOVEL_PROVIDER', 'Esta obra pertence à WuxiaWorld.site.');
  const language = query.language?.toLowerCase();
  return language === undefined || language === 'all' || language === 'en';
}
const unavailableLanguage = 'Esta edição está disponível em inglês na WuxiaWorld.site. Escolha EN para consultar o texto original da fonte.';
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) { promise.catch(() => undefined); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export const WUXIAWORLDSITE_SOURCE = { id: 'wuxiaworldsite', name: 'WuxiaWorld.site', url: ORIGIN } as const;
export function validateWuxiaWorldSiteId(id: string, chapter = false): string {
  if (typeof id !== 'string' || id.length > 400 || !(chapter ? CHAPTER : WORK).test(id)) throw new ApiError(400, 'INVALID_NOVEL_ID', 'Identificador da WuxiaWorld.site inválido.');
  return id;
}
interface WuxiaWorldSiteOptions { fetcher?: typeof fetch; cache?: AniwatchAPICache; timeoutMs?: number; requestIntervalMs?: number }

/** Independent adapter for public wuxiaworld.site pages. This is not wuxiaworld.com or an official API. */
export class WuxiaWorldSiteProvider implements NovelProvider {
  private readonly fetcher: typeof fetch;
  private readonly store: AniwatchAPICache;
  private readonly timeoutMs: number;
  private readonly interval: number;
  private queue: Promise<void> = Promise.resolve();
  private lastRequest = 0;
  private cooldownUntil = 0;
  constructor(options: WuxiaWorldSiteOptions = {}) {
    this.fetcher = options.fetcher ?? fetch; this.store = options.cache ?? cache;
    this.timeoutMs = options.timeoutMs ?? 15_000; this.interval = options.requestIntervalMs ?? 350;
  }
  private async request(path: string, method: 'GET' | 'POST' = 'GET'): Promise<string> {
    const previous = this.queue; let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; }); await previous;
    try {
      if (this.cooldownUntil > Date.now()) throw new ApiError(503, 'WUXIAWORLDSITE_RATE_LIMIT', 'A WuxiaWorld.site limitou as consultas. Aguarde um momento.', Math.ceil((this.cooldownUntil - Date.now()) / 1000));
      const delay = this.lastRequest + this.interval - Date.now(); if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      this.lastRequest = Date.now();
    } finally { release(); }
    const url = sourceUrl(path), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await abortable(this.fetcher(url.href, { method, signal: controller.signal, redirect: 'error', headers: { Accept: 'text/html', 'User-Agent': 'HPmovies/2.0 (local novel reader)' } }), controller.signal);
      if (response.status === 429) {
        const retry = Math.max(1, Math.min(300, Number(response.headers.get('retry-after')) || 60)); this.cooldownUntil = Date.now() + retry * 1000;
        void response.body?.cancel().catch(() => undefined); throw new ApiError(503, 'WUXIAWORLDSITE_RATE_LIMIT', 'A WuxiaWorld.site limitou as consultas. Aguarde um momento.', retry);
      }
      if (response.status === 404) { void response.body?.cancel().catch(() => undefined); throw new ApiError(404, 'NOVEL_NOT_FOUND', 'A obra ou capítulo não está disponível na WuxiaWorld.site.'); }
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new ApiError(503, 'WUXIAWORLDSITE_UNAVAILABLE', 'A WuxiaWorld.site não disponibilizou este conteúdo. Tente abrir a fonte ou consultar mais tarde.'); }
      if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/html') || Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) { void response.body?.cancel().catch(() => undefined); throw fail(); }
      reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0, body = '';
      while (true) {
        const part = await abortable(reader.read(), controller.signal); if (part.done) break;
        bytes += part.value.length; if (bytes > MAX_BYTES) throw fail(); body += decoder.decode(part.value, { stream: true });
      }
      return cleanDocument(body + decoder.decode());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? 'WUXIAWORLDSITE_TIMEOUT' : 'INVALID_WUXIAWORLDSITE_RESPONSE', controller.signal.aborted ? 'A WuxiaWorld.site demorou para responder. Tente novamente.' : 'A WuxiaWorld.site retornou dados inesperados. Tente novamente mais tarde.');
    } finally { clearTimeout(timer); void reader?.cancel().catch(() => undefined); }
  }
  private catalogPath(params: URLSearchParams, page = 1) { return `${page === 1 ? '/' : `/page/${page}/`}?${params}`; }
  private categoryList(): Promise<Array<{ slug: string; name: string }>> {
    return this.store.getOrSet(async () => {
      const html = await this.request(this.catalogPath(new URLSearchParams({ s: '', post_type: 'wp-manga', adult: '0', m_orderby: 'views' })));
      const categories: Array<{ slug: string; name: string }> = [];
      const labels = blocks(html, tag => tag === 'label');
      for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
        const attributes = attrs(match[0]); if (attributes.name !== 'genre[]') continue;
        const slug = attributes.value, label = labels.find(row => row.attributes.for === attributes.id);
        if (!slug || !new RegExp(`^${SLUG}$`).test(slug) || !label) throw fail();
        const name = plain(label.inner); if (name && !explicit([name], '')) categories.push({ slug, name });
      }
      if (!categories.length || categories.length > 300 || new Set(categories.map(row => row.slug)).size !== categories.length) throw fail();
      return categories;
    }, 'wuxiaworldsite:categories', 3600);
  }
  async genres(): Promise<string[]> { return (await this.categoryList()).map(row => row.name).sort((a, b) => a.localeCompare(b, 'en')); }
  async search(query: NovelQuery): Promise<NovelPage> {
    const page = query.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Página de novels inválida.');
    if (query.year !== undefined) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'O filtro por ano não está disponível nesta integração.');
    if (query.sort !== undefined && !Object.hasOwn(SORTS, query.sort)) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'A WuxiaWorld.site oferece ordenação por popularidade ou adição recente.');
    if (query.status !== undefined && !Object.hasOwn(STATUSES, query.status)) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Este status não está disponível nos filtros da WuxiaWorld.site.');
    const search = query.search?.trim() ?? '';
    if (search.length > 120 || [...search].some(character => character.charCodeAt(0) < 32)) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Título de busca inválido.');
    const params = new URLSearchParams({ s: search, post_type: 'wp-manga', adult: '0', m_orderby: SORTS[query.sort ?? 'popular'] });
    if (query.genre) {
      const wanted = query.genre.toLowerCase(), genre = (await this.categoryList()).find(row => row.slug === wanted || row.name.toLowerCase() === wanted);
      if (!genre) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Gênero da WuxiaWorld.site não encontrado.');
      params.append('genre[]', genre.slug);
    }
    if (query.status) params.append('status[]', STATUSES[query.status]);
    return this.store.getOrSet(async () => {
      const html = await this.request(this.catalogPath(params, page));
      const listing = blocks(html, (_tag, attributes) => attributes.id === 'loop-content')[0]; if (!listing) throw fail();
      const rows = byClass(listing.inner, 'c-tabs-item__content'), items: NovelTitle[] = [];
      if (rows.length > 100) throw fail();
      for (const row of rows) {
        try { items.push(metadata(row.inner)); } catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
      }
      if (new Set(items.map(row => row.id)).size !== items.length) throw fail();
      const navigation = byClass(html, 'paging-navigation')[0]; let hasNextPage = false;
      for (const link of navigation ? links(navigation.inner) : []) {
        const next = sourceUrl(link.attributes.href ?? ''), match = /^\/page\/(\d+)\/$/.exec(next.pathname);
        if (!match) continue;
        const nextPage = Number(match[1]);
        if (nextPage > page) {
          if (nextPage !== page + 1 || [...params].some(([key, value]) => !next.searchParams.getAll(key).includes(value))) throw fail();
          hasNextPage = true;
        }
      }
      if (!rows.length && hasNextPage) throw fail();
      return { items, page, hasNextPage };
    }, `wuxiaworldsite:search:${page}:${params}`, 180);
  }
  async details(id: string): Promise<NovelTitle> {
    validateWuxiaWorldSiteId(id); const slug = WORK.exec(id)![1], path = `/novel/${slug}/`;
    return this.store.getOrSet(async () => {
      const html = await this.request(path); canonical(html, path);
      const summary = byClass(html, 'tab-summary')[0], heading = byClass(html, 'post-title')[0];
      if (!summary || !heading || !blocks(heading.inner, tag => tag === 'h1').length) throw fail();
      const synopsis = byClass(html, 'summary__content')[0];
      return metadata(heading.outer + summary.outer + (synopsis?.outer ?? ''), id);
    }, `wuxiaworldsite:details:${slug}`, 300);
  }
  private chapterIndex(id: string): Promise<NovelChapter[]> {
    validateWuxiaWorldSiteId(id); const slug = WORK.exec(id)![1];
    return this.store.getOrSet(async () => {
      await this.details(id);
      const chapters: NovelChapter[] = [], ids = new Set<string>(); let expectedPages = 1;
      for (let page = 1; page <= expectedPages; page++) {
        const html = await this.request(`/novel/${slug}/ajax/chapters/?t=${page}`, 'POST');
        const listing = byClass(html, 'listing-chapters_wrap')[0]; if (!listing) throw fail();
        const pagination = byClass(listing.inner, 'pagination')[0];
        if (pagination) {
          const pageNumbers = links(pagination.inner).map(link => Number(link.attributes['data-page'])).filter(value => Number.isSafeInteger(value) && value > 0);
          if (!pageNumbers.length) throw fail();
          const advertisedPages = Math.max(page, ...pageNumbers);
          if (advertisedPages > 200 || page > 1 && advertisedPages !== expectedPages) throw fail();
          expectedPages = advertisedPages;
        } else if (expectedPages > 1) throw fail();
        const rows = byClass(listing.inner, 'wp-manga-chapter');
        if (!rows.length && expectedPages > 1) throw fail();
        for (const row of rows) {
          const link = links(row.inner)[0]; if (!link) throw fail();
          const chapterId = chapterFromUrl(link.attributes.href ?? '', id), title = plain(link.inner);
          if (!title || title.length > 1000 || ids.has(chapterId)) throw fail();
          ids.add(chapterId);
          const number = /\bchapter\s*(\d+(?:[.,]\d+)?)/i.exec(title)?.[1];
          chapters.push({ id: chapterId, title, displayLabel: title, language: 'en', number: number ? Number(number.replace(',', '.')) : Number.NaN });
          if (chapters.length > 20_000) throw fail();
        }
      }
      // The public endpoint returns newest first. Reverse the complete source order, retaining extras and volume labels.
      return chapters.reverse().map((chapter, index) => ({ ...chapter, number: Number.isFinite(chapter.number) ? chapter.number : index + 1 }));
    }, `wuxiaworldsite:chapters:${slug}`, 180);
  }
  async chapters(id: string, query: ChapterQuery = {}): Promise<NovelChapterList> {
    validateWuxiaWorldSiteId(id);
    if (!languageAvailable(query)) return { available: false, status: 'unavailable', providerId: 'wuxiaworldsite', message: unavailableLanguage, chapters: [] };
    const chapters = await this.chapterIndex(id);
    return { available: chapters.length > 0, status: chapters.length ? 'available' : 'unavailable', providerId: 'wuxiaworldsite', message: chapters.length ? 'Capítulos em inglês retornados pela WuxiaWorld.site. A leitura depende da disponibilidade de cada edição na fonte.' : 'Esta obra não possui capítulos publicados na WuxiaWorld.site.', chapters };
  }
  async content(id: string, chapterId: string, query: ChapterQuery = {}): Promise<NovelReadingResult> {
    validateWuxiaWorldSiteId(id); validateWuxiaWorldSiteId(chapterId, true);
    if (!chapterId.startsWith(`${id}/`)) throw new ApiError(400, 'INVALID_NOVEL_CHAPTER', 'Este capítulo pertence a outra obra.');
    if (!languageAvailable(query)) return { available: false, status: 'unavailable', providerId: 'wuxiaworldsite', message: unavailableLanguage, paragraphs: [] };
    const [novel, index] = await Promise.all([this.details(id), this.chapterIndex(id)]), position = index.findIndex(chapter => chapter.id === chapterId);
    if (position < 0) throw new ApiError(404, 'NOVEL_CHAPTER_NOT_FOUND', 'Este capítulo não está listado para a obra na WuxiaWorld.site.');
    const [, slug, chapterSlug] = CHAPTER.exec(chapterId)!, path = `/novel/${slug}/${chapterSlug}/`;
    const body = await this.store.getOrSet(async () => {
      const html = await this.request(path); canonical(html, path);
      const breadcrumb = byClass(html, 'breadcrumb')[0], active = breadcrumb ? byClass(breadcrumb.inner, 'active')[0] : undefined;
      if (!breadcrumb || !active || plain(active.inner) !== index[position].title || !links(breadcrumb.inner).some(link => link.attributes.href === novel.sourceUrl && plain(link.inner) === novel.title)) throw fail();
      const chapterField = [...html.matchAll(/<input\b[^>]*>/gi)].map(match => attrs(match[0])).find(attributes => attributes.id === 'wp-manga-current-chap');
      if (chapterField?.value !== chapterSlug) throw fail();
      const reading = byClass(html, 'reading-content')[0], text = reading ? byClass(reading.inner, 'text-left')[0] : undefined;
      if (!text) throw new ApiError(503, 'WUXIAWORLDSITE_TEXT_UNAVAILABLE', 'A fonte não disponibilizou o texto desta edição. Abra o capítulo na WuxiaWorld.site.');
      const normalized = (value: string) => plain(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const heading = blocks(text.inner, tag => /^h[1-6]$/.test(tag))[0], label = normalized(index[position].title);
      if (!heading || !(normalized(heading.inner) === label || normalized(heading.inner).startsWith(`${label} `))) throw fail();
      const remove = blocks(text.inner, (tag, attributes) => ['iframe', 'svg', 'form', 'nav', 'aside', 'noscript', 'button'].includes(tag) || attributes['aria-hidden'] === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes.style ?? '') || /(?:^|\s)(?:ads?|advertisement|adsbygoogle|comments?)(?:\s|$)/i.test(attributes.class ?? ''));
      let clean = text.inner; for (const block of remove) clean = clean.replace(block.outer, '');
      const credits: string[] = [];
      const paragraphs = blocks(clean, tag => tag === 'p' || /^h[1-6]$/.test(tag)).map(block => plain(block.inner)).filter(paragraph => {
        if (/^(?:translator|editor|translation|proofreader)\s*:/i.test(paragraph)) { credits.push(paragraph.slice(0, 1000)); return false; }
        return !!paragraph;
      });
      if (paragraphs.length < 2 || paragraphs.length > 10_000 || paragraphs.some(paragraph => paragraph.length > 30_000) || paragraphs.join('').length > 2_000_000) throw new ApiError(503, 'WUXIAWORLDSITE_TEXT_UNAVAILABLE', 'Esta edição não possui texto compatível com o leitor. Abra o capítulo na WuxiaWorld.site.');
      for (const [className, expected] of [['prev_page', index[position - 1]?.id], ['next_page', index[position + 1]?.id]] as const) {
        const navigation = links(html).filter(link => hasClass(link.attributes, className));
        if (expected && !navigation.length) throw fail();
        for (const link of navigation) if (chapterFromUrl(link.attributes.href ?? '', id) !== expected) throw fail();
      }
      return { paragraphs, credits };
    }, `wuxiaworldsite:content:${chapterId}`, 300);
    return { available: true, status: 'available', providerId: 'wuxiaworldsite', message: 'Texto em inglês fornecido pela página pública da WuxiaWorld.site.', paragraphs: body.paragraphs, novel, chapter: index[position], previousChapterId: index[position - 1]?.id, nextChapterId: index[position + 1]?.id, isDemo: false, attribution: [WUXIAWORLDSITE_SOURCE.name, ...body.credits].join(' · '), sourceUrl: `${ORIGIN}${path}` };
  }
}
