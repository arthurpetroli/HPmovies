import type {
  MangaCatalogProvider, MangaChapterProvider, MangaImageProvider, MangaChapter, MangaChapterPage,
  MangaChapterPages, MangaHome, MangaPage, MangaQuery, MangaTag, MangaTitle,
} from '../../../shared/manga.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache, cache } from '../config/cache.js';
import { ContentImageGateway } from './content-image.js';
import type { TokoConfig } from '../config/integrations.js';

const ORIGIN = 'https://mangalivre.to';
const SLUG = '[a-z0-9]+(?:[-_][a-z0-9]+)*';
const WORK_ID = new RegExp(`^mangalivre:(${SLUG})$`);
const CHAPTER_ID = new RegExp(`^mangalivre:(${SLUG})/(${SLUG})$`);
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const CHAPTER_PAGE_SIZE = 100;
const natural = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const imageConfig: TokoConfig = {
  enabled: true, contentAuthorized: true, baseUrl: ORIGIN, timeoutMs: 14_000, retries: 0,
  allowedProviders: ['mangalivre'], allowedMediaHosts: ['mangalivre.to'], allowedRequestOrigins: [ORIGIN],
};
const unexpected = () => new ApiError(502, 'INVALID_MANGALIVRE_RESPONSE', 'O Mangá Livre retornou uma página inesperada. Tente novamente mais tarde.');
const unavailable = () => new ApiError(503, 'MANGALIVRE_UNAVAILABLE', 'Não foi possível consultar o Mangá Livre. Tente novamente mais tarde.');

/** This provider reads the public mangalivre.to site; it does not claim continuity with mangalivre.net. */
export const MANGALIVRE_SOURCE = { id: 'mangalivre', name: 'Mangá Livre · mangalivre.to', url: ORIGIN } as const;

export function validateMangaLivreId(id: string, chapter = false): string {
  if (typeof id !== 'string' || id.length > 200 || !(chapter ? CHAPTER_ID : WORK_ID).test(id)) {
    throw new ApiError(400, 'INVALID_MANGA_ID', 'Identificador do Mangá Livre inválido.');
  }
  return id;
}

const entities: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', acirc: 'â', ecirc: 'ê', ocirc: 'ô',
  atilde: 'ã', otilde: 'õ', ccedil: 'ç', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  Agrave: 'À', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç', rsquo: '’', lsquo: '‘',
};
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (all, name: string) => {
    if (!name.startsWith('#')) return entities[name] ?? all;
    const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}
const text = (html: string) => decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of tag.matchAll(/(?:^|\s)([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+))/gi)) {
    result[item[1].toLowerCase()] = decode(item[2] ?? item[3] ?? item[4] ?? '').trim();
  }
  return result;
}
const hasClass = (attrs: Record<string, string>, name: string) => attrs.class?.split(/\s+/).includes(name) ?? false;

