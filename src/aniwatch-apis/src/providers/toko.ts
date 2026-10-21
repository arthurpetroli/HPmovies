import type {
  AnimeStreamingProvider, Playback, ProviderDiagnostic, ProviderState,
  StreamingAvailability, StreamingEpisode, StreamingSource, StreamSubtitle,
} from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { integrationsConfig, normalizeProviderKey } from '../config/integrations.js';
import type { TokoConfig } from '../config/integrations.js';
import { TokoHttpClient } from './toko-http.js';
import type { TokoStream } from './toko-http.js';

export interface TokoStreamingOptions {
  config?: TokoConfig;
  client?: TokoHttpClient;
}

/** Only explicit language metadata is trusted. A label such as "sub" is unknown. */
export function normalizeTokoLanguage(value: string | undefined): string {
  const candidate = (value ?? '').trim();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(candidate) || ['sub', 'dub'].includes(candidate.toLowerCase())) return 'und';
  try { return Intl.getCanonicalLocales(candidate)[0] ?? 'und'; } catch { return 'und'; }
}

/** Exact public DNS host permissions; no replay proxy or arbitrary destinations. */
export function permittedMediaUrl(raw: string, allowedHosts: string[]): string | undefined {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) return undefined;
    if (!allowedHosts.includes(hostname) || !hostname.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(hostname) ||
        /^\d+(?:\.\d+){3}$/.test(hostname) || hostname.includes(':')) return undefined;
    return url.toString();
  } catch { return undefined; }
}

export function normalizeTokoSource(source: TokoStream, config: TokoConfig, index = 0): StreamingSource | undefined {
  const providerId = normalizeProviderKey(source.providerKey || source.providerName);
  if (!config.contentAuthorized || !providerId || !config.allowedProviders.includes(providerId) || source.requiresHeaders) return undefined;
  if (source.type !== 'hls' && source.type !== 'mp4') return undefined;
  const url = permittedMediaUrl(source.url, config.allowedMediaHosts);
  if (!url) return undefined;
  const audioLanguage = normalizeTokoLanguage(source.audioLanguage);
  const subtitles = source.subtitles.flatMap((track, trackIndex): StreamSubtitle[] => {
    const subtitleUrl = permittedMediaUrl(track.url, config.allowedMediaHosts);
    if (!subtitleUrl) return [];
    return [{
      id: `toko-${providerId}-${index}-${trackIndex}`, url: subtitleUrl,
      label: track.label, language: normalizeTokoLanguage(track.language),
      kind: 'subtitles', default: track.default,
    }];
  });
  // Resolution is a provider label only; the HLS player discovers actual levels.
  return {
    providerId, providerName: source.providerName || providerId,
    url, type: source.type, label: source.quality || source.providerName || providerId,
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
  readonly config: TokoConfig;
  readonly client: TokoHttpClient;

  constructor(options: TokoStreamingOptions = {}) {
    this.config = options.config ?? options.client?.config ?? integrationsConfig.toko;
    this.client = options.client ?? new TokoHttpClient(this.config);
  }

  private get contentPermitted(): boolean {
    return this.config.contentAuthorized && this.config.allowedProviders.length > 0 && this.config.allowedMediaHosts.length > 0;
  }

  private status(state: ProviderState, technicalAvailable: boolean, message: string): ProviderDiagnostic {
    return {
      id: 'toko', name: 'Toko HTTP', enabled: this.config.enabled,
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

  async episodes(animeId: string): Promise<StreamingAvailability> {
    if (!/^[1-9]\d{0,9}$/.test(animeId) || Number(animeId) > 2_147_483_647) throw new ApiError(400, 'INVALID_ANIME_ID', 'Informe um identificador AniList válido.');
    const diagnostic = await this.diagnostic();
    if (diagnostic.state !== 'available') return { available: false, episodes: [], state: diagnostic.state, message: diagnostic.message, diagnostics: [diagnostic] };
    try {
      const index = await this.client.episodes(Number(animeId));
      const indexed = [...new Map(index.episodes.map((episode) => [episode.number, episode])).values()].sort((a, b) => a.number - b.number);
      if (!indexed.length) {
        const empty = this.status('empty', true, 'O Toko está disponível, mas não retornou episódios para este título.');
        return { available: false, episodes: [], state: 'empty', message: empty.message, diagnostics: [empty] };
      }
      // A provider's episode index alone is not evidence of authorized playback.
      const first = indexed[0];
      const probe = await this.resolveSources(Number(animeId), first.number);
      const available = probe.sources.length > 0;
      const state = available ? 'available' : probe.returnedSources > 0 ? 'unauthorized' : 'empty';
      const episodes: StreamingEpisode[] = indexed.map((episode) => ({
        id: `toko:${animeId}:${episode.number}`, number: episode.number,
        title: episode.title || `Episódio ${episode.number}`,
        ...(episode.number === first.number ? { available } : {}),
      }));
      const message = available
        ? 'Fonte permitida confirmada para o primeiro episódio; os demais são verificados ao abrir o player.'
        : state === 'unauthorized' ? 'Foram encontradas fontes técnicas, mas nenhuma atende às permissões de reprodução e acesso direto configuradas.'
          : 'O índice contém episódios, mas não há mídia disponível no momento.';
      return { available, episodes, state, message, diagnostics: [this.status(state, true, message)] };
    } catch (error) {
      const state = errorState(error);
      const message = error instanceof ApiError ? error.message : 'Não foi possível consultar os episódios do Toko.';
      return { available: false, episodes: [], state, message, diagnostics: [this.status(state, state === 'unauthorized', message)] };
    }
  }

  private async resolveSources(anilistId: number, episode: number) {
    const result = await this.client.streams(anilistId, episode);
    const sources = result.sources.flatMap((source, index) => {
      const normalized = normalizeTokoSource(source, this.config, index);
      return normalized ? [normalized] : [];
    });
    return { sources, returnedSources: result.sources.length };
  }

  async playback(episodeId: string): Promise<Playback> {
    const match = /^toko:([1-9]\d{0,9}):((?:0|[1-9]\d{0,5})(?:\.\d{1,3})?)$/.exec(episodeId);
    if (!match || Number(match[1]) > 2_147_483_647 || Number(match[2]) <= 0 || Number(match[2]) > 100_000) throw new ApiError(400, 'INVALID_EPISODE_ID', 'Identificador de episódio Toko inválido.');
    if (!this.config.enabled) throw new ApiError(503, 'TOKO_DISABLED', 'A integração Toko está desativada.');
    if (!this.contentPermitted) throw new ApiError(503, 'TOKO_UNAUTHORIZED', 'Nenhuma fonte autorizada foi configurada para reprodução no Toko.');
    await this.client.ready();
    const [result, episodeIndex] = await Promise.all([
      this.resolveSources(Number(match[1]), Number(match[2])),
      this.client.episodes(Number(match[1])).catch(() => null),
    ]);
    if (!result.sources.length) {
      if (result.returnedSources > 0) throw new ApiError(503, 'TOKO_UNAUTHORIZED', 'As fontes retornadas não atendem às permissões ou exigem cabeçalhos de acesso incompatíveis com a reprodução direta.');
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
      ...(previous ? { previousEpisodeId: `toko:${match[1]}:${previous.number}` } : {}),
      ...(next ? { nextEpisodeId: `toko:${match[1]}:${next.number}` } : {}),
      diagnostics: [this.status('available', true, 'Reprodução direta de fonte e domínio de mídia explicitamente permitidos.')],
    };
  }
}
