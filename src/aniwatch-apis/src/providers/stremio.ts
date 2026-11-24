import { isIP } from 'node:net';
import type {
  AnimeStreamingProvider, Playback, ProviderDiagnostic, ProviderState,
  StreamingAvailability, StreamingSource, StreamSubtitle,
} from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { RequestSlots } from '../config/requestSlots.js';
import { AniwatchAPICache } from '../config/cache.js';

/** Operator configuration. Addon payloads are never installed or executed. */
export interface StremioAddonConfig {
  id: string;
  name: string;
  manifestUrl: string;
  authorized: boolean;
  allowedMediaHosts: string[];
}

export interface StremioProviderOptions {
  addons: StremioAddonConfig[];
  fetcher?: typeof fetch;
  cache?: AniwatchAPICache;
  timeoutMs?: number;
  /** Explicitly permits a local addon and media served from its exact origin. */
  allowLoopback?: boolean;
}

interface StremioRequestIdentity {
  imdbId: string;
  provider?: string;
}

export type StremioPlaybackRequest = StremioRequestIdentity & (
  | { type?: 'series'; season: number; episode: number }
  | { type: 'movie'; season?: never; episode?: never }
);

interface ManifestResource {
  name: string;
  types?: string[];
  idPrefixes?: string[];
}

interface AddonManifest {
  types: string[];
  idPrefixes?: string[];
  resources: ManifestResource[];
  configurationRequired: boolean;
}

interface AddonResult {
  sources: StreamingSource[];
  diagnostic: ProviderDiagnostic;
  error?: ApiError;
}

const ADDON_ID = /^[a-z][a-z0-9-]{0,63}$/;
const IMDB_ID = /^tt\d{5,12}$/;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REQUESTS = 4;
const MAX_MP4_PROBE_BYTES = 65_536;
const MAX_MP4_PROBES = 8;
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const string = (value: unknown, max = 200): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
const invalid = (): never => { throw new ApiError(502, 'STREMIO_INVALID_RESPONSE', 'O addon Stremio respondeu com dados incompatíveis com o contrato JSON.'); };

function stringList(value: unknown, max = 64): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((item) => !string(item, 100))) return invalid();
  return value as string[];
}

function publicHostname(hostname: string): boolean {
  return !isIP(hostname.replace(/^\[|\]$/g, '')) && hostname.includes('.') &&
    !/(?:^|\.)(?:localhost|local|internal|invalid|test|lan|home|onion)$/.test(hostname) &&
    /^[a-z0-9.-]+$/.test(hostname) && !hostname.endsWith('.');
}

const loopbackHostname = (hostname: string): boolean => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);

function manifestUrl(raw: string, allowLoopback: boolean): string {
  try {
    const url = new URL(raw);
    const loopback = allowLoopback && loopbackHostname(url.hostname);
    if (url.username || url.password || url.hash || !url.pathname.endsWith('/manifest.json') ||
      (loopback ? !['http:', 'https:'].includes(url.protocol) :
        url.protocol !== 'https:' || (url.port && url.port !== '443') || !publicHostname(url.hostname))) throw new Error();
    return url.toString();
  } catch {
    throw new ApiError(400, 'STREMIO_INVALID_CONFIG', 'Configure uma URL HTTPS pública de manifesto Stremio válida.');
  }
}

function mediaUrl(raw: unknown, addon: StremioAddonConfig, allowLoopback: boolean): string | undefined {
  if (!string(raw, 8_192)) return undefined;
  try {
    const url = new URL(raw as string);
    const manifest = new URL(addon.manifestUrl);
    const localRelay = allowLoopback && loopbackHostname(manifest.hostname) && url.origin === manifest.origin;
    if (url.username || url.password || url.hash || (localRelay ? !['http:', 'https:'].includes(url.protocol) :
      url.protocol !== 'https:' || (url.port && url.port !== '443') || !publicHostname(url.hostname) || !addon.allowedMediaHosts.includes(url.hostname))) return undefined;
    return url.toString();
  } catch { return undefined; }
}

