import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import { MangaLivreProvider, validateMangaLivreId } from '../src/aniwatch-apis/src/providers/mangalivre';
import type { ContentImageGateway } from '../src/aniwatch-apis/src/providers/content-image';

// Synthetic HTML models public Madara markup. Live checks are recorded separately.
const origin = 'https://mangalivre.to';
const workId = 'mangalivre:historia-qa';
const chapterId = `${workId}/capitulo-1`;
const cover = `${origin}/wp-content/uploads/2026/10/cover.webp`;
const pageOne = `${origin}/wp-content/uploads/WP-manga/data/qa/001.webp`;
const pageTwo = `${origin}/wp-content/uploads/WP-manga/data/qa/002.webp`;
const webp = Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 1, 2, 3]);
const html = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
const canonical = (path: string) => `<link rel="canonical" href="${origin}${path}">`;
const chapterRow = (number: number, title = `Capítulo ${number}`, extras = '') => `<div class='chapter-box'><a href='${origin}/manga/historia-qa/capitulo-${number}/'>${title}</a>${extras}<div class='chapter-date'>10 de outubro de 2026</div></div>`;
const work = (chapters = chapterRow(2) + chapterRow(1) + chapterRow(1), extra = '') => canonical('/manga/historia-qa/') + `
<div class="profile-manga"><div class="post-title"><h1>História &amp; Ação</h1></div>
<div class="summary_image"><img src="${cover}"></div>
<div class="author-content"><a href="${origin}/manga-author/autor-qa/">Autor QA</a></div>
<div class="genres-content"><a href="${origin}/genero/aventura/">Aventura</a></div>
<div class="post-content_item"><div class="summary-heading"><h5>Status</h5></div><div class="summary-content">Em Andamento</div></div>
<div class="post-content_item"><div class="summary-heading"><h5>Lançamento</h5></div><div class="summary-content"><a href="${origin}/ano-de-lancamento/2026/">2026</a></div></div>
<div class="summary__content"><p>Uma sinopse <strong>em português</strong>.</p></div>${extra}</div>
<div class="listing-chapters-wrap">${chapters}</div>`;
const pages = (sources = [pageOne, pageTwo], chapter = 'capitulo-1') => canonical(`/manga/historia-qa/${chapter}/`) + `<input id="wp-manga-current-chap" value="${chapter}"><div class="reading-content">${sources.map((source, index) => `<div class="page-break"><img id="image-${index}" class="wp-manga-chapter-img" src=" ${source}"></div>`).join('')}</div>`;
const card = (slug = 'historia-qa', title = 'História QA', extra = '') => `<div class="page-item-detail manga"><div class="item-thumb"><a href="${origin}/manga/${slug}/"><img src="${cover}"></a></div><div class="item-summary"><div class="post-title"><h3><a href="${origin}/manga/${slug}/">${title}</a></h3></div>${extra}</div></div>`;
const gateway = () => ({
  issue: vi.fn<ContentImageGateway['issue']>(() => `/api/content/image/${randomUUID()}`),
  image: vi.fn(async () => ({ bytes: webp, contentType: 'image/webp', cacheControl: 'private, max-age=60' })),
});
function provider(fetcher: typeof fetch) {
  const imageGateway = gateway();
  return { imageGateway, service: new MangaLivreProvider({ fetcher, imageGateway, cache: new AniwatchAPICache(), requestIntervalMs: 0 }) };
}

