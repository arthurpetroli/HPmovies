import { describe, expect, it, vi } from 'vitest';
import { IntroSkipProvider, parseEndingSkipResponse, parseIntroSkipResponse } from '../src/aniwatch-apis/src/providers/intro-skips';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const identity = (id = 235, idMal: number | null = 235, episodes: number | null = null) => ({ data: { Media: { id, idMal, type: 'ANIME', episodes } } });
const result = (start = 0.625, end = 104.875, episodeLength = 1496.5834) => ({ found: true, statusCode: 200,
  results: [{ skipType: 'op', interval: { startTime: start, endTime: end }, episodeLength }] });
const endingResult = (start = 1350, end = 1440, episodeLength = 1496.5834) => ({ found: true, statusCode: 200,
  results: [{ skipType: 'ed', interval: { startTime: start, endTime: end }, episodeLength }] });

describe('opening metadata matching', () => {
  it('accepts only a known opening with a closely matching video duration', () => {
    expect(parseIntroSkipResponse(result(), 1496.506)).toEqual({ start: 0.625, end: 104.875 });
    expect(parseIntroSkipResponse(result(0, 90, 1422), 1420)).toEqual({ start: 0, end: 90 });
    expect(parseIntroSkipResponse(result(0, 90, 1422.001), 1420)).toBeUndefined();
    expect(parseIntroSkipResponse(result(5.617, 95.617, 1435.193), 1419.960605)).toBeUndefined();
    expect(parseIntroSkipResponse(result(0, 81.1, 1417.16), 1411.451923)).toBeUndefined();
  });

  it('rejects missing, malformed, contradictory or out-of-video intervals', () => {
    for (const payload of [null, { found: false, results: [], statusCode: 404 }, { ...result(), statusCode: 500 },
      result(-1, 90), result(90, 90), result(100, 90), result(0, 1500), result(NaN, 90), result(0, Infinity),
      { ...result(), results: [{ ...result().results[0], skipType: 'ed' }] },
      { ...result(), results: [...result().results, ...result(10, 100).results] }]) {
      expect(parseIntroSkipResponse(payload, 1496.506)).toBeUndefined();
    }
    expect(parseIntroSkipResponse(result(), Infinity)).toBeUndefined();
    expect(parseIntroSkipResponse(result(), 0)).toBeUndefined();
  });
});

describe('ending metadata matching', () => {
  it('keeps ED independent of OP and applies the same strict video-duration check', () => {
    const mixed = { ...endingResult(), results: [...result().results, ...endingResult().results] };
    expect(parseEndingSkipResponse(mixed, 1496.506)).toEqual({ start: 1350, end: 1440 });
    expect(parseIntroSkipResponse(mixed, 1496.506)).toEqual({ start: 0.625, end: 104.875 });
    expect(parseEndingSkipResponse(result(), 1496.506)).toBeUndefined();
    expect(parseIntroSkipResponse(endingResult(), 1496.506)).toBeUndefined();
    expect(parseEndingSkipResponse(endingResult(1350, 1440, 1498), 1496)).toEqual({ start: 1350, end: 1440 });
    expect(parseEndingSkipResponse(endingResult(1350, 1440, 1498.001), 1496)).toBeUndefined();
  });

  it('refuses contradictory, malformed, missing and out-of-video endings', () => {
    for (const payload of [null, { found: false, statusCode: 404, results: [] }, endingResult(-1, 1440),
      endingResult(1440, 1440), endingResult(1440, 1350), endingResult(1350, 1500), endingResult(NaN, 1440),
      { ...endingResult(), results: [...endingResult().results, ...endingResult(1360, 1450).results] }]) {
      expect(parseEndingSkipResponse(payload, 1496.506)).toBeUndefined();
    }
    expect(parseEndingSkipResponse(endingResult(), Infinity)).toBeUndefined();
  });
});

