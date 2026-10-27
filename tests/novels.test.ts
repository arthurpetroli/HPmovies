import { describe, expect, it, vi } from 'vitest';
import { AniListNovelProvider, normalizeNovel, validateNovelQuery } from '../src/aniwatch-apis/src/providers/novels';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';

const media = {
  id: 32827, type: 'MANGA', format: 'NOVEL', isAdult: false,
  title: { english: 'Example Novel', romaji: 'Example', native: '例' },
  coverImage: { extraLarge: 'https://example.org/cover.jpg' },
  description: '<b>A story</b><br>with &amp; without formatting.', averageScore: 86,
  startDate: { year: 2009 }, genres: ['Adventure'], chapters: 10, volumes: 2, status: 'FINISHED',
};
function providerWith(data: unknown) {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data }), { status: 200 }));
  return { provider: new AniListNovelProvider({ fetcher, cache: new AniwatchAPICache() }), fetcher };
}

describe('novel provider', () => {
  it('uses AniList MANGA/NOVEL with parameterized filters and preserves honest metadata', async () => {
    const { provider, fetcher } = providerWith({ Page: { pageInfo: { currentPage: 2, hasNextPage: true, total: 40 }, media: [media] } });
    const result = await provider.search({ search: 'Example', genre: 'Adventure', year: 2009, page: 2, sort: 'score' });
    expect(result).toMatchObject({ page: 2, hasNextPage: true, items: [{ id: '32827', title: 'Example Novel', score: 86, description: 'A story\nwith & without formatting.' }] });
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.query).toContain('type: MANGA, format: NOVEL');
    expect(request.variables).toEqual({ search: 'Example', genre: 'Adventure', sort: ['SCORE_DESC'], page: 2, dateStart: 20090100, dateEnd: 20091232 });
    expect(request.variables).not.toHaveProperty('status');
  });

  it('deduplicates identical requests and isolates cache by filters', async () => {
    const { provider, fetcher } = providerWith({ Page: { pageInfo: { currentPage: 1, hasNextPage: false }, media: [media] } });
    await Promise.all([provider.search({ search: 'A' }), provider.search({ search: 'A' })]);
    await provider.search({ search: 'B' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not mistake manga, adult media, or unsafe image URLs for permitted novels', () => {
    expect(() => normalizeNovel({ ...media, format: 'MANGA' })).toThrow();
    expect(() => normalizeNovel({ ...media, isAdult: true })).toThrow();
    expect(normalizeNovel({ ...media, coverImage: { extraLarge: 'javascript:alert(1)' } }).poster).toBe('');
    expect(() => validateNovelQuery({ page: '0' })).toThrow();
    expect(() => validateNovelQuery({ sort: '__proto__' })).toThrow();
    expect(() => validateNovelQuery({ unknown: 'x' })).toThrow();
  });

  it('separates metadata from unavailable third-party chapters without fetching their text', async () => {
    const { provider, fetcher } = providerWith({});
    expect(await provider.chapters('32827')).toMatchObject({ available: false, status: 'not_authorized', chapters: [] });
    expect(await provider.content('32827', '1')).toMatchObject({ available: false, status: 'not_authorized', paragraphs: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('serves clearly attributed original demo text with adjacent chapters', async () => {
    const { provider, fetcher } = providerWith({});
    const demo = await provider.details('demo');
    const chapters = await provider.chapters('demo');
    const content = await provider.content('demo', '2');
    expect(demo.isDemo).toBe(true);
    expect(chapters.chapters).toHaveLength(3);
    expect(content).toMatchObject({ available: true, isDemo: true, providerId: 'hpmovies-original', previousChapterId: '1', nextChapterId: '3', chapter: { language: 'pt-br' } });
    expect(content.paragraphs).toHaveLength(10);
    expect(content.attribution).toContain('Texto original');
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => provider.content('demo', 'missing')).toThrow('Capítulo demonstrativo não encontrado.');
  });

  it('normalizes upstream failures and honors a bounded rate-limit retry time', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '99999' } }));
    const provider = new AniListNovelProvider({ fetcher, cache: new AniwatchAPICache() });
    await expect(provider.search({})).rejects.toMatchObject({ status: 503, code: 'NOVEL_RATE_LIMIT', retryAfter: 3600 });
    fetcher.mockRejectedValueOnce(new DOMException('Timeout', 'TimeoutError'));
    await expect(provider.details('32827')).rejects.toMatchObject({ status: 504, code: 'NOVEL_TIMEOUT' });
  });

  it('times out stalled response bodies and limits oversized upstream JSON', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream({ cancel: cancelled });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(body));
    const provider = new AniListNovelProvider({ fetcher, timeoutMs: 20, cache: new AniwatchAPICache() });
    await expect(provider.search({})).rejects.toMatchObject({ status: 504, code: 'NOVEL_TIMEOUT' });
    expect(cancelled).toHaveBeenCalledOnce();
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(2_000_001)));
    await expect(provider.search({})).rejects.toMatchObject({ status: 502, code: 'NOVEL_RESPONSE_TOO_LARGE' });
  });
});
