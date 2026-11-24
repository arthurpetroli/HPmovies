import type { CatalogAnime, StreamingAvailability, StreamingEpisode } from '../../shared/providers';

export const CATALOG_EPISODES_NOTICE = 'Lista do AniList. A disponibilidade de vídeo é consultada ao abrir cada episódio.';

/**
 * Numbered episodes from the AniList catalog, used only when no source index answered.
 * The count is catalog metadata, not proof of media: each episode is still resolved
 * by the connected sources when it is opened. Releasing titles list aired episodes only.
 */
export function catalogEpisodeList(anime: CatalogAnime | undefined | null, prefix: 'tatakai' | 'toko' = 'tatakai'): StreamingEpisode[] {
  if (!anime || !/^[1-9]\d{0,8}$/.test(anime.id)) return [];
  const status = anime.status;
  const total = status === 'RELEASING' ? anime.airedEpisodes
    : status === 'FINISHED' || status === 'CANCELLED' || status === 'HIATUS' ? anime.airedEpisodes ?? anime.episodeCount
      : undefined;
  if (!total || !Number.isInteger(total) || total < 1 || total > 5_000) return [];
  return Array.from({ length: total }, (_, index) => ({ id: `${prefix}:${anime.id}:${index + 1}`, number: index + 1, title: `Episódio ${index + 1}` }));
}

/** Keep a source index intact. Bound catalog metadata by the AniList episode count when known. */
export function withCatalogEpisodes(availability: StreamingAvailability | null | undefined, anime: CatalogAnime | undefined | null): StreamingAvailability | null {
  if (availability?.episodes.length && !availability.catalogFallback) return availability;
  const episodes = catalogEpisodeList(anime);
  if (availability?.catalogFallback && availability.episodes.length) {
    if (anime?.status === 'NOT_YET_RELEASED' || anime?.status === 'RELEASING' && !episodes.length) {
      return { ...availability, episodes: [] };
    }
    if (!episodes.length) return availability;
    const metadata = new Map(availability.episodes.map(episode => [episode.id, episode]));
    return { ...availability, episodes: episodes.map(episode => {
      const match = metadata.get(episode.id);
      return match && match.number === episode.number ? { ...episode, title: match.title, thumbnail: match.thumbnail } : episode;
    }) };
  }
  if (!episodes.length) return availability ?? null;
  return { available: false, state: 'unavailable', message: CATALOG_EPISODES_NOTICE, episodes, catalogFallback: true, diagnostics: availability?.diagnostics };
}
