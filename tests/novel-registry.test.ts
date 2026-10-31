import { describe, expect, it, vi } from 'vitest';
import type { NovelProvider, NovelTitle } from '../src/shared/novel';
import { NovelRegistry, validateNovelProvider, validateReadingNovelId, validateReadingNovelQuery } from '../src/aniwatch-apis/src/providers/novel-registry';
import { createApp } from '../src/aniwatch-apis/src/app';

// Injected catalog/text contracts. No third-party service or demo text is requested.
const id = 'novelmania:historia_qa';
const chapterId = `${id}/volume-1-capitulo-1`;
const nextChapter = `${id}/volume-2-capitulo-1`;
const title: NovelTitle = { id, title: 'História QA', poster: '', genres: ['Aventura'], providerId: 'novelmania', availableLanguages: ['pt-br'], sourceUrl: 'https://novelmania.com.br/novels/historia_qa' };
function source(native = false) {
  const novel = native ? title : { ...title, id: '12345', providerId: 'anilist' as const };
  const chapter = { id: native ? chapterId : 'tatakai-qa-one', title: 'Volume 1 – Capítulo 1', number: 1, language: 'pt-br' };
  return {
    search: vi.fn<NovelProvider['search']>(async () => ({ items: [novel], page: 1, hasNextPage: false, total: 1 })),
    genres: vi.fn<NovelProvider['genres']>(async () => ['Aventura']),
    details: vi.fn<NovelProvider['details']>(async () => novel),
    chapters: vi.fn<NovelProvider['chapters']>(async () => ({ available: true, status: 'available', providerId: native ? 'novelmania' : 'tatakai', message: 'Capítulos sintéticos.', chapters: [chapter] })),
    content: vi.fn<NovelProvider['content']>(async () => ({ available: true, status: 'available', providerId: native ? 'novelmania' : 'tatakai', message: 'Texto sintético.', novel, chapter, paragraphs: ['Parágrafo de teste.'], nextChapterId: native ? nextChapter : 'tatakai-qa-two', sourceUrl: 'https://novelmania.com.br/novels/historia_qa/capitulos/volume-1-capitulo-1', isDemo: false })),
  };
}
function setup() {
  const anilist = source(), native = source(true);
  return { anilist, native, registry: new NovelRegistry(anilist, native) };
}