describe('optional intro provider', () => {
  it('resolves exact AniList to MAL IDs, requests only OP and deduplicates lookup work', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('aniskip.com') ? json(result()) : json(identity()));
    const provider = new IntroSkipProvider({ fetcher });
    const [first, duplicate] = await Promise.all([provider.intro('tatakai:235:1', 1496.506), provider.intro('toko:235:1', 1496.506)]);
    expect(first).toEqual({ start: 0.625, end: 104.875 }); expect(duplicate).toEqual(first);
    expect(await provider.intro('tatakai:235:1', 1496.506)).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(calls[0][1].body)).variables).toEqual({ id: 235 });
    const url = new URL(calls[1][0]);
    expect(url.origin).toBe('https://api.aniskip.com'); expect(url.pathname).toBe('/v2/skip-times/235/1');
    expect([...url.searchParams]).toEqual([['types[]', 'op'], ['episodeLength', '1496.506']]);
    expect(calls.every(([, init]) => init.redirect === 'error' && init.signal instanceof AbortSignal)).toBe(true);
  });

  it('requests only ED, shares exact identity work, and separates OP/ED caches and pending requests', async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      return url.hostname === 'api.aniskip.com' ? json(url.searchParams.get('types[]') === 'ed' ? endingResult() : result()) : json(identity());
    });
    const provider = new IntroSkipProvider({ fetcher });
    const [opening, ending, duplicateEnding] = await Promise.all([
      provider.intro('tatakai:235:1', 1496.506), provider.ending('tatakai:235:1', 1496.506), provider.ending('toko:235:1', 1496.506),
    ]);
    expect(opening).toEqual({ start: 0.625, end: 104.875 });
    expect(ending).toEqual({ start: 1350, end: 1440 });
    expect(duplicateEnding).toEqual(ending);
    expect(await provider.ending('toko:235:1', 1496.506)).toEqual(ending);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const urls = fetcher.mock.calls.map(([raw]) => new URL(String(raw))).filter(url => url.hostname === 'api.aniskip.com');
    expect(urls.map(url => url.searchParams.get('types[]')).sort()).toEqual(['ed', 'op']);
    expect(urls.every(url => url.pathname === '/v2/skip-times/235/1' && url.searchParams.get('episodeLength') === '1496.506')).toBe(true);
  });

  it('isolates missing endings from available openings and rejects bad ending requests before fetching', async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.hostname !== 'api.aniskip.com') return json(identity());
      return url.searchParams.get('types[]') === 'ed' ? json({ found: false, results: [] }, 404) : json(result());
    });
    const provider = new IntroSkipProvider({ fetcher });
    expect(await provider.ending('tatakai:235:1', 1496.506)).toBeUndefined();
    expect(await provider.intro('tatakai:235:1', 1496.506)).toEqual({ start: 0.625, end: 104.875 });
    expect(await provider.ending('tatakai:235:1', 1496.506)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(() => provider.ending('tatakai:235:0', 1496.506)).toThrow('episódio');
    expect(() => provider.ending('tatakai:235:1', Infinity)).toThrow('duração');
    expect(await provider.ending('demo', 120)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not search by title or infer another season when MAL identity is absent or mismatched', async () => {
    for (const payload of [identity(235, null), identity(999), identity(235, 235, 1), { data: { Media: null } }]) {
      const fetcher = vi.fn(async () => json(payload));
      expect(await new IntroSkipProvider({ fetcher }).intro('tatakai:235:2', 1496.506)).toBeUndefined();
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it('isolates missing records and failed requests, caches failures briefly and retries later', async () => {
    let now = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('aniskip.com') ? json({ found: false, results: [] }, 404) : json(identity()));
    const provider = new IntroSkipProvider({ fetcher, now: () => now });
    expect(await provider.intro('tatakai:235:1', 1496.506)).toBeUndefined();
    expect(await provider.intro('tatakai:235:1', 1496.506)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 300_001;
    expect(await provider.intro('tatakai:235:1', 1496.506)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
    const offline = new IntroSkipProvider({ fetcher: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(await offline.intro('tatakai:235:1', 1496.506)).toBeUndefined();
  });

  it('separates editions by actual duration while reusing exact catalog identities', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('aniskip.com') ? json(result()) : json(identity()));
    const provider = new IntroSkipProvider({ fetcher });
    expect(await provider.intro('tatakai:235:1', 1496.506)).toBeTruthy();
    expect(await provider.intro('tatakai:235:1', 1470)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('bounds stalled headers and chunked bodies instead of holding requests forever', async () => {
    const stalled = new IntroSkipProvider({ timeoutMs: 15, fetcher: vi.fn(() => new Promise<Response>(() => undefined)) });
    expect(await stalled.intro('tatakai:235:1', 1496.506)).toBeUndefined();
    const body = new ReadableStream<Uint8Array>();
    const stalledBody = new IntroSkipProvider({ timeoutMs: 15, fetcher: vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/json' } })) });
    expect(await stalledBody.intro('tatakai:235:1', 1496.506)).toBeUndefined();
    expect(body.locked).toBe(false);
    const oversized = new IntroSkipProvider({ fetcher: vi.fn(async () => new Response(new Uint8Array(160_001), { headers: { 'Content-Type': 'application/json' } })) });
    expect(await oversized.intro('tatakai:235:1', 1496.506)).toBeUndefined();
  });

  it('rejects invalid episode IDs and durations before any network call', async () => {
    const fetcher = vi.fn(); const provider = new IntroSkipProvider({ fetcher });
    for (const id of ['tatakai:235:0', 'tatakai:235:1.5', 'toko:235:100001', 'https://example.com', 'bad']) expect(() => provider.intro(id, 1496.506)).toThrow('episódio');
    for (const duration of [NaN, Infinity, -1, 0, 86401]) expect(() => provider.intro('tatakai:235:1', duration)).toThrow('duração');
    expect(await provider.intro('demo', 120)).toBeUndefined();
    expect(await provider.intro('stremio:addon:tt1234567:1:1', 120)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
