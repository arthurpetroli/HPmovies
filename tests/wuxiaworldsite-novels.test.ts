import { describe, expect, it, vi } from 'vitest';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import { validateWuxiaWorldSiteId, WuxiaWorldSiteProvider } from '../src/aniwatch-apis/src/providers/wuxiaworldsite-novels';

// Original, synthetic Madara-shaped fixtures. Live availability is verified separately.
const origin = 'https://wuxiaworld.site';
const id = 'wuxiaworldsite:story-qa';
const chapterId = `${id}/chapter-1`;
const workUrl = `${origin}/novel/story-qa/`;
const response = (body: string, init: ResponseInit = {}) => new Response(body, { ...init, headers: { 'Content-Type': 'text/html; charset=utf-8', ...init.headers } });
const field = (label: string, value: string) => `<div class="post-content_item"><div class="summary-heading"><h5>${label}</h5></div><div class="summary-content">${value}</div></div>`;
function summary(options: { genre?: string; details?: boolean; cover?: string; title?: string; work?: string; score?: string } = {}) {
  const title = options.title ?? 'Story QA', url = options.work ?? workUrl;
  return `<div class="post-title">${options.details ? `<h1>${title}</h1>` : `<h3><a href="${url}">${title}</a></h3>`}</div><div class="tab-summary"><div class="${options.details ? 'summary_image' : 'tab-thumb'}"><a href="${url}"><img src="${origin}/wp-content/themes/madara/images/dflazy.jpg" data-src="${options.cover ?? `${origin}/wp-content/uploads/2026/story.jpg`}" /></a></div>${field(options.details ? 'Author(s)' : 'Authors', '<a href="/manga-author/qa/">Author QA</a>')}${field(options.details ? 'Genre(s)' : 'Genres', `<a href="/genre/action/">${options.genre ?? 'Action'}</a>`)}${field('Status', 'OnGoing')}<span class="score font-meta total_votes">${options.score ?? '4.1'}</span></div>`;
}
const detailHtml = (options: Parameters<typeof summary>[0] = {}) => `<html lang="en"><head><link rel="canonical" href="${workUrl}" /></head><body><header>Header QA</header>${summary({ ...options, details: true })}<div class="summary__content"><p>An original synopsis for the QA fixture.</p></div><div id="manga-chapters-holder" data-id="123"></div></body></html>`;
const genresForm = '<form><input id="action" name="genre[]" value="action" type="checkbox"/><label for="action">Action</label><input id="fantasy" name="genre[]" value="fantasy" type="checkbox"/><label for="fantasy">Fantasy</label><input id="adult" name="genre[]" value="adult" type="checkbox"/><label for="adult">Adult</label><input id="smut" name="genre[]" value="smut" type="checkbox"/><label for="smut">Smut</label></form>';
function catalogHtml(url: URL, options: { card?: string; empty?: boolean; next?: string | false } = {}) {
  const page = Number(/^\/page\/(\d+)\/$/.exec(url.pathname)?.[1] ?? 1);
  const next = options.next ?? `${origin}/page/${page + 1}/${url.search}`;
  return `<html><body>${genresForm}<div id="loop-content">${options.empty ? '' : `<div class="row c-tabs-item__content">${options.card ?? summary()}</div>`}</div>${next === false ? '' : `<nav class="navigation paging-navigation"><div class="nav-previous"><a href="${next}">Older Posts</a></div></nav>`}</body></html>`;
}
interface ChapterFixture { slug: string; label: string }
const chapter = (number: number, slug = `chapter-${number}`): ChapterFixture => ({ slug, label: `Chapter ${number}` });
const sourceChapters = [chapter(3), chapter(2), chapter(1)];
function indexHtml(rows: ChapterFixture[], options: { page?: number; pages?: number; foreign?: boolean } = {}) {
  return `<div class="page-content-listing"><div class="listing-chapters_wrap"><ul class="main version-chap no-volumn">${rows.map(row => `<li class="wp-manga-chapter"><a href="${options.foreign ? `${origin}/novel/other-story/` : workUrl}${row.slug}/">${row.label}</a><span class="chapter-release-date">Today</span></li>`).join('')}</ul>${options.pages ? `<div class="pagination">${Array.from({ length: options.pages }, (_, page) => `<span class="page page-${page + 1} ${options.page === page + 1 ? 'current' : ''}"><a href="#" data-page="${page + 1}">${page + 1}</a></span>`).join('')}</div>` : ''}</div></div>`;
}
function chapterHtml(number = 1, body = '<p>The QA explorer opened a blue notebook beside the quiet river.</p><p>She drew a map and set off for the next village.</p>') {
  const slug = `chapter-${number}`;
  return `<html lang="en"><head><link rel="canonical" href="${workUrl}${slug}/" /></head><body><nav><p>Navigation outside the story</p></nav><ol class="breadcrumb"><li><a href="${origin}/">Home</a></li><li><a href="${workUrl}">Story QA</a></li><li class="active">Chapter ${number}</li></ol>${number > 1 ? `<a class="btn prev_page" href="${workUrl}chapter-${number - 1}/">Prev</a>` : ''}${number < 3 ? `<a class="btn next_page" href="${workUrl}chapter-${number + 1}/">Next</a>` : ''}<div class="reading-content"><input id="wp-manga-current-chap" value="${slug}"/><div class="text-left"><h3>Chapter ${number}: The QA Journey</h3><p><strong>Translator:</strong> QA Translation <strong>Editor:</strong> QA Editing</p>${body}</div></div><aside><p>Advertisement outside the story</p></aside><div id="comments"><p>A reader comment outside the story</p></div></body></html>`;
}
function setup(options: { details?: string; content?: Record<string, string>; index?: ChapterFixture[]; indexPages?: ChapterFixture[][]; catalog?: Parameters<typeof catalogHtml>[1] } = {}) {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== origin) throw new Error('Fixtures never fetch another host.');
    if (url.pathname === '/novel/story-qa/') return response(options.details ?? detailHtml());
    if (url.pathname === '/novel/story-qa/ajax/chapters/') {
      expect(init?.method).toBe('POST'); expect(init?.body).toBeUndefined();
      const page = Number(url.searchParams.get('t'));
      return response(indexHtml(options.indexPages?.[page - 1] ?? options.index ?? sourceChapters, options.indexPages ? { page, pages: options.indexPages.length } : {}));
    }
    if (url.pathname === '/' || /^\/page\/\d+\/$/.test(url.pathname)) return response(catalogHtml(url, options.catalog));
    const match = /^\/novel\/story-qa\/(chapter-\d+)\/$/.exec(url.pathname);
    if (match) return response(options.content?.[match[1]] ?? chapterHtml(Number(match[1].slice(8))));
    throw new Error('No fixture: unrelated, protected or invented endpoint.');
  });
  return { fetcher, provider: new WuxiaWorldSiteProvider({ fetcher, cache: new AniwatchAPICache(), requestIntervalMs: 0 }) };
}

