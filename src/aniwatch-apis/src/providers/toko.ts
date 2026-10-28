import type {
  AnimeStreamingProvider, Playback, ProviderDiagnostic, ProviderState,
  StreamingAvailability, StreamingEpisode, StreamingSource, StreamSubtitle,
} from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { integrationsConfig, normalizeProviderKey } from '../config/integrations.js';
import type { TokoConfig } from '../config/integrations.js';
import { TokoHttpClient } from './toko-http.js';
import type { TokoStream } from './toko-http.js';
import { streamMediaGateway } from './stream-media.js';
import { isKnownSourceMismatch } from './source-mismatches.js';

export interface TokoStreamingOptions {
  config?: TokoConfig;
  client?: TokoHttpClient;
  id?: string;
  name?: string;
  /** Fixtures may inject transport verification; production always probes scoped tickets. */
  probe?: (source: StreamingSource, signal: AbortSignal) => Promise<void>;
  probeBudgetMs?: number;
}

/** Only explicit language metadata is trusted. A label such as "sub" is unknown. */
export function normalizeTokoLanguage(value: string | undefined): string {
  const explicitNames: Record<string, string> = {
    english: 'en', 'english(cr english)': 'en', 'english(cc)': 'en', 'english(forced)': 'en', japanese: 'ja',
    'portuguese(brazil)': 'pt-BR', 'português(brasil)': 'pt-BR',
    'portuguese(cr portuguese(brazil))': 'pt-BR',
    'portuguese(cr portuguese)': 'pt',
    'portuguese(-português(brasil))': 'pt-BR',
    'portuguese(-portuguese(brazil))': 'pt-BR', 'portuguese(-portugues(brasil))': 'pt-BR',
    'portuguese(-brazilian)': 'pt-BR', 'brazilian portuguese': 'pt-BR',
    'portuguese(portuguese-brazilian[full])': 'pt-BR', 'portuguese(portuguese-brazilian)': 'pt-BR',
    'portuguese(portuguese-[full])': 'pt', 'portuguese(-european)': 'pt-PT',
    portuguese: 'pt', 'portuguese 2': 'pt',
  };
  const supplied = (value ?? '').trim();
  const candidate = explicitNames[supplied.toLowerCase().replace(/\s*([()[\]-])\s*/g, '$1')] ?? supplied;
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(candidate) || ['sub', 'dub'].includes(candidate.toLowerCase())) return 'und';
  try { return Intl.getCanonicalLocales(candidate)[0] ?? 'und'; } catch { return 'und'; }
}

/** Exact hosts or explicit streaming DNS families; no arbitrary destinations. */
export function permittedMediaUrl(raw: string, allowedHosts: string[], allowedStreamDomains: string[] = []): string | undefined {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) return undefined;
    const permitted = allowedHosts.includes(hostname) || allowedStreamDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    if (!permitted || !hostname.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(hostname) ||
        /^\d+(?:\.\d+){3}$/.test(hostname) || hostname.includes(':')) return undefined;
    return url.toString();
  } catch { return undefined; }
}

