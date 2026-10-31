import { describe, expect, it, vi } from 'vitest';
import type { MangaCatalogProvider, MangaChapterProvider, MangaImageProvider, MangaChapter, MangaTitle } from '../src/shared/manga';
import { MangaRegistry, validateMangaProvider, validateReadingMangaId, validateReadingMangaQuery } from '../src/aniwatch-apis/src/providers/manga-registry';
import { ApiError } from '../src/aniwatch-apis/src/config/apiError';

// Injected synthetic sources: no website or public API is consulted here.
const dexId = '10000000-0000-4000-8000-000000000001';
const dexChapter = '10000000-0000-4000-8000-000000000002';
const dexToken = '10000000-0000-4000-8000-000000000003';
const livreId = 'mangalivre:historia_qa';
const livreChapter = `${livreId}/capitulo-1_1`;
const livreToken = '10000000-0000-4000-8000-000000000004';
const dexTag = '10000000-0000-4000-8000-000000000005';
const livreTag = 'mangalivre:tag:aventura';
type Source = MangaCatalogProvider & MangaChapterProvider & MangaImageProvider;

function fixture(id: string, chapterId: string, token: string, tag: string) {
  const manga: MangaTitle = { id, title: 'História sintética QA', poster: `/api/manga/image/${token}`, availableLanguages: ['pt-br'], authors: [], tags: [{ id: tag, name: 'Aventura' }], contentRating: 'suggestive', sourceUrl: id.startsWith('mangalivre:') ? 'https://mangalivre.to/manga/historia_qa/' : `https://mangadex.org/title/${id}` };
  const chapter: MangaChapter = { id: chapterId, mangaId: id, title: 'Capítulo sintético 1', chapter: '1', volume: null, language: 'pt-br', pages: 1, groups: [] };
  const source = {
    home: vi.fn<Source['home']>(async () => ({ popular: [manga], topRated: [manga], ongoing: [manga], latest: [manga], warnings: [] })),
    search: vi.fn<Source['search']>(async () => ({ items: [manga], page: 1, total: 1, hasNextPage: false })),
    details: vi.fn<Source['details']>(async () => manga),
    tags: vi.fn<Source['tags']>(async () => manga.tags),
    chapters: vi.fn<Source['chapters']>(async () => ({ items: [chapter], language: 'pt-br', page: 1, total: 1, hasNextPage: false })),
    pages: vi.fn<Source['pages']>(async () => ({ chapter, pages: [`/api/manga/image/${token}`], sourceUrl: manga.sourceUrl })),
    image: vi.fn<Source['image']>(async value => {
      if (value !== token) throw new ApiError(404, 'IMAGE_UNAVAILABLE', 'Imagem não emitida pela fonte sintética.');
      return { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png', cacheControl: 'private' };
    }),
  };
  return { source, manga, chapter };
}
function setup() {
  const dex = fixture(dexId, dexChapter, dexToken, dexTag);
  const livre = fixture(livreId, livreChapter, livreToken, livreTag);
  return { dex, livre, registry: new MangaRegistry({ mangadex: dex.source, mangalivre: livre.source }) };
}

describe('manga registry with isolated public-source adapters', () => {
  it('validates source-qualified work/chapter IDs and provider-specific genre queries', () => {
    expect(validateMangaProvider()).toBe('mangadex'); expect(validateMangaProvider('mangalivre')).toBe('mangalivre');
    expect(validateReadingMangaId(livreId)).toBe(livreId); expect(validateReadingMangaId(livreChapter, true)).toBe(livreChapter);
    expect(validateReadingMangaQuery({ provider: 'mangalivre', tag: livreTag, language: 'PT-BR', page: '2' })).toMatchObject({ provider: 'mangalivre', tag: livreTag, language: 'pt-br', page: 2 });
    expect(validateReadingMangaQuery({ tag: dexTag })).toMatchObject({ provider: 'mangadex', tag: dexTag });
    for (const input of [{ provider: 'other' }, { provider: 'mangalivre', tag: dexTag }, { provider: 'mangadex', tag: livreTag }, { provider: 'mangalivre', tag: '../admin' }, { provider: 'mangalivre', ignored: 'true' }]) expect(() => validateReadingMangaQuery(input)).toThrow();
    for (const value of ['https://mangalivre.to/manga/historia-qa/', 'mangalivre:../admin', livreChapter, 'anilist:1']) expect(() => validateReadingMangaId(value)).toThrow();
    expect(() => validateReadingMangaId(livreId, true)).toThrow();
  });

  it('routes home, search and genres only to the selected source and labels its cards', async () => {
    const { registry, dex, livre } = setup();
    const home = await registry.home('pt', 'mangalivre');
    expect(home.popular[0]).toMatchObject({ id: livreId, providerId: 'mangalivre' });
    expect(livre.source.home).toHaveBeenCalledWith('pt'); expect(dex.source.home).not.toHaveBeenCalled();
    const found = await registry.search({ provider: 'mangalivre', search: 'história', sort: 'latest', page: 3 });
    expect(found.items[0].providerName).toContain('Livre');
    expect(livre.source.search).toHaveBeenCalledWith({ search: 'história', sort: 'latest', page: 3 });
    expect(dex.source.search).not.toHaveBeenCalled();
    expect(await registry.tags('mangalivre')).toEqual(livre.manga.tags); expect(livre.source.tags).toHaveBeenCalledOnce(); expect(dex.source.tags).not.toHaveBeenCalled();
    await registry.search({ search: 'default' }); await registry.tags(); await registry.home();
    expect(dex.source.search).toHaveBeenCalledWith({ search: 'default' }); expect(dex.source.tags).toHaveBeenCalledOnce(); expect(dex.source.home).toHaveBeenCalledWith('pt-br');
  });

  it('routes details and chapter feeds by identity while preserving language and pagination', async () => {
    const { registry, dex, livre } = setup();
    expect((await registry.details(livreId)).providerId).toBe('mangalivre');
    expect(livre.source.details).toHaveBeenCalledWith(livreId); expect(dex.source.details).not.toHaveBeenCalled();
    expect((await registry.details(dexId)).providerId).toBe('mangadex');
    await registry.chapters(livreId, 'pt-br', 2); expect(livre.source.chapters).toHaveBeenCalledWith(livreId, 'pt-br', 2);
    await registry.chapters(dexId, 'en', 3); expect(dex.source.chapters).toHaveBeenCalledWith(dexId, 'en', 3);
    const pages = await registry.pages(livreChapter); expect(pages.chapter.id).toBe(livreChapter); expect(livre.source.pages).toHaveBeenCalledWith(livreChapter); expect(dex.source.pages).not.toHaveBeenCalled();
    await registry.pages(dexChapter); expect(dex.source.pages).toHaveBeenCalledWith(dexChapter);
  });

  it('remembers cover and page ticket ownership independently for both sources', async () => {
    const { registry, dex, livre } = setup();
    await registry.details(livreId); await registry.home();
    await registry.image(livreToken); expect(livre.source.image).toHaveBeenCalledWith(livreToken); expect(dex.source.image).not.toHaveBeenCalled();
    await registry.image(dexToken); expect(dex.source.image).toHaveBeenCalledWith(dexToken);
    const otherToken = '10000000-0000-4000-8000-000000000006';
    livre.source.pages.mockResolvedValueOnce({ chapter: livre.chapter, pages: [`/api/manga/image/${otherToken}`], sourceUrl: livre.manga.sourceUrl });
    livre.source.image.mockResolvedValueOnce({ bytes: new Uint8Array([4]), contentType: 'image/png', cacheControl: 'private' });
    await registry.pages(livreChapter); await registry.image(otherToken); expect(livre.source.image).toHaveBeenLastCalledWith(otherToken);
    await expect(registry.image('https://127.0.0.1/private')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects cards returned by a different source before exposing them', async () => {
    const { registry, dex, livre } = setup();
    livre.source.search.mockResolvedValueOnce({ items: [dex.manga], page: 1, total: 1, hasNextPage: false });
    await expect(registry.search({ provider: 'mangalivre' })).rejects.toMatchObject({ code: 'INVALID_MANGA_RESPONSE' });
  });

  it('rejects a detail response for a different work even when the provider matches', async () => {
    const { registry, livre } = setup();
    livre.source.details.mockResolvedValueOnce({ ...livre.manga, id: 'mangalivre:outra-obra' });
    await expect(registry.details(livreId)).rejects.toMatchObject({ code: 'INVALID_MANGA_RESPONSE' });
  });

  it.each(['other-work', 'other-provider'] as const)('rejects chapter feeds containing %s rows', async kind => {
    const { registry, dex, livre } = setup();
    const wrong = kind === 'other-provider' ? dex.chapter : { ...livre.chapter, mangaId: 'mangalivre:outra-obra' };
    livre.source.chapters.mockResolvedValueOnce({ items: [wrong], language: 'pt-br', page: 1, total: 1, hasNextPage: false });
    await expect(registry.chapters(livreId)).rejects.toMatchObject({ code: 'INVALID_MANGA_RESPONSE' });
  });

  it('rejects page metadata associating a qualified chapter with another work from the same source', async () => {
    const { registry, livre } = setup();
    livre.source.pages.mockResolvedValueOnce({ chapter: { ...livre.chapter, mangaId: 'mangalivre:outra-obra' }, pages: [`/api/manga/image/${livreToken}`], sourceUrl: livre.manga.sourceUrl });
    await expect(registry.pages(livreChapter)).rejects.toMatchObject({ code: 'INVALID_MANGA_RESPONSE' });
  });

  it('rejects page navigation that changes source or qualified work', async () => {
    const { registry, livre } = setup();
    for (const nextId of [dexChapter, 'mangalivre:outra-obra/capitulo-2']) {
      livre.source.pages.mockResolvedValueOnce({ chapter: livre.chapter, pages: [`/api/manga/image/${livreToken}`], sourceUrl: livre.manga.sourceUrl, navigation: { nextId } });
      await expect(registry.pages(livreChapter)).rejects.toMatchObject({ code: 'INVALID_MANGA_RESPONSE' });
    }
  });
});
