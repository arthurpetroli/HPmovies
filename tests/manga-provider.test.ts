import { describe, expect, it, vi } from 'vitest';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import { MangaDexProvider, validateMangaId, validateMangaLanguage, validateMangaPage, validateMangaQuery } from '../src/aniwatch-apis/src/providers/mangadex';
const MANGA = '11111111-1111-4111-8111-111111111111';
const CHAPTER = '22222222-2222-4222-8222-222222222222';
const NEXT = '33333333-3333-4333-8333-333333333333';
const TAG = '44444444-4444-4444-8444-444444444444';
const response = (data: object) => new Response(JSON.stringify({ result: 'ok', ...data }), { headers: { 'Content-Type': 'application/json' } });
const manga = (contentRating = 'safe') => ({ id: MANGA, type: 'manga', attributes: { title: { en: 'Original', 'pt-br': 'Título brasileiro' }, description: { en: 'Synopsis', 'pt-br': 'Sinopse' }, availableTranslatedLanguages: ['en', 'pt-br', null], contentRating, status: 'ongoing', tags: [{ id: TAG, attributes: { name: { en: 'Action' } } }] }, relationships: [{ type: 'cover_art', attributes: { fileName: 'cover.jpg' } }, { type: 'author', attributes: { name: 'Author' } }] });
const chapter = (extra: object = {}) => ({ id: CHAPTER, type: 'chapter', attributes: { title: 'Capítulo um', chapter: '1', volume: '1', translatedLanguage: 'pt-br', pages: 2, ...extra }, relationships: [{ type: 'manga', id: MANGA }, { type: 'scanlation_group', attributes: { name: 'Grupo PT-BR' } }] });
const provider = (fetcher: typeof fetch) => new MangaDexProvider({ fetcher, cache: new AniwatchAPICache(), requestIntervalMs: 0 });

