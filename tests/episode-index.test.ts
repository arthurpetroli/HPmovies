import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const { createEpisodeIndexResolver } = createRequire(import.meta.url)('../src/aniwatch-apis/src/providers/tatakai-runtime/episode-index.cjs');
const params = (anilistId = 21) => ({
  namespace: 'toko', anilistId, titles: ['One Piece'], entry: { runtime: { providers: ['nebula'] } },
  bundle: { listProviders: () => [{ name: 'nebula', kind: 'stream' }] },
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const page = (currentPage: number, totalPages = 1) => ({ id: 21, currentPage, totalPages, totalResults: totalPages * 2, episodes: [{ number: currentPage * 2 - 1, title: `Episode ${currentPage * 2 - 1}` }, { number: currentPage * 2 }] });

describe('real source episode indexing', () => {
  it('collects the actual paginated index, caches per identifier and never infers entries from counts', async () => {
    let now = 0;
    const fetcher = vi.fn(async (raw: string, init: RequestInit) => {
      const url = new URL(raw);
      expect(url.origin).toBe('https://core.justanime.to');
      expect(url.pathname).toBe('/api/anime/21/episodes');
      expect(init).toMatchObject({ redirect: 'error', headers: { Origin: 'https://justanime.to', Referer: 'https://justanime.to/' } });
      return json(page(Number(url.searchParams.get('page')), 3));
    });
    const resolve = createEpisodeIndexResolver({ fetcher, now: () => now });
    const [index, same] = await Promise.all([resolve(params()), resolve(params())]);
    expect(index).toEqual(same);
    expect(index.episodes.map((row: { number: number }) => row.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(index).toMatchObject({ provider: 'nebula', episodeCount: 6 });
    expect(index.episodes[1]).not.toHaveProperty('available');
    expect(fetcher).toHaveBeenCalledTimes(3);
    await resolve(params());
    expect(fetcher).toHaveBeenCalledTimes(3);
    now = 120001;
    await resolve(params());
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('returns only explicitly listed episode numbers, including fractional specials', async () => {
    const fetcher = vi.fn(async () => json({ ...page(1), totalResults: 99, episodes: [{ number: 7 }, { number: 0.5 }, { number: 7 }] }));
    const resolve = createEpisodeIndexResolver({ fetcher });
    expect(await resolve(params())).toEqual({ provider: 'nebula', episodeCount: 2, episodes: [{ number: 0.5 }, { number: 7 }] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves real per-episode image artwork while discarding unsafe optional URLs', async () => {
    const rejected = ['http://images.example.com/episode.jpg', 'https://user:pass@images.example.com/episode.jpg',
      'https://127.0.0.1/episode.jpg', 'https://[::1]/episode.jpg', 'https://localhost/episode.jpg',
      'https://images.internal/episode.jpg', 'https://images.example.com:8443/episode.jpg',
      'https://images.example.com/episode.jpg#fragment', 'https://images.example.com/video.mp4',
      'https://images.example.com/page.html', 'https://images.example.com/' + 'a'.repeat(2048) + '.jpg'];
    const rows = [{ number: 1, title: 'First', image: 'https://images.example.com/first.jpg' },
      { number: 2, thumbnail: 'https://images.example.com/second.webp?size=320' },
      ...rejected.map((image, i) => ({ number: i + 3, image }))];
    const resolve = createEpisodeIndexResolver({ fetcher: async () => json({ ...page(1), totalResults: rows.length, episodes: rows }) });
    const index = await resolve(params());
    expect(index.episodes[0]).toEqual({ number: 1, title: 'First', thumbnail: 'https://images.example.com/first.jpg' });
    expect(index.episodes[1]).toEqual({ number: 2, thumbnail: 'https://images.example.com/second.webp?size=320' });
    expect(index.episodes.slice(2).every((row: { thumbnail?: string }) => row.thumbnail === undefined)).toBe(true);
    expect(index.episodeCount).toBe(rows.length);
  });

  it('returns an empty result for missing titles without caching a false full catalog', async () => {
    const fetcher = vi.fn(async () => json({}, 404));
    expect(await createEpisodeIndexResolver({ fetcher })(params())).toEqual({ provider: null, episodeCount: 0, episodes: [] });
  });

  it('refuses mismatched identities, excessive pages, invalid rows, HTML and changed pagination', async () => {
    for (const data of [{ ...page(1), id: 20 }, { ...page(1), totalPages: 51 }, { ...page(1), episodes: [{ number: 0 }] }, { ...page(1), totalResults: 5001 }]) {
      const resolve = createEpisodeIndexResolver({ fetcher: async () => json(data) });
      await expect(resolve(params())).rejects.toThrow('Invalid source episode index');
    }
    await expect(createEpisodeIndexResolver({ fetcher: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) })(params())).rejects.toThrow();
    const resolve = createEpisodeIndexResolver({ fetcher: async (raw: string) => json(page(Number(new URL(raw).searchParams.get('page')), raw.endsWith('=1') ? 2 : 3)) });
    await expect(resolve(params())).rejects.toThrow('pagination changed');
  });

  it('uses a selected extension method for other providers and validates its returned provider', async () => {
    const fetcher = vi.fn();
    const getWebsiteEpisodeIndex = vi.fn(async () => ({ provider: 'selected', episodeCount: 1, episodes: [{ number: 3, title: 'Third' }] }));
    const input = { ...params(), entry: { runtime: { providers: ['selected'] } }, bundle: { listProviders: () => [{ name: 'selected', kind: 'stream' }], getWebsiteEpisodeIndex } };
    expect(await createEpisodeIndexResolver({ fetcher })(input)).toEqual({ provider: 'selected', episodeCount: 1, episodes: [{ number: 3, title: 'Third' }] });
    expect(fetcher).not.toHaveBeenCalled();
    expect(getWebsiteEpisodeIndex).toHaveBeenCalledWith({ anilistId: 21, titles: ['One Piece'] });
    input.bundle.getWebsiteEpisodeIndex = vi.fn(async () => ({ provider: 'forbidden', episodeCount: 1, episodes: [{ number: 1, title: 'First' }] }));
    await expect(createEpisodeIndexResolver({ fetcher })(input)).rejects.toThrow();
  });

  it('bounds response size before parsing and does not cache failures', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '2000001' } }));
    const resolve = createEpisodeIndexResolver({ fetcher });
    await expect(resolve(params())).rejects.toThrow();
    await expect(resolve(params())).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