export function normalizeTokoSource(source: TokoStream, config: TokoConfig, index = 0): StreamingSource | undefined {
  const providerId = normalizeProviderKey(source.providerKey || source.providerName);
  if (!config.contentAuthorized || !providerId || !config.allowedProviders.includes(providerId) || source.requiresHeaders && !source.headers) return undefined;
  if (source.type !== 'hls' && source.type !== 'mp4') return undefined;
  let url = permittedMediaUrl(source.url, config.allowedMediaHosts, config.allowedStreamDomains);
  if (!url) return undefined;
  try { url = streamMediaGateway.issue(config, providerId, url, source.type, source.headers); }
  catch { return undefined; }
  const audioLanguage = normalizeTokoLanguage(source.audioLanguage);
  const subtitles = source.subtitles.flatMap((track, trackIndex): StreamSubtitle[] => {
    let subtitleUrl = permittedMediaUrl(track.url, config.allowedMediaHosts, config.allowedStreamDomains);
    if (!subtitleUrl) return [];
    const inferred = /\.(srt|ass|ssa|vtt)$/i.exec(new URL(track.url).pathname)?.[1].toLowerCase();
    const format = track.format !== undefined ? track.format.trim().toLowerCase() : inferred === 'ssa' ? 'ass' : inferred ?? 'vtt';
    if (!['vtt', 'srt', 'ass'].includes(format) || format === 'ass' && (source.requiresHeaders || track.headers)) return [];
    if (source.requiresHeaders || track.headers) {
      try { subtitleUrl = streamMediaGateway.issue(config, providerId, subtitleUrl, 'subtitle', track.headers ?? source.headers); }
      catch { return []; }
    }
    return [{
      id: `toko-${providerId}-${index}-${trackIndex}`, url: subtitleUrl,
      label: track.label, language: normalizeTokoLanguage(track.language),
      kind: 'subtitles', default: track.default, format: format as StreamSubtitle['format'],
    }];
  });
  // Resolution is a provider label only; the HLS player discovers actual levels.
  return {
    providerId, providerName: source.providerName || providerId,
    url, type: source.type, label: [source.providerName || providerId, audioLanguage !== 'und' ? audioLanguage : undefined, source.quality].filter(Boolean).join(' · '),
    quality: source.quality, audioLanguage, subtitles, available: true,
  };
}

function errorState(error: unknown): ProviderState {
  if (error instanceof ApiError) {
    if (error.code === 'TOKO_UNAUTHORIZED') return 'unauthorized';
    if (error.code === 'TOKO_NOT_READY' || error.code === 'TOKO_DISABLED' || error.status === 404) return 'unavailable';
  }
  return 'connection_error';
}

export class TokoStreamingProvider implements AnimeStreamingProvider {
  readonly id: string;
  readonly name: string;
  readonly config: TokoConfig;
  readonly client: TokoHttpClient;
  private readonly probe: NonNullable<TokoStreamingOptions['probe']>;
  private readonly probeBudgetMs: number;

  constructor(options: TokoStreamingOptions = {}) {
    this.id = options.id ?? 'toko';
    if (!['toko', 'tatakai'].includes(this.id)) throw new Error('Identidade de provedor inválida.');
    this.name = options.name ?? 'Toko HTTP';
    this.config = options.config ?? options.client?.config ?? integrationsConfig.toko;
    this.client = options.client ?? new TokoHttpClient(this.config);
    this.probe = options.probe ?? ((source, signal) => streamMediaGateway.probe(source.url, signal));
    this.probeBudgetMs = Math.max(1, Math.min(8_000, options.probeBudgetMs ?? 8_000));
  }

  private get contentPermitted(): boolean {
    return this.config.contentAuthorized && this.config.allowedProviders.length > 0
      && (this.config.allowedMediaHosts.length > 0 || (this.config.allowedStreamDomains?.length ?? 0) > 0);
  }

  private status(state: ProviderState, technicalAvailable: boolean, message: string): ProviderDiagnostic {
    return {
      id: this.id, name: this.name, enabled: this.config.enabled,
      state, technicalAvailable, authorized: this.contentPermitted,
      checkedAt: new Date().toISOString(), message,
      capabilities: ['anime-streams', 'languages', 'episode-index', 'manga-http-contract', 'novel-http-contract'],
    };
  }

  async diagnostic(): Promise<ProviderDiagnostic> {
    if (!this.config.enabled) return this.status('unavailable', false, 'Toko desativado. Configure um serviço HTTP local permitido para ativar os diagnósticos.');
    try {
      await this.client.ready();
      return this.contentPermitted
        ? this.status('available', true, 'Toko HTTP e bundle disponíveis. Cada resultado ainda precisa corresponder ao provedor e ao domínio de mídia permitidos.')
        : this.status('unauthorized', true, 'Toko respondeu, mas nenhuma permissão completa de reprodução foi configurada. Saúde técnica não concede direitos de conteúdo.');
    } catch (error) {
      return this.status(errorState(error), false, error instanceof ApiError ? error.message : 'Falha ao verificar a disponibilidade do Toko.');
    }
  }