describe('Mangá Livre public mangalivre.to provider', () => {
  it('keeps source-qualified identities and rejects arbitrary URLs or traversal before requests', async () => {
    const fetcher = vi.fn<typeof fetch>(); const { service } = provider(fetcher);
    expect(validateMangaLivreId(workId)).toBe(workId);
    expect(validateMangaLivreId(chapterId, true)).toBe(chapterId);
    for (const id of ['https://mangalivre.to/manga/story/', '../admin', 'mangalivre:../../admin', 'mangalivre:story?url=private', 'mangalivre:story%2fadmin']) {
      await expect(service.details(id)).rejects.toMatchObject({ status: 400 });
    }
    await expect(service.pages(workId)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes a real-shaped title, PT-BR metadata, authors and scoped cover tickets', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => html(work())); const { service, imageGateway } = provider(fetcher);
    const [first, second] = await Promise.all([service.details(workId), service.details(workId)]);
    expect(first).toEqual(second); expect(fetcher).toHaveBeenCalledOnce();
    expect(first).toMatchObject({ id: workId, title: 'História & Ação', description: 'Uma sinopse em português .', year: 2026, status: 'ongoing', availableLanguages: ['pt-br'], authors: ['Autor QA'], sourceUrl: `${origin}/manga/historia-qa/`, contentRating: 'suggestive', providerId: 'mangalivre' });
    expect(first.tags).toEqual([{ id: 'mangalivre:tag:aventura', name: 'Aventura' }]);
    expect(first.poster).toMatch(/^\/api\/manga\/image\/[0-9a-f-]{36}$/);
    expect(imageGateway.issue).toHaveBeenCalledWith(expect.objectContaining({ allowedMediaHosts: ['mangalivre.to'], allowedProviders: ['mangalivre'] }), 'mangalivre', cover, { referer: `${origin}/` });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('deduplicates chapter URLs, sorts numbers naturally and does not invent page counts or volumes', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => html(work(chapterRow(10) + chapterRow(2) + chapterRow(1) + chapterRow(2))));
    const { service } = provider(fetcher);
    const result = await service.chapters(workId, 'pt-br');
    expect(result.total).toBe(3); expect(result.items.map(item => item.chapter)).toEqual(['1', '2', '10']);
    expect(result.items.every(item => item.volume === null && item.pages === 0 && item.language === 'pt-br' && item.groups.length === 0)).toBe(true);
    expect(await service.chapters(workId, 'en')).toMatchObject({ items: [], total: 0 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('paginates the complete chapter index and preserves explicit volume labels', async () => {
    const chapters = Array.from({ length: 102 }, (_, index) => chapterRow(index + 1, index === 0 ? 'Volume 3 Capítulo 1' : `Capítulo ${index + 1}`)).join('');
    const { service } = provider(vi.fn(async () => html(work(chapters))));
    const first = await service.chapters(workId, 'pt'); const next = await service.chapters(workId, 'PT-BR', 2);
    expect(first).toMatchObject({ total: 102, hasNextPage: true }); expect(first.items).toHaveLength(100);
    expect(first.items[0].volume).toBe('3'); expect(next.items.map(item => item.chapter)).toEqual(['101', '102']);
    expect(next.hasNextPage).toBe(false);
  });

  it('preserves source chapter slugs containing underscores instead of silently omitting editions', async () => {
    const extra = `<div class="chapter-box"><a href="${origin}/manga/historia-qa/capitulo-2_1/">Capitulo 2_1</a></div>`;
    const { service } = provider(vi.fn(async () => html(work(chapterRow(1) + chapterRow(2) + extra))));
    const feed = await service.chapters(workId);
    expect(feed.total).toBe(3);
    expect(feed.items.map(item => item.id)).toContain(`${workId}/capitulo-2_1`);
  });

  it('resolves all chapter pages in order, credits pages intact, and source-bound navigation', async () => {
    const fetcher = vi.fn<typeof fetch>(async input => html(new URL(String(input)).pathname.endsWith('/capitulo-1/') ? pages([pageOne, pageTwo, pageTwo]) : work()));
    const { service, imageGateway } = provider(fetcher);
    const content = await service.pages(chapterId);
    expect(content.chapter).toMatchObject({ id: chapterId, mangaId: workId, chapter: '1', pages: 2, language: 'pt-br' });
    expect(content.pages).toHaveLength(2); expect(content.pages.every(page => /^\/api\/manga\/image\/[0-9a-f-]{36}$/.test(page))).toBe(true);
    expect(content.sourceUrl).toBe(`${origin}/manga/historia-qa/capitulo-1/`);
    expect(content.navigation).toEqual({ previousId: undefined, nextId: `${workId}/capitulo-2` });
    expect(imageGateway.issue.mock.calls.map(call => call[2])).toEqual([cover, pageOne, pageTwo]);
    expect((await service.chapters(workId)).items[0].pages).toBe(2);
    await expect(service.pages(`${workId}/capitulo-999`)).rejects.toMatchObject({ status: 404 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [() => pages([`${origin}/wp-content/uploads/qa/001.webp`, 'https://attacker.example/private.png']), 'untrusted image host'],
    [() => pages([`${origin}/wp-content/uploads/qa/001.webp?token=secret`]), 'image credentials'],
    [() => pages([`${origin}/admin/private.jpg`]), 'non-media source path'],
    [() => pages([pageOne], 'capitulo-2'), 'wrong canonical chapter'],
    [() => pages().replace('value="capitulo-1"', 'value="capitulo-2"'), 'wrong chapter identity'],
    [() => pages([]), 'empty reading content'],
  ])('rejects %s instead of returning a partial chapter (%s)', async (content) => {
    const fetcher = vi.fn<typeof fetch>(async input => html(new URL(String(input)).pathname.endsWith('/capitulo-1/') ? content() : work()));
    await expect(provider(fetcher).service.pages(chapterId)).rejects.toMatchObject({ code: 'INVALID_MANGALIVRE_RESPONSE' });
  });

  it('only serves owned image tickets and rejects HTML disguised as an image', async () => {
    const { service, imageGateway } = provider(vi.fn(async () => html(work())));
    const manga = await service.details(workId); const token = manga.poster.split('/').at(-1)!;
    expect(service.ownsImage(token)).toBe(true); expect(service.ownsImage(randomUUID())).toBe(false);
    expect((await service.image(token)).bytes).toEqual(webp);
    imageGateway.image.mockResolvedValueOnce({ bytes: new TextEncoder().encode('<html>wrong</html>'), contentType: 'image/webp', cacheControl: 'private' });
    await expect(service.image(token)).rejects.toMatchObject({ code: 'MANGALIVRE_IMAGE_UNAVAILABLE' });
    await expect(service.image('https://127.0.0.1/admin')).rejects.toMatchObject({ status: 404 });
  });

  it('filters adult cards, preserves catalog pagination and supports search filters on verified paths', async () => {
    const catalog = card() + card('adulto-qa', '+18 História', '<span class="manga-title-badges adult">18+</span>') + card('genre-qa', 'Outra história', `<a href="${origin}/genero/hentai/">Hentai</a>`) + `<div class="nav-previous"><a href="${origin}/manga/page/2/">Older</a></div>`;
    const search = card().replace('page-item-detail manga', 'row c-tabs-item__content') + '<h1>21 Resultados</h1>';
    const fetcher = vi.fn<typeof fetch>(async input => html(new URL(String(input)).pathname.startsWith('/manga/') ? catalog : search));
    const { service } = provider(fetcher);
    const result = await service.search({}); expect(result.items).toHaveLength(1); expect(result.hasNextPage).toBe(true);
    const found = await service.search({ search: 'história', status: 'ongoing', tag: 'mangalivre:tag:aventura', sort: 'rating', page: 2 });
    expect(found.items).toHaveLength(1); expect(found.total).toBe(21);
    const url = new URL(String(fetcher.mock.calls[1][0]));
    expect(url.pathname).toBe('/page/2/'); expect(url.searchParams.get('s')).toBe('história');
    expect(url.searchParams.get('post_type')).toBe('wp-manga'); expect(url.searchParams.get('genre[]')).toBe('aventura');
    expect(url.searchParams.get('status[]')).toBe('on-going'); expect(url.searchParams.get('m_orderby')).toBe('rating');
  });

  it('does not surface explicit titles through direct details', async () => {
    const { service } = provider(vi.fn(async () => html(work(undefined, '<a href="https://mangalivre.to/genero/adulto/">Adulto</a>'))));
    await expect(service.details(workId)).rejects.toMatchObject({ status: 404 });
  });

  it('normalizes non-explicit genre links and never follows foreign URLs', async () => {
    const content = `<a href="${origin}/genero/acao/">Ação (20)</a><a href="${origin}/genero/18/">+18</a><a href="https://attacker.example/genero/aventura/">Falso</a>`;
    const { service } = provider(vi.fn(async () => html(content)));
    expect(await service.tags()).toEqual([{ id: 'mangalivre:tag:acao', name: 'Ação' }]);
  });

  it('reports malformed/challenge pages and preserves upstream cooldown without retry storms', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } }));
    const { service } = provider(fetcher);
    await expect(service.search({})).rejects.toMatchObject({ code: 'MANGALIVRE_RATE_LIMIT', retryAfter: 60 });
    await expect(service.details(workId)).rejects.toMatchObject({ code: 'MANGALIVRE_RATE_LIMIT' }); expect(fetcher).toHaveBeenCalledOnce();
    await expect(provider(vi.fn(async () => html('<title>Just a moment...</title>'))).service.details(workId)).rejects.toMatchObject({ code: 'MANGALIVRE_UNAVAILABLE' });
    await expect(provider(vi.fn(async () => html('<html>Maintenance</html>'))).service.details(workId)).rejects.toMatchObject({ code: 'INVALID_MANGALIVRE_RESPONSE' });
    await expect(provider(vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))).service.search({})).rejects.toMatchObject({ code: 'INVALID_MANGALIVRE_RESPONSE' });
  });

  it('bounds declared and streamed HTML sizes and cancels the body', async () => {
    const cancel = vi.fn();
    const declared = new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'text/html', 'Content-Length': String(4 * 1024 * 1024 + 1) } });
    await expect(provider(vi.fn(async () => declared)).service.search({})).rejects.toMatchObject({ code: 'INVALID_MANGALIVRE_RESPONSE' }); expect(cancel).toHaveBeenCalledOnce();
    const streamedCancel = vi.fn();
    const streamed = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); }, cancel: streamedCancel }), { headers: { 'Content-Type': 'text/html' } });
    await expect(provider(vi.fn(async () => streamed)).service.search({})).rejects.toMatchObject({ code: 'INVALID_MANGALIVRE_RESPONSE' }); expect(streamedCancel).toHaveBeenCalledOnce();
  });

  it('keeps successful homepage lists when one source selection fails', async () => {
    const fetcher = vi.fn<typeof fetch>(async input => new URL(String(input)).searchParams.get('m_orderby') === 'rating' ? new Response('', { status: 503 }) : html(card()));
    const home = await provider(fetcher).service.home();
    expect(home.popular).toHaveLength(1); expect(home.topRated).toEqual([]); expect(home.warnings.some(item => item.includes('não responderam'))).toBe(true);
  });
});
