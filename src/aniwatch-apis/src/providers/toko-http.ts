import { setTimeout as delay } from 'node:timers/promises';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache } from '../config/cache.js';
import type { TokoConfig } from '../config/integrations.js';

export interface TokoHealth {
  ok: boolean;
  service: string;
  toko: boolean;
}

export interface TokoSubtitle {
  url: string;
  label: string;
  language: string;
  default?: boolean;
}

export interface TokoStream {
  url: string;
  type: string;
  providerKey: string;
  providerName: string;
  quality?: string;
  audioLanguage?: string;
  subtitles: TokoSubtitle[];
  requiresHeaders: boolean;
}

export interface TokoStreamResponse {
  sources: TokoStream[];
  providerStatus: Array<{ provider: string; status: string }>;
}

export interface TokoEpisodeIndex {
  provider: string | null;
  episodeCount: number;
  episodes: Array<{ number: number; title?: string }>;
}

export interface TokoLanguage {
  language: string;
  label: string;
  type: 'audio' | 'subtitle';
}

export interface TokoChapter {
  chapterKey: string;
  provider: string;
  providerChapterId?: string;
  number?: string;
  title?: string;
  language?: string;
  scanlator?: string;
  translator?: string;
}

export interface TokoChapterList {
  chapters: TokoChapter[];
  chapterCount: number;
}

export interface TokoPage {
  pageNumber: number;
  imageUrl: string;
  requiresHeaders: boolean;
}

export interface TokoNovelContent {
  title?: string;
  provider?: string;
  paragraphs: Array<{ index: number; text: string }>;
}

export interface TokoClientOptions {
  fetcher?: typeof fetch;
  cache?: AniwatchAPICache;
  retryDelayMs?: number;
}

function invalid(): never {
  throw new ApiError(502, 'TOKO_INVALID_RESPONSE', 'O Toko respondeu com dados incompatíveis com o contrato HTTP verificado.');
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const list = (value: unknown, max = 5_000): unknown[] => {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
};
const text = (value: unknown, max = 500): string | undefined => typeof value === 'string' && value.length <= max ? value : undefined;
const count = (value: unknown, max = 100_000): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) return invalid();
  return value;
};

/**
 * Independent HTTP implementation of Toko's documented JSON interface.
 * No bundle, extension, scraper, torrent or browser code is imported.
 */
export class TokoHttpClient {
  private readonly fetcher: typeof fetch;
  private readonly cache: AniwatchAPICache;
  private readonly retryDelayMs: number;
  private activeRequests = 0;
  private readonly issuedChapters = new Map<string, number>();

  constructor(readonly config: TokoConfig, options: TokoClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.cache ?? new AniwatchAPICache({ maxEntries: 128 });
    this.retryDelayMs = Math.max(0, Math.min(options.retryDelayMs ?? 150, 1_000));
  }