/** Bounded tag scanning keeps nested divs intact without executing any upstream HTML or scripts. */
function blocks(html: string, className: string): string[] {
  const result: string[] = [];
  const active: { tag: string; depth: number; start: number }[] = [];
  const tags = /<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (const match of html.matchAll(tags)) {
    const token = match[0]; const name = match[1].toLowerCase(); const closing = token.startsWith('</');
    const voidTag = /^(?:img|input|br|hr|meta|link|source|area|base|embed|param|track|wbr)$/.test(name) || token.endsWith('/>');
    if (closing) {
      for (let index = active.length - 1; index >= 0; index--) {
        const target = active[index];
        if (target.tag !== name) continue;
        if (--target.depth === 0) { result.push(html.slice(target.start, match.index! + token.length)); active.splice(index, 1); }
      }
    } else {
      if (!voidTag) for (const target of active) if (target.tag === name) target.depth++;
      if (hasClass(attributes(token), className)) {
        if (voidTag) result.push(token);
        else active.push({ tag: name, depth: 1, start: match.index! });
      }
    }
  }
  return result;
}
function links(html: string): { href: string; label: string; attrs: Record<string, string> }[] {
  return [...html.matchAll(/(<a\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)([\s\S]*?)<\/a\s*>/gi)].map(match => {
    const attrs = attributes(match[1]);
    return { href: attrs.href ?? '', label: text(match[2]), attrs };
  });
}
function sourceUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value, ORIGIN); } catch { throw unexpected(); }
  if (url.origin !== ORIGIN || url.username || url.password || url.port || url.search || url.hash) throw unexpected();
  return url;
}
function workSlug(value: string): string | undefined {
  try { return new RegExp(`^/manga/(${SLUG})/$`).exec(sourceUrl(value).pathname)?.[1]; } catch { return undefined; }
}
function chapterSlug(value: string, work: string): string | undefined {
  try { return new RegExp(`^/manga/${work}/(${SLUG})/$`).exec(sourceUrl(value).pathname)?.[1]; } catch { return undefined; }
}
function imageSource(html: string): string | undefined {
  const tag = /<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(html)?.[0];
  if (!tag) return undefined;
  const attrs = attributes(tag);
  return attrs['data-src'] || attrs['data-lazy-src'] || attrs.src;
}
const explicit = (html: string): boolean => /class\s*=\s*["'][^"']*\badult\b/i.test(html)
  || /(?:\+\s*18|18\s*\+|sem\s+censura)/i.test(text(blocks(html, 'post-title')[0] ?? ''))
  || links(html).some(link => /\/(?:genero|genre)\/(?:18|adulto|hentai|erotica?|pornografico|smut)\//i.test(link.href));
function genreTags(html: string): MangaTag[] {
  const result = new Map<string, MangaTag>();
  for (const link of links(html)) {
    let path: string;
    try { path = sourceUrl(link.href).pathname; } catch { continue; }
    const slug = new RegExp(`^/genero/(${SLUG})/$`).exec(path)?.[1];
    if (!slug || /^(?:18|adulto|hentai|erotica?|pornografico|smut)$/.test(slug)) continue;
    const name = link.label.replace(/\s*\([\d.,]+\)\s*$/, '').trim();
    if (name) result.set(slug, { id: `mangalivre:tag:${slug}`, name });
  }
  return [...result.values()];
}
const status = (value: string): MangaTitle['status'] => /completo|conclu[ií]do|completed|^end$/i.test(value) ? 'completed'
  : /andamento|ongoing|on-going/i.test(value) ? 'ongoing' : /hiat|pausa|on-hold/i.test(value) ? 'hiatus' : /cancel/i.test(value) ? 'cancelled' : undefined;
function metadata(html: string, heading: RegExp): string | undefined {
  for (const item of blocks(html, 'post-content_item')) {
    if (heading.test(text(blocks(item, 'summary-heading')[0] ?? ''))) return text(blocks(item, 'summary-content')[0] ?? '');
  }
  return undefined;
}
function validateCanonical(html: string, path: string) {
  const tag = [...html.matchAll(/<link\b[^>]*>/gi)].find(match => attributes(match[0]).rel === 'canonical');
  if (tag && sourceUrl(attributes(tag[0]).href ?? '').pathname !== path) throw unexpected();
}
function validLanguage(language: string): boolean {
  if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(language.toLowerCase()) && language !== 'all') throw new ApiError(400, 'INVALID_LANGUAGE', 'Idioma de edição inválido.');
  return ['pt', 'pt-br', 'all'].includes(language.toLowerCase());
}
function rasterImage(mime: string, bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (mime === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (mime === 'image/gif') return /^(?:GIF87a|GIF89a)$/.test(ascii(0, 6));
  return mime === 'image/avif' && ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 32));
}
interface MangaLivreOptions {
  fetcher?: typeof fetch;
  cache?: AniwatchAPICache;
  timeoutMs?: number;
  requestIntervalMs?: number;
  imageGateway?: Pick<ContentImageGateway, 'issue' | 'image'>;
}
interface WorkData { manga: MangaTitle; chapters: MangaChapter[] }

