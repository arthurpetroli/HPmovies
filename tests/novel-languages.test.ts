import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NovelProvider, NovelTitle } from '../src/shared/novel';
import { NovelRegistry } from '../src/aniwatch-apis/src/providers/novel-registry';
import { isNovel, novelService } from '../src/frontend/services/novels';
import { isNativeNovelChapterId, isNativeNovelId, isNovelWorkId, nativeNovelChapterBelongsTo, nativeNovelLanguageMatches, novelCatalogPath, novelDetailsPath, novelProviderForId, novelProviderLanguage, novelProviderLabel, novelReaderPath } from '../src/shared/novelIdentity';

// Synthetic client contracts only. Real source availability is checked separately.
const provider = 'wuxiaworldsite';
const id = `${provider}:historia_qa`;
const firstId = `${id}/chapter-1`;
const novel = {
  id, title: 'Synthetic English QA story', poster: '', genres: ['Fantasy'],
  providerId: provider, availableLanguages: ['en'], sourceUrl: 'https://wuxiaworld.site/novel/historia-qa/',
};
const chapter = { id: firstId, title: 'Synthetic first chapter', number: 1, language: 'en' };
const content = {
  available: true, status: 'available', providerId: provider, message: 'Synthetic English content.',
  novel, chapter, paragraphs: ['A synthetic paragraph in English.'],
  sourceUrl: 'https://wuxiaworld.site/novel/historia-qa/chapter-1/',
};
const mockResponse = (data: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data }))));

