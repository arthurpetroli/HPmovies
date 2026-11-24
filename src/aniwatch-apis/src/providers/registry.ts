import type { AnimeStreamingProvider } from '../../../shared/providers.js';
import { LocalStreamingProvider } from './streaming.js';
import { TokoStreamingProvider } from './toko.js';
import { TatakaiStreamingProvider } from './tatakai.js';
import { configuredStremioOptions } from '../config/stremio.js';
import { StremioStreamingProvider } from './stremio.js';
import type { Playback } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { portugueseSubtitles, PortugueseSubtitleProvider } from './portuguese-subtitles.js';
import { AnimeStremioProvider, mergeAnimePlaybacks } from './anime-stremio.js';
import type { AnimeStremioResult } from './anime-stremio.js';

/** After the first playable result, wait this long for the other lookups before answering. */
const SOURCE_GRACE_MS = 1_500;
const pendingSource = () => new ApiError(504, 'SOURCE_STILL_RESOLVING', 'A fonte ainda estava respondendo.');

/**
 * Every lookup starts together. The answer goes out when all of them settle, or
 * shortly after the first playable result, so a slow addon no longer delays a
 * source that already answered. Late lookups keep running and warm their caches.
 */
function gatherSources(legacy: Promise<Playback>[], remote: Promise<AnimeStremioResult>, graceMs: number): Promise<[PromiseSettledResult<Playback>[], AnimeStremioResult]> {
  const settled: Array<PromiseSettledResult<Playback> | undefined> = legacy.map(() => undefined);
  let extra: AnimeStremioResult | undefined;
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve([settled.map(result => result ?? { status: 'rejected', reason: pendingSource() }), extra ?? {}]);
    };
    const check = () => {
      if (settled.every(Boolean) && extra !== undefined) return finish();
      const playable = settled.some(result => result?.status === 'fulfilled' && result.value.sources.length > 0) || !!extra?.playback;
      if (playable && !timer) timer = setTimeout(finish, graceMs);
    };
    legacy.forEach((task, index) => task.then(
      value => { settled[index] = { status: 'fulfilled', value }; check(); },
      reason => { settled[index] = { status: 'rejected', reason }; check(); },
    ));
    remote.then(value => { extra = value; check(); }, () => { extra = {}; check(); });
  });
}

const temporaryFailure = (error: ApiError) => error.status >= 500 && !/UNAUTHORIZED|DISABLED|INVALID/.test(error.code);

/** One clear reason when no source produced media, keeping each original error code. */
function playbackFailure(results: PromiseSettledResult<Playback>[], extra: AnimeStremioResult, automatic: boolean): ApiError {
  const failures = results.flatMap(result => result.status === 'rejected' && result.reason instanceof ApiError ? [result.reason] : []);
  // An optional disabled provider should not hide the result of active lookups.
  const legacy = automatic ? failures.filter(error => error.code !== 'TOKO_DISABLED') : failures;
  const remoteMissing = extra.error?.status === 404;
  const unmapped = !extra.error && extra.diagnostic?.state === 'unavailable';
  const temporary = legacy.find(temporaryFailure);
  if (temporary && (!extra.error || remoteMissing)) {
    const detail = remoteMissing ? ' e o addon Stremio não encontrou este episódio' : unmapped ? ' e não há uma correspondência IMDb segura para consultar os addons' : '';
    return new ApiError(503, temporary.code, `A fonte principal de anime não respondeu agora${detail}. Tente novamente em instantes.`);
  }
  const blocking = legacy.find(error => error.status !== 404);
  if (blocking) return blocking;
  if (extra.error) return remoteMissing
    ? new ApiError(404, extra.error.code, 'Nenhuma fonte conectada tem este episódio no momento. A fonte principal e o addon Stremio não retornaram vídeo.')
    : extra.error;
  return new ApiError(404, 'EPISODE_UNAVAILABLE', unmapped
    ? 'Nenhuma fonte encontrou mídia para este episódio, e não há correspondência IMDb segura para consultar os addons.'
    : 'Nenhuma fonte encontrou mídia disponível para este episódio.');
}

/** A provider failure stays confined to its own availability result. */
export class StreamingRegistry implements AnimeStreamingProvider {
  readonly local = new LocalStreamingProvider();
  readonly toko: TokoStreamingProvider;
  readonly tatakai: TatakaiStreamingProvider;
  readonly stremio: StremioStreamingProvider;
  readonly subtitles: PortugueseSubtitleProvider;
  private readonly animeStremio: AnimeStremioProvider;
  private readonly sourceGraceMs: number;
  constructor(options: { toko?: TokoStreamingProvider; tatakai?: TatakaiStreamingProvider; stremio?: StremioStreamingProvider; subtitles?: PortugueseSubtitleProvider; sourceGraceMs?: number } = {}) {
    this.sourceGraceMs = Math.max(0, Math.min(options.sourceGraceMs ?? SOURCE_GRACE_MS, 30_000));
    this.toko = options.toko ?? new TokoStreamingProvider();
    this.tatakai = options.tatakai ?? new TatakaiStreamingProvider();
    this.stremio = options.stremio ?? new StremioStreamingProvider(configuredStremioOptions());
    this.subtitles = options.subtitles ?? portugueseSubtitles;
    this.animeStremio = new AnimeStremioProvider({ stremio: this.stremio, identity: (id, episode) => this.subtitles.resolveIdentity(id, episode) });
  }