export class MangaLivreProvider implements MangaCatalogProvider, MangaChapterProvider, MangaImageProvider {
  private readonly fetcher: typeof fetch;
  private readonly store: AniwatchAPICache;
  private readonly gateway: Pick<ContentImageGateway, 'issue' | 'image'>;
  private readonly timeoutMs: number;
  private readonly interval: number;
  private lastRequest = 0;
  private cooldownUntil = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly tickets = new Map<string, number>();
  private readonly knownPages = new Map<string, number>();

  constructor(options: MangaLivreOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.store = options.cache ?? cache;
    this.gateway = options.imageGateway ?? new ContentImageGateway();
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.interval = options.requestIntervalMs ?? 350;
  }

  ownsImage(token: string): boolean { return (this.tickets.get(token) ?? 0) > Date.now(); }

  private issueImage(value: string | undefined): string {
    if (!value) return '';
    const url = sourceUrl(value);
    if (!url.pathname.startsWith('/wp-content/uploads/') || !/\.(?:jpe?g|png|webp|gif|avif)$/i.test(url.pathname)) throw unexpected();
    const issued = this.gateway.issue(imageConfig, 'mangalivre', url.href, { referer: `${ORIGIN}/` });
    const token = /^\/api\/content\/image\/([0-9a-f-]{36})$/i.exec(issued)?.[1];
    if (!token) throw unexpected();
    for (const [key, expires] of this.tickets) if (expires <= Date.now()) this.tickets.delete(key);
    while (this.tickets.size >= 4096) this.tickets.delete(this.tickets.keys().next().value!);
    this.tickets.set(token, Date.now() + 15 * 60_000);
    return `/api/manga/image/${token}`;
  }

  async image(token: string) {
    if (!this.ownsImage(token)) throw new ApiError(404, 'MANGALIVRE_IMAGE_EXPIRED', 'A imagem expirou. Atualize o capítulo.');
    const image = await this.gateway.image(token);
    if (!rasterImage(image.contentType, image.bytes)) throw new ApiError(502, 'MANGALIVRE_IMAGE_UNAVAILABLE', 'A fonte não disponibilizou uma imagem válida. Atualize o capítulo.');
    return image;
  }

