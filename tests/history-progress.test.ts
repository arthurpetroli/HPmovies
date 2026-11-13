import { describe, expect, it } from 'vitest';
import type { WatchProgress } from '../src/frontend/services/library';
import { historyWatchLocation, progressDisplayTitle, progressEpisodeLabel } from '../src/frontend/services/historyProgress';
import { cinemaForEpisode, stremioWatchIdentity } from '../src/frontend/services/watchCinemaContext';

const progress: WatchProgress = {
  episodeId: 'stremio:all:movie:tt27543632', title: 'Filme · tt27543632',
  currentTime: 30, duration: 600, updatedAt: 123, completed: false,
};
const cinema = { id: 'tt27543632', type: 'movie' as const, title: 'The Housemaid', genres: ['Drama'] };

describe('history identity and navigation', () => {
  it('labels legacy anime episodes from their playback identity and supports fractional episodes', () => {
    expect(progressEpisodeLabel({ ...progress, episodeId: 'tatakai:170000:7', episodeNumber: 99 })).toBe('Episódio 7');
    expect(progressEpisodeLabel({ ...progress, episodeId: 'toko:1:12.5' })).toBe('Episódio 12.5');
    expect(progressEpisodeLabel({ ...progress, episodeId: 'native-id', episodeNumber: 4 })).toBe('Episódio 4');
    expect(progressEpisodeLabel({ ...progress, episodeId: 'demo' })).toBeUndefined();
  });

  it('takes movie and series numbering from the exact route rather than stored hints', () => {
    expect(progressEpisodeLabel(progress)).toBe('Filme');
    expect(progressEpisodeLabel({ ...progress, episodeId: 'stremio:all:tt0903747:2:3', season: 8, episodeNumber: 90 })).toBe('Temporada 2 · Episódio 3');
    expect(progressEpisodeLabel({ ...progress, episodeId: 'stremio:provider-one:tt0903747:0:1' })).toBe('Temporada 0 · Episódio 1');
  });

  it.each(['stremio:all:tt0903747:02:3', 'stremio:all:tt0903747:2:0', 'stremio:all:tt0903747:1001:1', 'stremio:all:tt0903747:2:100001', 'stremio:all:movie:tt27543632:1', 'stremio:all:movie:other'])('rejects malformed playback identity: %s', id => {
    expect(stremioWatchIdentity(id)).toBeUndefined();
    expect(cinemaForEpisode(id, cinema)).toBeUndefined();
  });

  it('accepts only metadata for the requested IMDb ID and media type', () => {
    expect(cinemaForEpisode(progress.episodeId, { ...cinema, id: 'tt0903747' }, cinema)).toBe(cinema);
    expect(cinemaForEpisode(progress.episodeId, { ...cinema, type: 'series' })).toBeUndefined();
    expect(cinemaForEpisode(progress.episodeId, { ...cinema, genres: 'Drama' })).toBeUndefined();
  });

  it('uses human titles while legacy technical titles await metadata', () => {
    expect(progressDisplayTitle(progress)).toBe('Filme');
    expect(progressDisplayTitle({ ...progress, episodeId: 'stremio:all:tt0903747:2:3', title: 'Episódio 3 · temporada 2' })).toBe('Série');
    expect(progressDisplayTitle({ ...progress, cinema })).toBe(cinema.title);
    expect(progressDisplayTitle({ ...progress, title: 'A title already saved' })).toBe('A title already saved');
  });

  it('restores cinema context in a shareable route without putting artwork or progress in the URL', () => {
    const location = historyWatchLocation({ ...progress, cinema });
    const url = new URL(location.to, 'http://hpmovies.invalid');
    expect(decodeURIComponent(url.pathname)).toBe(`/watch/${progress.episodeId}`);
    expect([...url.searchParams]).toEqual([['cinema', 'movie'], ['title', cinema.title]]);
    expect(location.state).toMatchObject({ cinema, resume: true });
    const legacy = new URL(historyWatchLocation(progress).to, url.origin);
    expect(legacy.searchParams.get('cinema')).toBe('movie');
    expect(legacy.searchParams.has('title')).toBe(false);
  });

  it('preserves the existing anime route and its resume intent', () => {
    const anime = { id: '170000', title: 'Chained Soldier Season 2', genres: [] };
    const location = historyWatchLocation({ ...progress, episodeId: 'tatakai:170000:7', anime });
    expect(location.to).toBe('/watch/tatakai%3A170000%3A7');
    expect(location.state).toMatchObject({ anime, resume: true });
  });
});
