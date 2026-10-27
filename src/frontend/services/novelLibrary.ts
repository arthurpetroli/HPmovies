import { useSyncExternalStore } from 'react';
import type { NovelTitle } from '../../shared/novel';
import { isNovel } from './novels';

export interface SavedNovel { novel: NovelTitle; favorite: boolean; addedAt: number; completed: boolean }
export interface NovelProgress {
  novel: NovelTitle;
  chapterId: string;
  chapterTitle: string;
  /** Zero based paragraph index; stable when typography or viewport changes. */
  position: number;
  paragraphCount: number;
  updatedAt: number;
  completed: boolean;
}
export interface NovelReaderPreferences { fontSize: number; lineHeight: number; theme: 'dark' | 'light' | 'sepia'; font: 'serif' | 'sans' }
interface NovelLibraryState { saved: SavedNovel[]; history: NovelProgress[]; preferences: NovelReaderPreferences; storageError: string }
const KEY = 'hpmovies.novels.v1';
const EVENT = 'hpmovies:novels';
const DEFAULTS: NovelReaderPreferences = { fontSize: 20, lineHeight: 1.9, theme: 'dark', font: 'serif' };
let serialized: string | null | undefined;
let unavailable = false;
let snapshot: NovelLibraryState = { saved: [], history: [], preferences: DEFAULTS, storageError: '' };

function validPreferences(value: unknown): NovelReaderPreferences {
  const prefs = value && typeof value === 'object' ? value as Partial<NovelReaderPreferences> : {};
  return {
    fontSize: typeof prefs.fontSize === 'number' && Number.isFinite(prefs.fontSize) ? Math.max(16, Math.min(30, prefs.fontSize)) : DEFAULTS.fontSize,
    lineHeight: typeof prefs.lineHeight === 'number' && Number.isFinite(prefs.lineHeight) ? Math.max(1.4, Math.min(2.4, prefs.lineHeight)) : DEFAULTS.lineHeight,
    theme: ['dark', 'light', 'sepia'].includes(prefs.theme ?? '') ? prefs.theme! : DEFAULTS.theme,
    font: prefs.font === 'sans' ? 'sans' : 'serif',
  };
}

function read(): NovelLibraryState {
  if (unavailable) return snapshot;
  let raw: string | null;
  try { raw = window.localStorage.getItem(KEY); }
  catch { unavailable = true; snapshot = { ...snapshot, storageError: 'O armazenamento local está bloqueado. As alterações ficam apenas nesta sessão.' }; return snapshot; }
  if (serialized === raw) return snapshot;
  serialized = raw;
  try {
    const data = JSON.parse(raw ?? '{}') as Partial<NovelLibraryState>;
    snapshot = {
      saved: Array.isArray(data.saved) ? data.saved.filter((entry) => entry && isNovel(entry.novel) && typeof entry.favorite === 'boolean' && Number.isFinite(entry.addedAt) && typeof entry.completed === 'boolean').slice(0, 500) : [],
      history: Array.isArray(data.history) ? data.history.filter((entry) => entry && isNovel(entry.novel)
        && typeof entry.chapterId === 'string' && typeof entry.chapterTitle === 'string' && Number.isInteger(entry.position)
        && Number.isInteger(entry.paragraphCount) && entry.position >= 0 && entry.paragraphCount > 0
        && entry.position < entry.paragraphCount && Number.isFinite(entry.updatedAt) && typeof entry.completed === 'boolean').slice(0, 300) : [],
      preferences: validPreferences(data.preferences), storageError: '',
    };
  } catch { snapshot = { saved: [], history: [], preferences: DEFAULTS, storageError: 'Os dados de novels estavam danificados e foram reiniciados.' }; }
  return snapshot;
}

function write(state: NovelLibraryState) {
  snapshot = { ...state, storageError: '' };
  serialized = JSON.stringify(snapshot);
  try { window.localStorage.setItem(KEY, serialized); unavailable = false; }
  catch { unavailable = true; snapshot = { ...snapshot, storageError: 'Não foi possível salvar neste navegador. As alterações ficam apenas nesta sessão.' }; }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { unavailable = false; listener(); } };
  window.addEventListener(EVENT, listener); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', storage); };
}
function compact(novel: NovelTitle): NovelTitle {
  const card = { ...novel };
  delete card.description;
  delete card.externalLinks;
  return card;
}

export const novelLibrary = {
  getSaved: () => read().saved,
  getHistory: () => read().history,
  getPreferences: () => read().preferences,
  has: (id: string) => read().saved.some((entry) => entry.novel.id === id),
  toggle: (novel: NovelTitle) => {
    const state = read(), exists = state.saved.some((entry) => entry.novel.id === novel.id);
    write({ ...state, saved: exists ? state.saved.filter((entry) => entry.novel.id !== novel.id)
      : [{ novel: compact(novel), favorite: false, completed: false, addedAt: Date.now() }, ...state.saved].slice(0, 500) });
  },
  toggleFavorite: (novel: NovelTitle) => {
    const state = read(), exists = state.saved.some((entry) => entry.novel.id === novel.id);
    write({ ...state, saved: exists ? state.saved.map((entry) => entry.novel.id === novel.id ? { ...entry, favorite: !entry.favorite } : entry)
      : [{ novel: compact(novel), favorite: true, completed: false, addedAt: Date.now() }, ...state.saved].slice(0, 500) });
  },
  markCompleted: (id: string) => {
    const state = read();
    write({ ...state, saved: state.saved.map((entry) => entry.novel.id === id ? { ...entry, completed: !entry.completed } : entry) });
  },
  progress: (novelId: string, chapterId?: string) => read().history.find((entry) => entry.novel.id === novelId && (!chapterId || entry.chapterId === chapterId)),
  saveProgress: (progress: Omit<NovelProgress, 'updatedAt' | 'completed'>) => {
    if (!isNovel(progress.novel) || !Number.isInteger(progress.position) || !Number.isInteger(progress.paragraphCount)
      || progress.position < 0 || progress.paragraphCount < 1 || progress.position >= progress.paragraphCount) return;
    const state = read();
    const entry: NovelProgress = { ...progress, novel: compact(progress.novel), updatedAt: Date.now(), completed: progress.position === progress.paragraphCount - 1 };
    write({ ...state, history: [entry, ...state.history.filter((item) => item.novel.id !== progress.novel.id || item.chapterId !== progress.chapterId)].slice(0, 300) });
  },
  setPreferences: (preferences: Partial<NovelReaderPreferences>) => { const state = read(); write({ ...state, preferences: validPreferences({ ...state.preferences, ...preferences }) }); },
};

export function useNovelLibrary() { return useSyncExternalStore(subscribe, read); }