  async episodes(animeId: string, titles?: string[]): Promise<StreamingAvailability> {
    if (!/^[1-9]\d{0,9}$/.test(animeId) || Number(animeId) > 2_147_483_647) throw new ApiError(400, 'INVALID_ANIME_ID', 'Informe um identificador AniList válido.');
    const diagnostic = await this.diagnostic();
    if (diagnostic.state !== 'available') return { available: false, episodes: [], state: diagnostic.state, message: diagnostic.message, diagnostics: [diagnostic] };
    try {
      const index = await this.client.episodes(Number(animeId), titles);
      const indexed = [...new Map(index.episodes.map((episode) => [episode.number, episode])).values()].sort((a, b) => a.number - b.number);
      if (!indexed.length) {
        const empty = this.status('empty', true, 'O Toko está disponível, mas não retornou episódios para este título.');
        return { available: false, episodes: [], state: 'empty', message: empty.message, diagnostics: [empty] };
      }
      // A provider's episode index alone is not evidence of authorized playback.
      const first = indexed[0];
      // Keep a genuine source index visible even when its first video's CDN
      // fails. Other entries are resolved independently when selected.
      const probe = await this.resolveSources(Number(animeId), first.number, titles)
        .catch(error => ({ sources: [] as StreamingSource[], failureState: errorState(error) }));
      const available = probe.sources.length > 0;
      const state = available ? 'available' : probe.failureState;
      const episodes: StreamingEpisode[] = indexed.map((episode) => ({
        id: `${this.id}:${animeId}:${episode.number}`, number: episode.number,
        title: episode.title || `Episódio ${episode.number}`,
        // A failed initial check can be transient. Keep indexed entries open
        // for individual resolution rather than disabling their links.
        ...(episode.number === first.number && available ? { available: true } : {}),
      }));
      const message = available
        ? 'Fonte permitida confirmada para o primeiro episódio; os demais são verificados ao abrir o player.'
        : state === 'unauthorized' ? 'Foram encontradas fontes técnicas, mas nenhuma atende às permissões de reprodução e acesso direto configuradas.'
          : state === 'connection_error' ? 'As fontes responderam, mas a verificação do manifesto e do primeiro trecho de vídeo falhou. Tente novamente ou escolha outra fonte.'
          : 'O índice contém episódios, mas não há mídia disponível no momento.';
      return { available, episodes, state, message, diagnostics: [this.status(state, true, message)] };
    } catch (error) {
      const state = errorState(error);
      const message = error instanceof ApiError ? error.message : 'Não foi possível consultar os episódios do Toko.';
      return { available: false, episodes: [], state, message, diagnostics: [this.status(state, state === 'unauthorized', message)] };
    }
  }