describe('English novel language and qualified client identities', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the same work slug distinct across English and Portuguese sources', () => {
    const portuguese = 'novelmania:historia_qa';
    expect(isNativeNovelId(id)).toBe(true); expect(isNovelWorkId(id)).toBe(true); expect(isNovel(novel)).toBe(true);
    expect(isNativeNovelChapterId(firstId)).toBe(true);
    expect(novelProviderForId(id)).toBe(provider); expect(novelProviderForId(portuguese)).toBe('novelmania');
    expect(novelProviderLabel(provider)).toBe('WuxiaWorld.site');
    expect(nativeNovelChapterBelongsTo(firstId, id)).toBe(true);
    expect(nativeNovelChapterBelongsTo(firstId, portuguese)).toBe(false);
    expect(nativeNovelChapterBelongsTo(`${portuguese}/chapter-1`, id)).toBe(false);
    expect(novelDetailsPath(id)).toBe('/novel/wuxiaworldsite%3Ahistoria_qa');
    expect(novelReaderPath(id, firstId)).toBe('/novel/wuxiaworldsite%3Ahistoria_qa/read/wuxiaworldsite%3Ahistoria_qa%2Fchapter-1');
    expect(isNovel({ ...novel, providerId: 'novelmania' })).toBe(false);
  });

  it('rejects unknown providers and work or chapter IDs containing path injection', () => {
    for (const invalid of ['unknown:historia_qa', `${id}/chapter-1`, 'wuxiaworldsite:', 'wuxiaworldsite:../other', 'wuxiaworldsite:history?language=pt-br', 'wuxiaworldsite:history#chapter']) {
      expect(isNativeNovelId(invalid)).toBe(false);
    }
    for (const invalid of [`${id}/../chapter-2`, `${id}/chapter-1/extra`, `${id}/chapter-1?language=pt-br`, `${id}/https://example.org`]) {
      expect(isNativeNovelChapterId(invalid)).toBe(false);
    }
  });

  it('derives language and catalog return paths from the qualified source identity', () => {
    expect(novelProviderLanguage(provider)).toBe('en'); expect(novelProviderLanguage('novelmania')).toBe('pt-br');
    expect(novelProviderLanguage('anilist')).toBeUndefined();
    expect(novelCatalogPath(provider)).toBe('/novels?provider=wuxiaworldsite&language=en');
    expect(novelCatalogPath('novelmania')).toBe('/novels?provider=novelmania&language=pt-br');
    for (const language of [undefined, 'all', 'en', 'EN']) expect(nativeNovelLanguageMatches(id, language)).toBe(true);
    for (const language of ['pt', 'pt-br', 'ja']) expect(nativeNovelLanguageMatches(id, language)).toBe(false);
    expect(nativeNovelLanguageMatches('novelmania:historia_qa', 'pt')).toBe(true);
    expect(nativeNovelLanguageMatches('novelmania:historia_qa', 'en')).toBe(false);
  });

  it('sends the chosen English catalog and language together without changing the search', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: { items: [novel], page: 1, hasNextPage: false } })));
    vi.stubGlobal('fetch', fetcher);
    const result = await novelService.search({ provider, language: 'en', search: 'QA English', sort: 'popular', page: 1 });
    expect(result.items[0].id).toBe(id);
    const url = new URL(String(fetcher.mock.calls[0][0]), 'http://localhost');
    expect(url.searchParams.get('provider')).toBe(provider); expect(url.searchParams.get('language')).toBe('en');
    expect(url.searchParams.get('search')).toBe('QA English');
  });

  it('accepts source English chapters and leaves existing Portuguese chapters valid', async () => {
    mockResponse({ available: true, status: 'available', providerId: provider, message: 'Synthetic chapters.', chapters: [chapter] });
    await expect(novelService.chapters(id)).resolves.toMatchObject({ chapters: [{ id: firstId, language: 'en' }] });
    const portugueseId = 'novelmania:historia_qa';
    mockResponse({ available: true, status: 'available', providerId: 'novelmania', message: 'Capítulo sintético.', chapters: [{ ...chapter, id: `${portugueseId}/capitulo-1`, language: 'pt-br' }] });
    await expect(novelService.chapters(portugueseId)).resolves.toMatchObject({ chapters: [{ language: 'pt-br' }] });
  });

  it('rejects English chapter lists that switch source, work or language', async () => {
    for (const change of [
      { providerId: 'novelmania' },
      { chapters: [{ ...chapter, id: 'wuxiaworldsite:other/chapter-1' }] },
      { chapters: [{ ...chapter, id: 'novelmania:historia_qa/chapter-1' }] },
      { chapters: [{ ...chapter, language: 'pt-br' }] },
    ]) {
      mockResponse({ available: true, status: 'available', providerId: provider, message: 'Synthetic mismatched chapters.', chapters: [chapter], ...change });
      await expect(novelService.chapters(id)).rejects.toThrow();
    }
  });

  it('reads English source text without persisting fuzzy catalog title hints', async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    mockResponse(content);
    await expect(novelService.content(id, firstId, { language: 'en', titles: ['Unused fuzzy title'] })).resolves.toMatchObject({ chapter: { language: 'en' }, paragraphs: content.paragraphs });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('rejects English reading that changes work, chapter, provider, language, navigation or demo status', async () => {
    for (const change of [
      { novel: { ...novel, id: 'wuxiaworldsite:other' } },
      { chapter: { ...chapter, id: `${id}/chapter-2` } },
      { chapter: { ...chapter, language: 'pt-br' } },
      { providerId: 'novelmania' },
      { previousChapterId: 'novelmania:historia_qa/chapter-1' },
      { nextChapterId: 'wuxiaworldsite:other/chapter-2' },
      { isDemo: true },
    ]) {
      mockResponse({ ...content, ...change });
      await expect(novelService.content(id, firstId)).rejects.toThrow();
    }
  });
});

const registryTitle: NovelTitle = { ...novel, providerId: provider };
function injectedSource() {
  return {
    search: vi.fn<NovelProvider['search']>(async () => ({ items: [registryTitle], page: 1, hasNextPage: false })),
    genres: vi.fn<NovelProvider['genres']>(async () => ['Fantasy']),
    details: vi.fn<NovelProvider['details']>(async () => registryTitle),
    chapters: vi.fn<NovelProvider['chapters']>(async () => ({ available: true, status: 'available', providerId: provider, message: 'Synthetic English chapters.', chapters: [chapter] })),
    content: vi.fn<NovelProvider['content']>(async () => ({ ...content, status: 'available', novel: registryTitle })),
  };
}
function injectedRegistry() {
  const anilist = injectedSource(), portuguese = injectedSource(), english = injectedSource();
  return { anilist, portuguese, english, registry: new NovelRegistry(anilist, portuguese, english) };
}

