import { afterEach, describe, expect, it, vi } from 'vitest';
import { episodeEnding, episodeIntro } from '../src/frontend/services/intro';

afterEach(() => vi.unstubAllGlobals());

describe('optional opening timing client', () => {
  it('uses the exact episode and real duration with an abortable lookup', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { start: 0.625, end: 104.875 } })));
    vi.stubGlobal('fetch', fetcher);
    expect(await episodeIntro('tatakai:235:1', 1496.50601, new AbortController().signal)).toEqual({ start: 0.625, end: 104.875 });
    expect(fetcher.mock.calls[0][0]).toBe('/api/streaming/episodes/tatakai%3A235%3A1/intro?duration=1496.506');
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('ignores absent, incompatible, malformed or unavailable opening data without failing the video', async () => {
    for (const data of [null, { start: -1, end: 90 }, { start: 5, end: 5 }, { start: 5, end: 1600 }, { start: '5', end: 90 }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }))));
      expect(await episodeIntro('tatakai:235:1', 1496, new AbortController().signal)).toBeUndefined();
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    expect(await episodeIntro('tatakai:235:1', 1496, new AbortController().signal)).toBeUndefined();
  });
  it('never requests demo, unsupported episode formats, or invalid durations', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const id of ['demo', 'stremio:tt0131179:1:1', 'tatakai:235:0', 'tatakai:235:1.5']) expect(await episodeIntro(id, 1496, new AbortController().signal)).toBeUndefined();
    for (const duration of [0, NaN, Infinity, 86401]) expect(await episodeIntro('tatakai:235:1', duration, new AbortController().signal)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requests the ending independently from the opening and validates the same video bounds', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: { start: 1313.25, end: 1405.125 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { start: 1400, end: 1600 } })));
    vi.stubGlobal('fetch', fetcher);
    expect(await episodeEnding('tatakai:235:1', 1496.506, new AbortController().signal)).toEqual({ start: 1313.25, end: 1405.125 });
    expect(fetcher.mock.calls[0][0]).toBe('/api/streaming/episodes/tatakai%3A235%3A1/ending?duration=1496.506');
    expect(await episodeEnding('tatakai:235:1', 1496.506, new AbortController().signal)).toBeUndefined();
  });
});
