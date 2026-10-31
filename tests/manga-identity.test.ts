import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MangaTitle } from '../src/shared/manga';
import { isMangaChapterId, isMangaWorkId, mangaDetailsPath, mangaReaderPath } from '../src/shared/mangaIdentity';
import { isManga, isMangaChapter } from '../src/frontend/services/manga';

const manga: MangaTitle = { id: 'mangalivre:historia_qa', title: 'História QA', poster: '', authors: [], availableLanguages: ['pt-br'], contentRating: 'suggestive', tags: [{ id: 'mangalivre:tag:aventura', name: 'Aventura' }], providerId: 'mangalivre', sourceUrl: 'https://mangalivre.to/manga/historia_qa/' };
const chapterId = 'mangalivre:historia_qa/capitulo-1_1';
const dexId = '10000000-0000-4000-8000-000000000001';
const chapter = { id: chapterId, mangaId: manga.id, title: 'Capítulo 1', chapter: '1', volume: null, language: 'pt-br', pages: 0, groups: [] };

describe('qualified manga identities across reading and local library', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('accepts underscore source IDs and safely encodes their reader routes', () => {
    expect(isMangaWorkId(manga.id)).toBe(true); expect(isMangaChapterId(chapterId)).toBe(true);
    expect(isManga(manga)).toBe(true); expect(isMangaChapter(chapter)).toBe(true);
    expect(mangaDetailsPath(manga.id)).toBe('/manga/mangalivre%3Ahistoria_qa');
    expect(mangaReaderPath(manga.id, chapterId)).toBe('/manga/mangalivre%3Ahistoria_qa/read/mangalivre%3Ahistoria_qa%2Fcapitulo-1_1');
    expect(isMangaWorkId('mangalivre:../private')).toBe(false); expect(isMangaChapterId('mangalivre:historia_qa/../../private')).toBe(false);
  });

  it('keeps MangaDex and Mangá Livre cards, genres and chapters within their source identities', () => {
    expect(isManga({ ...manga, providerId: 'mangadex' })).toBe(false);
    expect(isManga({ ...manga, tags: [{ id: dexId, name: 'Wrong source' }] })).toBe(false);
    expect(isMangaChapter({ ...chapter, mangaId: dexId })).toBe(false);
    expect(isMangaChapter({ ...chapter, mangaId: 'mangalivre:outra-obra' })).toBe(false);
  });

  it('persists a qualified source favorite and actual chapter progress through a library reload', async () => {
    const storage = new Map<string, string>(); const events = new EventTarget();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, dispatchEvent: events.dispatchEvent.bind(events), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
    const first = await import('../src/frontend/services/mangaLibrary');
    first.mangaLibrary.toggleFavorite(manga);
    first.mangaLibrary.saveProgress({ manga, chapterId, chapterTitle: chapter.title, language: 'pt-br', page: 1, pageCount: 3 });
    vi.resetModules();
    const reloaded = await import('../src/frontend/services/mangaLibrary');
    expect(reloaded.mangaLibrary.has(manga.id)).toBe(true);
    expect(reloaded.mangaLibrary.progress(manga.id)).toMatchObject({ chapterId, page: 1, pageCount: 3, language: 'pt-br' });
  });
});