  private async json<T>(path: string, params: URLSearchParams, parse: (input: unknown) => T, ttl: number, scope = ''): Promise<T> {
    if (!this.config.enabled) throw new ApiError(503, 'TOKO_DISABLED', 'A integração HTTP do Toko está desativada.');
    // Paths are constants from verified endpoints; untrusted values only enter query parameters.
    const base = this.config.baseUrl.replace(/\/api\/v3\/?$/, '');
    const url = new URL(`${base}${path}`);
    params.sort();
    url.search = params.toString();
    return this.cache.getOrSet(async () => {
      if (this.activeRequests >= 4) throw new ApiError(503, 'TOKO_BUSY', 'O Toko já está verificando outras consultas. Tente novamente.');
      this.activeRequests++;
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await this.fetcher(url.toString(), {
              headers: { Accept: 'application/json' },
              redirect: 'manual',
              signal: AbortSignal.timeout(this.config.timeoutMs),
            });
            if (!response.ok) await response.body?.cancel();
            if (response.status === 401 || response.status === 403) {
              throw new ApiError(503, 'TOKO_UNAUTHORIZED', 'O serviço Toko recusou o acesso à integração.');
            }
            if (response.status >= 300 && response.status < 400) {
              throw new ApiError(502, 'TOKO_REDIRECT_REFUSED', 'O serviço Toko respondeu com um redirecionamento não permitido.');
            }
            if (response.status === 404) throw new ApiError(404, 'TOKO_NOT_FOUND', 'O recurso solicitado não foi encontrado no Toko.');
            if (!response.ok) {
              if (response.status === 429 || response.status >= 500) {
                throw new ApiError(503, 'TOKO_UPSTREAM_UNAVAILABLE', 'O Toko está temporariamente indisponível.');
              }
              throw new ApiError(502, 'TOKO_UPSTREAM_ERROR', 'O serviço Toko não aceitou a consulta.');
            }
            const contentType = response.headers.get('content-type') ?? '';
            if (!/^application\/(?:[a-z0-9.-]+\+)?json\b/i.test(contentType)) {
              await response.body?.cancel();
              return invalid();
            }
            const declared = Number(response.headers.get('content-length') ?? 0);
            if (declared > 2_000_000) {
              await response.body?.cancel();
              throw new ApiError(502, 'TOKO_RESPONSE_TOO_LARGE', 'A resposta do Toko excedeu o limite de tamanho.');
            }
            const reader = response.body?.getReader();
            if (!reader) return invalid();
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > 2_000_000) {
                await reader.cancel();
                throw new ApiError(502, 'TOKO_RESPONSE_TOO_LARGE', 'A resposta do Toko excedeu o limite de tamanho.');
              }
              chunks.push(chunk.value);
            }
            let payload: unknown;
            try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return invalid(); }
            return parse(payload);
          } catch (error) {
            const normalized = error instanceof ApiError ? error
              : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
                ? new ApiError(504, 'TOKO_TIMEOUT', 'O Toko demorou demais para responder.')
                : new ApiError(503, 'TOKO_CONNECTION_ERROR', 'Não foi possível conectar ao serviço Toko.');
            const retryable = ['TOKO_TIMEOUT', 'TOKO_CONNECTION_ERROR', 'TOKO_UPSTREAM_UNAVAILABLE'].includes(normalized.code);
            if (!retryable || attempt >= this.config.retries) throw normalized;
            await delay(this.retryDelayMs * (attempt + 1));
          }
        }
      } finally {
        this.activeRequests--;
      }
    }, `toko:http:${scope}:${url.toString()}`, ttl);
  }

  private query(anilistId: number): URLSearchParams {
    if (!Number.isSafeInteger(anilistId) || anilistId <= 0 || anilistId > 2_147_483_647) {
      throw new ApiError(400, 'INVALID_ANIME_ID', 'Informe um identificador AniList válido.');
    }
    return new URLSearchParams({ anilistId: String(anilistId), stream: '0' });
  }

  health(): Promise<TokoHealth> {
    return this.json('/api/v3/health', new URLSearchParams(), (input) => {
      const data = object(input);
      if (typeof data.ok !== 'boolean' || typeof data.toko !== 'boolean' || data.service !== 'toko-api') return invalid();
      return { ok: data.ok, toko: data.toko, service: data.service };
    }, 15);
  }

  async ready(): Promise<void> {
    const health = await this.health();
    if (!health.ok || !health.toko) throw new ApiError(503, 'TOKO_NOT_READY', 'O HTTP do Toko está ativo, mas seu bundle de provedores não está pronto.');
  }

  episodes(anilistId: number): Promise<TokoEpisodeIndex> {
    return this.json('/api/v3/toko/index/episodes', this.query(anilistId), (input) => {
      const data = object(input);
      return {
        provider: text(data.provider) ?? null,
        episodeCount: count(data.episodeCount),
        episodes: list(data.episodes, 5_000).map((item) => {
          const row = object(item);
          if (typeof row.number !== 'number' || !Number.isFinite(row.number) || row.number <= 0 || row.number > 100_000) return invalid();
          return { number: row.number, title: text(row.title) };
        }),
      };
    }, 120);
  }

  languages(anilistId: number): Promise<TokoLanguage[]> {
    return this.json('/api/v3/toko/languages', this.query(anilistId), (input) => list(object(input).languages, 300).map((item) => {
      const row = object(item);
      const language = text(row.language, 64);
      const label = text(row.label, 100);
      if (!language || !label || !['audio', 'subtitle'].includes(String(row.type))) return invalid();
      return { language, label, type: row.type as 'audio' | 'subtitle' };
    }), 120);
  }

  streams(anilistId: number, episode: number): Promise<TokoStreamResponse> {
    if (!this.config.contentAuthorized || !this.config.allowedProviders.length || !this.config.allowedMediaHosts.length) {
      throw new ApiError(503, 'TOKO_UNAUTHORIZED', 'Nenhuma fonte autorizada foi configurada para reprodução no Toko.');
    }
    if (!Number.isFinite(episode) || episode <= 0 || episode > 100_000) throw new ApiError(400, 'INVALID_EPISODE', 'Episódio inválido.');
    const params = this.query(anilistId);
    params.set('episode', String(episode));
    // The verified API supports these bounded runner controls, but no provider filter.
    params.set('maxConcurrency', '2');
    params.set('maxRetries', '0');
    params.set('timeoutMs', String(Math.max(250, this.config.timeoutMs - 250)));
    return this.json('/api/v3/toko/stream', params, (input) => {
      const data = object(input);
      const sources = list(data.sources, 2_000).map((item): TokoStream => {
        const row = object(item);
        const url = text(row.url, 8_192);
        const type = text(row.type, 30);
        if (!url || !type) return invalid();
        return {
          url, type,
          providerKey: text(row.providerKey, 150) ?? '',
          providerName: text(row.providerName, 150) ?? text(row.source, 150) ?? '',
          quality: text(row.quality, 50),
          audioLanguage: text(row.audioLanguage, 64),
          requiresHeaders: !!row.headers && Object.keys(object(row.headers)).length > 0,
          subtitles: (row.subtitles === undefined ? [] : list(row.subtitles, 100)).map((track) => {
            const subtitle = object(track);
            const subtitleUrl = text(subtitle.url, 8_192);
            if (!subtitleUrl) return invalid();
            return {
              url: subtitleUrl,
              label: text(subtitle.label, 100) ?? 'Legenda sem identificação',
              language: text(subtitle.language, 64) ?? 'und',
              default: subtitle.default === true,
            };
          }),
        };
      });
      return {
        sources,
        providerStatus: (data.providerStatus === undefined ? [] : list(data.providerStatus, 500)).map((item) => {
          const row = object(item);
          return { provider: text(row.provider) ?? text(row.providerName) ?? 'toko', status: text(row.status, 64) ?? 'unknown' };
        }),
      };
    }, 30);
  }

  private requireContentProvider(provider: string): void {
    if (!this.config.contentAuthorized || !this.config.allowedProviders.includes(provider)) {
      throw new ApiError(503, 'TOKO_UNAUTHORIZED', 'Esta fonte não possui permissão de conteúdo configurada.');
    }
  }

  /** Available to future permitted adapters; never activated by catalog metadata alone. */
  async chapters(kind: 'manga' | 'novel', anilistId: number, permittedProvider: string): Promise<TokoChapterList> {
    this.requireContentProvider(permittedProvider);
    const result = await this.json(`/api/v3/toko/${kind}/chapters`, this.query(anilistId), (input) => {
      const data = object(input);
      const chapterCount = count(data.chapterCount);
      const chapters = list(data.chapters).map((item): TokoChapter => {
        const row = object(item);
        const chapterKey = text(row.chapterKey, 4_096);
        const provider = text(row.provider, 150);
        if (!chapterKey || !provider) return invalid();
        return {
          chapterKey, provider,
          providerChapterId: text(row.providerChapterId, 4_096),
          number: typeof row.number === 'number' ? String(row.number) : text(row.number, 64),
          title: text(row.title), language: text(row.language, 64),
          scanlator: text(row.scanlator), translator: text(row.translator),
        };
      }).filter((chapter) => chapter.provider === permittedProvider);
      return { chapters, chapterCount: chapters.length < chapterCount ? chapters.length : chapterCount };
    }, 120, permittedProvider);
    // A chapter request must refer to a key actually issued by this provider's
    // listing, so this interface cannot turn a caller-supplied URL into a fetch.
    const now = Date.now();
    for (const [key, expiresAt] of this.issuedChapters) if (expiresAt <= now) this.issuedChapters.delete(key);
    for (const chapter of result.chapters) this.issuedChapters.set(`${kind}:${permittedProvider}:${chapter.chapterKey}`, now + 600_000);
    while (this.issuedChapters.size > 20_000) this.issuedChapters.delete(this.issuedChapters.keys().next().value!);
    return result;
  }

  private chapterQuery(kind: 'manga' | 'novel', chapterKey: string, provider: string): URLSearchParams {
    this.requireContentProvider(provider);
    if (chapterKey.length > 4_096 || !chapterKey.startsWith(`${provider}:`) || chapterKey.length <= provider.length + 1) {
      throw new ApiError(400, 'INVALID_CHAPTER_KEY', 'Identificador de capítulo inválido.');
    }
    if ((this.issuedChapters.get(`${kind}:${provider}:${chapterKey}`) ?? 0) <= Date.now()) {
      throw new ApiError(400, 'UNKNOWN_CHAPTER_KEY', 'O capítulo deve ser obtido primeiro na listagem autorizada deste provedor.');
    }
    return new URLSearchParams({ chapterKey, provider, stream: '0' });
  }

  mangaPages(chapterKey: string, provider: string): Promise<TokoPage[]> {
    return this.json('/api/v3/toko/manga/pages', this.chapterQuery('manga', chapterKey, provider), (input) => list(object(input).pages, 1_000).map((item) => {
      const row = object(item);
      const imageUrl = text(row.imageUrl, 8_192);
      if (!imageUrl) return invalid();
      return { pageNumber: count(row.pageNumber, 1_000), imageUrl, requiresHeaders: !!row.headers && Object.keys(object(row.headers)).length > 0 };
    }), 30);
  }

  novelContent(chapterKey: string, provider: string): Promise<TokoNovelContent> {
    return this.json('/api/v3/toko/novel/content', this.chapterQuery('novel', chapterKey, provider), (input) => {
      const data = object(input);
      if (data.provider !== undefined && data.provider !== null && data.provider !== provider) return invalid();
      return {
        title: text(data.title), provider,
        paragraphs: list(data.paragraphs, 10_000).map((item) => {
          const row = object(item);
          const paragraph = text(row.text, 100_000);
          if (paragraph === undefined) return invalid();
          return { index: count(row.index), text: paragraph };
        }),
      };
    }, 120);
  }
}
