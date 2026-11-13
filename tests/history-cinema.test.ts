import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CinemaDetails, CinemaType } from '../src/shared/cinema';

const { details } = vi.hoisted(() => ({
  details: vi.fn<(type: CinemaType, id: string) => Promise<CinemaDetails>>(),
}));

vi.mock('../src/frontend/services/cinema', () => ({ cinemaService: { details } }));

const movie = (id = 'tt27543632'): CinemaDetails => ({
  id, type: 'movie', title: 'Filme QA', genres: ['Drama'],
  poster: 'https://images.example.test/poster.jpg', episodes: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('legacy history cinema metadata queue (synthetic responses)', () => {
  beforeEach(() => {
    vi.resetModules();
    details.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('deduplicates simultaneous cards of the same title and caches the compact metadata', async () => {
    const response = deferred<CinemaDetails>();
    details.mockReturnValue(response.promise);
    const { historyCinemaMetadata } = await import('../src/frontend/services/historyCinema');
    const first = historyCinemaMetadata('movie', 'tt27543632');
    const second = historyCinemaMetadata('movie', 'tt27543632');
    expect(second).toBe(first);
    expect(details).toHaveBeenCalledExactlyOnceWith('movie', 'tt27543632');

    response.resolve({ ...movie(), description: 'Unused full description' });
    const metadata = await first;
    expect(metadata).toMatchObject({ id: 'tt27543632', title: 'Filme QA', poster: movie().poster });
    expect(metadata).not.toHaveProperty('episodes');
    expect(metadata).not.toHaveProperty('description');
    expect(await second).toEqual(metadata);
    expect(await historyCinemaMetadata('movie', 'tt27543632')).toEqual(metadata);
    expect(details).toHaveBeenCalledTimes(1);
  });

  it('limits simultaneous requests to four and drains queued titles after completion', async () => {
    const responses = Array.from({ length: 8 }, () => deferred<CinemaDetails>());
    const ids = responses.map((_, index) => `tt${1000000 + index}`);
    let active = 0;
    let peak = 0;
    details.mockImplementation((_type, id) => {
      active++;
      peak = Math.max(peak, active);
      return responses[ids.indexOf(id)].promise.finally(() => { active--; });
    });
    const { historyCinemaMetadata } = await import('../src/frontend/services/historyCinema');
    const requests = ids.map(id => historyCinemaMetadata('movie', id));
    expect(details).toHaveBeenCalledTimes(4);
    expect(active).toBe(4);

    responses.slice(0, 4).forEach((response, index) => response.resolve(movie(ids[index])));
    await Promise.all(requests.slice(0, 4));
    await vi.waitFor(() => expect(details).toHaveBeenCalledTimes(8));
    expect(active).toBe(4);
    responses.slice(4).forEach((response, index) => response.resolve(movie(ids[index + 4])));
    const values = await Promise.all(requests);
    expect(values.map(value => value?.id)).toEqual(ids);
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });

  it('caches a temporary failure for 60 seconds and then retries successfully', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
    details.mockRejectedValueOnce(new Error('Synthetic upstream unavailable')).mockResolvedValue(movie());
    const { historyCinemaMetadata } = await import('../src/frontend/services/historyCinema');
    expect(await historyCinemaMetadata('movie', 'tt27543632')).toBeUndefined();
    vi.setSystemTime(new Date('2026-11-07T12:00:59.999Z'));
    expect(await historyCinemaMetadata('movie', 'tt27543632')).toBeUndefined();
    expect(details).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-11-07T12:01:00Z'));
    expect(await historyCinemaMetadata('movie', 'tt27543632')).toMatchObject({ id: 'tt27543632', title: 'Filme QA' });
    expect(details).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...movie('tt0903747') },
    { ...movie(), type: 'series' as const },
  ])('rejects metadata for a different IMDb or media type: $id/$type', async response => {
    details.mockResolvedValue(response);
    const { historyCinemaMetadata } = await import('../src/frontend/services/historyCinema');
    expect(await historyCinemaMetadata('movie', 'tt27543632')).toBeUndefined();
    expect(details).toHaveBeenCalledExactlyOnceWith('movie', 'tt27543632');
  });
});