  async episodes(id: string, titles?: string[]) {
    if (id === 'demo') return this.local.episodes(id);
    const results = await Promise.allSettled([this.toko.episodes(id, titles), this.tatakai.episodes(id, titles)]);
    const available = results.flatMap(result => result.status === 'fulfilled' && result.value.available ? [result.value] : []);
    if (available.length) return { ...available[0], episodes: available.flatMap(value => value.episodes), diagnostics: available.flatMap(value => value.diagnostics || []) };
    const values = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const diagnostics = values.flatMap(value => value.diagnostics ?? []);
    const indexed = values.filter(value => value.episodes.length > 0);
    if (indexed.length) return {
      ...indexed[0], available: false,
      episodes: [...new Map(indexed.flatMap(value => value.episodes).map(episode => [episode.id, episode])).values()].sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
      message: 'Episódios encontrados. A fonte de vídeo será verificada ao abrir cada episódio.',
      diagnostics,
    };
    // Episode artwork and titles remain usable when the media index is down.
    const episodes = await this.subtitles.episodeMetadata(id).catch(() => []);
    if (episodes.length) {
      const indexUnavailable = values.some(value => value.state === 'connection_error');
      return {
        available: false, state: 'unavailable' as const, episodes, catalogFallback: true,
        message: indexUnavailable
          ? 'O índice da fonte de vídeo não respondeu. A lista vem do Cinemeta e o vídeo é consultado por episódio.'
          : 'Lista do Cinemeta. A disponibilidade de vídeo é consultada ao abrir cada episódio.',
        diagnostics,
      };
    }
    const failure = values.find(value => value.state === 'unauthorized') ??
      values.find(value => value.state === 'connection_error') ?? values[0];
    return {
      available: false, episodes: [],
      state: failure?.state ?? 'connection_error' as const,
      message: failure?.message || 'As fontes conectadas ainda não retornaram episódios para este anime.',
      diagnostics,
    };
  }

  async resolve(animeId: string, episode: number, source?: string, titles?: string[], refresh = false): Promise<Playback> {
    if (!/^[1-9]\d{0,8}$/.test(animeId) || !Number.isFinite(episode) || episode <= 0 || episode > 100000 || source && !['toko', 'tatakai'].includes(source)) throw new ApiError(400, 'INVALID_EPISODE', 'Informe obra, episódio e fonte válidos.');
    const providers = [this.tatakai, this.toko].filter(provider => !source || (provider === this.toko ? 'toko' : 'tatakai') === source);
    const id = `${source || 'tatakai'}:${animeId}:${episode}`;
    return this.animePlayback(id, animeId, episode, providers, refresh, titles, !source);
  }

  private async animePlayback(id: string, animeId: string, episode: number, providers: Array<TokoStreamingProvider | TatakaiStreamingProvider>, refresh: boolean, titles?: string[], includeStremio = true): Promise<Playback> {
    // All source lookups begin together; a slow IMDb addon never delays a source that already answered.
    // External subtitles are searched at the same time instead of after the media.
    const subtitles = this.subtitles.prefetch(animeId, episode);
    const [results, extra] = await gatherSources(
      providers.map(provider => {
        const providerId = `${provider === this.toko ? 'toko' : 'tatakai'}:${animeId}:${episode}`;
        return refresh ? provider.playback(providerId, titles, true) : provider.playback(providerId, titles);
      }),
      includeStremio ? this.animeStremio.resolve(animeId, episode, id, refresh) : Promise.resolve<AnimeStremioResult>({}),
      this.sourceGraceMs,
    );
    const playbacks = results.flatMap(result => result.status === 'fulfilled' && result.value.sources.length ? [result.value] : []);
    if (extra.playback) playbacks.push(extra.playback);
    if (playbacks.length) {
      const merged = mergeAnimePlaybacks(playbacks);
      if (extra.diagnostic) merged.diagnostics = [...(merged.diagnostics ?? []), extra.diagnostic];
      return this.subtitles.enrich(merged, animeId, subtitles);
    }
    throw playbackFailure(results, extra, includeStremio);
  }

  playback(id: string, titles?: string[], refresh = false) {
    if (id === 'demo') return this.local.playback(id);
    if (id.startsWith('toko:') || id.startsWith('tatakai:')) {
      const match = /^(toko|tatakai):([1-9]\d{0,8}):((?:0|[1-9]\d{0,5})(?:\.\d{1,3})?)$/.exec(id);
      if (!match || Number(match[3]) <= 0 || Number(match[3]) > 100_000) throw new ApiError(400, 'INVALID_EPISODE_ID', 'Identificador de episódio inválido.');
      const provider = match[1] === 'toko' ? this.toko : this.tatakai;
      return this.animePlayback(id, match[2], Number(match[3]), [provider], refresh, titles);
    }
    if (id.startsWith('stremio:')) return refresh ? this.stremio.playback(id, undefined, true) : this.stremio.playback(id);
    throw new ApiError(404, 'EPISODE_UNAVAILABLE', 'Não há uma fonte autorizada para este episódio.');
  }
}