describe('WuxiaWorld.site independent English novel provider', () => {
  it('keeps qualified identities and rejects traversal, arbitrary URLs and cross-work chapters before fetching', async () => {
    const { provider, fetcher } = setup();
    expect(validateWuxiaWorldSiteId(id)).toBe(id); expect(validateWuxiaWorldSiteId(chapterId, true)).toBe(chapterId);
    for (const invalid of ['123', 'wuxiaworldsite:../../private', 'wuxiaworldsite:story-qa?work=other', `${id}/chapter-1`, 'https://wuxiaworld.site/novel/story-qa/']) await expect(provider.details(invalid)).rejects.toMatchObject({ status: 400 });
    await expect(provider.content(id, 'wuxiaworldsite:other-story/chapter-1')).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes original English metadata, real Genre(s), source links and score on the shared 0–100 scale', async () => {
    const { provider, fetcher } = setup();
    const [first, second] = await Promise.all([provider.details(id), provider.details(id)]);
    expect(first).toEqual(second); expect(fetcher).toHaveBeenCalledOnce();
    expect(first).toMatchObject({ id, title: 'Story QA', poster: `${origin}/wp-content/uploads/2026/story.jpg`, authors: ['Author QA'], genres: ['Action'], status: 'RELEASING', score: 82, description: 'An original synopsis for the QA fixture.', providerId: 'wuxiaworldsite', providerName: 'WuxiaWorld.site', availableLanguages: ['en'], sourceUrl: workUrl, externalLinks: [{ site: 'WuxiaWorld.site', url: workUrl }] });
    expect(first.year).toBeUndefined(); expect(first.volumes).toBeUndefined(); expect(first.chapterCount).toBeUndefined();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
  });

  it('uses proven public search, genre/status, adult exclusion, sort and source pagination', async () => {
    const { provider, fetcher } = setup();
    expect(await provider.genres()).toEqual(['Action', 'Fantasy']);
    const result = await provider.search({ search: 'QA journey', genre: 'Action', status: 'HIATUS', sort: 'newest', page: 2 });
    expect(result).toMatchObject({ items: [{ id }], page: 2, hasNextPage: true });
    const url = new URL(String(fetcher.mock.calls.at(-1)![0]));
    expect(url.origin).toBe(origin); expect(url.pathname).toBe('/page/2/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ s: 'QA journey', post_type: 'wp-manga', adult: '0', m_orderby: 'new-manga', 'genre[]': 'action', 'status[]': 'on-hold' });
    await provider.search({ status: 'FINISHED' });
    const completedUrl = new URL(String(fetcher.mock.calls.at(-1)![0]));
    expect(completedUrl.searchParams.get('status[]')).toBe('end'); expect(completedUrl.searchParams.get('m_orderby')).toBe('views');
  });

  it('rejects unsupported filters without silently approximating an incomplete page', async () => {
    const { provider, fetcher } = setup();
    for (const query of [{ year: 2026 }, { sort: 'score' as const }, { sort: 'trending' as const }, { status: 'UNKNOWN' }, { page: 0 }, { page: 1001 }, { search: 'x'.repeat(121) }, { search: 'bad\nquery' }]) await expect(provider.search(query)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(provider.search({ genre: 'Adult' })).rejects.toMatchObject({ status: 400 });
    await expect(provider.search({ genre: 'Missing Genre' })).rejects.toMatchObject({ status: 400 });
  });

  it('supports a truthful empty catalog and refuses lost filters, foreign links and duplicate cards', async () => {
    expect(await setup({ catalog: { empty: true, next: false } }).provider.search({})).toEqual({ items: [], page: 1, hasNextPage: false });
    await expect(setup({ catalog: { next: `${origin}/page/2/?s=&post_type=wp-manga` } }).provider.search({})).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
    await expect(setup({ catalog: { card: summary({ work: 'https://attacker.example/novel/story-qa/' }) } }).provider.search({})).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
    const duplicate = `<div class="c-tabs-item__content">${summary()}</div><div class="c-tabs-item__content">${summary()}</div>`;
    const fetcher = vi.fn<typeof fetch>(async () => response(`<div id="loop-content">${duplicate}</div>`));
    await expect(new WuxiaWorldSiteProvider({ fetcher, cache: new AniwatchAPICache(), requestIntervalMs: 0 }).search({})).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
  });

  it('loads the entire public POST index across all pages, preserving chapter zero, extras and source order', async () => {
    const rows = Array.from({ length: 103 }, (_, index) => chapter(102 - index));
    rows.splice(53, 0, chapter(50, 'chapter-50-extra'));
    const { provider, fetcher } = setup({ indexPages: [rows.slice(0, 50), rows.slice(50, 100), rows.slice(100)] });
    const result = await provider.chapters(id, { language: 'en' });
    expect(result).toMatchObject({ available: true, status: 'available', providerId: 'wuxiaworldsite' });
    expect(result.chapters).toHaveLength(104);
    expect(result.chapters[0]).toMatchObject({ id: `${id}/chapter-0`, number: 0, language: 'en', displayLabel: 'Chapter 0' });
    expect(result.chapters.at(-1)).toMatchObject({ id: `${id}/chapter-102`, number: 102 });
    expect(result.chapters.filter(row => row.number === 50)).toHaveLength(2);
    const requests = fetcher.mock.calls.filter(([input]) => String(input).includes('/ajax/chapters/'));
    expect(requests.map(([input]) => new URL(String(input)).searchParams.get('t'))).toEqual(['1', '2', '3']);
    expect(requests.every(([, init]) => init?.method === 'POST')).toBe(true);
  });

  it('does not deduplicate distinct chapter URLs with identical labels or replace the index with recent homepage chapters', async () => {
    const { provider, fetcher } = setup({ index: [chapter(2), chapter(1, 'volume-2-chapter-1'), chapter(1)] });
    const result = await provider.chapters(id);
    expect(result.chapters.map(row => row.id)).toEqual([chapterId, `${id}/volume-2-chapter-1`, `${id}/chapter-2`]);
    expect(fetcher.mock.calls.every(([input]) => !String(input).includes('admin-ajax'))).toBe(true);
  });

  it('rejects duplicated chapter identities, foreign works and changing pagination instead of returning a partial index', async () => {
    await expect(setup({ index: [chapter(1), chapter(1)] }).provider.chapters(id)).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
    const foreign = setup();
    foreign.fetcher.mockImplementation(async input => response(String(input).includes('/ajax/chapters/') ? indexHtml([chapter(1)], { foreign: true }) : detailHtml()));
    await expect(foreign.provider.chapters(id)).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
    const changed = setup();
    changed.fetcher.mockImplementation(async input => {
      const url = new URL(String(input));
      return response(url.pathname.endsWith('/ajax/chapters/') ? indexHtml([chapter(Number(url.searchParams.get('t')))], { page: Number(url.searchParams.get('t')), pages: url.searchParams.get('t') === '1' ? 2 : 3 }) : detailHtml());
    });
    await expect(changed.provider.chapters(id)).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
    const excessive = setup(); excessive.fetcher.mockImplementation(async input => response(String(input).includes('/ajax/chapters/') ? indexHtml([chapter(1)], { page: 1, pages: 201 }) : detailHtml()));
    await expect(excessive.provider.chapters(id)).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
  });

  it('reads two distinct English chapters with checked work/chapter identity, credits and index-backed navigation', async () => {
    const first = chapterHtml(1, '<p>QA chapter one begins at the river.</p><p>Our explorer chooses the northern path.</p>');
    const second = chapterHtml(2, '<p>QA chapter two reaches the village.</p><p>The explorer meets the local cartographer.</p>');
    const { provider } = setup({ content: { 'chapter-1': first, 'chapter-2': second } });
    const a = await provider.content(id, chapterId, { language: 'en' });
    const b = await provider.content(id, `${id}/chapter-2`, { language: 'en' });
    expect(a).toMatchObject({ available: true, status: 'available', providerId: 'wuxiaworldsite', isDemo: false, novel: { id }, chapter: { id: chapterId, language: 'en', number: 1 }, nextChapterId: `${id}/chapter-2`, sourceUrl: `${workUrl}chapter-1/` });
    expect(a.previousChapterId).toBeUndefined();
    expect(b).toMatchObject({ chapter: { id: `${id}/chapter-2` }, previousChapterId: chapterId, nextChapterId: `${id}/chapter-3`, sourceUrl: `${workUrl}chapter-2/` });
    expect(a.paragraphs).toContain('QA chapter one begins at the river.'); expect(b.paragraphs).toContain('QA chapter two reaches the village.');
    expect(a.paragraphs).not.toEqual(b.paragraphs); expect(a.attribution).toContain('WuxiaWorld.site'); expect(a.attribution).toContain('QA Translation'); expect(a.attribution).toContain('QA Editing');
    expect(a.paragraphs.join('')).not.toMatch(/Translator:|Navigation outside|Advertisement outside|reader comment/);
  });

  it('extracts plain editorial text and removes scripts, hidden void tags, menus, advertisements and comments', async () => {
    const body = '<p>First <em>original</em> QA paragraph &amp; text.</p><script>secretScript()</script><style>hiddenStyle</style><input style="display:none" value="hidden"/><img style="display:none" src="/hidden.jpg"/><nav><p>Menu noise</p></nav><div class="ads"><p>Ad noise</p></div><div class="comments"><p>Comment noise</p></div><div aria-hidden="true"><p>Hidden noise</p></div><p>Second &ldquo;original&rdquo; QA paragraph.</p>';
    const result = await setup({ content: { 'chapter-1': chapterHtml(1, body) } }).provider.content(id, chapterId);
    expect(result.paragraphs).toEqual(['Chapter 1: The QA Journey', 'First original QA paragraph & text.', 'Second “original” QA paragraph.']);
    expect(result.paragraphs.join('')).not.toMatch(/noise|secretScript|hiddenStyle|<[^>]+>/);
  });

  it('reports unavailable PT-BR/Japanese editions without fetching or fabricating translated prose', async () => {
    const { provider, fetcher } = setup();
    expect(await provider.chapters(id, { language: 'pt-br' })).toMatchObject({ available: false, status: 'unavailable', chapters: [] });
    expect(await provider.content(id, chapterId, { language: 'ja' })).toMatchObject({ available: false, paragraphs: [] });
    await expect(provider.chapters(id, { provider: 'novelmania' })).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not fetch an unlisted chapter', async () => {
    const { provider, fetcher } = setup();
    await expect(provider.content(id, `${id}/chapter-999`)).rejects.toMatchObject({ status: 404 });
    expect(fetcher.mock.calls.every(([input]) => !String(input).endsWith('/chapter-999/'))).toBe(true);
  });

  it.each([
    [chapterHtml().replace(`${workUrl}chapter-1/`, `${workUrl}chapter-2/`), 'canonical chapter'],
    [chapterHtml().replace('href="https://wuxiaworld.site/novel/story-qa/">Story QA', 'href="https://wuxiaworld.site/novel/other-story/">Story QA'), 'work breadcrumb'],
    [chapterHtml().replace('class="active">Chapter 1', 'class="active">Chapter 2'), 'chapter breadcrumb'],
    [chapterHtml().replace('value="chapter-1"', 'value="chapter-2"'), 'current chapter field'],
    [chapterHtml().replace('<h3>Chapter 1:', '<h3>Chapter 2:'), 'editorial heading'],
    [chapterHtml().replace('class="text-left"', 'class="login-required"'), 'missing public text'],
    [chapterHtml().replace('href="https://wuxiaworld.site/novel/story-qa/chapter-2/"', 'href="https://wuxiaworld.site/novel/other-story/chapter-2/"'), 'foreign next navigation'],
    [chapterHtml().replace('href="https://wuxiaworld.site/novel/story-qa/chapter-2/"', 'href="https://wuxiaworld.site/novel/story-qa/chapter-3/"'), 'wrong next navigation'],
    [chapterHtml().replace(/<a class="btn next_page"[\s\S]*?<\/a>/, ''), 'missing next navigation'],
    [chapterHtml(1, '<img src="/illustration.jpg"/>'), 'illustration without prose'],
  ])('rejects substituted or unavailable content (%s; %s)', async body => {
    await expect(setup({ content: { 'chapter-1': body } }).provider.content(id, chapterId)).rejects.toMatchObject({ status: expect.any(Number) });
  });

  it('filters explicitly classified adult titles in search and details, and discards untrusted cover hosts', async () => {
    expect((await setup({ catalog: { card: summary({ genre: 'Adult' }) } }).provider.search({})).items).toEqual([]);
    expect((await setup({ catalog: { card: summary({ genre: 'Smut' }) } }).provider.search({})).items).toEqual([]);
    await expect(setup({ details: detailHtml({ genre: 'Adult' }) }).provider.details(id)).rejects.toMatchObject({ status: 404 });
    await expect(setup({ details: detailHtml({ title: 'Story QA 18+' }) }).provider.details(id)).rejects.toMatchObject({ status: 404 });
    expect((await setup({ details: detailHtml({ cover: 'https://attacker.example/cover.jpg' }) }).provider.details(id)).poster).toBe('');
    expect((await setup({ details: detailHtml({ score: '500' }) }).provider.details(id)).score).toBeUndefined();
  });

  it('refuses malformed HTML, CAPTCHA pages, missing identity and unexpected response types without demo fallback', async () => {
    for (const details of ['<html><title>Just a moment...</title><div id="captcha">Verify you are human</div></html>', detailHtml().replace('rel="canonical"', 'rel="alternate"'), detailHtml().replace('</h1>', ''), detailHtml().replace(workUrl, `${origin}/novel/other-story/`)]) await expect(setup({ details }).provider.details(id)).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    await expect(new WuxiaWorldSiteProvider({ fetcher, cache: new AniwatchAPICache(), requestIntervalMs: 0 }).search({})).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
  });

  it('honors HTTP errors and rate-limit cooldown without retrying protected pages or a different source', async () => {
    for (const status of [403, 503, 404]) {
      const fetcher = vi.fn<typeof fetch>(async () => response('Unavailable fixture', { status }));
      const provider = new WuxiaWorldSiteProvider({ fetcher, cache: new AniwatchAPICache(), requestIntervalMs: 0 });
      await expect(provider.search({})).rejects.toMatchObject({ status: status === 404 ? 404 : 503, code: status === 404 ? 'NOVEL_NOT_FOUND' : 'WUXIAWORLDSITE_UNAVAILABLE' });
      expect(fetcher).toHaveBeenCalledOnce();
    }
    const limited = vi.fn<typeof fetch>(async () => response('Rate limit fixture', { status: 429, headers: { 'Retry-After': '60' } }));
    const provider = new WuxiaWorldSiteProvider({ fetcher: limited, cache: new AniwatchAPICache(), requestIntervalMs: 0 });
    await expect(provider.search({})).rejects.toMatchObject({ code: 'WUXIAWORLDSITE_RATE_LIMIT', retryAfter: 60 });
    await expect(provider.details(id)).rejects.toMatchObject({ code: 'WUXIAWORLDSITE_RATE_LIMIT' }); expect(limited).toHaveBeenCalledOnce();
  });

  it('bounds declared and streamed bytes, cancels stalled bodies and times out requests', async () => {
    const declared = vi.fn<typeof fetch>(async () => response('x', { headers: { 'Content-Length': String(3 * 1024 * 1024 + 1) } }));
    await expect(new WuxiaWorldSiteProvider({ fetcher: declared, cache: new AniwatchAPICache(), requestIntervalMs: 0 }).search({})).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
    const streamed = vi.fn<typeof fetch>(async () => response('x'.repeat(3 * 1024 * 1024 + 1)));
    await expect(new WuxiaWorldSiteProvider({ fetcher: streamed, cache: new AniwatchAPICache(), requestIntervalMs: 0 }).search({})).rejects.toMatchObject({ code: 'INVALID_WUXIAWORLDSITE_RESPONSE' });
    const cancelled = vi.fn();
    const stalled = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'Content-Type': 'text/html' } }));
    await expect(new WuxiaWorldSiteProvider({ fetcher: stalled, cache: new AniwatchAPICache(), requestIntervalMs: 0, timeoutMs: 20 }).search({})).rejects.toMatchObject({ code: 'WUXIAWORLDSITE_TIMEOUT' }); expect(cancelled).toHaveBeenCalledOnce();
    const noHeaders = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    await expect(new WuxiaWorldSiteProvider({ fetcher: noHeaders, cache: new AniwatchAPICache(), requestIntervalMs: 0, timeoutMs: 20 }).search({})).rejects.toMatchObject({ code: 'WUXIAWORLDSITE_TIMEOUT' });
  });
});
