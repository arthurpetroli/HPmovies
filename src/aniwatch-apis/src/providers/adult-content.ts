import type { CatalogAnime, Playback, ProviderDiagnostic, StreamingAvailability, StreamingEpisode } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import type { AdultCatalogProvider } from './anilist-adult.js';
import { mergeAnimePlaybacks } from './anime-stremio.js';
import type { StreamingRegistry } from './registry.js';

type Registry = Pick<StreamingRegistry, 'episodes' | 'resolve'> & { toko: { diagnostic(): Promise<ProviderDiagnostic> }; tatakai: { diagnostic(): Promise<ProviderDiagnostic> } };

/** An adult-only video source looked up by title (hentai-api, streaming sites). */
export interface AdultVideoSource {
  readonly enabled: boolean;
  episodes(titles: string[]): Promise<Array<{ number: number; title: string; thumbnail?: string }>>;
  playback(titles: string[], episode: number, refresh?: boolean): Promise<Playback>;
  diagnostic(): Promise<ProviderDiagnostic>;
}

export const adultEpisodeId = (animeId: string, episode: number) => `adult:${animeId}:${episode}`;
const MAX_CATALOG_EPISODES = 200;
const DISABLED = /_DISABLED$/;

/**
 * Episodes and playback for adult AniList titles. Every request first loads the
 * title from the adult catalog, which applies the minors filter, and then asks
 * the existing anime sources (Tatakai/Toko) and every enabled adult source.
 */
export class AdultContentService {
  constructor(private readonly catalog: AdultCatalogProvider, private readonly registry: Registry, private readonly sources: AdultVideoSource[]) {}

  /** The anime sources accept at most five title hints (toko-http validates this). */
  private titles(anime: CatalogAnime): string[] {
    return [...new Set([anime.titleOriginal, anime.title, anime.titleNative, ...(anime.synonyms ?? [])]
      .flatMap(title => title?.trim() ? [title.trim().slice(0, 120)] : []))].slice(0, 5);
  }

  private enabled(): AdultVideoSource[] { return this.sources.filter(source => source.enabled); }

  async episodes(id: string): Promise<StreamingAvailability> {
    const anime = await this.catalog.details(id);
    const titles = this.titles(anime);
    const extras = this.enabled();
    const [indexed, ...found] = await Promise.allSettled([this.registry.episodes(id, titles), ...extras.map(source => source.episodes(titles))]);
    const episodes = new Map<number, StreamingEpisode>();
    const diagnostics = indexed.status === 'fulfilled' ? indexed.value.diagnostics ?? [] : [];
    if (indexed.status === 'fulfilled' && !indexed.value.catalogFallback) {
      for (const episode of indexed.value.episodes) {
        const number = episode.number;
        if (!number || !Number.isInteger(number) || number < 1 || episodes.has(number)) continue;
        episodes.set(number, { id: adultEpisodeId(id, number), number, title: episode.title, ...(episode.thumbnail ? { thumbnail: episode.thumbnail } : {}), ...(episode.available === false ? { available: false } : {}) });
      }
    }
    for (const result of found) {
      if (result.status !== 'fulfilled') continue;
      for (const episode of result.value) {
        const current = episodes.get(episode.number);
        episodes.set(episode.number, current
          ? { ...current, available: true, thumbnail: current.thumbnail ?? episode.thumbnail }
          : { id: adultEpisodeId(id, episode.number), number: episode.number, title: episode.title, ...(episode.thumbnail ? { thumbnail: episode.thumbnail } : {}) });
      }
    }
    const failures = found.flatMap(result => result.status === 'rejected' && result.reason instanceof ApiError && !DISABLED.test(result.reason.code) ? [result.reason] : []);
    const message = failures.find(error => error.status !== 404)?.message ?? failures[0]?.message;
    const anyExtra = found.some(result => result.status === 'fulfilled');
    if (episodes.size) {
      return {
        available: anyExtra || indexed.status === 'fulfilled' && indexed.value.available,
        episodes: [...episodes.values()].sort((a, b) => (a.number ?? 0) - (b.number ?? 0)), diagnostics,
        ...(message && !anyExtra ? { message } : {}),
      };
    }
    // Without an index, the catalog count still lets each episode be tried.
    const count = Math.min(MAX_CATALOG_EPISODES, anime.episodeCount ?? anime.airedEpisodes ?? (anime.format === 'MOVIE' ? 1 : 0));
    const fallback = message ?? 'Nenhuma fonte retornou um índice de episódios. A lista vem do AniList e o vídeo é consultado ao abrir cada episódio.';
    if (count > 0) return {
      available: false, state: 'unavailable', catalogFallback: true, message: fallback, diagnostics,
      episodes: Array.from({ length: count }, (_, index) => ({ id: adultEpisodeId(id, index + 1), number: index + 1, title: `Episódio ${index + 1}` })),
    };
    return { available: false, state: 'unavailable', episodes: [], message: fallback, diagnostics };
  }

  async playback(id: string, episode: number, refresh = false): Promise<Playback> {
    const anime = await this.catalog.details(id);
    const titles = this.titles(anime);
    const results = await Promise.allSettled([
      refresh ? this.registry.resolve(id, episode, undefined, titles, true) : this.registry.resolve(id, episode, undefined, titles),
      ...this.enabled().map(source => source.playback(titles, episode, refresh)),
    ]);
    const playbacks = results.flatMap(result => result.status === 'fulfilled' && result.value.sources.length ? [result.value] : []);
    if (!playbacks.length) {
      const errorOf = (result: PromiseSettledResult<Playback>) => result.status === 'rejected' && result.reason instanceof ApiError ? [result.reason] : [];
      const [animeResult, ...extras] = results;
      const indexed = errorOf(animeResult);
      const adult = extras.flatMap(errorOf);
      // Adult sources explain more than the generic anime index; then any configuration or connection problem.
      throw adult.find(error => error.code === 'ADULT_TITLE_BLOCKED') ?? adult.find(error => error.status !== 404) ?? indexed.find(error => error.status !== 404)
        ?? adult[0] ?? new ApiError(404, 'ADULT_EPISODE_UNAVAILABLE',
          'Nenhuma fonte conectada encontrou vídeo para este episódio. Configure ADULT_SITES, a hentai-api (HENTAI_API_URL) ou uma extensão de fontes que tenha este título.');
    }
    const merged = mergeAnimePlaybacks(playbacks);
    return {
      ...merged, isDemo: false, nextEpisodeId: undefined, previousEpisodeId: undefined,
      // The player keeps this order when no source has subtitles: best quality first.
      sources: [...merged.sources].sort((a, b) => (b.height ?? 0) - (a.height ?? 0)),
      episode: { ...merged.episode, id: adultEpisodeId(id, episode), number: episode, available: true },
    };
  }

  diagnostics(): Promise<ProviderDiagnostic[]> {
    return Promise.all([...this.sources.map(source => source.diagnostic()), this.registry.tatakai.diagnostic(), this.registry.toko.diagnostic()]);
  }
}
