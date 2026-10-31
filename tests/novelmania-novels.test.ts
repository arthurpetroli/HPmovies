import { describe, expect, it, vi } from 'vitest';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import { NovelManiaProvider, validateNovelManiaId } from '../src/aniwatch-apis/src/providers/novelmania-novels';

// Public API/SSR-shaped fixtures only. They are not evidence of live text availability.
const origin = 'https://novelmania.com.br';
const id = 'novelmania:historia-qa';
const chapterId = `${id}/volume-1-capitulo-1`;
const genre = { id: 'public-category-qa', name: 'Aventura', slug: 'aventura' };
const book = { slug: 'historia-qa', title: 'História QA', author: 'Autor QA', status: 'Ativo', kind: 'Light Novel', chaptersCount: 2, category: genre, categories: [genre], cover: { large: 'https://assets.novelmania.com.br/uploads/novel/cover/qa/cover.jpg' }, synopsis: '<p>Uma sinopse em <em>português</em>.</p>' };
const rawChapter = (number: number, extra: object = {}) => ({ slug: `volume-1-capitulo-${number}`, title: `Capítulo ${number}: História QA`, longTitle: `Volume 1 – Capítulo ${number}`, position: number, translators: [{ username: 'Tradução QA' }], editors: [{ username: 'Revisão QA' }], ...extra });
const json = (data: unknown, meta?: object) => new Response(JSON.stringify({ success: true, data, ...(meta ? { meta } : {}) }), { headers: { 'Content-Type': 'application/json' } });
const html = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const chapterHtml = (body = '<p>Primeiro parágrafo <strong>original da fixture</strong>.</p><p>Segundo parágrafo em português.</p>', slug = 'volume-1-capitulo-1') => `<!doctype html><html lang="pt-BR"><head><link rel="canonical" href="${origin}/novels/historia-qa/capitulos/${slug}"></head><body><nav><p>Menu que não pertence à história</p></nav><main><header><h1 id="reader-chapter-title">Capítulo 1: História QA<span class="sr-only"> – História QA</span></h1><span>Créditos fora do texto</span></header><div class="rich-text-content prose reader-body">${body}</div><aside><p>Propaganda excluída</p></aside><section id="comments"><p>Comentário excluído</p></section></main><footer><p>Rodapé excluído</p></footer></body></html>`;
function setup(options: { chapters?: ReturnType<typeof rawChapter>[]; content?: string; bookOverride?: object } = {}) {
  const chapters = options.chapters ?? [rawChapter(1), rawChapter(2)];
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    if (url.pathname === '/api/categories') return json([genre, { id: 'adult-public-qa', name: 'Adulto', slug: 'adulto' }]);
    if (url.pathname === '/api/novels') return json([{ ...book, ...options.bookOverride }], { page: Number(url.searchParams.get('page') ?? 1), limit: 24, pages: 3, count: 60 });
    if (url.pathname === '/api/novels/historia-qa') return json({ ...book, chaptersCount: chapters.length, ...options.bookOverride });
    if (url.pathname === '/api/novels/historia-qa/chapters') {
      const page = Number(url.searchParams.get('page') ?? 1);
      return json(chapters.slice((page - 1) * 50, page * 50), { page, limit: 50, pages: Math.max(1, Math.ceil(chapters.length / 50)), count: chapters.length });
    }
    if (url.pathname.startsWith('/novels/historia-qa/capitulos/')) return html(options.content ?? chapterHtml());
    throw new Error('No fixture; protected or unrelated endpoint must not be requested.');
  });
  return { fetcher, provider: new NovelManiaProvider({ fetcher, cache: new AniwatchAPICache(), requestIntervalMs: 0 }) };
}

