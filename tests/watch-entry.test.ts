import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Playback, StreamingAvailability } from '../src/shared/providers';
import type { WatchProgress } from '../src/frontend/services/library';

const mocks = vi.hoisted(() => ({ episodes: vi.fn(), playback: vi.fn(), content: vi.fn(), history: vi.fn() }));
vi.mock('../src/frontend/services/streaming', () => ({ streamingService: { episodes: mocks.episodes, playback: mocks.playback } }));
vi.mock('../src/frontend/services/content', () => ({ contentService: { playback: mocks.content } }));
vi.mock('../src/frontend/services/library', () => ({ libraryService: { getHistory: mocks.history } }));
vi.mock('../src/frontend/pages/WatchPage', () => ({ WatchPage: () => null }));

const anime = { id: '21', title: 'Anime fixture', titleOriginal: 'Original fixture', poster: '', genres: [] };
const episodes = [
  { id: 'tatakai:21:1', number: 1, title: 'Primeiro', available: false },
  { id: 'tatakai:21:2', number: 2, title: 'Segundo' },
  { id: 'tatakai:21:3', number: 3, title: 'Terceiro', available: false },
  { id: 'tatakai:21:4', number: 4, title: 'Quarto' },
];
const availability: StreamingAvailability = { available: true, episodes };
const playback: Playback = {
  episode: episodes[1], sources: [{ url: 'https://example.test/demo.m3u8', type: 'hls' }],
  subtitles: [], audioLanguages: [], isDemo: true,
};
const progress = (episodeId: string, completed = false): WatchProgress => ({ episodeId, completed, title: 'Fixture', currentTime: 25, duration: 600, updatedAt: 1 });

