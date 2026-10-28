import type { CatalogAnime, Playback, StreamingAvailability, StreamingEpisode } from '../../shared/providers';
import { normalizedTitleHints } from '../../shared/titleHints';
import { libraryService } from './library';
import { streamingService } from './streaming';
import { contentService } from './content';

interface CachedRequest<T> { promise: Promise<T>; expires: number; pending: boolean }
const episodeRequests = new Map<string, CachedRequest<StreamingAvailability>>();
const playbackRequests = new Map<string, CachedRequest<Playback>>();
const entryRequests = new Map<string, CachedRequest<Playback>>();
const requestKey = (id: string, titles?: string[]) => JSON.stringify([id, normalizedTitleHints(titles)]);

/** Keep a small, short-lived cache in memory; media tickets never enter storage. */
function cached<T>(cache: Map<string, CachedRequest<T>>, key: string, loader: () => Promise<T>, ttl: number, refresh: boolean) {
  const previous = cache.get(key);
  if (!refresh && previous && (previous.pending || previous.expires > Date.now())) return previous.promise;
  const request: CachedRequest<T> = { promise: Promise.resolve().then(loader), expires: 0, pending: true };
  cache.set(key, request);
  while (cache.size > 6) cache.delete(cache.keys().next().value!);
  request.promise = request.promise.then(value => {
    request.pending = false;
    request.expires = Date.now() + ttl;
    // Providers may explicitly issue tickets with a shorter validity window.
    if (value && typeof value === 'object' && 'expiresAt' in value && typeof value.expiresAt === 'string') {
      const expiry = Date.parse(value.expiresAt);
      if (Number.isFinite(expiry)) request.expires = Math.min(request.expires, expiry - 5000);
    }
    return value;
  }, error => {
    if (cache.get(key) === request) cache.delete(key);
    throw error;
  });
  return request.promise;
}

export const watchEpisodes = (id: string, titles?: string[], refresh = false) => cached(episodeRequests,
  requestKey(id, titles), () => streamingService.episodes(id, titles), 120_000, refresh);

export const watchPlayback = (id: string, titles?: string[], refresh = false) => cached(playbackRequests,
  requestKey(id, titles), () => streamingService.playback(id, titles), 20_000, refresh);

/** Resolve media through the backend before the complete episode index is ready. */
export const watchStart = (animeId: string, titles?: string[], refresh = false, preferredEpisode?: number) => {
  const progress = libraryService.getHistory().find(item =>
    item.anime?.id === animeId || /^(?:tatakai|toko):([1-9]\d*):/.exec(item.episodeId)?.[1] === animeId);
  return cached(entryRequests, JSON.stringify([requestKey(animeId, titles), progress?.episodeId, progress?.completed, preferredEpisode]), async () => {
    const resolveIndexed = async () => {
      // Fractional/special episode indexes may begin somewhere other than 1.
      const availability = await watchEpisodes(animeId, titles, refresh);
      const first = selectWatchEpisode(animeId, availability.episodes);
      if (!first) throw new Error(availability.message || 'Os episódios deste anime ainda não foram encontrados nas fontes conectadas.');
      return watchPlayback(first.id, titles, refresh);
    };
    const playback = preferredEpisode !== undefined ? await contentService.playback(animeId, String(preferredEpisode), { titles })
      : progress ? progress.completed ? await resolveIndexed() : await watchPlayback(progress.episodeId, titles, refresh)
      : await contentService.playback(animeId, '1', { titles }).catch(resolveIndexed);
    const expiresAt = Date.parse(playback.expiresAt || '');
    playbackRequests.set(requestKey(playback.episode.id, titles), {
      promise: Promise.resolve(playback), pending: false,
      expires: Math.min(Date.now() + 20_000, Number.isFinite(expiresAt) ? expiresAt - 5000 : Infinity),
    });
    while (playbackRequests.size > 6) playbackRequests.delete(playbackRequests.keys().next().value!);
    return playback;
  }, 20_000, refresh);
};

export function selectWatchEpisode(animeId: string, episodes: StreamingEpisode[]): StreamingEpisode | undefined {
  const available = episodes.filter(episode => episode.available !== false);
  const history = libraryService.getHistory().find(progress => available.some(episode => episode.id === progress.episodeId)
    && (progress.anime?.id === animeId || /^(?:tatakai|toko):([1-9]\d*):/.exec(progress.episodeId)?.[1] === animeId));
  if (history) {
    const index = available.findIndex(episode => episode.id === history.episodeId);
    if (!history.completed) return available[index];
    return available[index + 1] || available[index];
  }
  return available[0];
}

export const loadWatchPage = () => import('../pages/WatchPage');

/** Warm only deliberate hover/focus intent, never every card in the catalog. */
export async function prepareAnimeWatch(anime: CatalogAnime, preferredEpisode?: number): Promise<void> {
  const titles = [anime.title, anime.titleOriginal || ''].filter(Boolean);
  await Promise.allSettled([
    loadWatchPage(),
    watchStart(anime.id, titles, false, preferredEpisode),
    watchEpisodes(anime.id, titles),
  ]);
}
