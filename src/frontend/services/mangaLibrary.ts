import { useSyncExternalStore } from 'react';
import type { MangaTitle } from '../../shared/manga';
import { isManga } from './manga';
import { isMangaChapterId, mangaChapterBelongsTo } from '../../shared/mangaIdentity';

export interface SavedManga { manga: MangaTitle; favorite: boolean; completed: boolean; addedAt: number }
export interface MangaProgress { manga: MangaTitle; chapterId: string; chapterTitle: string; language: string; page: number; pageCount: number; updatedAt: number; completed: boolean }
interface MangaLibraryState { saved: SavedManga[]; history: MangaProgress[]; storageError: string }
const KEY = 'hpmovies.manga.library.v1';
const EVENT = 'hpmovies:manga-library';
let snapshot: MangaLibraryState = { saved: [], history: [], storageError: '' };
let serialized: string | null | undefined;
let volatile = false;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const uint = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const compact = (manga: MangaTitle): MangaTitle => ({ ...manga, description: undefined });
export function isMangaProgress(value: unknown): value is MangaProgress {
  return object(value) && isManga(value.manga) && isMangaChapterId(value.chapterId) && mangaChapterBelongsTo(value.chapterId, value.manga.id) && typeof value.chapterTitle === 'string'
    && typeof value.language === 'string' && /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(value.language)
    && uint(value.page) && uint(value.pageCount) && value.pageCount > 0 && value.pageCount <= 1000 && value.page < value.pageCount
    && uint(value.updatedAt) && typeof value.completed === 'boolean';
}
function read(): MangaLibraryState {
  if (typeof window === 'undefined' || volatile) return snapshot;
  let raw: string | null;
  try { raw = window.localStorage.getItem(KEY); }
  catch { volatile = true; snapshot = { ...snapshot, storageError: 'O navegador bloqueou o armazenamento. A leitura será lembrada apenas nesta sessão.' }; return snapshot; }
  if (raw === serialized) return snapshot;
  serialized = raw;
  try {
    const value: unknown = JSON.parse(raw ?? '{}'); const data = object(value) ? value : {};
    snapshot = {
      saved: Array.isArray(data.saved) ? data.saved.filter((entry): entry is SavedManga => object(entry) && isManga(entry.manga)
        && typeof entry.favorite === 'boolean' && typeof entry.completed === 'boolean' && uint(entry.addedAt)).slice(0, 500) : [],
      history: Array.isArray(data.history) ? data.history.filter(isMangaProgress).slice(0, 300) : [], storageError: '',
    };
  } catch { snapshot = { saved: [], history: [], storageError: 'Os dados locais de mangás estavam corrompidos. Uma nova biblioteca foi iniciada.' }; }
  return snapshot;
}
function write(next: MangaLibraryState) {
  snapshot = next;
  serialized = JSON.stringify({ saved: next.saved, history: next.history });
  try { window.localStorage.setItem(KEY, serialized); volatile = false; snapshot = { ...next, storageError: '' }; }
  catch { volatile = true; snapshot = { ...next, storageError: 'Não foi possível salvar no dispositivo. Suas alterações estão disponíveis apenas nesta sessão.' }; }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { volatile = false; serialized = undefined; listener(); } };
  window.addEventListener(EVENT, listener); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', storage); };
}
export const mangaLibrary = {
  has: (id: string) => read().saved.some((entry) => entry.manga.id === id),
  toggle: (manga: MangaTitle) => {
    if (!isManga(manga)) return;
    const state = read(); const exists = state.saved.some((entry) => entry.manga.id === manga.id);
    write({ ...state, saved: exists ? state.saved.filter((entry) => entry.manga.id !== manga.id) : [{ manga: compact(manga), favorite: false, completed: false, addedAt: Date.now() }, ...state.saved].slice(0, 500) });
  },
  toggleFavorite: (manga: MangaTitle) => {
    if (!isManga(manga)) return;
    const state = read(); const exists = state.saved.some((entry) => entry.manga.id === manga.id);
    write({ ...state, saved: (exists ? state.saved.map((entry) => entry.manga.id === manga.id ? { ...entry, favorite: !entry.favorite } : entry)
      : [{ manga: compact(manga), favorite: true, completed: false, addedAt: Date.now() }, ...state.saved]).slice(0, 500) });
  },
  progress: (id: string) => read().history.find((entry) => entry.manga.id === id),
  saveProgress: (progress: Omit<MangaProgress, 'updatedAt' | 'completed'>) => {
    const entry: MangaProgress = { ...progress, manga: compact(progress.manga), updatedAt: Date.now(), completed: progress.page === progress.pageCount - 1 };
    if (!isMangaProgress(entry)) return;
    const state = read();
    write({ ...state, history: [entry, ...state.history.filter((item) => item.manga.id !== entry.manga.id)].slice(0, 300) });
  },
  markCompleted: (id: string) => {
    const state = read();
    write({ ...state, saved: state.saved.map((entry) => entry.manga.id === id ? { ...entry, completed: !entry.completed } : entry) });
  },
};
export function useMangaLibrary() { return useSyncExternalStore(subscribe, read); }