  private async html(path: string): Promise<string> {
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || url.username || url.password || url.hash) throw unexpected();
    if (this.cooldownUntil > Date.now()) throw new ApiError(503, 'MANGALIVRE_RATE_LIMIT', 'O Mangá Livre limitou as consultas. Aguarde antes de tentar novamente.', Math.ceil((this.cooldownUntil - Date.now()) / 1000));
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const delay = this.lastRequest + this.interval - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      if (this.cooldownUntil > Date.now()) throw new ApiError(503, 'MANGALIVRE_RATE_LIMIT', 'O Mangá Livre limitou as consultas. Aguarde antes de tentar novamente.', Math.ceil((this.cooldownUntil - Date.now()) / 1000));
      this.lastRequest = Date.now();
    } finally { release(); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetcher(url.href, { signal: controller.signal, redirect: 'error', headers: { Accept: 'text/html', 'User-Agent': 'HPmovies/2.0 (local manga reader)' } });
      if (response.status === 429) {
        const retry = Math.min(300, Math.max(1, Number(response.headers.get('retry-after')) || 60));
        this.cooldownUntil = Date.now() + retry * 1000;
        void response.body?.cancel().catch(() => undefined);
        throw new ApiError(503, 'MANGALIVRE_RATE_LIMIT', 'O Mangá Livre limitou as consultas. Aguarde antes de tentar novamente.', retry);
      }
      if (response.status === 404) { void response.body?.cancel().catch(() => undefined); throw new ApiError(404, 'MANGA_NOT_FOUND', 'Esta obra ou capítulo não está disponível no Mangá Livre.'); }
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw unavailable(); }
      if (!response.headers.get('content-type')?.toLowerCase().includes('text/html') || !response.body || Number(response.headers.get('content-length') ?? 0) > MAX_HTML_BYTES) {
        void response.body?.cancel().catch(() => undefined); throw unexpected();
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder(); let content = ''; let bytes = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_HTML_BYTES) throw unexpected();
        content += decoder.decode(part.value, { stream: true });
      }
      content += decoder.decode();
      if (/<title>\s*(?:just a moment|access denied|checking your browser)/i.test(content)) throw unavailable();
      return content.replace(/<!--[^]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(controller.signal.aborted ? 504 : 503, 'MANGALIVRE_UNAVAILABLE', controller.signal.aborted ? 'O Mangá Livre demorou para responder. Tente novamente.' : 'Não foi possível consultar o Mangá Livre. Tente novamente mais tarde.');
    } finally { clearTimeout(timer); void reader?.cancel().catch(() => undefined); }
  }

  private title(id: string, title: string, html: string): MangaTitle {
    const source = `${ORIGIN}/manga/${id.slice('mangalivre:'.length)}/`;
    const image = imageSource(blocks(html, 'summary_image')[0] ?? blocks(html, 'item-thumb')[0] ?? blocks(html, 'tab-thumb')[0] ?? html);
    const year = metadata(html, /^(?:lançamento|release)$/i) ?? links(html).find(link => link.href.includes('/ano-de-lancamento/'))?.label;
    return {
      id, title, poster: this.issueImage(image), description: text(blocks(html, 'summary__content')[0] ?? '').slice(0, 8000) || undefined,
      status: status(metadata(html, /^status$/i) ?? ''), year: /^\d{4}$/.test(year ?? '') ? Number(year) : undefined,
      availableLanguages: ['pt-br'], tags: genreTags(blocks(html, 'genres-content')[0] ?? html),
      authors: [...new Set(links(blocks(html, 'author-content')[0] ?? html).filter(link => /\/manga-(?:author|artist)\//.test(link.href)).map(link => link.label))],
      contentRating: 'suggestive', sourceUrl: source, providerId: 'mangalivre', providerName: MANGALIVRE_SOURCE.name,
    };
  }

  private work(id: string): Promise<WorkData> {
    validateMangaLivreId(id);
    return this.store.getOrSet(async () => {
      const slug = WORK_ID.exec(id)![1]; const path = `/manga/${slug}/`; const html = await this.html(path);
      validateCanonical(html, path);
      const profile = blocks(html, 'profile-manga')[0] ?? html;
      const heading = blocks(profile, 'post-title').find(item => /<h1\b/i.test(item));
      const title = heading ? text(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(heading)?.[1] ?? '') : '';
      if (!title) throw unexpected();
      if (explicit(profile)) throw new ApiError(404, 'MANGA_NOT_FOUND', 'Esta obra tem classificação explícita e não está disponível neste catálogo.');
      const manga = this.title(id, title, profile);
      const section = blocks(html, 'listing-chapters-wrap')[0] ?? blocks(html, 'listing-chapters_wrap')[0];
      if (!section) throw unexpected();
      const items = blocks(section, 'chapter-box');
      const rows = items.length ? items : blocks(section, 'wp-manga-chapter');
      const chapters = new Map<string, MangaChapter>();
      for (const item of rows) {
        const link = links(item).find(link => chapterSlug(link.href, slug));
        if (!link) continue;
        const chapterPart = chapterSlug(link.href, slug)!;
        const number = /(?:cap[ií]tulo|chapter|cap\.?)[\s-]*(\d+(?:[.,]\d+)?)/i.exec(link.label)?.[1]?.replace(',', '.')
          ?? /^(?:capitulo|chapter)-(\d+(?:-\d+)?)$/.exec(chapterPart)?.[1]?.replace('-', '.') ?? null;
        const volume = /\bvol(?:ume)?\.?\s*(\d+(?:[.,]\d+)?)/i.exec(link.label)?.[1]?.replace(',', '.') ?? null;
        const chapterId = `mangalivre:${slug}/${chapterPart}`;
        chapters.set(chapterId, { id: chapterId, mangaId: id, title: link.label || `Capítulo ${number ?? chapterPart}`, chapter: number, volume, language: 'pt-br', groups: [], pages: 0 });
      }
      if (chapters.size > 10_000) throw unexpected();
      return { manga, chapters: [...chapters.values()].sort((a, b) => natural.compare(a.chapter ?? a.title, b.chapter ?? b.title) || natural.compare(a.id, b.id)) };
    }, `mangalivre:work:${id}`, 300);
  }

  async details(id: string): Promise<MangaTitle> { return (await this.work(id)).manga; }

  async chapters(id: string, language = 'pt-br', page = 1): Promise<MangaChapterPage> {
    validateMangaLivreId(id);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new ApiError(400, 'INVALID_PAGE', 'Página de capítulos inválida.');
    if (!validLanguage(language)) return { items: [], language, page, total: 0, hasNextPage: false };
    const { chapters } = await this.work(id);
    const start = (page - 1) * CHAPTER_PAGE_SIZE;
    return { items: chapters.slice(start, start + CHAPTER_PAGE_SIZE).map(chapter => ({ ...chapter, pages: this.knownPages.get(chapter.id) ?? 0 })), language: language.toLowerCase(), page, total: chapters.length, hasNextPage: start + CHAPTER_PAGE_SIZE < chapters.length };
  }

  async pages(id: string): Promise<MangaChapterPages> {
    validateMangaLivreId(id, true);
    const [, slug, chapterPart] = CHAPTER_ID.exec(id)!; const mangaId = `mangalivre:${slug}`;
    const work = await this.work(mangaId); const index = work.chapters.findIndex(chapter => chapter.id === id);
    if (index < 0) throw new ApiError(404, 'MANGA_CHAPTER_NOT_FOUND', 'Este capítulo não está listado para a obra no Mangá Livre.');
    const sources = await this.store.getOrSet(async () => {
      const path = `/manga/${slug}/${chapterPart}/`; const html = await this.html(path);
      validateCanonical(html, path);
      const current = [...html.matchAll(/<input\b[^>]*>/gi)].map(match => attributes(match[0])).find(attrs => attrs.id === 'wp-manga-current-chap');
      if (!current || current.value !== chapterPart) throw unexpected();
      const section = blocks(html, 'reading-content')[0];
      if (!section) throw unexpected();
      const images = [...section.matchAll(/<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)].filter(match => hasClass(attributes(match[0]), 'wp-manga-chapter-img'));
      if (!images.length || images.length > 500) throw unexpected();
      const pages = images.map(match => {
        const source = imageSource(match[0]);
        if (!source) throw unexpected();
        // Validate every page now; malformed pages must not silently produce a partial chapter.
        const url = sourceUrl(source);
        if (!url.pathname.startsWith('/wp-content/uploads/') || !/\.(?:jpe?g|png|webp|gif|avif)$/i.test(url.pathname)) throw unexpected();
        return url.href;
      });
      return [...new Set(pages)];
    }, `mangalivre:pages:${id}`, 300);
    this.knownPages.set(id, sources.length);
    while (this.knownPages.size > 2048) this.knownPages.delete(this.knownPages.keys().next().value!);
    return { chapter: { ...work.chapters[index], pages: sources.length }, pages: sources.map(source => this.issueImage(source)), sourceUrl: `${ORIGIN}/manga/${slug}/${chapterPart}/`, navigation: { previousId: work.chapters[index - 1]?.id, nextId: work.chapters[index + 1]?.id } };
  }

  async search(query: MangaQuery): Promise<MangaPage> {
    const page = query.page ?? 1; const language = query.language ?? 'pt-br';
    if (!Number.isSafeInteger(page) || page < 1 || page > 416) throw new ApiError(400, 'INVALID_PAGE', 'Página de catálogo inválida.');
    if (!validLanguage(language)) return { items: [], page, total: 0, hasNextPage: false };
    const search = query.search?.trim() ?? '';
    if (search.length > 120 || [...search].some(character => character.charCodeAt(0) < 32)) throw new ApiError(400, 'INVALID_FILTER', 'Título de busca inválido.');
    const tag = query.tag ? new RegExp(`^mangalivre:tag:(${SLUG})$`).exec(query.tag)?.[1] : undefined;
    if (query.tag && !tag) throw new ApiError(400, 'INVALID_FILTER', 'Gênero do Mangá Livre inválido.');
    const sort = { popular: 'views', rating: 'rating', latest: 'latest', newest: 'new-manga' }[query.sort ?? 'popular'];
    if (!sort) throw new ApiError(400, 'INVALID_FILTER', 'Ordenação de catálogo inválida.');
    const statuses = { ongoing: 'on-going', completed: 'end', hiatus: 'on-hold', cancelled: 'canceled' };
    if (query.status && !statuses[query.status]) throw new ApiError(400, 'INVALID_FILTER', 'Status de publicação inválido.');
    const filtered = !!(search || tag || query.status);
    const path = filtered ? (page > 1 ? `/page/${page}/` : '/') : `/manga/${page > 1 ? `page/${page}/` : ''}`;
    const params = new URLSearchParams({ m_orderby: sort });
    if (filtered) { params.set('s', search); params.set('post_type', 'wp-manga'); }
    if (tag) params.set('genre[]', tag);
    if (query.status) params.set('status[]', statuses[query.status]);
    return this.store.getOrSet(async () => {
      const html = await this.html(`${path}?${params}`);
      const candidates = blocks(html, filtered ? 'c-tabs-item__content' : 'page-item-detail');
      if (!candidates.length && !/(?:0\s+Resultados|Nenhum|Nothing Found|No results|search-no-results)/i.test(html)) throw unexpected();
      const found = new Map<string, MangaTitle>();
      for (const card of candidates) {
        if (explicit(card)) continue;
        const link = links(blocks(card, 'post-title')[0] ?? '').find(link => workSlug(link.href));
        if (!link) continue;
        const slug = workSlug(link.href)!; const id = `mangalivre:${slug}`;
        const manga = this.title(id, link.label, card);
        if (query.status && manga.status && manga.status !== query.status) continue;
        found.set(id, manga);
      }
      const pagination = blocks(html, 'nav-previous').some(item => links(item).some(link => {
        try { const target = new URL(link.href, ORIGIN); return target.origin === ORIGIN && new RegExp(`/page/${page + 1}/$`).test(target.pathname); } catch { return false; }
      }));
      const totalText = /([\d.,]+)\s+Resultados/i.exec(text(html))?.[1];
      const total = totalText ? Number(totalText.replace(/[.,]/g, '')) : (page - 1) * 10 + candidates.length + (pagination ? 1 : 0);
      return { items: [...found.values()], page, total, hasNextPage: pagination };
    }, `mangalivre:search:${path}?${params}`, 180);
  }

  async home(language = 'pt-br'): Promise<MangaHome> {
    const result = await Promise.allSettled([
      this.search({ language, sort: 'popular' }), this.search({ language, sort: 'rating' }),
      this.search({ language, status: 'ongoing', sort: 'popular' }), this.search({ language, sort: 'latest' }),
    ]);
    const items = (index: number) => result[index].status === 'fulfilled' ? result[index].value.items : [];
    const warnings = ['Fonte: mangalivre.to. A classificação etária das obras não foi verificada; títulos marcados como explícitos são omitidos.'];
    if (result.some(item => item.status === 'rejected')) warnings.push('Algumas listas do Mangá Livre não responderam. Tente atualizar mais tarde.');
    if (result.every(item => item.status === 'rejected')) throw (result[0] as PromiseRejectedResult).reason;
    return { popular: items(0), topRated: items(1), ongoing: items(2), latest: items(3), warnings };
  }

  tags(): Promise<MangaTag[]> {
    return this.store.getOrSet(async () => genreTags(await this.html('/manga/')).sort((a, b) => natural.compare(a.name, b.name)), 'mangalivre:tags', 3600);
  }
}
