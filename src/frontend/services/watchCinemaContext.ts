import type { CinemaTitle } from '../../shared/cinema';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function isCinemaTitle(value: unknown): value is CinemaTitle {
  return object(value) && typeof value.id === 'string' && /^tt\d{5,12}$/.test(value.id)
    && (value.type === 'movie' || value.type === 'series') && typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 300
    && Array.isArray(value.genres) && value.genres.length <= 100 && value.genres.every(genre => typeof genre === 'string')
    && ['poster', 'background', 'description', 'year', 'runtime'].every(key => value[key] === undefined || typeof value[key] === 'string')
    && (value.rating === undefined || typeof value.rating === 'number' && Number.isFinite(value.rating));
}

/** Media identity comes from the playback ID, never a title hint or navigation state. */
export function stremioWatchIdentity(id: string) {
  const movie = /^stremio:([a-z][a-z0-9-]{0,63}):movie:(tt\d{5,12})$/.exec(id);
  if (movie) return { type: 'movie' as const, provider: movie[1], imdb: movie[2] };
  const series = /^stremio:([a-z][a-z0-9-]{0,63}):(tt\d{5,12}):(0|[1-9]\d{0,3}):([1-9]\d{0,5})$/.exec(id);
  return series && Number(series[3]) <= 1000 && Number(series[4]) <= 100_000
    ? { type: 'series' as const, provider: series[1], imdb: series[2], season: series[3], episode: series[4] } : undefined;
}

export function cinemaForEpisode(episodeId: string, ...candidates: unknown[]): CinemaTitle | undefined {
  const identity = stremioWatchIdentity(episodeId);
  return identity ? candidates.find((value): value is CinemaTitle => isCinemaTitle(value) && value.id === identity.imdb && value.type === identity.type) : undefined;
}

