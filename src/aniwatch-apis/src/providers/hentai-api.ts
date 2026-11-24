import type { Playback, ProviderDiagnostic, ProviderState, StreamSource } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache } from '../config/cache.js';
import { integrationsConfig } from '../config/integrations.js';
import type { HentaiApiConfig } from '../config/integrations.js';
import { depictsMinors } from './adult-safety.js';
import { streamMediaGateway } from './stream-media.js';
import type { StreamMediaGateway } from './stream-media.js';

/**
 * HTTP client for the operator's own hentai-api instance (github.com/sulvii/hentai-api).
 * HPmovies never scrapes these sites itself. Every title and every franchise is
 * checked by the minors filter, and media URLs pass through the stream gateway
 * with the operator's domain allowlist.
 */

type HentaiProvider = 'hanime' | 'hentaihaven';
export interface HentaiEpisode { provider: HentaiProvider; key: string; number: number; title: string; thumbnail?: string }
interface Franchise { provider: HentaiProvider; title: string; episodes: HentaiEpisode[] }

const MAX_RESPONSE_BYTES = 2_000_000;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HH_SERIES = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const HH_EPISODE = /^[A-Za-z0-9+/]{4,600}={0,2}$/;
const PROVIDER_NAMES: Record<HentaiProvider, string> = { hanime: 'HAnime', hentaihaven: 'HentaiHaven' };

const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const string = (value: unknown, max = 500): string | undefined => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined;
const positive = (value: unknown): number | undefined => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 10_000 ? value : undefined;
const httpsUrl = (value: unknown): string | undefined => {
  const raw = string(value, 4096);
  if (!raw) return undefined;
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
};
const normalizeTitle = (value: string): string => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const notFound = () => new ApiError(404, 'HENTAI_API_NOT_FOUND', 'A hentai-api não encontrou este título no HAnime nem no HentaiHaven.');

/** A list in either the documented array shape or a paginated `{ results }` object. */
function list(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  const results = object(value)?.results;
  return Array.isArray(results) ? results : undefined;
}

/** Tags and genres as plain names; undefined when any entry is unreadable. */
function names(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.map(item => typeof item === 'string' ? item : string(object(item)?.text) ?? string(object(item)?.name));
  return result.every((item): item is string => typeof item === 'string') ? result : undefined;
}

function mediaType(url: string, ...hints: unknown[]): 'hls' | 'mp4' | undefined {
  const text = hints.filter((hint): hint is string => typeof hint === 'string').join(' ').toLowerCase();
  const path = new URL(url).pathname.toLowerCase();
  if (/m3u8|mpegurl/.test(text) || path.endsWith('.m3u8')) return 'hls';
  if (/mp4/.test(text) || path.endsWith('.mp4')) return 'mp4';
  return undefined;
}

interface Options { config?: HentaiApiConfig; fetcher?: typeof fetch; cache?: AniwatchAPICache; gateway?: Pick<StreamMediaGateway, 'issue'> }

export class HentaiApiProvider {
  readonly config: HentaiApiConfig;
  private readonly fetcher: typeof fetch;
  private readonly cache: AniwatchAPICache;
  private readonly gateway: Pick<StreamMediaGateway, 'issue'>;

  constructor(options: Options = {}) {
    this.config = options.config ?? integrationsConfig.hentaiApi;
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.cache ?? new AniwatchAPICache({ maxEntries: 256 });
    this.gateway = options.gateway ?? streamMediaGateway;
  }

  get enabled(): boolean { return this.config.enabled && !!this.config.baseUrl; }