function normalizeLanguage(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(raw) || /^(?:sub|dub)$/i.test(raw)) return 'und';
  try { return Intl.getCanonicalLocales(raw)[0] ?? 'und'; } catch { return 'und'; }
}

function readManifest(input: unknown): AddonManifest {
  const data = object(input);
  if (!data || !string(data.id) || !string(data.name) || !string(data.version, 100) || !Array.isArray(data.resources) || data.resources.length > 64) return invalid();
  const types = stringList(data.types, 32);
  const resources = data.resources.map((value): ManifestResource => {
    if (typeof value === 'string' && string(value, 100)) return { name: value };
    const row = object(value);
    if (!row || !string(row.name, 100)) return invalid();
    return {
      name: row.name as string,
      ...(row.types === undefined ? {} : { types: stringList(row.types, 32) }),
      ...(row.idPrefixes === undefined ? {} : { idPrefixes: stringList(row.idPrefixes) }),
    };
  });
  const hints = data.behaviorHints === undefined ? {} : object(data.behaviorHints);
  if (!hints) return invalid();
  return {
    types, resources, configurationRequired: hints.configurationRequired === true,
    ...(data.idPrefixes === undefined ? {} : { idPrefixes: stringList(data.idPrefixes) }),
  };
}

function supportsStream(manifest: AddonManifest, type: string, id?: string): boolean {
  return manifest.resources.some((resource) => {
    const prefixes = resource.idPrefixes ?? manifest.idPrefixes;
    return resource.name === 'stream' && (resource.types ?? manifest.types).includes(type) &&
      (!id || !prefixes?.length || prefixes.some((prefix) => id.startsWith(prefix)));
  });
}

function validateRequest(request: StremioPlaybackRequest): void {
  if (!object(request) || !IMDB_ID.test(request.imdbId) || (request.type !== undefined && request.type !== 'series' && request.type !== 'movie') ||
    (request.type === 'movie' ? request.season !== undefined || request.episode !== undefined :
      !Number.isInteger(request.season) || request.season < 0 || request.season > 1_000 ||
      !Number.isInteger(request.episode) || request.episode < 1 || request.episode > 100_000) ||
    (request.provider !== undefined && !ADDON_ID.test(request.provider))) {
    throw new ApiError(400, 'INVALID_STREMIO_EPISODE', 'Informe IMDb, temporada e episódio válidos para o addon Stremio.');
  }
}

export function stremioEpisodeId(provider: string | undefined, request: StremioPlaybackRequest): string {
  validateRequest({ ...request, provider });
  return request.type === 'movie' ? `stremio:${provider ?? 'all'}:movie:${request.imdbId}`
    : `stremio:${provider ?? 'all'}:${request.imdbId}:${request.season}:${request.episode}`;
}

export function parseStremioEpisodeId(id: string): StremioPlaybackRequest {
  const movie = /^stremio:([a-z][a-z0-9-]{0,63}):movie:(tt\d{5,12})$/.exec(id);
  if (movie) {
    const request: StremioPlaybackRequest = { type: 'movie', imdbId: movie[2], ...(movie[1] === 'all' ? {} : { provider: movie[1] }) };
    validateRequest(request);
    return request;
  }
  const match = /^stremio:([a-z][a-z0-9-]{0,63}):(tt\d{5,12}):(0|[1-9]\d{0,3}):([1-9]\d{0,5})$/.exec(id);
  if (!match) throw new ApiError(400, 'INVALID_STREMIO_EPISODE', 'Identificador de episódio Stremio inválido.');
  const request = { ...(match[1] === 'all' ? {} : { provider: match[1] }), imdbId: match[2], season: Number(match[3]), episode: Number(match[4]) };
  validateRequest(request);
  return request;
}

/** No headers or secondary transports from stream metadata are replayed. */
function requiresHeaders(data: Record<string, unknown>): boolean {
  for (const key of ['headers', 'requestHeaders', 'responseHeaders']) {
    if (data[key] !== undefined && (!object(data[key]) || Object.keys(data[key] as object).length > 0)) return true;
  }
  if (data.behaviorHints !== undefined) {
    const hints = object(data.behaviorHints);
    if (!hints) return true;
    for (const key of ['proxyHeaders', 'headers']) {
      if (hints[key] !== undefined && (!object(hints[key]) || Object.keys(hints[key] as object).length > 0)) return true;
    }
  }
  return false;
}

