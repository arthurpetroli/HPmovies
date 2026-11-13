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

/** A provider failure stays confined to its own availability result. */
export class StreamingRegistry implements AnimeStreamingProvider {
  readonly local = new LocalStreamingProvider();
  readonly toko: TokoStreamingProvider;
  readonly tatakai: TatakaiStreamingProvider;
  readonly stremio: StremioStreamingProvider;
  readonly subtitles: PortugueseSubtitleProvider;
  private readonly animeStremio: AnimeStremioProvider;
  constructor(options: { toko?: TokoStreamingProvider; tatakai?: TatakaiStreamingProvider; stremio?: StremioStreamingProvider; subtitles?: PortugueseSubtitleProvider } = {}) {
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
    const indexed = values.filter(value => value.episodes.length > 0);
    if (indexed.length) return {
      ...indexed[0], available: false,
      episodes: [...new Map(indexed.flatMap(value => value.episodes).map(episode => [episode.id, episode])).values()].sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
      message: 'Episódios encontrados. A fonte de vídeo será verificada ao abrir cada episódio.',
      diagnostics: values.flatMap(value => value.diagnostics ?? []),
    };
    return {
      available: false, episodes: [],
      state: values.find(value => value.state === 'unauthorized')?.state ?? values[0]?.state ?? 'connection_error' as const,
      message: values.find(value => value.message)?.message || 'As fontes conectadas ainda não retornaram episódios para este anime.',
      diagnostics: values.flatMap(value => value.diagnostics || []),
    };
  }

  async resolve(animeId: string, episode: number, source?: string, titles?: string[]): Promise<Playback> {
    if (!/^[1-9]\d{0,8}$/.test(animeId) || !Number.isFinite(episode) || episode <= 0 || episode > 100000 || source && !['toko', 'tatakai'].includes(source)) throw new ApiError(400, 'INVALID_EPISODE', 'Informe obra, episódio e fonte válidos.');
    const providers = [this.tatakai, this.toko].filter(provider => !source || (provider === this.toko ? 'toko' : 'tatakai') === source);
    const id = `${source || 'tatakai'}:${animeId}:${episode}`;
    return this.animePlayback(id, animeId, episode, providers, titles, !source);
  }

  private async animePlayback(id: string, animeId: string, episode: number, providers: Array<TokoStreamingProvider | TatakaiStreamingProvider>, titles?: string[], includeStremio = true): Promise<Playback> {
    // All source lookups begin together; a slow IMDb addon never serializes the legacy lookups.
    const [results, extra] = await Promise.all([
      Promise.allSettled(providers.map(provider => provider.playback(`${provider === this.toko ? 'toko' : 'tatakai'}:${animeId}:${episode}`, titles))),
      includeStremio ? this.animeStremio.resolve(animeId, episode, id) : Promise.resolve<AnimeStremioResult>({}),
    ]);
    const playbacks = results.flatMap(result => result.status === 'fulfilled' && result.value.sources.length ? [result.value] : []);
    if (extra.playback) playbacks.push(extra.playback);
    if (playbacks.length) {
      const merged = mergeAnimePlaybacks(playbacks);
      if (extra.diagnostic) merged.diagnostics = [...(merged.diagnostics ?? []), extra.diagnostic];
      return this.subtitles.enrich(merged, animeId);
    }
    const error = results.find(result => result.status === 'rejected' && result.reason instanceof ApiError && result.reason.status !== 404);
    if (error?.status === 'rejected') throw error.reason;
    if (extra.error) throw extra.error;
    throw new ApiError(404, 'EPISODE_UNAVAILABLE', 'Nenhuma fonte encontrou mídia disponível para este episódio.');
  }

  playback(id: string, titles?: string[]) {
    if (id === 'demo') return this.local.playback(id);
    if (id.startsWith('toko:') || id.startsWith('tatakai:')) {
      const match = /^(toko|tatakai):([1-9]\d{0,8}):((?:0|[1-9]\d{0,5})(?:\.\d{1,3})?)$/.exec(id);
      if (!match || Number(match[3]) <= 0 || Number(match[3]) > 100_000) throw new ApiError(400, 'INVALID_EPISODE_ID', 'Identificador de episódio inválido.');
      const provider = match[1] === 'toko' ? this.toko : this.tatakai;
      return this.animePlayback(id, match[2], Number(match[3]), [provider], titles);
    }
    if (id.startsWith('stremio:')) return this.stremio.playback(id);
    throw new ApiError(404, 'EPISODE_UNAVAILABLE', 'Não há uma fonte autorizada para este episódio.');
  }
}
