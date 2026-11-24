import { request } from 'node:https';
import type { Playback, ProviderDiagnostic, StreamSource } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache } from '../config/cache.js';
import { integrationsConfig } from '../config/integrations.js';
import type { AdultSiteId, AdultSitesConfig } from '../config/integrations.js';
import { depictsMinors } from './adult-safety.js';
import { streamMediaGateway } from './stream-media.js';
import type { StreamMediaGateway } from './stream-media.js';

/**
 * Brazilian streaming sites that embed the Blogger video player. HPmovies reads
 * only public pages: no login, captcha or anti-bot challenge is touched, and
 * players that require a forged Referer are skipped. Blogger serves
 * progressive MP4s (itag 22 = 720p for HD uploads, itag 18 = 360p) bound to the
 * requesting IPv4 address, so pages are fetched over IPv4, the same family the
 * media gateway uses.
 */

export interface PageResponse { status: number; url: string; body: string }
export type PageFetcher = (url: string, timeoutMs: number) => Promise<PageResponse>;

const MAX_PAGE_BYTES = 3_000_000;
const USER_AGENT = 'HPmovies/2.0 (local media client)';
const BLOGGER_EMBED = /https:\/\/www\.blogger\.com\/video\.g\?token=[A-Za-z0-9_-]{20,2000}/g;

const siteError = (code: string, message: string, status: ApiError['status'] = 502) => new ApiError(status, code, message);