function normalizeStream(input: unknown, addon: StremioAddonConfig, index: number, allowLoopback: boolean): { source: StreamingSource; probe: boolean } | undefined {
  const row = object(input);
  if (!row || ['infoHash', 'fileIdx', 'fileIndex', 'externalUrl', 'authUrl', 'ytId', 'magnetLink'].some((key) => key in row) || requiresHeaders(row)) return undefined;
  const url = mediaUrl(row.url, addon, allowLoopback);
  if (!url) return undefined;
  const path = new URL(url).pathname;
  // FMHY's signed progressive relay ends in media.bin. Inspect its media rather
  // than treating an arbitrary binary file as browser-compatible MP4.
  const probe = /\/media\.bin$/i.test(path) && new URL(url).origin === new URL(addon.manifestUrl).origin;
  const type = /\.m3u8$/i.test(path) ? 'hls' : /\.mp4$/i.test(path) || probe ? 'mp4' : undefined;
  if (!type) return undefined;
  const subtitles = (Array.isArray(row.subtitles) ? row.subtitles.slice(0, 100) : []).flatMap((value, trackIndex): StreamSubtitle[] => {
    const track = object(value);
    if (!track || requiresHeaders(track)) return [];
    const subtitleUrl = mediaUrl(track.url, addon, allowLoopback);
    if (!subtitleUrl) return [];
    const language = normalizeLanguage(track.lang ?? track.language);
    const extension = /\.(vtt|srt|ass)$/i.exec(new URL(subtitleUrl).pathname)?.[1]?.toLowerCase() as StreamSubtitle['format'];
    return [{
      id: `stremio-${addon.id}-${index}-${trackIndex}`, url: subtitleUrl,
      language, label: string(track.label, 100) ?? (language === 'und' ? 'Legenda sem identificação' : language),
      kind: 'subtitles', ...(extension ? { format: extension } : {}), default: track.default === true,
    }];
  });
  return { probe, source: {
    url, type, providerId: addon.id, providerName: addon.name,
    label: string(row.name) ?? addon.name, audioLanguage: normalizeLanguage(row.audioLanguage ?? row.language),
    subtitles, available: true,
  } };
}

async function pool<T, R>(values: readonly T[], work: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(MAX_REQUESTS, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await work(values[index]);
    }
  }));
  return results;
}

export class StremioStreamingProvider implements AnimeStreamingProvider {
  hasConfiguredAddons(): boolean { return this.addons.length > 0; }
  private readonly addons: StremioAddonConfig[];
  private readonly fetcher: typeof fetch;
  private readonly cache: AniwatchAPICache;
  private readonly timeoutMs: number;
  private readonly allowLoopback: boolean;
  private readonly slots = new RequestSlots(MAX_REQUESTS, 20_000, () => new ApiError(503, 'STREMIO_BUSY', 'Há outras consultas Stremio em andamento. Tente novamente.'));

  constructor(options: StremioProviderOptions) {
    this.allowLoopback = options.allowLoopback === true;
    if (!Array.isArray(options.addons) || options.addons.length > 8) throw new ApiError(400, 'STREMIO_INVALID_CONFIG', 'Configure no máximo oito addons Stremio.');
    this.addons = options.addons.map((addon) => {
      if (!object(addon) || !ADDON_ID.test(addon.id) || addon.id === 'all' || !string(addon.name, 120) || typeof addon.authorized !== 'boolean' ||
        !Array.isArray(addon.allowedMediaHosts) || addon.allowedMediaHosts.length > 100 ||
        addon.allowedMediaHosts.some((host) => typeof host !== 'string' || !publicHostname(host.toLowerCase()))) {
        throw new ApiError(400, 'STREMIO_INVALID_CONFIG', 'Identificador, nome, permissão ou domínios do addon Stremio inválidos.');
      }
      return {
        ...addon, manifestUrl: manifestUrl(addon.manifestUrl, options.allowLoopback === true),
        allowedMediaHosts: [...new Set(addon.allowedMediaHosts.map((host) => host.toLowerCase()))],
      };
    });
    if (new Set(this.addons.map((addon) => addon.id)).size !== this.addons.length) throw new ApiError(400, 'STREMIO_INVALID_CONFIG', 'Os identificadores de addons Stremio precisam ser únicos.');
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.cache ?? new AniwatchAPICache({ maxEntries: 128 });
    const timeout = options.timeoutMs ?? 35_000;
    if (!Number.isInteger(timeout) || timeout < 250 || timeout > 45_000) throw new ApiError(400, 'STREMIO_INVALID_CONFIG', 'Tempo limite Stremio inválido.');
    this.timeoutMs = timeout;
  }