describe('Novel Mania public catalog and reading provider', () => {
  it('uses qualified source IDs and rejects traversal or a chapter from another work before fetching', async () => {
    const { provider, fetcher } = setup();
    expect(validateNovelManiaId(id)).toBe(id); expect(validateNovelManiaId(chapterId, true)).toBe(chapterId);
    for (const value of ['12345', 'novelmania:../../private', 'https://novelmania.com.br/novels/story', `${id}?title=other`]) await expect(provider.details(value)).rejects.toMatchObject({ status: 400 });
    await expect(provider.content(id, 'novelmania:outra-obra/capitulo-1')).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes public metadata without inventing rating, publication year or volume counts', async () => {
    const { provider, fetcher } = setup();
    const [first, second] = await Promise.all([provider.details(id), provider.details(id)]);
    expect(first).toEqual(second); expect(fetcher).toHaveBeenCalledOnce();
    expect(first).toMatchObject({ id, title: book.title, providerId: 'novelmania', providerName: 'Novel Mania', sourceUrl: `${origin}/novels/historia-qa`, availableLanguages: ['pt-br'], authors: ['Autor QA'], genres: ['Aventura'], status: 'RELEASING', chapterCount: 2, description: 'Uma sinopse em português.' });
    expect(first.year).toBeUndefined(); expect(first.score).toBeUndefined(); expect(first.volumes).toBeUndefined();
    expect(first.poster).toBe(book.cover.large);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('maps supported catalog filters to the actual public API, resolving genre IDs from its categories endpoint', async () => {
    const { provider, fetcher } = setup();
    const result = await provider.search({ search: 'história', genre: 'Aventura', status: 'HIATUS', sort: 'newest', page: 2 });
    expect(result).toMatchObject({ page: 2, hasNextPage: true, total: 60, items: [{ id }] });
    const url = new URL(String(fetcher.mock.calls.at(-1)![0]));
    expect(url.pathname).toBe('/api/novels'); expect(url.searchParams.get('q')).toBe('história');
    expect(url.searchParams.get('categories[]')).toBe(genre.id); expect(url.searchParams.get('items')).toBe('24');
    expect(url.searchParams.getAll('statuses[]')).toEqual(['Parado', 'Pausado']); expect(url.searchParams.get('sort')).toBe('created_at_desc');
    expect(await provider.genres()).toEqual(['Aventura']);
  });

  it('rejects unavailable catalog filters rather than filtering an incomplete page locally', async () => {
    const { provider, fetcher } = setup();
    for (const query of [{ year: 2026 }, { sort: 'score' as const }, { sort: 'trending' as const }, { status: 'CANCELLED' }, { page: 0 }]) await expect(provider.search(query)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(provider.search({ genre: 'Categoria inexistente' })).rejects.toMatchObject({ status: 400 });
  });

  it('fetches every chapter index page and preserves repeated chapter numbers in different volumes', async () => {
    const rows = Array.from({ length: 103 }, (_, index) => rawChapter(index + 1));
    rows[100] = rawChapter(1, { slug: 'volume-2-capitulo-1', longTitle: 'Volume 2 – Capítulo 1', position: 101 });
    const { provider, fetcher } = setup({ chapters: rows });
    const list = await provider.chapters(id);
    expect(list.chapters).toHaveLength(103); expect(list.chapters[0]).toMatchObject({ id: chapterId, number: 1, language: 'pt-br', displayLabel: 'Capítulo 1: História QA' });
    expect(list.chapters[100]).toMatchObject({ id: `${id}/volume-2-capitulo-1`, number: 1, title: 'Volume 2 – Capítulo 1' });
    const requests = fetcher.mock.calls.map(([input]) => new URL(String(input))).filter(url => url.pathname.endsWith('/chapters'));
    expect(requests.map(url => url.searchParams.get('page'))).toEqual(['1', '2', '3']);
    expect(requests.every(url => url.searchParams.get('items') === '50')).toBe(true);
  });

  it('rejects a changing, duplicated or incomplete index instead of presenting it as the whole work', async () => {
    const { provider } = setup({ chapters: [rawChapter(1), rawChapter(1)] });
    await expect(provider.chapters(id)).rejects.toMatchObject({ code: 'INVALID_NOVELMANIA_RESPONSE' });
    const broken = vi.fn<typeof fetch>(async input => new URL(String(input)).pathname.endsWith('/chapters') ? json([rawChapter(1)], { page: 1, pages: 1, count: 2 }) : json(book));
    await expect(new NovelManiaProvider({ fetcher: broken, cache: new AniwatchAPICache(), requestIntervalMs: 0 }).chapters(id)).rejects.toMatchObject({ code: 'INVALID_NOVELMANIA_RESPONSE' });
  });

  it('reads only editorial paragraphs from the public SSR route, keeping source, credits and same-work navigation', async () => {
    const { provider, fetcher } = setup({ content: chapterHtml('<p>Primeiro <em>parágrafo</em>.</p><script>alert("do not execute")</script><p>Segundo &amp; último.</p>') });
    const result = await provider.content(id, chapterId);
    expect(result).toMatchObject({ available: true, providerId: 'novelmania', isDemo: false, paragraphs: ['Primeiro parágrafo.', 'Segundo & último.'], novel: { id }, chapter: { id: chapterId, language: 'pt-br' }, nextChapterId: `${id}/volume-1-capitulo-2`, sourceUrl: `${origin}/novels/historia-qa/capitulos/volume-1-capitulo-1` });
    expect(result.previousChapterId).toBeUndefined(); expect(result.attribution).toContain('Tradução: Tradução QA'); expect(result.attribution).toContain('Revisão: Revisão QA');
    expect(result.paragraphs.join('')).not.toMatch(/Menu|Comentário|Propaganda|Rodapé|Créditos fora|alert/);
    const paths = fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths).toContain('/novels/historia-qa/capitulos/volume-1-capitulo-1');
    expect(paths).not.toContain('/api/novels/historia-qa/chapters/volume-1-capitulo-1');
  });

  it('does not request text for an unlisted chapter or an unavailable edition language', async () => {
    const { provider, fetcher } = setup();
    expect(await provider.chapters(id, { language: 'en' })).toMatchObject({ available: false, chapters: [] });
    expect(await provider.content(id, chapterId, { language: 'ja' })).toMatchObject({ available: false, paragraphs: [] });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(provider.content(id, `${id}/capitulo-999`)).rejects.toMatchObject({ status: 404 });
    expect(fetcher.mock.calls.every(([input]) => !new URL(String(input)).pathname.includes('/capitulos/'))).toBe(true);
    await expect(provider.chapters(id, { provider: 'another' })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [chapterHtml().replace('href="https://novelmania.com.br/novels/historia-qa/capitulos/volume-1-capitulo-1"', 'href="https://novelmania.com.br/novels/outra-obra/capitulos/capitulo-1"'), 'wrong canonical identity'],
    [chapterHtml().replace('id="reader-chapter-title"', 'id="wrong-heading"'), 'missing reader heading'],
    [chapterHtml().replace('Capítulo 1: História QA', 'Capítulo 2: História QA'), 'wrong chapter heading on the same canonical URL'],
    [chapterHtml('<img src="https://assets.novelmania.com.br/uploads/illustration.jpg">'), 'illustrations without readable text'],
    [chapterHtml().replace('rich-text-content', 'paywall-login'), 'unavailable editorial body'],
  ])('does not fabricate a readable chapter when %s (%s)', async content => {
    await expect(setup({ content }).provider.content(id, chapterId)).rejects.toMatchObject({ status: expect.any(Number) });
  });

  it('filters explicitly adult metadata and refuses a substituted work response', async () => {
    const explicitBook = { categories: [{ id: 'adult-public-qa', name: 'Adulto', slug: 'adulto' }], category: { id: 'adult-public-qa', name: 'Adulto', slug: 'adulto' } };
    expect((await setup({ bookOverride: explicitBook }).provider.search({})).items).toEqual([]);
    await expect(setup({ bookOverride: explicitBook }).provider.details(id)).rejects.toMatchObject({ status: 404 });
    await expect(setup({ bookOverride: { slug: 'outra-obra' } }).provider.details(id)).rejects.toMatchObject({ code: 'INVALID_NOVELMANIA_RESPONSE' });
    expect((await setup({ bookOverride: { cover: { large: 'https://attacker.example/cover.jpg' } } }).provider.details(id)).poster).toBe('');
  });

  it('honors upstream rate limits and never substitutes a protected response with demo text', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
    const provider = new NovelManiaProvider({ fetcher, cache: new AniwatchAPICache(), requestIntervalMs: 0 });
    await expect(provider.search({})).rejects.toMatchObject({ code: 'NOVELMANIA_RATE_LIMIT', retryAfter: 60 });
    await expect(provider.details(id)).rejects.toMatchObject({ code: 'NOVELMANIA_RATE_LIMIT' }); expect(fetcher).toHaveBeenCalledOnce();
    const blocked = new NovelManiaProvider({ fetcher: vi.fn(async () => new Response('{}', { status: 403 })), cache: new AniwatchAPICache(), requestIntervalMs: 0 });
    await expect(blocked.search({})).rejects.toMatchObject({ code: 'NOVELMANIA_UNAVAILABLE' });
  });

  it('bounds response bytes and times out stalled bodies', async () => {
    const cancelled = vi.fn();
    const provider = new NovelManiaProvider({ fetcher: vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'Content-Type': 'application/json' } })), cache: new AniwatchAPICache(), requestIntervalMs: 0, timeoutMs: 20 });
    await expect(provider.search({})).rejects.toMatchObject({ code: 'NOVELMANIA_TIMEOUT' }); expect(cancelled).toHaveBeenCalledOnce();
    const oversized = new NovelManiaProvider({ fetcher: vi.fn(async () => new Response('x', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(3 * 1024 * 1024 + 1) } })), cache: new AniwatchAPICache(), requestIntervalMs: 0 });
    await expect(oversized.search({})).rejects.toMatchObject({ code: 'INVALID_NOVELMANIA_RESPONSE' });
  });
});
