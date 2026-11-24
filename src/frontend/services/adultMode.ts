import { useSyncExternalStore } from 'react';

/** Off by default. Turning it on requires the 18+ confirmation in Sua experiência. */
export interface AdultMode { enabled: boolean; confirmedAt?: string }

const key = 'hpmovies.adult-mode.v1';
const event = 'hpmovies:adult-mode';
const OFF: AdultMode = { enabled: false };
let snapshot: AdultMode = OFF;
let memoryOnly = false;

export function readAdultMode(): AdultMode {
  if (memoryOnly) return snapshot;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null') as Partial<AdultMode> | null;
    const enabled = stored?.enabled === true && typeof stored.confirmedAt === 'string' && !Number.isNaN(Date.parse(stored.confirmedAt));
    const next: AdultMode = enabled ? { enabled: true, confirmedAt: stored!.confirmedAt } : OFF;
    if (next.enabled !== snapshot.enabled || next.confirmedAt !== snapshot.confirmedAt) snapshot = next;
  } catch { /* Blocked storage keeps the session choice. */ }
  return snapshot;
}

function subscribe(listener: () => void) {
  const storage = (change: StorageEvent) => { if (change.key === key || change.key === null) listener(); };
  window.addEventListener(event, listener);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(event, listener); window.removeEventListener('storage', storage); };
}

/** Enabling records the moment the person confirmed being 18 or older. */
export function setAdultMode(enabled: boolean) {
  snapshot = enabled ? { enabled: true, confirmedAt: new Date().toISOString() } : OFF;
  try {
    if (enabled) localStorage.setItem(key, JSON.stringify(snapshot));
    else localStorage.removeItem(key);
  } catch { memoryOnly = true; }
  window.dispatchEvent(new Event(event));
}

export const useAdultMode = () => useSyncExternalStore(subscribe, readAdultMode);

/** Lets an adult page open the settings drawer owned by the app shell. */
export const OPEN_SETTINGS_EVENT = 'hpmovies:open-settings';
export const openSettings = () => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