  private async json<T>(url: string, parse: (input: unknown) => T, ttl: number, refresh = false): Promise<T> {
    // Requests beyond the limit wait in order for a free slot instead of failing immediately.
    return this.cache.getOrSet(() => this.slots.run(async () => {
      try {
        const response = await this.fetcher(url, {
          headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer',
          redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok || response.redirected) {
          await response.body?.cancel();
          if (response.redirected || response.status >= 300 && response.status < 400) throw new ApiError(502, 'STREMIO_REDIRECT_REFUSED', 'O addon respondeu com um redirecionamento não permitido.');
          if (response.status === 401 || response.status === 403) throw new ApiError(503, 'STREMIO_UNAUTHORIZED', 'O addon Stremio recusou o acesso à consulta.');
          if (response.status === 404) throw new ApiError(404, 'STREMIO_NOT_FOUND', 'O recurso solicitado não foi encontrado no addon Stremio.');
          throw new ApiError(503, 'STREMIO_UPSTREAM_UNAVAILABLE', 'O addon Stremio está temporariamente indisponível.');
        }
        if (!/^application\/(?:[a-z0-9.-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '')) {
          await response.body?.cancel();
          return invalid();
        }
        if (Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE_BYTES) {
          await response.body?.cancel();
          throw new ApiError(502, 'STREMIO_RESPONSE_TOO_LARGE', 'A resposta Stremio excedeu o limite de tamanho.');
        }
        const reader = response.body?.getReader();
        if (!reader) return invalid();
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new ApiError(502, 'STREMIO_RESPONSE_TOO_LARGE', 'A resposta Stremio excedeu o limite de tamanho.');
          }
          chunks.push(chunk.value);
        }
        let data: unknown;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return invalid(); }
        return parse(data);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new ApiError(504, 'STREMIO_TIMEOUT', 'O addon Stremio demorou demais para responder.');
        throw new ApiError(503, 'STREMIO_CONNECTION_ERROR', 'Não foi possível conectar ao addon Stremio.');
      }
    }), `stremio:http:${url}`, ttl, refresh);
  }

  private manifest(addon: StremioAddonConfig): Promise<AddonManifest> {
    return this.json(addon.manifestUrl, readManifest, 120);
  }

  private hasMediaPermission(addon: StremioAddonConfig): boolean {
    return addon.authorized && (addon.allowedMediaHosts.length > 0 ||
      this.allowLoopback && loopbackHostname(new URL(addon.manifestUrl).hostname));
  }

  /** Bounded, credential-free inspection of a relay from the configured origin. */
  private async probeMp4(url: string): Promise<boolean> {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 8_000));
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetcher(url, {
        headers: { Accept: 'video/mp4', Range: `bytes=0-${MAX_MP4_PROBE_BYTES - 1}` },
        redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      if (![200, 206].includes(response.status) || response.redirected || !/^video\/mp4\b/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel();
        return false;
      }
      reader = response.body?.getReader();
      if (!reader) return false;
      const prefix = new Uint8Array(12);
      let length = 0;
      while (length < prefix.length) {
        const chunk = await reader.read();
        if (chunk.done) return false;
        const bytes = chunk.value.subarray(0, prefix.length - length);
        prefix.set(bytes, length); length += bytes.byteLength;
      }
      return new DataView(prefix.buffer).getUint32(0) >= 12 && new TextDecoder().decode(prefix.subarray(4, 8)) === 'ftyp';
    } catch { return false; }
    finally {
      await reader?.cancel().catch(() => {});
      clearTimeout(deadline);
    }
  }

  private status(addon: StremioAddonConfig, state: ProviderState, technicalAvailable: boolean, message: string, capabilities: string[] = ['stremio-http']): ProviderDiagnostic {
    return {
      id: `stremio:${addon.id}`, name: addon.name, enabled: true, state,
      technicalAvailable, authorized: addon.authorized, checkedAt: new Date().toISOString(), message, capabilities,
    };
  }

  private errorDiagnostic(addon: StremioAddonConfig, error: ApiError): ProviderDiagnostic {
    return this.status(addon, error.code === 'STREMIO_UNAUTHORIZED' ? 'unauthorized' : error.status === 404 ? 'unavailable' : 'connection_error', false, error.message);
  }

  async diagnostics(): Promise<ProviderDiagnostic[]> {
    return pool(this.addons, async (addon) => {
      try {
        const manifest = await this.manifest(addon);
        const types = ['series', 'movie'].filter((type) => supportsStream(manifest, type));
        if (!types.length) return this.status(addon, 'unavailable', true, 'O manifesto respondeu, mas oferece apenas catálogo, metadados ou recursos sem streaming.');
        const capabilities = ['stremio-http', ...types.map((type) => `stream-${type}`)];
        if (manifest.configurationRequired) return this.status(addon, 'unauthorized', true, 'O addon exige uma URL de manifesto configurada pelo operador.', capabilities);
        if (!this.hasMediaPermission(addon)) return this.status(addon, 'unauthorized', true, 'O manifesto respondeu; configure a permissão de conteúdo e os domínios de mídia deste addon.', capabilities);
        return this.status(addon, 'available', true, 'O addon declara streaming por HTTP. Isso não confirma a disponibilidade ou a identidade da mídia.', capabilities);
      } catch (error) {
        return this.errorDiagnostic(addon, error as ApiError);
      }
    });
  }

  async diagnostic(): Promise<ProviderDiagnostic> {
    const diagnostics = await this.diagnostics();
    const chosen = diagnostics.find((item) => item.state === 'available') ?? diagnostics.find((item) => item.state === 'unauthorized') ?? diagnostics[0];
    return {
      id: 'stremio', name: 'Stremio HTTP', enabled: this.addons.length > 0,
      state: chosen?.state ?? 'unavailable', technicalAvailable: diagnostics.some((item) => item.technicalAvailable),
      authorized: this.addons.some((addon) => this.hasMediaPermission(addon)),
      checkedAt: new Date().toISOString(), message: chosen?.message ?? 'Nenhum addon Stremio foi configurado.',
      capabilities: [...new Set(diagnostics.flatMap((item) => item.capabilities))],
    };
  }

  async episodes(_animeId: string): Promise<StreamingAvailability> {
    void _animeId;
    // AniList IDs and episode counts are not IMDb season/episode mappings.
    const diagnostic = await this.diagnostic();
    return {
      available: false, episodes: [], state: diagnostic.state === 'available' ? 'unavailable' : diagnostic.state,
      message: 'A reprodução Stremio requer o IMDb, a temporada e o episódio explícitos; o addon não fornece um índice de episódios AniList.',
      diagnostics: [diagnostic],
    };
  }

  private async resolve(addon: StremioAddonConfig, request: StremioPlaybackRequest, refresh: boolean): Promise<AddonResult> {
    try {
      const manifest = await this.manifest(addon);
      const type = request.type ?? 'series';
      const id = request.type === 'movie' ? request.imdbId : `${request.imdbId}:${request.season}:${request.episode}`;
      if (manifest.configurationRequired) throw new ApiError(503, 'STREMIO_UNAUTHORIZED', 'O addon exige uma URL de manifesto configurada pelo operador.');
      if (!supportsStream(manifest, type, id)) {
        const message = 'O manifesto deste addon não oferece streaming para esse tipo e identificador IMDb.';
        return { sources: [], diagnostic: this.status(addon, 'unavailable', true, message), error: new ApiError(404, 'STREMIO_STREAM_UNSUPPORTED', message) };
      }
      const url = new URL(addon.manifestUrl);
      url.pathname = url.pathname.slice(0, -'/manifest.json'.length) + `/stream/${type}/${encodeURIComponent(id)}.json`;
      const rows = await this.json(url.toString(), (input) => {
        const data = object(input);
        if (!data || !Array.isArray(data.streams) || data.streams.length > 500) return invalid();
        return data.streams as unknown[];
      }, 30, refresh);
      const normalized = rows.flatMap((row, index) => {
        const result = normalizeStream(row, addon, index, this.allowLoopback);
        return result ? [result] : [];
      });
      const candidates = [...new Map(normalized.map(result => [`${result.source.type}:${result.source.url}`, result])).values()];
      const ambiguous = candidates.filter(result => result.probe).slice(0, MAX_MP4_PROBES);
      const inspected = await pool(ambiguous, async result => ({ result, valid: await this.probeMp4(result.source.url) }));
      const validMp4 = new Set(inspected.filter(result => result.valid).map(result => result.result.source.url));
      const sources = candidates.filter(result => !result.probe || validMp4.has(result.source.url)).map(result => result.source);
      if (!sources.length) {
        const message = rows.length ? 'O addon retornou fontes incompatíveis com reprodução direta e os domínios configurados.' : 'O addon não retornou mídia para este episódio.';
        return {
          sources, diagnostic: this.status(addon, rows.length ? 'unauthorized' : 'empty', true, message),
          error: new ApiError(rows.length ? 503 : 404, rows.length ? 'STREMIO_DIRECT_SOURCE_REQUIRED' : 'STREMIO_EPISODE_UNAVAILABLE', message),
        };
      }
      return { sources, diagnostic: this.status(addon, 'available', true, 'O addon retornou fontes diretas para a consulta. A identidade do conteúdo depende da fonte.', ['stremio-http', `stream-${type}`]) };
    } catch (error) {
      return { sources: [], diagnostic: this.errorDiagnostic(addon, error as ApiError), error: error as ApiError };
    }
  }

  async playback(input: StremioPlaybackRequest | string, _titles?: string[], refresh = false): Promise<Playback> {
    const request = typeof input === 'string' ? parseStremioEpisodeId(input) : input;
    validateRequest(request);
    const configured = request.provider ? this.addons.filter((addon) => addon.id === request.provider) : this.addons;
    if (!configured.length) throw new ApiError(404, 'STREMIO_ADDON_NOT_FOUND', 'Nenhum addon Stremio corresponde à consulta.');
    const permitted = configured.filter((addon) => this.hasMediaPermission(addon));
    if (!permitted.length) throw new ApiError(503, 'STREMIO_UNAUTHORIZED', 'Nenhum addon Stremio possui permissão de conteúdo e domínios de mídia configurados.');
    const results = await pool(permitted, (addon) => this.resolve(addon, request, refresh));
    const sources = results.flatMap((result) => result.sources);
    if (!sources.length) throw results.find((result) => result.error?.status !== 404)?.error ?? results[0].error ?? new ApiError(404, 'STREMIO_EPISODE_UNAVAILABLE', 'Nenhuma mídia Stremio foi encontrada para este episódio.');
    const subtitles = [...new Map(sources.flatMap((source) => source.subtitles).map((track) => [`${track.url}:${track.language}`, track])).values()];
    subtitles.sort((a, b) => Number(b.language === 'pt-BR') - Number(a.language === 'pt-BR'));
    return {
      episode: {
        id: stremioEpisodeId(request.provider, request),
        title: request.type === 'movie' ? `Filme · ${request.imdbId}` : `Episódio ${request.episode} · temporada ${request.season}`,
        ...(request.type === 'movie' ? {} : { number: request.episode }), available: true,
      },
      sources, subtitles, audioLanguages: [...new Set(sources.map((source) => source.audioLanguage).filter((language): language is string => !!language && language !== 'und'))],
      isDemo: false, diagnostics: results.map((result) => result.diagnostic),
    };
  }
}
