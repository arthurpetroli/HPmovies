import { useSyncExternalStore } from 'react';
import type { CatalogAnime } from '../../shared/providers';
import { isCatalogAnime } from './catalog';

export interface SavedAnime {
  anime: CatalogAnime;
  favorite: boolean;
  completed?: boolean;
  addedAt: number;
}

export interface WatchProgress {
  episodeId: string;
  title: string;
  anime?: CatalogAnime;
  currentTime: number;
  duration: number;
  updatedAt: number;
  completed: boolean;
}

interface LibraryState {
  list: SavedAnime[];
  history: WatchProgress[];
  storageError?: string;
}

const STORAGE_KEY = 'hpmovies.library.v1';
const CHANGE_EVENT = 'hpmovies:library';
let serialized: string | null | undefined;
let snapshot: LibraryState = { list: [], history: [] };
let storageUnavailable = false;

function read(): LibraryState {
  if (storageUnavailable) return snapshot;
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(STORAGE_KEY); }
  catch { storageUnavailable = true; snapshot = { ...snapshot, storageError: 'O navegador bloqueou o armazenamento. As alterações ficam apenas nesta sessão.' }; return snapshot; }
  if (serialized === raw) return snapshot;
  serialized = raw;
  try {
    const value = JSON.parse(raw || '{}') as Partial<LibraryState>;
    snapshot = {
      list: Array.isArray(value.list) ? value.list.filter((entry) => entry && isCatalogAnime(entry.anime)
        && typeof entry.favorite === 'boolean' && Number.isFinite(entry.addedAt)).slice(0, 500) : [],
      history: Array.isArray(value.history) ? value.history.filter((entry) => entry
        && typeof entry.episodeId === 'string' && typeof entry.title === 'string'
        && Number.isFinite(entry.currentTime) && entry.currentTime >= 0
        && Number.isFinite(entry.duration) && entry.duration > 0
        && Number.isFinite(entry.updatedAt) && typeof entry.completed === 'boolean'
        && (!entry.anime || isCatalogAnime(entry.anime))).slice(0, 250) : [],
    };
  } catch { snapshot = { list: [], history: [] }; }
  return snapshot;
}

function write(value: LibraryState) {
  snapshot = value;
  serialized = JSON.stringify(value);
  try { window.localStorage.setItem(STORAGE_KEY, serialized); storageUnavailable = false; }
  catch { storageUnavailable = true; snapshot = { ...value, storageError: 'Não foi possível salvar no dispositivo. As alterações ficam apenas nesta sessão.' }; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) { storageUnavailable = false; listener(); }
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

function compactAnime(anime: CatalogAnime): CatalogAnime {
  const card = { ...anime };
  delete card.relations;
  delete card.recommendations;
  delete card.externalLinks;
  delete card.description;
  delete card.characters;
  return card;
}

export const libraryService = {
  getList: () => read().list,
  has: (id: string) => read().list.some((entry) => entry.anime.id === id),
  toggle: (anime: CatalogAnime) => {
    const state = read();
    const exists = state.list.some((entry) => entry.anime.id === anime.id);
    write({ ...state, list: exists ? state.list.filter((entry) => entry.anime.id !== anime.id)
      : [{ anime: compactAnime(anime), favorite: false, addedAt: Date.now() }, ...state.list].slice(0, 500) });
  },
  toggleFavorite: (anime: CatalogAnime) => {
    const state = read();
    const exists = state.list.some((entry) => entry.anime.id === anime.id);
    const list = exists ? state.list.map((entry) => entry.anime.id === anime.id
      ? { ...entry, favorite: !entry.favorite } : entry)
      : [{ anime: compactAnime(anime), favorite: true, addedAt: Date.now() }, ...state.list];
    write({ ...state, list: list.slice(0, 500) });
  },
  markCompleted: (id: string) => {
    const state = read();
    write({ ...state, list: state.list.map(entry => entry.anime.id === id ? { ...entry, completed: !entry.completed } : entry) });
  },
  getHistory: () => read().history,
  getProgress: (id: string) => read().history.find((entry) => entry.episodeId === id),
  saveProgress: (progress: Omit<WatchProgress, 'updatedAt' | 'completed'>) => {
    if (!Number.isFinite(progress.currentTime) || !Number.isFinite(progress.duration)
      || progress.duration <= 0 || progress.currentTime < 0) return;
    const state = read();
    const entry: WatchProgress = {
      ...progress,
      anime: progress.anime ? compactAnime(progress.anime) : undefined,
      currentTime: Math.min(progress.currentTime, progress.duration),
      updatedAt: Date.now(),
      completed: progress.currentTime / progress.duration >= 0.95,
    };
    write({ ...state, history: [entry, ...state.history.filter((item) => item.episodeId !== progress.episodeId)].slice(0, 250) });
  },
};

export function useLibrary() {
  return useSyncExternalStore(subscribe, read);
}