/** Follows at most three redirects on the same host, upgrading http to https. */
export const fetchPage: PageFetcher = (input, timeoutMs) => new Promise((resolve, reject) => {
  const visit = (url: URL, redirects: number) => {
    const outgoing = request(url, {
      method: 'GET', family: 4, signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' },
    }, response => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        let next: URL;
        try { next = new URL(location, url); } catch { reject(siteError('ADULT_SITE_REDIRECT_REFUSED', 'O site respondeu com um redirecionamento inválido.')); return; }
        if (next.protocol === 'http:') next.protocol = 'https:';
        if (redirects >= 3 || next.hostname !== url.hostname || next.protocol !== 'https:') {
          reject(siteError('ADULT_SITE_REDIRECT_REFUSED', 'O site redirecionou para outro endereço.'));
          return;
        }
        visit(next, redirects + 1);
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on('data', (chunk: Buffer) => {
        length += chunk.byteLength;
        if (length > MAX_PAGE_BYTES) { response.destroy(); reject(siteError('ADULT_SITE_RESPONSE_TOO_LARGE', 'A página do site excedeu o limite de tamanho.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ status, url: url.href, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', () => reject(siteError('ADULT_SITE_CONNECTION_ERROR', 'A conexão com o site foi interrompida.', 503)));
    });
    outgoing.once('error', error => reject(error.name === 'AbortError' || error.name === 'TimeoutError'
      ? siteError('ADULT_SITE_TIMEOUT', 'O site demorou demais para responder.', 504)
      : siteError('ADULT_SITE_CONNECTION_ERROR', 'Não foi possível conectar ao site.', 503)));
    outgoing.end();
  };
  visit(new URL(input), 0);
});

export interface MediaHead { status: number; contentType: string; body: Buffer }
export type HeadFetcher = (url: string, timeoutMs: number) => Promise<MediaHead>;
const HEAD_BYTES = 262_144;

/** Reads only the first bytes of a direct MP4, enough for ftyp and a front-loaded moov. */
export const fetchMediaHead: HeadFetcher = (input, timeoutMs) => new Promise((resolve, reject) => {
  const outgoing = request(new URL(input), {
    method: 'GET', family: 4, signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': USER_AGENT, Range: `bytes=0-${HEAD_BYTES - 1}`, 'Accept-Encoding': 'identity' },
  }, response => {
    const chunks: Buffer[] = [];
    let length = 0;
    const done = () => resolve({ status: response.statusCode ?? 0, contentType: String(response.headers['content-type'] ?? ''), body: Buffer.concat(chunks).subarray(0, HEAD_BYTES) });
    response.on('data', (chunk: Buffer) => { length += chunk.byteLength; chunks.push(chunk); if (length >= HEAD_BYTES) response.destroy(); });
    response.on('end', done);
    response.on('close', done);
  });
  outgoing.once('error', () => reject(siteError('ADULT_SITE_CONNECTION_ERROR', 'Não foi possível ler o vídeo do site.', 503)));
  outgoing.end();
});

/** A real MP4 (ftyp first) and the tallest video track declared in its tkhd boxes. */
export function mp4Video(bytes: Buffer): { height?: number } | undefined {
  if (bytes.length < 12 || bytes.toString('latin1', 4, 8) !== 'ftyp') return undefined;
  let height: number | undefined;
  for (let index = bytes.indexOf('tkhd'); index !== -1; index = bytes.indexOf('tkhd', index + 4)) {
    const start = index - 4;
    if (start < 0) continue;
    const size = bytes.readUInt32BE(start);
    const end = start + size;
    if (size < 84 || size > 120 || end > bytes.length) continue;
    const width = bytes.readUInt32BE(end - 8) >>> 16;
    const trackHeight = bytes.readUInt32BE(end - 4) >>> 16;
    if (width > 0 && trackHeight > 0 && trackHeight <= 4320) height = Math.max(height ?? 0, trackHeight);
  }
  return { ...(height ? { height } : {}) };
}

const normalizeTitle = (value: string): string => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slugOf = (value: string): string => normalizeTitle(value).replaceAll(' ', '-');
const decodeEntities = (value: string): string => value.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plainText = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

interface Anchor { url: URL; text: string; title?: string }
function anchors(html: string, base: string): Anchor[] {
  const result: Anchor[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
    if (!href) continue;
    try {
      const title = /\btitle\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
      result.push({ url: new URL(decodeEntities(href), base), text: plainText(match[2]), ...(title ? { title: decodeEntities(title) } : {}) });
    } catch { /* Malformed links are ignored. */ }
  }
  return result;
}

/** Only the title's own genre block, never the site-wide genre menu. */
function genres(html: string): string[] | undefined {
  const start = html.indexOf('class="sgeneros');
  if (start < 0) return undefined;
  const block = html.slice(start, start + 4000);
  const end = block.indexOf('</div>');
  return [...new Set(anchors(end >= 0 ? block.slice(0, end) : block, 'https://example.invalid/')
    .filter(anchor => anchor.url.pathname.includes('/genero/') && anchor.text.length > 1).map(anchor => anchor.text))];
}

const heading = (html: string): string | undefined => {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return match ? plainText(match[1]).slice(0, 300) || undefined : undefined;
};

export interface SiteEpisode { number: number; url: string }
export interface SiteMatch { site: AdultSiteId; title: string; episodes: SiteEpisode[] }
type Load = (url: string) => Promise<PageResponse>;

/** A video an episode page links to: the site's own MP4 or a Blogger embed. */
type MediaCandidate = { kind: 'mp4'; url: string } | { kind: 'blogger'; url: string };

interface SiteAdapter {
  id: AdultSiteId;
  name: string;
  origin: string;
  /** The title's page and episodes, or undefined when the site has no exact match. Throws on blocked titles. */
  find(title: string, load: Load): Promise<SiteMatch | undefined>;
  /** Videos reachable from an episode page without forged headers. */
  media(html: string, url: string, load: Load): Promise<MediaCandidate[]>;
}

const blocked = () => new ApiError(404, 'ADULT_TITLE_BLOCKED', 'A fonte encontrada foi bloqueada: o HPmovies não exibe obras que retratam menores.');
const bloggerEmbeds = (html: string): MediaCandidate[] => [...new Set([...decodeEntities(html).matchAll(BLOGGER_EMBED)].map(match => match[0]))].map(url => ({ kind: 'blogger', url }));

/** <video><source src="…mp4"> players hosted by the site itself (exact host suffix). */
function ownMp4(html: string, base: string, domain: string): MediaCandidate[] {
  return [...new Set([...html.matchAll(/<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].flatMap(match => {
    try {
      const url = new URL(decodeEntities(match[1]), base);
      return url.protocol === 'https:' && !url.port && (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) && url.pathname.toLowerCase().endsWith('.mp4') ? [url.href] : [];
    } catch { return []; }
  }))].map(url => ({ kind: 'mp4', url }));
}

/** Episode links like /episodio/<slug>-episodio-07/ for the matched slug only. */
function episodeLinks(list: Anchor[], prefix: string, slug: string): SiteEpisode[] {
  const pattern = new RegExp(`^${prefix}${slug}-episodio-(\\d{1,4})/?$`);
  const episodes = new Map<number, SiteEpisode>();
  for (const anchor of list) {
    const number = Number(pattern.exec(anchor.url.pathname)?.[1]);
    if (number > 0 && !episodes.has(number)) episodes.set(number, { number, url: anchor.url.href });
  }
  return [...episodes.values()].sort((a, b) => a.number - b.number);
}

function checkTitle(title: string, siteGenres: string[] | undefined, extra: string[] = []) {
  if (depictsMinors({ tags: siteGenres, texts: [title, ...extra] })) throw blocked();
}

const animeshentai: SiteAdapter = {
  id: 'animeshentai', name: 'AnimesHentai', origin: 'https://animeshentai.biz',
  async find(title, load) {
    const slug = slugOf(title);
    const search = await load(`${this.origin}/search/${encodeURIComponent(title)}`);
    const wanted = normalizeTitle(title);
    const match = anchors(search.body, search.url).find(anchor => {
      const candidate = /^\/hentai\/([a-z0-9-]+)\/?$/.exec(anchor.url.pathname)?.[1];
      return anchor.url.hostname === 'animeshentai.biz' && !!candidate && (candidate === slug || normalizeTitle(anchor.title ?? anchor.text) === wanted);
    });
    const found = match && /^\/hentai\/([a-z0-9-]+)/.exec(match.url.pathname)?.[1];
    if (!found) return undefined;
    const page = await load(`${this.origin}/hentai/${found}/`);
    const pageTitle = heading(page.body) ?? title;
    checkTitle(pageTitle, genres(page.body) ?? []);
    const episodes = episodeLinks(anchors(page.body, page.url), '/episodio/', found);
    return episodes.length ? { site: this.id, title: pageTitle, episodes } : undefined;
  },
  // The "HD" tab is the Blogger player; its progressive 720p is used when the upload has it.
  async media(html) { return bloggerEmbeds(html); },
};

const assistirhentai: SiteAdapter = {
  id: 'assistirhentai', name: 'Assistir Hentai', origin: 'https://www.assistirhentai.com',
  async find(title, load) {
    const slug = slugOf(title);
    const search = await load(`${this.origin}/?s=${encodeURIComponent(title)}`);
    const list = anchors(search.body, search.url).filter(anchor => anchor.url.hostname === 'www.assistirhentai.com');
    const episodes = episodeLinks(list, '/episodio/', slug);
    if (!episodes.length) return undefined;
    // This site lists no genres; the AniList title already passed the filter.
    checkTitle(title, undefined, list.filter(anchor => episodes.some(episode => episode.url === anchor.url.href)).map(anchor => anchor.title ?? anchor.text));
    return { site: this.id, title, episodes };
  },
  // Some episodes use the site's own video.js player with a 720p MP4 on
  // videos.assistirhentai.com (served without a Referer check); others use Blogger.
  async media(html, url) { return [...ownMp4(html, url, 'assistirhentai.com'), ...bloggerEmbeds(html)]; },
};

const muitohentai: SiteAdapter = {
  id: 'muitohentai', name: 'Muito Hentai', origin: 'https://www.muitohentai.com',
  async find(title, load) {
    const slug = slugOf(title);
    const search = await load(`${this.origin}/buscar/${title.trim().split(/\s+/).map(encodeURIComponent).join('+')}/`);
    const wanted = normalizeTitle(title);
    const match = anchors(search.body, search.url).find(anchor => {
      const candidate = /^\/info\/([a-z0-9-]+)\/?$/.exec(anchor.url.pathname)?.[1];
      return anchor.url.hostname === 'www.muitohentai.com' && !!candidate && (candidate === slug || normalizeTitle(anchor.title ?? anchor.text) === wanted);
    });
    const found = match && /^\/info\/([a-z0-9-]+)/.exec(match.url.pathname)?.[1];
    if (!found) return undefined;
    const page = await load(`${this.origin}/info/${found}/`);
    const pageTitle = heading(page.body) ?? title;
    checkTitle(pageTitle, genres(page.body) ?? []);
    const episodes = episodeLinks(anchors(page.body, page.url), '/episodios/', found);
    return episodes.length ? { site: this.id, title: pageTitle, episodes } : undefined;
  },
  async media(html, url, load) {
    const direct = bloggerEmbeds(html);
    // The hentaitube.online player embeds Blogger. The /players/p2/ server
    // refuses requests without the site's Referer, so it is never used.
    const players = [...html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].flatMap(match => {
      try {
        const player = new URL(decodeEntities(match[1]), url);
        return player.protocol === 'https:' && player.hostname === 'www.hentaitube.online' && player.pathname.startsWith('/players_sites/') ? [player.href] : [];
      } catch { return []; }
    });
    const nested = await Promise.all(players.slice(0, 2).map(player => load(player).then(page => bloggerEmbeds(page.body), () => [] as MediaCandidate[])));
    return [...new Map([...direct, ...nested.flat()].map(candidate => [candidate.url, candidate])).values()];
  },
};

const ADAPTERS: Record<AdultSiteId, SiteAdapter> = { animeshentai, assistirhentai, muitohentai };

/** Progressive MP4 formats (video and audio in one file): itag 37 = 1080p, 22 = 720p, 18 = 360p. */
const PROGRESSIVE_ITAGS: Record<string, number> = { 37: 1080, 22: 720, 18: 360 };

/**
 * The progressive MP4s Blogger offers to any viewer, best first. Uploads in HD
 * include itag 22 (720p) next to itag 18 (360p). Adaptive SABR streams, which
 * need YouTube's proof-of-origin token, are never used.
 */
export function bloggerMp4(html: string): Array<{ url: string; expiresAt: number; height: number }> {
  const plain = decodeEntities(html).replace(/\\u0026/g, '&').replace(/\\u003d/g, '=').replace(/\\\//g, '/');
  const files = new Map<string, { url: string; expiresAt: number; height: number }>();
  for (const match of plain.matchAll(/https:\/\/[a-z0-9.-]+\.googlevideo\.com\/videoplayback\?[^"'\s<>\\]+/g)) {
    let url: URL;
    try { url = new URL(match[0]); } catch { continue; }
    const itag = url.searchParams.get('itag') ?? '';
    const height = PROGRESSIVE_ITAGS[itag];
    const expiresAt = Number(url.searchParams.get('expire')) * 1000;
    if (!height || files.has(itag) || !url.searchParams.get('mime')?.startsWith('video/mp4')
      || !Number.isFinite(expiresAt) || expiresAt < Date.now() + 5 * 60_000) continue;
    files.set(itag, { url: url.href, expiresAt, height });
  }
  return [...files.values()].sort((a, b) => b.height - a.height);
}

interface Options { config?: AdultSitesConfig; fetcher?: PageFetcher; headFetcher?: HeadFetcher; cache?: AniwatchAPICache; gateway?: Pick<StreamMediaGateway, 'issue'> }
/** A playable file found for one episode on one site. */
interface ResolvedMedia { url: string; expiresAt: number; height?: number; origin: 'site' | 'blogger' }

export class AdultSitesProvider {
  readonly config: AdultSitesConfig;
  private readonly fetcher: PageFetcher;
  private readonly headFetcher: HeadFetcher;
  private readonly cache: AniwatchAPICache;
  private readonly gateway: Pick<StreamMediaGateway, 'issue'>;

  constructor(options: Options = {}) {
    this.config = options.config ?? integrationsConfig.adultSites;
    this.fetcher = options.fetcher ?? fetchPage;
    this.headFetcher = options.headFetcher ?? fetchMediaHead;
    this.cache = options.cache ?? new AniwatchAPICache({ maxEntries: 512 });
    this.gateway = options.gateway ?? streamMediaGateway;
  }

  get enabled(): boolean { return this.config.enabled && this.config.sites.length > 0; }

  private load: Load = async url => {
    const page = await this.fetcher(url, this.config.timeoutMs);
    if (page.status === 404) throw siteError('ADULT_SITE_NOT_FOUND', 'A página não existe no site.', 404);
    if (page.status === 403 || page.status === 429 || page.status === 503) throw siteError('ADULT_SITE_REFUSED', 'O site recusou a consulta automática.', 503);
    if (page.status < 200 || page.status >= 300) throw siteError('ADULT_SITE_UPSTREAM_ERROR', `O site respondeu com HTTP ${page.status}.`);
    return page;
  };

  /** The first exact title match on one site, cached for an hour. */
  private find(site: SiteAdapter, titles: string[]): Promise<SiteMatch | null> {
    return this.cache.getOrSet(async () => {
      for (const title of titles) {
        try {
          const match = await site.find(title, this.load);
          if (match) return match;
        } catch (error) {
          if (error instanceof ApiError && error.code === 'ADULT_SITE_NOT_FOUND') continue;
          throw error;
        }
      }
      return null;
    }, `adult-sites:find:${site.id}:${JSON.stringify(titles)}`, 3600);
  }

  /** Every playable file an episode page links to, the site's own MP4 first. */
  private media(site: SiteAdapter, episodeUrl: string, refresh: boolean): Promise<ResolvedMedia[]> {
    return this.cache.getOrSet(async () => {
      const page = await this.load(episodeUrl);
      const candidates = await site.media(page.body, page.url, this.load);
      const resolved = await Promise.all(candidates.slice(0, 4).map(async (candidate): Promise<ResolvedMedia[]> => {
        try {
          if (candidate.kind === 'blogger') {
            return bloggerMp4((await this.load(candidate.url)).body).map(file => ({ ...file, origin: 'blogger' as const }));
          }
          // Offer the site's file only when its first bytes are a real MP4.
          const head = await this.headFetcher(candidate.url, this.config.timeoutMs);
          const video = (head.status === 200 || head.status === 206) && /^video\/mp4\b/i.test(head.contentType) ? mp4Video(head.body) : undefined;
          return video ? [{ url: candidate.url, expiresAt: Date.now() + 3 * 60 * 60_000, ...video, origin: 'site' }] : [];
        } catch { return []; }
      }));
      const found = [...new Map(resolved.flat().map(item => [item.url, item])).values()].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
      // An empty result is thrown, never cached: a passing failure must not hide a site for an hour.
      if (!found.length) throw new ApiError(404, 'ADULT_SITES_NO_MEDIA', 'O site não ofereceu um vídeo compatível para este episódio.');
      return found;
    }, `adult-sites:media:${episodeUrl}`, 3600, refresh);
  }

  private sites(): SiteAdapter[] { return this.config.sites.map(id => ADAPTERS[id]); }

  async episodes(titles: string[]): Promise<Array<{ number: number; title: string }>> {
    if (!this.enabled) throw new ApiError(503, 'ADULT_SITES_DISABLED', 'Nenhum site de streaming adulto foi configurado em ADULT_SITES.');
    const results = await Promise.allSettled(this.sites().map(site => this.find(site, titles)));
    const numbers = new Set(results.flatMap(result => result.status === 'fulfilled' && result.value ? result.value.episodes.map(episode => episode.number) : []));
    if (!numbers.size) throw this.failure(results);
    return [...numbers].sort((a, b) => a - b).map(number => ({ number, title: `Episódio ${number}` }));
  }

  private failure(results: PromiseSettledResult<unknown>[]): ApiError {
    const errors = results.flatMap(result => result.status === 'rejected' && result.reason instanceof ApiError ? [result.reason] : []);
    return errors.find(error => error.code === 'ADULT_TITLE_BLOCKED') ?? errors.find(error => error.status !== 404)
      ?? errors.find(error => error.code === 'ADULT_SITES_NO_MEDIA') ?? errors[0]
      ?? new ApiError(404, 'ADULT_SITES_NOT_FOUND', 'Os sites configurados não têm este título.');
  }

  async playback(titles: string[], number: number, refresh = false): Promise<Playback> {
    if (!this.enabled) throw new ApiError(503, 'ADULT_SITES_DISABLED', 'Nenhum site de streaming adulto foi configurado em ADULT_SITES.');
    if (!this.config.contentAuthorized) throw new ApiError(503, 'ADULT_SITES_UNAUTHORIZED', 'Defina ADULT_SITES_CONTENT_AUTHORIZED=true para reproduzir os sites configurados.');
    const results = await Promise.allSettled(this.sites().map(async site => {
      const match = await this.find(site, titles);
      const episode = match?.episodes.find(item => item.number === number);
      if (!episode) throw new ApiError(404, 'ADULT_SITES_NOT_FOUND', 'Os sites configurados não têm este episódio.');
      const media = await this.media(site, episode.url, refresh);
      const sources = media.flatMap((item): StreamSource[] => {
        try {
          const url = this.gateway.issue(this.config, site.id, item.url, 'mp4', {}, Math.min(item.expiresAt - 60_000, Date.now() + 2 * 60 * 60_000));
          const quality = item.height ? `${item.height}p` : undefined;
          return [{ url, type: 'mp4', label: `${site.name} · ${quality ?? 'MP4'}${item.origin === 'site' ? ' · servidor do site' : ''}`, ...(item.height ? { height: item.height, quality } : {}),
            providerId: `adult-site:${site.id}`, providerName: site.name, subtitles: [], available: true }];
        } catch { return []; }
      });
      if (!sources.length) throw new ApiError(503, 'ADULT_SITES_MEDIA_NOT_PERMITTED', `Inclua ${[...new Set(media.map(item => item.origin === 'blogger' ? 'googlevideo.com' : new URL(item.url).hostname.split('.').slice(-2).join('.')))].join(' e ')} em ADULT_SITES_ALLOWED_STREAM_DOMAINS.`);
      return sources;
    }));
    const sources = results.flatMap(result => result.status === 'fulfilled' ? result.value : []).sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    if (!sources.length) throw this.failure(results);
    return { episode: { id: `adult-site:${number}`, title: `Episódio ${number}`, number, available: true }, sources, subtitles: [], audioLanguages: [], isDemo: false };
  }

  async diagnostic(): Promise<ProviderDiagnostic> {
    const status = (state: ProviderDiagnostic['state'], technicalAvailable: boolean, message: string): ProviderDiagnostic => ({
      id: 'adult-sites', name: 'Sites de streaming adulto', enabled: this.enabled, state, technicalAvailable,
      authorized: this.config.contentAuthorized, checkedAt: new Date().toISOString(), message, capabilities: ['adult-video'],
    });
    if (!this.enabled) return status('unavailable', false, `Configure ADULT_SITES com um ou mais de: ${Object.keys(ADAPTERS).join(', ')}.`);
    const probes = await Promise.all(this.sites().map(async site => {
      try { await this.load(`${site.origin}/`); return `${site.name}: respondeu`; } catch { return `${site.name}: sem resposta`; }
    }));
    const reachable = probes.some(probe => probe.endsWith('respondeu'));
    if (!this.config.contentAuthorized) return status('unauthorized', reachable, `${probes.join(' · ')}. Defina ADULT_SITES_CONTENT_AUTHORIZED=true para reproduzir.`);
    if (!this.config.allowedStreamDomains?.length) return status('unauthorized', reachable, `${probes.join(' · ')}. Inclua googlevideo.com (e assistirhentai.com para o 720p) em ADULT_SITES_ALLOWED_STREAM_DOMAINS.`);
    return status(reachable ? 'available' : 'connection_error', reachable, `${probes.join(' · ')}. Vídeo pelo Blogger em 720p quando o envio é HD (senão 360p) e pelo servidor do Assistir Hentai quando ele hospeda o arquivo.`);
  }
}
