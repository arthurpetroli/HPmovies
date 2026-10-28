import { useSyncExternalStore } from 'react';

interface WatchPreferences { ambient: boolean; autoNext: boolean; autoSkipIntro: boolean }
const key = 'hpmovies.watch-preferences.v1';
const event = 'hpmovies:watch-preferences';
let snapshot: WatchPreferences = { ambient: true, autoNext: true, autoSkipIntro: false };
let memoryOnly = false;

function read(): WatchPreferences {
  if (memoryOnly) return snapshot;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '{}') as Partial<WatchPreferences> | null;
    const next = {
      ambient: typeof stored?.ambient === 'boolean' ? stored.ambient : true,
      autoNext: typeof stored?.autoNext === 'boolean' ? stored.autoNext : localStorage.getItem('hpmovies.auto-next') !== 'false',
      autoSkipIntro: typeof stored?.autoSkipIntro === 'boolean' ? stored.autoSkipIntro : false,
    };
    if (Object.keys(next).some(name => next[name as keyof WatchPreferences] !== snapshot[name as keyof WatchPreferences])) snapshot = next;
  } catch { /* Defaults and session preferences remain usable when storage is blocked. */ }
  return snapshot;
}

function subscribe(listener: () => void) {
  const storage = (change: StorageEvent) => { if (change.key === key || change.key === 'hpmovies.auto-next' || change.key === null) listener(); };
  window.addEventListener(event, listener);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(event, listener); window.removeEventListener('storage', storage); };
}

export function setWatchPreference<K extends keyof WatchPreferences>(name: K, value: WatchPreferences[K]) {
  snapshot = { ...read(), [name]: value };
  try { localStorage.setItem(key, JSON.stringify(snapshot)); } catch { memoryOnly = true; }
  window.dispatchEvent(new Event(event));
}

export const useWatchPreferences = () => useSyncExternalStore(subscribe, read);