describe('English novel registry editions without external requests', () => {
  it('dispatches the English catalog, index and text only to the English source', async () => {
    const { registry, english, anilist, portuguese } = injectedRegistry();
    await expect(registry.search({ provider, language: 'en', search: 'QA' })).resolves.toMatchObject({ items: [{ id, providerId: provider, providerName: 'WuxiaWorld.site' }] });
    expect(english.search).toHaveBeenCalledWith({ search: 'QA' });
    await registry.genres(provider); await registry.details(id); await registry.chapters(id);
    await expect(registry.content(id, firstId)).resolves.toMatchObject({ novel: { id }, chapter: { language: 'en' } });
    expect(english.genres).toHaveBeenCalledOnce(); expect(english.details).toHaveBeenCalledWith(id);
    expect(english.chapters).toHaveBeenCalledOnce(); expect(english.content).toHaveBeenCalledOnce();
    for (const source of [anilist, portuguese]) for (const call of Object.values(source)) expect(call).not.toHaveBeenCalled();
  });

  it('reports an incompatible Portuguese language request before querying the English source', async () => {
    const { registry, english } = injectedRegistry();
    await expect(registry.search({ provider, language: 'pt-br', page: 3 })).resolves.toMatchObject({ items: [], page: 3, hasNextPage: false, total: 0 });
    await expect(registry.chapters(id, { language: 'pt-br' })).resolves.toMatchObject({ available: false, providerId: provider, chapters: [] });
    await expect(registry.content(id, firstId, { language: 'pt-br' })).resolves.toMatchObject({ available: false, providerId: provider, paragraphs: [] });
    expect(english.search).not.toHaveBeenCalled(); expect(english.chapters).not.toHaveBeenCalled(); expect(english.content).not.toHaveBeenCalled();
  });

  it('reports a missing English source instead of using the Portuguese catalog or AniList', async () => {
    const anilist = injectedSource(), portuguese = injectedSource();
    const registry = new NovelRegistry(anilist, portuguese);
    await expect(registry.search({ provider, language: 'en' })).rejects.toMatchObject({ status: 503, code: 'NOVEL_PROVIDER_UNAVAILABLE' });
    await expect(registry.details(id)).rejects.toMatchObject({ status: 503, code: 'NOVEL_PROVIDER_UNAVAILABLE' });
    for (const source of [anilist, portuguese]) for (const call of Object.values(source)) expect(call).not.toHaveBeenCalled();
  });

  it('blocks substituted English text, source, language, demo and adjacent work identities at the registry', async () => {
    const { registry, english } = injectedRegistry();
    const original = await english.content(id, firstId);
    for (const change of [
      { novel: { ...registryTitle, id: 'wuxiaworldsite:other' } },
      { chapter: { ...chapter, id: `${id}/chapter-2` } },
      { chapter: { ...chapter, language: 'pt-br' } },
      { providerId: 'novelmania' },
      { isDemo: true },
      { nextChapterId: 'novelmania:historia_qa/chapter-2' },
    ]) {
      english.content.mockResolvedValueOnce({ ...original, ...change });
      await expect(registry.content(id, firstId)).rejects.toMatchObject({ status: 502, code: 'INVALID_NOVEL_RESPONSE' });
    }
    english.content.mockClear();
    await expect(registry.content(id, 'novelmania:historia_qa/chapter-1')).rejects.toMatchObject({ status: 400, code: 'INVALID_NOVEL_CHAPTER' });
    expect(english.content).not.toHaveBeenCalled();
  });
});
