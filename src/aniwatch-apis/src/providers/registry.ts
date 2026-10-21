import type { AnimeStreamingProvider } from '../../../shared/providers.js';
import { LocalStreamingProvider } from './streaming.js';
import { TokoStreamingProvider } from './toko.js';
import { TatakaiStreamingProvider } from './tatakai.js';
import { ApiError } from '../config/apiError.js';

/** A provider failure stays confined to its own availability result. */
export class StreamingRegistry implements AnimeStreamingProvider {
  readonly local = new LocalStreamingProvider();
  readonly toko = new TokoStreamingProvider();
  readonly tatakai = new TatakaiStreamingProvider();

  async episodes(id: string) {
    if (id === 'demo') return this.local.episodes(id);
    const results = await Promise.allSettled([this.toko.episodes(id), this.tatakai.episodes(id)]);
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

  playback(id: string) {
    if (id === 'demo') return this.local.playback(id);
    if (id.startsWith('toko:')) return this.toko.playback(id);
    throw new ApiError(404, 'EPISODE_UNAVAILABLE', 'Não há uma fonte autorizada para este episódio.');
  }
}
