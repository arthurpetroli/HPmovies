import type { Playback, ProviderDiagnostic, StreamSource, StreamSubtitle } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import type { EpisodeIdentity } from './portuguese-subtitles.js';
import type { StremioStreamingProvider } from './stremio.js';

interface Options {
  stremio: Pick<StremioStreamingProvider, 'hasConfiguredAddons' | 'playback'>;
  identity(animeId: string, episode: number): Promise<EpisodeIdentity | undefined>;
}

export interface AnimeStremioResult {
  playback?: Playback;
  diagnostic?: ProviderDiagnostic;
  error?: ApiError;
}

/** AniList identity is resolved explicitly before requesting any IMDb media. */
export class AnimeStremioProvider {
  constructor(private readonly options: Options) {}

  private status(state: ProviderDiagnostic['state'], message: string): ProviderDiagnostic {
    return { id: 'stremio-anime', name: 'Stremio · fontes adicionais de anime', enabled: true,
      state, technicalAvailable: state !== 'connection_error', authorized: state !== 'unauthorized',
      checkedAt: new Date().toISOString(), message, capabilities: ['anime-streaming', 'stremio-http'] };
  }

  async resolve(animeId: string, episode: number, episodeId: string): Promise<AnimeStremioResult> {
    if (!this.options.stremio.hasConfiguredAddons()) return {};
    const missing = () => ({ diagnostic: this.status('unavailable', 'Não há correspondência segura entre este episódio AniList e uma edição IMDb. As outras fontes permanecem disponíveis.') });
    if (!/^[1-9]\d{0,8}$/.test(animeId) || !Number.isSafeInteger(episode) || episode < 1 || episode > 100_000) return missing();
    try {
      const identity = await this.options.identity(animeId, episode);
      if (!identity || !/^tt\d{5,12}$/.test(identity.imdb)) return missing();
      const series = identity.kind === 'series' && Number.isInteger(identity.season) && Number(identity.season) >= 0 && Number(identity.season) <= 1000
        && Number.isInteger(identity.episode) && Number(identity.episode) > 0 && Number(identity.episode) <= 100_000;
      if (identity.kind === 'movie' ? episode !== 1 : !series) return missing();
      const playback = await this.options.stremio.playback(identity.kind === 'movie'
        ? { type: 'movie', imdbId: identity.imdb }
        : { imdbId: identity.imdb, season: identity.season!, episode: identity.episode! });
      if (!playback.sources.length || playback.isDemo) throw new ApiError(404, 'STREMIO_EPISODE_UNAVAILABLE', 'As fontes Stremio não retornaram vídeo para este episódio.');
      return { playback: { ...playback, episode: { id: episodeId, number: episode, title: `Episódio ${episode}`, available: true } } };
    } catch (error) {
      const failure = error instanceof ApiError ? error : new ApiError(503, 'STREMIO_ANIME_MAPPING_UNAVAILABLE', 'Não foi possível consultar a correspondência IMDb ou as fontes Stremio deste anime.');
      return { error: failure, diagnostic: this.status(failure.code === 'STREMIO_UNAUTHORIZED' ? 'unauthorized' : failure.status === 404 ? 'empty' : 'connection_error', failure.message) };
    }
  }
}

const tracks = (values: StreamSubtitle[]) => [...new Map(values.map(track => [`${track.url}:${track.language}`, track])).values()];

/** Keep subtitle ownership with its video, including providers with only episode-level tracks. */
export function mergeAnimePlaybacks(values: Playback[]): Playback {
  const first = values[0];
  if (!first) throw new ApiError(404, 'EPISODE_UNAVAILABLE', 'Nenhuma fonte encontrou mídia disponível para este episódio.');
  const sources = new Map<string, StreamSource>();
  for (const playback of values) playback.sources.forEach((source, index) => {
    const key = `${source.type}:${source.url}`;
    const scoped = source.subtitles ?? (index === 0 ? playback.subtitles : []);
    const previous = sources.get(key);
    sources.set(key, previous ? { ...previous, subtitles: tracks([...(previous.subtitles ?? []), ...scoped]) } : { ...source, subtitles: scoped });
  });
  const expiration = values.flatMap(value => value.expiresAt && Number.isFinite(Date.parse(value.expiresAt)) ? [Date.parse(value.expiresAt)] : []);
  return { ...first, sources: [...sources.values()], subtitles: tracks(values.flatMap(value => value.subtitles)),
    audioLanguages: [...new Set(values.flatMap(value => value.audioLanguages))],
    diagnostics: values.flatMap(value => value.diagnostics ?? []),
    ...(expiration.length ? { expiresAt: new Date(Math.min(...expiration)).toISOString() } : {}) };
}