  private async resolveSources(anilistId: number, episode: number, titles?: string[]) {
    const result = await this.client.streams(anilistId, episode, titles);
    const eligible = result.sources.filter(source => !isKnownSourceMismatch({
      anilistId, episode, providerId: normalizeProviderKey(source.providerKey || source.providerName),
      audioLanguage: normalizeTokoLanguage(source.audioLanguage), type: source.type,
    }));
    const candidates = eligible.flatMap((source, index) => {
      const normalized = normalizeTokoSource(source, this.config, index);
      return normalized ? [normalized] : [];
    });
    const confirmed = new Set<StreamingSource>(); let cursor = 0; const failures: unknown[] = [];
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.probeBudgetMs);
    const stopped = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new ApiError(504, 'STREAM_MEDIA_UNAVAILABLE', 'A verificação inicial do vídeo excedeu o tempo disponível.')), { once: true }));
    const worker = async () => {
      while (cursor < candidates.length && !controller.signal.aborted) {
        const source = candidates[cursor++];
        try { await Promise.race([this.probe(source, controller.signal), stopped]); confirmed.add(source); }
        catch (error) { failures.push(error); }
      }
    };
    try { await Promise.all([worker(), worker()]); }
    finally { clearTimeout(timer); }
    const sources = candidates.filter(source => confirmed.has(source));
    const failureState: ProviderState = !eligible.length ? 'empty'
      : !candidates.length || failures.some(error => error instanceof ApiError && error.code === 'STREAM_MEDIA_NOT_PERMITTED') ? 'unauthorized' : 'connection_error';
    return { sources, returnedSources: eligible.length, failureState };
  }

  async playback(episodeId: string, titles?: string[]): Promise<Playback> {
    const prefix = `${this.id}:`;
    const token = episodeId.startsWith(prefix) ? episodeId.slice(prefix.length) : '';
    const match = /^([1-9]\d{0,9}):((?:0|[1-9]\d{0,5})(?:\.\d{1,3})?)$/.exec(token);
    if (!match || Number(match[1]) > 2_147_483_647 || Number(match[2]) <= 0 || Number(match[2]) > 100_000) throw new ApiError(400, 'INVALID_EPISODE_ID', 'Identificador de episódio Toko inválido.');
    if (!this.config.enabled) throw new ApiError(503, 'TOKO_DISABLED', 'A integração Toko está desativada.');
    if (!this.contentPermitted) throw new ApiError(503, 'TOKO_UNAUTHORIZED', 'Nenhuma fonte autorizada foi configurada para reprodução no Toko.');
    await this.client.ready();
    const [result, episodeIndex] = await Promise.all([
      this.resolveSources(Number(match[1]), Number(match[2]), titles),
      this.client.episodes(Number(match[1]), titles).catch(() => null),
    ]);
    if (!result.sources.length) {
      if (result.failureState === 'unauthorized') throw new ApiError(503, 'TOKO_UNAUTHORIZED', 'As fontes retornadas não atendem às permissões de domínio, provedor ou cabeçalhos configuradas.');
      if (result.returnedSources > 0) throw new ApiError(502, 'STREAM_MEDIA_UNAVAILABLE', 'Nenhuma fonte passou na verificação inicial de vídeo. Reabra o episódio ou escolha outra fonte.');
      throw new ApiError(404, 'EPISODE_UNAVAILABLE', 'O Toko não encontrou mídia disponível para este episódio.');
    }
    const subtitles = [...new Map(result.sources.flatMap((source) => source.subtitles).map((track) => [`${track.url}:${track.language}`, track])).values()];
    subtitles.sort((a, b) => Number(b.language === 'pt-BR') - Number(a.language === 'pt-BR'));
    const indexed = [...new Map((episodeIndex?.episodes ?? []).map((episode) => [episode.number, episode])).values()].sort((a, b) => a.number - b.number);
    const position = indexed.findIndex((episode) => episode.number === Number(match[2]));
    const previous = position > 0 ? indexed[position - 1] : undefined;
    const next = position >= 0 ? indexed[position + 1] : undefined;
    return {
      episode: { id: episodeId, title: indexed[position]?.title || `Episódio ${match[2]}`, number: Number(match[2]), available: true },
      sources: result.sources, subtitles,
      audioLanguages: [...new Set(result.sources.map((source) => source.audioLanguage).filter((language): language is string => !!language && language !== 'und'))],
      isDemo: false,
      ...(previous ? { previousEpisodeId: `${this.id}:${match[1]}:${previous.number}` } : {}),
      ...(next ? { nextEpisodeId: `${this.id}:${match[1]}:${next.number}` } : {}),
      diagnostics: [this.status('available', true, 'Manifesto e primeiro trecho de vídeo verificados por uma fonte e domínio de mídia permitidos.')],
    };
  }
}