describe('watch entry preparation and episode selection', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.episodes.mockReset().mockResolvedValue(availability);
    mocks.playback.mockReset().mockResolvedValue(playback);
    mocks.content.mockReset().mockRejectedValue(new Error('Fixture first episode absent'));
    mocks.history.mockReset().mockReturnValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it('shares pending and completed index requests for equivalent title hints', async () => {
    let release!: (value: StreamingAvailability) => void;
    mocks.episodes.mockImplementation(() => new Promise<StreamingAvailability>(resolve => { release = resolve; }));
    const { watchEpisodes } = await import('../src/frontend/services/watchEntry');
    const first = watchEpisodes('21', [' Anime fixture ', 'Anime fixture']);
    const second = watchEpisodes('21', ['Anime fixture']);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(mocks.episodes).toHaveBeenCalledOnce();
    release(availability);
    await expect(first).resolves.toBe(availability);
    await expect(watchEpisodes('21', ['Anime fixture'])).resolves.toBe(availability);
    expect(mocks.episodes).toHaveBeenCalledOnce();
  });

  it('keeps distinct title identities and explicit refresh separate', async () => {
    const { watchEpisodes } = await import('../src/frontend/services/watchEntry');
    await watchEpisodes('21', ['First fixture']);
    await watchEpisodes('21', ['Other fixture']);
    await watchEpisodes('21', ['Other fixture'], true);
    expect(mocks.episodes).toHaveBeenCalledTimes(3);
  });

  it('removes rejected preparation so a later attempt can recover', async () => {
    mocks.playback.mockRejectedValueOnce(new Error('Fixture source unavailable'));
    const { watchPlayback } = await import('../src/frontend/services/watchEntry');
    await expect(watchPlayback('tatakai:21:2')).rejects.toThrow('Fixture source unavailable');
    await expect(watchPlayback('tatakai:21:2')).resolves.toBe(playback);
    expect(mocks.playback).toHaveBeenCalledTimes(2);
  });

  it('refreshes tickets before a provider expiry shorter than the normal cache window', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-10-28T16:00:00Z').getTime();
    vi.setSystemTime(now);
    mocks.playback.mockResolvedValue({ ...playback, expiresAt: new Date(now + 10_000).toISOString() });
    const { watchPlayback } = await import('../src/frontend/services/watchEntry');
    await watchPlayback('tatakai:21:2');
    vi.setSystemTime(now + 4999);
    await watchPlayback('tatakai:21:2');
    expect(mocks.playback).toHaveBeenCalledOnce();
    vi.setSystemTime(now + 5001);
    await watchPlayback('tatakai:21:2');
    expect(mocks.playback).toHaveBeenCalledTimes(2);
  });

  it('bounds cached episode lookups instead of accumulating every hovered title', async () => {
    const { watchEpisodes } = await import('../src/frontend/services/watchEntry');
    for (let index = 1; index <= 7; index++) await watchEpisodes(String(index));
    await watchEpisodes('1');
    expect(mocks.episodes).toHaveBeenCalledTimes(8);
  });

  it('starts with an indexed available episode and never invents an episode for an empty index', async () => {
    const { selectWatchEpisode } = await import('../src/frontend/services/watchEntry');
    expect(selectWatchEpisode('21', episodes)).toBe(episodes[1]);
    expect(selectWatchEpisode('21', [])).toBeUndefined();
    expect(selectWatchEpisode('21', [episodes[0]])).toBeUndefined();
  });

  it('resumes a matching unfinished episode while ignoring history from another work', async () => {
    mocks.history.mockReturnValue([progress('tatakai:99:4'), progress('tatakai:21:4')]);
    const { selectWatchEpisode } = await import('../src/frontend/services/watchEntry');
    expect(selectWatchEpisode('21', episodes)).toBe(episodes[3]);
  });

  it('continues after a completed episode while skipping unavailable entries and retaining the last episode', async () => {
    const { selectWatchEpisode } = await import('../src/frontend/services/watchEntry');
    mocks.history.mockReturnValue([progress('tatakai:21:2', true)]);
    expect(selectWatchEpisode('21', episodes)).toBe(episodes[3]);
    mocks.history.mockReturnValue([progress('tatakai:21:4', true)]);
    expect(selectWatchEpisode('21', episodes)).toBe(episodes[3]);
  });

  it('prepares the selected episode once and absorbs source failures during optional prefetch', async () => {
    const { prepareAnimeWatch } = await import('../src/frontend/services/watchEntry');
    await prepareAnimeWatch(anime);
    await prepareAnimeWatch(anime);
    expect(mocks.episodes).toHaveBeenCalledOnce();
    expect(mocks.playback).toHaveBeenCalledOnce();
    expect(mocks.playback).toHaveBeenCalledWith(episodes[1].id, [anime.title, anime.titleOriginal]);
    mocks.episodes.mockRejectedValueOnce(new Error('Fixture index unavailable'));
    await expect(prepareAnimeWatch({ ...anime, id: '99' })).resolves.toBeUndefined();
  });

  it('resolves the backend-issued episode before a pending index and reuses its playback without another endpoint', async () => {
    let release!: (value: StreamingAvailability) => void;
    mocks.episodes.mockImplementation(() => new Promise<StreamingAvailability>(resolve => { release = resolve; }));
    const issued = { ...playback, episode: { id: 'toko:21:1', number: 1, title: 'Identidade emitida pela fixture do backend' } };
    mocks.content.mockResolvedValue(issued);
    const { watchEpisodes, watchPlayback, watchStart } = await import('../src/frontend/services/watchEntry');
    const pendingIndex = watchEpisodes('21', [anime.title]);
    const started = await watchStart('21', [anime.title]);
    expect(started).toBe(issued);
    expect(mocks.content).toHaveBeenCalledWith('21', '1', { titles: [anime.title] });
    await expect(watchPlayback(issued.episode.id, [anime.title])).resolves.toBe(issued);
    expect(mocks.playback).not.toHaveBeenCalled();
    release(availability);
    await pendingIndex;
  });

  it('falls back to the actual fractional index when episode one cannot be resolved', async () => {
    const special = { id: 'toko:21:0.5', number: 0.5, title: 'Especial da fixture' };
    mocks.episodes.mockResolvedValue({ available: true, episodes: [special, ...episodes] });
    mocks.playback.mockResolvedValue({ ...playback, episode: special });
    const { watchStart } = await import('../src/frontend/services/watchEntry');
    await expect(watchStart('21', [anime.title])).resolves.toMatchObject({ episode: special });
    expect(mocks.playback).toHaveBeenCalledWith(special.id, [anime.title]);
    expect(mocks.content).toHaveBeenCalledWith('21', '1', { titles: [anime.title] });
  });

  it('resumes a previously issued unfinished episode without waiting for an index or guessing episode one', async () => {
    mocks.history.mockReturnValue([progress(episodes[3].id)]);
    const { watchStart } = await import('../src/frontend/services/watchEntry');
    await watchStart('21', [anime.title]);
    expect(mocks.playback).toHaveBeenCalledWith(episodes[3].id, [anime.title]);
    expect(mocks.content).not.toHaveBeenCalled();
    expect(mocks.episodes).not.toHaveBeenCalled();
  });

  it('uses the index after a completed episode so entry continues forward instead of restarting episode one', async () => {
    mocks.history.mockReturnValue([progress(episodes[1].id, true)]);
    const { watchStart } = await import('../src/frontend/services/watchEntry');
    await watchStart('21', [anime.title]);
    expect(mocks.playback).toHaveBeenCalledWith(episodes[3].id, [anime.title]);
    expect(mocks.content).not.toHaveBeenCalled();
    expect(mocks.episodes).toHaveBeenCalledOnce();
  });
  it('opens the explicitly scheduled episode instead of an unrelated saved position', async () => {
    mocks.history.mockReturnValue([progress(episodes[1].id)]);
    const issued = { ...playback, episode: { id: 'toko:21:5', number: 5, title: 'Quinto' } };
    mocks.content.mockResolvedValue(issued);
    const { watchStart, watchPlayback } = await import('../src/frontend/services/watchEntry');
    await expect(watchStart('21', [anime.title], false, 5)).resolves.toBe(issued);
    expect(mocks.content).toHaveBeenCalledWith('21', '5', { titles: [anime.title] });
    await expect(watchPlayback(issued.episode.id, [anime.title])).resolves.toBe(issued);
    expect(mocks.playback).not.toHaveBeenCalled();
  });

  it('does not substitute episode one when a scheduled episode is unavailable', async () => {
    const { watchStart } = await import('../src/frontend/services/watchEntry');
    await expect(watchStart('21', [anime.title], false, 5)).rejects.toThrow();
    expect(mocks.content).toHaveBeenCalledOnce();
    expect(mocks.episodes).not.toHaveBeenCalled();
    expect(mocks.playback).not.toHaveBeenCalled();
  });

  it('does not reuse an entry cached for a different episode in watch history', async () => {
    mocks.history.mockReturnValue([progress(episodes[1].id)]);
    const { watchStart } = await import('../src/frontend/services/watchEntry');
    await watchStart('21', [anime.title]);
    mocks.history.mockReturnValue([progress(episodes[3].id)]);
    await watchStart('21', [anime.title]);
    expect(mocks.playback.mock.calls.map(call => call[0])).toEqual([episodes[1].id, episodes[3].id]);
  });

});
