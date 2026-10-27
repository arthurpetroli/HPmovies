import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MangaTitle } from '../src/shared/manga';
const manga: MangaTitle = { id: '11111111-1111-4111-8111-111111111111', title: 'História', poster: '', authors: [], availableLanguages: ['pt-br'], contentRating: 'safe', tags: [], sourceUrl: 'https://mangadex.org/title/11111111-1111-4111-8111-111111111111' };
const chapterId = '22222222-2222-4222-8222-222222222222';
const KEY = 'hpmovies.manga.library.v1';
async function setup(raw?: string) {
  vi.resetModules();
  const storage = new Map<string, string>(); if (raw) storage.set(KEY, raw);
  const events = new EventTarget();
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, dispatchEvent: events.dispatchEvent.bind(events), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
  const { mangaLibrary, isMangaProgress } = await import('../src/frontend/services/mangaLibrary');
  return { mangaLibrary, isMangaProgress, storage, events };
}
describe('manga progress and favorites persistence', () => {
  beforeEach(() => vi.unstubAllGlobals());
  it('persists favorites and completed library status across reloads', async () => {
    const { mangaLibrary, storage } = await setup();
    mangaLibrary.toggleFavorite(manga); mangaLibrary.markCompleted(manga.id);
    const raw = storage.get(KEY); expect(JSON.parse(raw!).saved[0]).toMatchObject({ favorite: true, completed: true });
    const reloaded = await setup(raw); expect(reloaded.mangaLibrary.has(manga.id)).toBe(true);
    reloaded.mangaLibrary.toggle(manga); expect(reloaded.mangaLibrary.has(manga.id)).toBe(false);
  });
  it('resumes the last actual page and replaces chapter progress within a series', async () => {
    const { mangaLibrary, storage } = await setup();
    mangaLibrary.saveProgress({ manga, chapterId, chapterTitle: 'Um', language: 'pt-br', page: 3, pageCount: 10 });
    const reloaded = await setup(storage.get(KEY));
    expect(reloaded.mangaLibrary.progress(manga.id)).toMatchObject({ page: 3, completed: false, language: 'pt-br' });
    reloaded.mangaLibrary.saveProgress({ manga, chapterId, chapterTitle: 'Um', language: 'pt-br', page: 9, pageCount: 10 });
    expect(reloaded.mangaLibrary.progress(manga.id)?.completed).toBe(true);
  });
  it('rejects out-of-range and corrupt progress instead of breaking the reader', async () => {
    const { mangaLibrary, isMangaProgress, storage } = await setup(JSON.stringify({ saved: [{ manga: null }], history: [{ manga, page: -1 }] }));
    expect(mangaLibrary.has(manga.id)).toBe(false); expect(mangaLibrary.progress(manga.id)).toBeUndefined();
    const base = { manga, chapterId, chapterTitle: 'Um', language: 'pt-br', pageCount: 10 };
    mangaLibrary.saveProgress({ ...base, page: 10 }); mangaLibrary.saveProgress({ ...base, page: NaN });
    expect(storage.get(KEY)).toContain('"page":-1');
    expect(isMangaProgress({ ...base, page: 5, updatedAt: Date.now(), completed: false })).toBe(true);
    expect(isMangaProgress({ ...base, page: 10, updatedAt: Date.now(), completed: false })).toBe(false);
  });
  it('keeps a session copy, notifies the UI and recovers after storage failures', async () => {
    const { mangaLibrary, events, storage } = await setup();
    const listener = vi.fn(); events.addEventListener('hpmovies:manga-library', listener);
    window.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
    mangaLibrary.toggle(manga); expect(mangaLibrary.has(manga.id)).toBe(true); expect(listener).toHaveBeenCalledOnce();
    window.localStorage.setItem = (key, value) => { storage.set(key, value); };
    mangaLibrary.toggleFavorite(manga); expect(JSON.parse(storage.get(KEY)!).saved[0].favorite).toBe(true);
  });
});