  private async response(path: string): Promise<Response> {
    try {
      return await this.fetcher(`${this.config.baseUrl}${path}`, {
        headers: { Accept: 'application/json', ...(this.config.apiKey ? { 'x-api-key': this.config.apiKey } : {}) },
        redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new ApiError(504, 'HENTAI_API_TIMEOUT', 'A hentai-api demorou demais para responder.');
      throw new ApiError(503, 'HENTAI_API_CONNECTION_ERROR', 'Não foi possível conectar à hentai-api configurada em HENTAI_API_URL.');
    }
  }

  private json(path: string, ttl: number, refresh = false): Promise<unknown> {
    return this.cache.getOrSet(async () => {
      const response = await this.response(path);
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new ApiError(503, 'HENTAI_API_RATE_LIMIT', 'A hentai-api limitou as consultas (15 por minuto sem chave). Aguarde ou configure HENTAI_API_KEY.');
        if (response.status === 422) throw new ApiError(502, 'HENTAI_API_SCHEMA_ERROR', 'A hentai-api rejeitou a própria resposta. A versão publicada valida dados com schemas incompatíveis; use uma versão corrigida.');
        if (response.status >= 300 && response.status < 400) throw new ApiError(502, 'HENTAI_API_REDIRECT_REFUSED', 'A hentai-api respondeu com um redirecionamento não permitido.');
        if (response.status === 401 || response.status === 403) throw new ApiError(503, 'HENTAI_API_UNAUTHORIZED', 'A hentai-api recusou a chave configurada em HENTAI_API_KEY.');
        throw new ApiError(502, 'HENTAI_API_UPSTREAM_ERROR', 'A hentai-api não conseguiu consultar o site de origem.');
      }
      if (!/^application\/(?:[a-z0-9.-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE_BYTES) {
        await response.body?.cancel();
        throw new ApiError(502, 'HENTAI_API_INVALID_RESPONSE', 'A hentai-api respondeu com dados inesperados.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError(502, 'HENTAI_API_INVALID_RESPONSE', 'A hentai-api respondeu com dados inesperados.');
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new ApiError(502, 'HENTAI_API_INVALID_RESPONSE', 'A resposta da hentai-api excedeu o limite de tamanho.');
        }
        chunks.push(chunk.value);
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch {
        throw new ApiError(502, 'HENTAI_API_INVALID_RESPONSE', 'A hentai-api respondeu com dados inesperados.');
      }
    }, `hentai-api:${this.config.baseUrl}${path}`, ttl, refresh);
  }

  private status(state: ProviderState, technicalAvailable: boolean, message: string): ProviderDiagnostic {
    return {
      id: 'hentai-api', name: 'hentai-api', enabled: this.enabled, state, technicalAvailable,
      authorized: this.config.contentAuthorized, checkedAt: new Date().toISOString(), message, capabilities: ['adult-video'],
    };
  }

  async diagnostic(): Promise<ProviderDiagnostic> {
    if (!this.enabled) return this.status('unavailable', false, 'Configure HENTAI_API_URL com o endereço da sua instância da hentai-api.');
    try {
      const response = await this.response('/');
      await response.body?.cancel();
      if (!response.ok) return this.status('connection_error', false, `A hentai-api respondeu com HTTP ${response.status}.`);
    } catch (error) {
      return this.status('connection_error', false, error instanceof ApiError ? error.message : 'Não foi possível conectar à hentai-api.');
    }
    if (!this.config.contentAuthorized) return this.status('unauthorized', true, 'A hentai-api respondeu. Defina HENTAI_API_CONTENT_AUTHORIZED=true para reproduzir as fontes dela.');
    if (!this.config.allowedMediaHosts.length && !this.config.allowedStreamDomains?.length) {
      return this.status('unauthorized', true, 'A hentai-api respondeu. Informe os domínios de vídeo em HENTAI_API_ALLOWED_STREAM_DOMAINS ou HENTAI_API_ALLOWED_MEDIA_HOSTS.');
    }
    return this.status('available', true, 'A hentai-api respondeu. A disponibilidade de cada título depende dos sites que ela consulta.');
  }

  /** HAnime slugs derive from the franchise name; the published search route does not validate. */
  private async hanime(title: string): Promise<Franchise | 'blocked' | undefined> {
    const base = normalizeTitle(title).replaceAll(' ', '-');
    if (!base || base.length > 150 || !SLUG.test(base)) return undefined;
    let input: unknown;
    try { input = await this.json(`/api/hanime/${encodeURIComponent(`${base}-1`)}`, 3600); } catch (error) {
      if (error instanceof ApiError && ['HENTAI_API_UPSTREAM_ERROR', 'HENTAI_API_SCHEMA_ERROR'].includes(error.code)) return undefined;
      throw error;
    }
    const data = object(input);
    const name = string(data?.title);
    const tags = names(data?.tags);
    const all = object(data?.episodes)?.all;
    if (!data || !name || !Array.isArray(all)) return undefined;
    if (!tags || depictsMinors({ tags, texts: [name, string(data.description, 20_000), ...all.map(row => string(object(row)?.name))] })) return 'blocked';
    const episodes = new Map<number, HentaiEpisode>();
    all.forEach((row, index) => {
      const value = object(row);
      const slug = string(value?.slug, 200);
      if (!value || !slug || !SLUG.test(slug)) return;
      const number = Number(/-(\d{1,3})$/.exec(slug)?.[1] ?? index + 1);
      if (number > 0 && !episodes.has(number)) episodes.set(number, { provider: 'hanime', key: slug, number, title: string(value.name, 300) ?? `Episódio ${number}`, thumbnail: httpsUrl(value.thumbnailUrl) ?? httpsUrl(value.coverUrl) });
    });
    return episodes.size ? { provider: 'hanime', title: name, episodes: [...episodes.values()].sort((a, b) => a.number - b.number) } : undefined;
  }

  private async hentaiHaven(title: string): Promise<Franchise | 'blocked' | undefined> {
    const wanted = normalizeTitle(title);
    if (!wanted) return undefined;
    const results = list(await this.json(`/api/hh/search/${encodeURIComponent(title.slice(0, 120))}`, 3600)) ?? [];
    const match = results.map(object).find(row => {
      const candidates = [string(row?.title), ...(string(row?.alternative, 2000)?.split(/[,;/]/) ?? [])];
      return candidates.some(candidate => candidate && normalizeTitle(candidate) === wanted);
    });
    const id = string(match?.id, 200);
    if (!id || !HH_SERIES.test(id)) return undefined;
    const info = object(await this.json(`/api/hh/${encodeURIComponent(id)}`, 3600));
    const genres = names(info?.genres);
    const rows = info?.episodes;
    if (!info || !Array.isArray(rows)) return undefined;
    if (!genres || depictsMinors({ tags: genres, texts: [string(info.title), string(info.summary, 20_000), ...rows.map(row => string(object(row)?.title))] })) return 'blocked';
    const episodes = new Map<number, HentaiEpisode>();
    for (const row of rows) {
      const value = object(row);
      const key = string(value?.id, 600);
      const number = positive(value?.number);
      if (!value || !key || !HH_EPISODE.test(key) || !number || episodes.has(number)) continue;
      episodes.set(number, { provider: 'hentaihaven', key, number, title: string(value.title, 300) ?? `Episódio ${number}`, thumbnail: httpsUrl(value.thumbnail) });
    }
    return episodes.size ? { provider: 'hentaihaven', title: string(info.title) ?? title, episodes: [...episodes.values()].sort((a, b) => a.number - b.number) } : undefined;
  }

  /** The first franchise that matches a title and passes the minors filter. */
  private find(titles: string[]): Promise<Franchise> {
    const candidates = [...new Set(titles.map(title => title.trim()).filter(Boolean))].slice(0, 6);
    return this.cache.getOrSet(async () => {
      let blocked = false;
      let failure: ApiError | undefined;
      for (const lookup of [this.hanime.bind(this), this.hentaiHaven.bind(this)]) {
        for (const title of candidates) {
          try {
            const result = await lookup(title);
            if (result === 'blocked') blocked = true;
            else if (result) return result;
          } catch (error) {
            failure ??= error instanceof ApiError ? error : new ApiError(502, 'HENTAI_API_INVALID_RESPONSE', 'A hentai-api respondeu com dados inesperados.');
            if (['HENTAI_API_CONNECTION_ERROR', 'HENTAI_API_TIMEOUT', 'HENTAI_API_RATE_LIMIT', 'HENTAI_API_UNAUTHORIZED'].includes(failure.code)) throw failure;
          }
        }
      }
      if (blocked) throw new ApiError(404, 'ADULT_TITLE_BLOCKED', 'A fonte encontrada foi bloqueada: o HPmovies não exibe obras que retratam menores.');
      throw failure ?? notFound();
    }, `hentai-api:find:${JSON.stringify(candidates)}`, 3600);
  }

  async episodes(titles: string[]): Promise<HentaiEpisode[]> {
    if (!this.enabled) throw new ApiError(503, 'HENTAI_API_DISABLED', 'A hentai-api não foi configurada.');
    return (await this.find(titles)).episodes;
  }

  private source(provider: HentaiProvider, url: string | undefined, type: 'hls' | 'mp4' | undefined, label: string, height?: number): StreamSource | undefined {
    if (!url || !type) return undefined;
    try {
      return {
        url: this.gateway.issue(this.config, provider, url, type), type, label: `${PROVIDER_NAMES[provider]} · ${label}`,
        ...(height ? { height, quality: `${height}p` } : {}),
        providerId: `hentai-api:${provider}`, providerName: `${PROVIDER_NAMES[provider]} (hentai-api)`, subtitles: [], available: true,
      };
    } catch { return undefined; }
  }

  async playback(titles: string[], number: number, refresh = false): Promise<Playback> {
    if (!this.enabled) throw new ApiError(503, 'HENTAI_API_DISABLED', 'A hentai-api não foi configurada.');
    if (!this.config.contentAuthorized) throw new ApiError(503, 'HENTAI_API_UNAUTHORIZED', 'Defina HENTAI_API_CONTENT_AUTHORIZED=true para reproduzir as fontes da hentai-api.');
    const franchise = await this.find(titles);
    const episode = franchise.episodes.find(item => item.number === number);
    if (!episode) throw new ApiError(404, 'HENTAI_API_EPISODE_UNAVAILABLE', `A hentai-api não tem o episódio ${number} deste título.`);
    let rows: unknown[] = [];
    if (episode.provider === 'hanime') {
      const input = await this.json(`/api/hanime/streams/${encodeURIComponent(episode.key)}`, 300, refresh);
      rows = (list(input) ?? list(object(input)?.streams) ?? []).flatMap(row => {
        const value = object(row);
        const url = httpsUrl(value?.url);
        if (!value || !url) return [];
        const height = positive(value.height);
        return [this.source('hanime', url, mediaType(url, value.extension, value.mimeType, value.kind), height ? `${height}p` : 'qualidade automática', height)];
      });
    } else {
      const input = await this.json(`/api/hh/sources/${encodeURIComponent(episode.key)}`, 300, refresh);
      rows = (list(input) ?? list(object(input)?.sources) ?? []).flatMap(row => {
        const value = object(row);
        const url = httpsUrl(value?.src);
        if (!value || !url) return [];
        return [this.source('hentaihaven', url, mediaType(url, value.type), string(value.label, 60) ?? 'original')];
      });
    }
    const candidates = rows.filter((row): row is StreamSource => !!row);
    const sources = [...new Map(candidates.map(source => [source.url, source])).values()].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    if (!sources.length) {
      throw rows.length
        ? new ApiError(503, 'HENTAI_API_MEDIA_NOT_PERMITTED', 'A hentai-api retornou vídeos de domínios que não estão em HENTAI_API_ALLOWED_STREAM_DOMAINS ou HENTAI_API_ALLOWED_MEDIA_HOSTS.')
        : new ApiError(404, 'HENTAI_API_EPISODE_UNAVAILABLE', 'A hentai-api não retornou vídeo para este episódio.');
    }
    return {
      episode: { id: `hentai-api:${episode.provider}:${episode.number}`, title: episode.title, number: episode.number, thumbnail: episode.thumbnail, available: true },
      sources, subtitles: [], audioLanguages: [], isDemo: false,
    };
  }
}