describe('qualified novel registry and local API contracts', () => {
  it('validates provider and qualified IDs without allowing free-form origins', () => {
    expect(validateNovelProvider()).toBe('anilist'); expect(validateNovelProvider('novelmania')).toBe('novelmania');
    expect(validateReadingNovelId(id)).toBe(id); expect(validateReadingNovelId('demo')).toBe('demo');
    expect(validateReadingNovelQuery({ provider: 'novelmania', search: 'história', sort: 'newest' })).toMatchObject({ provider: 'novelmania', search: 'história', sort: 'newest' });
    for (const input of ['https://novelmania.com.br/novels/story', 'novelmania:../private', chapterId, 'anilist:12345']) expect(() => validateReadingNovelId(input)).toThrow();
    expect(() => validateReadingNovelQuery({ provider: 'other' })).toThrow();
    expect(() => validateReadingNovelQuery({ provider: 'novelmania', ignored: 'true' })).toThrow();
  });

  it('dispatches catalog and genre choices without sending source selectors into the upstream query', async () => {
    const { registry, anilist, native } = setup();
    const result = await registry.search({ provider: 'novelmania', search: 'história' });
    expect(result.items[0]).toMatchObject({ id, providerId: 'novelmania', providerName: 'Novel Mania' });
    expect(native.search).toHaveBeenCalledWith({ search: 'história' }); expect(anilist.search).not.toHaveBeenCalled();
    await registry.genres('novelmania'); expect(native.genres).toHaveBeenCalledOnce(); expect(anilist.genres).not.toHaveBeenCalled();
    await registry.search({ sort: 'popular' }); await registry.genres();
    expect(anilist.search).toHaveBeenCalledWith({ sort: 'popular' }); expect(anilist.genres).toHaveBeenCalledOnce();
  });

  it('keeps AniList connected-source reading separate from direct native reading and source hints', async () => {
    const { registry, anilist, native } = setup();
    await registry.details(id); await registry.chapters(id, { language: 'pt-br' });
    const content = await registry.content(id, chapterId);
    expect(content).toMatchObject({ providerId: 'novelmania', sourceUrl: expect.stringContaining('/capitulos/'), chapter: { id: chapterId } });
    expect(anilist.details).not.toHaveBeenCalled(); expect(anilist.content).not.toHaveBeenCalled();
    const hints = { provider: 'fixture', titles: ['Título de fonte'] };
    await registry.chapters('12345', hints); await registry.content('12345', 'tatakai-qa-one', hints);
    expect(anilist.chapters).toHaveBeenCalledWith('12345', hints); expect(anilist.content).toHaveBeenCalledWith('12345', 'tatakai-qa-one', hints);
    expect(native.content).toHaveBeenCalledOnce();
  });

  it('rejects wrong-source catalog results and substituted details', async () => {
    const { registry, native } = setup();
    native.search.mockResolvedValueOnce({ items: [{ ...title, id: '12345' }], page: 1, hasNextPage: false });
    await expect(registry.search({ provider: 'novelmania' })).rejects.toMatchObject({ code: 'INVALID_NOVEL_RESPONSE' });
    native.details.mockResolvedValueOnce({ ...title, id: 'novelmania:outra-obra' });
    await expect(registry.details(id)).rejects.toMatchObject({ code: 'INVALID_NOVEL_RESPONSE' });
  });

  it('rejects a native chapter feed from another work or language', async () => {
    const { registry, native } = setup();
    for (const chapter of [{ id: 'novelmania:outra-obra/capitulo-1', language: 'pt-br' }, { id: chapterId, language: 'en' }]) {
      native.chapters.mockResolvedValueOnce({ available: true, status: 'available', providerId: 'novelmania', message: 'Wrong fixture.', chapters: [{ ...chapter, title: 'Capítulo 1', number: 1 }] });
      await expect(registry.chapters(id)).rejects.toMatchObject({ code: 'INVALID_NOVEL_RESPONSE' });
    }
  });

  it('rejects native reading content with another work, language, demo or cross-work navigation', async () => {
    const { registry, native } = setup();
    const original = await native.content(id, chapterId); native.content.mockClear();
    const mismatches = [
      { novel: { ...title, id: 'novelmania:outra-obra' } },
      { chapter: { id: chapterId, title: 'Capítulo 1', number: 1, language: 'en' } },
      { isDemo: true }, { nextChapterId: 'novelmania:outra-obra/capitulo-2' }, { providerId: 'tatakai' },
    ];
    for (const mismatch of mismatches) {
      native.content.mockResolvedValueOnce({ ...original, ...mismatch });
      await expect(registry.content(id, chapterId)).rejects.toMatchObject({ code: 'INVALID_NOVEL_RESPONSE' });
    }
    native.content.mockClear();
    await expect(registry.content(id, 'novelmania:outra-obra/capitulo-1')).rejects.toMatchObject({ status: 400 });
    expect(native.content).not.toHaveBeenCalled();
  });

  it('routes encoded qualified IDs through the local catalog and reading API without network access', async () => {
    const { registry, native } = setup();
    const app = createApp({ novels: registry, rateLimit: 10000 });
    const detail = await app.request(`/api/novels/${encodeURIComponent(id)}`);
    expect(detail.status).toBe(200); expect((await detail.json()).data).toMatchObject({ id, providerId: 'novelmania' });
    const result = await app.request(`/api/novels/${encodeURIComponent(id)}/chapters/${encodeURIComponent(chapterId)}/content?language=pt-br`);
    expect(result.status).toBe(200); expect((await result.json()).data).toMatchObject({ available: true, novel: { id }, chapter: { id: chapterId, language: 'pt-br' } });
    expect(native.content).toHaveBeenCalledWith(id, chapterId, expect.objectContaining({ language: 'pt-br' }));
    expect((await app.request('/api/novels/search?provider=novelmania&search=historia')).status).toBe(200);
    expect((await app.request('/api/novels/genres?provider=novelmania')).status).toBe(200);
  });
});