describe('MangaDex public provider', () => {
  it('validates filters, languages, UUIDs and upstream pagination bounds before calling out', () => {
    expect(validateMangaQuery({ search: ' título ', tag: TAG, sort: 'rating', page: '2' })).toMatchObject({ search: 'título', tag: TAG, sort: 'rating', page: 2 });
    for (const params of [{ page: '-1' }, { page: '417' }, { sort: '__proto__' }, { search: 'a'.repeat(121) }, { arbitrary: 'true' }]) expect(() => validateMangaQuery(params)).toThrow();
    expect(() => validateMangaPage('101', true)).toThrow();
    expect(() => validateMangaId('../admin')).toThrow();
    expect(() => validateMangaLanguage('en&translatedLanguage[]=pt-br')).toThrow();
    expect(validateMangaLanguage('pt-br')).toBe('pt-br');
    expect(() => new MangaDexProvider({ baseUrl: 'http://localhost:9999' })).toThrow();
  });
  it('uses real search filters, prioritizes PT-BR metadata and deduplicates cache requests', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: [manga(), manga('pornographic')], total: 100 }));
    const service = provider(fetcher);
    const [first, duplicate] = await Promise.all([service.search({ search: 'story', page: 2, sort: 'rating', tag: TAG }), service.search({ search: 'story', page: 2, sort: 'rating', tag: TAG })]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(first).toEqual(duplicate);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ title: 'Título brasileiro', description: 'Sinopse', availableLanguages: ['pt-br', 'en'], authors: ['Author'] });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get('offset')).toBe('24');
    expect(url.searchParams.get('order[rating]')).toBe('desc');
    expect(url.searchParams.getAll('contentRating[]')).toEqual(['safe', 'suggestive']);
    expect(url.searchParams.get('includedTags[]')).toBe(TAG);
    expect(url.searchParams.getAll('availableTranslatedLanguage[]')).toEqual(['pt-br']);
  });
  it('keeps Brazilian, general Portuguese and all-language catalogs in separate caches and rejects an ignored upstream language filter', async () => {
    const english = { ...manga(), id: NEXT, attributes: { ...manga().attributes, availableTranslatedLanguages: ['en'] } };
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: [manga(), english], total: 2 }));
    const service = provider(fetcher);
    expect((await service.search({})).items).toHaveLength(1);
    expect((await service.search({ language: 'pt' })).items).toHaveLength(1);
    expect((await service.search({ language: 'all' })).items).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.getAll('availableTranslatedLanguage[]')).toEqual(['pt-br', 'pt']);
    expect(new URL(String(fetcher.mock.calls[2][0])).searchParams.has('availableTranslatedLanguage[]')).toBe(false);
    expect(validateMangaQuery({ language: 'PT-BR' }).language).toBe('pt-br');
    expect(() => validateMangaQuery({ language: 'pt&unsafe=1' })).toThrow();
  });
  it('requests both Portuguese variants in a general Portuguese chapter feed without accepting English rows', async () => {
    const fetcher = vi.fn<typeof fetch>(async input => new URL(String(input)).pathname.endsWith('/feed')
      ? response({ data: [chapter(), { ...chapter({ translatedLanguage: 'pt' }), id: NEXT }, { ...chapter({ translatedLanguage: 'en' }), id: TAG }], total: 3 })
      : response({ data: manga() }));
    const result = await provider(fetcher).chapters(MANGA, 'pt');
    expect(result.items.map(item => item.language)).toEqual(['pt-br', 'pt']);
    const feed = fetcher.mock.calls.find(([input]) => String(input).includes('/feed'))!;
    expect(new URL(String(feed[0])).searchParams.getAll('translatedLanguage[]')).toEqual(['pt-br', 'pt']);
  });
  it('keeps metadata and other discovery selections available when a feed or selection fails', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/feed') || url.searchParams.has('order[rating]')) return new Response('Unavailable', { status: 503 });
      if (url.pathname === `/manga/${MANGA}`) return response({ data: manga() });
      return response({ data: [manga()], total: 1 });
    });
    const service = provider(fetcher);
    const home = await service.home();
    expect(home.popular).toHaveLength(1); expect(home.topRated).toEqual([]); expect(home.warnings).toHaveLength(1);
    await expect(service.chapters(MANGA)).rejects.toMatchObject({ code: 'MANGA_UNAVAILABLE' });
    await expect(service.details(MANGA)).resolves.toMatchObject({ id: MANGA });
  });
  it('preserves chapter edition languages, groups and provider pagination', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('/feed?') ? response({ data: [chapter()], total: 150 }) : response({ data: manga() }));
    const result = await provider(fetcher).chapters(MANGA, 'pt-br', 1);
    expect(result).toMatchObject({ language: 'pt-br', hasNextPage: true, total: 150, items: [{ language: 'pt-br', groups: ['Grupo PT-BR'] }] });
    const feedUrl = new URL(String(fetcher.mock.calls.find(([url]) => String(url).includes('/feed?'))?.[0]));
    expect(feedUrl.searchParams.get('translatedLanguage[]')).toBe('pt-br');
  });
  it('keeps readable and external editions together instead of selecting only empty external chapters', async () => {
    const readable = chapter();
    const external = { ...chapter({ pages: 0, externalUrl: 'https://example.org/official-reader' }), id: NEXT };
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith('/feed')) return response({ data: manga() });
      // MangaDex's tri-state value 1 requires that attribute, rather than adding it.
      const data = url.searchParams.get('includeExternalUrl') === '1' || url.searchParams.get('includeEmptyPages') === '1'
        ? [external] : [readable, external];
      return response({ data, total: data.length });
    });
    const result = await provider(fetcher).chapters(MANGA);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ pages: 2, language: 'pt-br' });
    expect(result.items[1].externalUrl).toBe('https://example.org/official-reader');
  });
  it('issues scoped image tickets with valid next chapter navigation', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === `/chapter/${CHAPTER}`) return response({ data: chapter() });
      if (path.endsWith('/aggregate')) return response({ volumes: { '1': { volume: '1', chapters: { '1': { chapter: '1', id: CHAPTER, others: [] }, '2': { chapter: '2', id: NEXT, others: [] } } } } });
      if (path.startsWith('/at-home/')) return response({ baseUrl: 'https://uploads.mangadex.org', chapter: { hash: 'abcdef123', data: ['page1.jpg', 'page2.png'] } });
      return response({ data: manga() });
    });
    const result = await provider(fetcher).pages(CHAPTER);
    expect(result.pages).toHaveLength(2);
    expect(result.pages.every((page) => /^\/api\/manga\/image\/[0-9a-f-]{36}$/.test(page))).toBe(true);
    expect(result.navigation).toEqual({ previousId: undefined, nextId: NEXT });
  });
  it('does not turn external editions, adult works or untrusted image hosts into in-app pages', async () => {
    const external = provider(vi.fn<typeof fetch>(async (input) => String(input).includes('/chapter/') ? response({ data: chapter({ externalUrl: 'https://example.org/official-reader' }) }) : response({ data: manga() })));
    await expect(external.pages(CHAPTER)).resolves.toMatchObject({ pages: [], sourceUrl: 'https://example.org/official-reader' });
    const blocked = provider(vi.fn<typeof fetch>(async () => response({ data: manga('pornographic') })));
    await expect(blocked.details(MANGA)).rejects.toMatchObject({ status: 404 });
    const unsafe = provider(vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.startsWith('/chapter/')) return response({ data: chapter() });
      if (path.startsWith('/at-home/')) return response({ baseUrl: 'https://attacker.example', chapter: { hash: 'abcd', data: ['one.jpg'] } });
      return response({ data: manga() });
    }));
    await expect(unsafe.pages(CHAPTER)).rejects.toMatchObject({ code: 'INVALID_MANGA_RESPONSE' });
  });
  it('honors rate-limit cooldown without retry storms and identifies malformed upstream errors', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
    const service = provider(fetcher);
    await expect(service.search({})).rejects.toMatchObject({ code: 'MANGA_RATE_LIMIT', retryAfter: 60 });
    await expect(service.details(MANGA)).rejects.toMatchObject({ code: 'MANGA_RATE_LIMIT' });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(provider(vi.fn<typeof fetch>(async () => new Response('<html>maintenance</html>'))).search({})).rejects.toMatchObject({ code: 'INVALID_MANGA_RESPONSE' });
  });
  it('keeps loaded pages usable if aggregate chapter navigation is unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.startsWith('/chapter/')) return response({ data: chapter() });
      if (path.endsWith('/aggregate')) return new Response('', { status: 503 });
      if (path.startsWith('/at-home/')) return response({ baseUrl: 'https://uploads.mangadex.org', chapter: { hash: 'abcd', data: ['one.jpg'] } });
      return response({ data: manga() });
    });
    const result = await provider(fetcher).pages(CHAPTER);
    expect(result.pages[0]).toMatch(/^\/api\/manga\/image\//); expect(result.navigation).toBeUndefined();
  });
  it('serves only issued image tickets, deduplicates image reads and rejects non-image responses', async () => {
    let imageType = 'image/png';
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).startsWith('https://uploads.mangadex.org/')
      ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': imageType } }) : response({ data: manga() }));
    const service = provider(fetcher);
    const card = await service.details(MANGA); const token = card.poster.split('/').at(-1)!;
    expect(card.poster).toMatch(/^\/api\/manga\/image\//);
    const [first, second] = await Promise.all([service.image(token), service.image(token)]);
    expect(first.contentType).toBe('image/png'); expect(first.bytes.byteLength).toBe(4); expect(first).toEqual(second);
    expect(fetcher.mock.calls.filter(([input]) => String(input).startsWith('https://uploads.'))).toHaveLength(1);
    const imageRequest = fetcher.mock.calls.find(([input]) => String(input).startsWith('https://uploads.'))!;
    expect(imageRequest[1]).toMatchObject({ redirect: 'error' });
    await expect(service.image('https://127.0.0.1/admin')).rejects.toMatchObject({ status: 404 });
    await expect(service.image(NEXT)).rejects.toMatchObject({ status: 404 });
    imageType = 'text/html'; await expect(service.image(token)).rejects.toMatchObject({ code: 'MANGA_IMAGE_UNAVAILABLE' });
  });
  it('preserves official access-token paths, forces port 443 and reports MangaDex@Home image health', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === 'node.mangadex.network') return new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/jpeg', 'X-Cache': 'HIT' } });
      if (url.pathname === '/report') return new Response('{}');
      if (url.pathname.startsWith('/chapter/')) return response({ data: chapter() });
      if (url.pathname.endsWith('/aggregate')) return response({ volumes: {} });
      if (url.pathname.startsWith('/at-home/')) return response({ baseUrl: 'https://node.mangadex.network/access-token', chapter: { hash: 'abcd', data: ['one.jpg'] } });
      return response({ data: manga() });
    });
    const service = provider(fetcher); const result = await service.pages(CHAPTER);
    await service.image(result.pages[0].split('/').at(-1)!);
    expect(fetcher.mock.calls.some(([input]) => String(input) === 'https://node.mangadex.network/access-token/data/abcd/one.jpg')).toBe(true);
    const atHome = new URL(String(fetcher.mock.calls.find(([input]) => String(input).includes('/at-home/'))?.[0]));
    expect(atHome.searchParams.get('forcePort443')).toBe('true');
    const report = fetcher.mock.calls.find(([input]) => String(input) === 'https://api.mangadex.network/report');
    expect(JSON.parse(String(report?.[1]?.body))).toMatchObject({ success: true, cached: true, bytes: 2 });
  });
  it('rejects oversized images and honors group content-removal configuration', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).startsWith('https://uploads.')
      ? new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '20000001' } }) : response({ data: manga() }));
    const service = provider(fetcher); const card = await service.details(MANGA);
    await expect(service.image(card.poster.split('/').at(-1)!)).rejects.toMatchObject({ code: 'MANGA_IMAGE_UNAVAILABLE' });
    const removed = { ...chapter(), relationships: [{ type: 'manga', id: MANGA }, { type: 'scanlation_group', id: TAG, attributes: { name: 'Removed group' } }] };
    const blocked = new MangaDexProvider({ cache: new AniwatchAPICache(), requestIntervalMs: 0, blockedGroupIds: [TAG], fetcher: vi.fn<typeof fetch>(async () => response({ data: removed })) });
    await expect(blocked.pages(CHAPTER)).rejects.toMatchObject({ code: 'MANGA_EDITION_REMOVED' });
  });
});
