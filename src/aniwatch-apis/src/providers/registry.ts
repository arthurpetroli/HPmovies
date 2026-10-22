import type { AnimeStreamingProvider } from '../../../shared/providers.js';
import { LocalStreamingProvider } from './streaming.js';
import { TokoStreamingProvider } from './toko.js';
import { TatakaiStreamingProvider } from './tatakai.js';
import { configuredStremioAddons } from '../config/stremio.js';
import { StremioStreamingProvider } from './stremio.js';
import type { Playback } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { portugueseSubtitles, PortugueseSubtitleProvider } from './portuguese-subtitles.js';

/** A provider failure stays confined to its own availability result. */
export class StreamingRegistry implements AnimeStreamingProvider {
  readonly local = new LocalStreamingProvider();
  readonly toko: TokoStreamingProvider;
  readonly tatakai: TatakaiStreamingProvider;
  readonly stremio: StremioStreamingProvider;
  readonly subtitles: PortugueseSubtitleProvider;
  constructor(options: { toko?: TokoStreamingProvider; tatakai?: TatakaiStreamingProvider; stremio?: StremioStreamingProvider; subtitles?: PortugueseSubtitleProvider } = {}) {
    this.toko = options.toko ?? new TokoStreamingProvider();
    this.tatakai = options.tatakai ?? new TatakaiStreamingProvider();
    this.stremio = options.stremio ?? new StremioStreamingProvider({ addons: configuredStremioAddons() });
    this.subtitles = options.subtitles ?? portugueseSubtitles;
  }

  async episodes(id: string, titles?: string[]) {
    if (id === 'demo') return this.local.episodes(id);
    const results = await Promise.allSettled([this.toko.episodes(id, titles), this.tatakai.episodes(id, titles)]);
    const available = results.flatMap(result => result.status === 'fulfilled' && result.value.available ? [result.value] : []);
    if (available.length) return { ...available[0], episodes: available.flatMap(value => value.episodes), diagnostics: available.flatMap(value => value.diagnostics || []) };
    const values = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    return {
      available: false, episodes: [],
      state: values.find(value => value.state === 'unauthorized')?.state ?? values[0]?.state ?? 'connection_error' as const,
      message: 'Nenhuma fonte de reprodução autorizada está disponível para este anime. Consulte os provedores ou use a demonstração do player.',
      diagnostics: values.flatMap(value => value.diagnostics || []),
    };
  }

  async resolve(animeId: string, episode: number, source?: string, titles?: string[]): Promise<Playback> {
    if (!/^[1-9]\d{0,8}$/.test(animeId) || !Number.isFinite(episode) || episode <= 0 || episode > 100000 || source && !['toko', 'tatakai'].includes(source)) throw new ApiError(400, 'INVALID_EPISODE', 'Informe obra, episódio e fonte válidos.');
    const providers = [this.tatakai, this.toko].filter(provider => !source || (provider === this.toko ? 'toko' : 'tatakai') === source);
    const results = await Promise.allSettled(providers.map(provider => provider.playback(`${provider === this.toko ? 'toko' : 'tatakai'}:${animeId}:${episode}`, titles)));
    const success = results.find(result => result.status === 'fulfilled');
    if (success?.status === 'fulfilled') return this.subtitles.enrich(success.value, animeId);
    const error = results.find(result => result.status === 'rejected' && result.reason instanceof ApiError && result.reason.status !== 404);
    if (error?.status === 'rejected') throw error.reason;
    throw new ApiError(404, 'EPISODE_UNAVAILABLE', 'Nenhuma fonte encontrou mídia disponível para este episódio.');
  }

  playback(id: string, titles?: string[]) {
    if (id === 'demo') return this.local.playback(id);
    if (id.startsWith('toko:')) return this.toko.playback(id, titles).then(playback => this.subtitles.enrich(playback, id.split(':')[1]));
    if (id.startsWith('tatakai:')) return this.tatakai.playback(id, titles).then(playback => this.subtitles.enrich(playback, id.split(':')[1]));
    if (id.startsWith('stremio:')) return this.stremio.playback(id);
    throw new ApiError(404, 'EPISODE_UNAVAILABLE', 'Não há uma fonte autorizada para este episódio.');
  }
}
