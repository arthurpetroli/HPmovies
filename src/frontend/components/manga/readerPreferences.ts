export type ReaderMode = 'vertical' | 'single' | 'double';
export interface ReaderPreferences { mode: ReaderMode; theme: 'dark' | 'light' | 'sepia'; fit: 'width' | 'height' | 'original'; width: number; zoom: number; direction: 'rtl' | 'ltr' }
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = { mode: 'vertical', theme: 'dark', fit: 'width', width: 900, zoom: 1, direction: 'rtl' };
const KEY = 'hpmovies.manga.reader.v1';
export function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    mode: data.mode === 'single' || data.mode === 'double' ? data.mode : 'vertical',
    theme: data.theme === 'light' || data.theme === 'sepia' ? data.theme : 'dark',
    fit: data.fit === 'height' || data.fit === 'original' ? data.fit : 'width',
    width: typeof data.width === 'number' && Number.isFinite(data.width) ? Math.min(1600, Math.max(400, data.width)) : 900,
    zoom: typeof data.zoom === 'number' && Number.isFinite(data.zoom) ? Math.min(2.5, Math.max(0.5, data.zoom)) : 1,
    direction: data.direction === 'ltr' ? 'ltr' : 'rtl',
  };
}
export function readReaderPreferences(): ReaderPreferences {
  try { return normalizeReaderPreferences(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')); }
  catch { return { ...DEFAULT_READER_PREFERENCES }; }
}
export function saveReaderPreferences(value: ReaderPreferences): boolean {
  try { window.localStorage.setItem(KEY, JSON.stringify(normalizeReaderPreferences(value))); return true; }
  catch { return false; }
}
export function readerPageStep(page: number, direction: 1 | -1, count: number, mode: ReaderMode): number {
  const step = mode === 'double' ? 2 : 1;
  return Math.min(Math.max(0, count - 1), Math.max(0, page + step * direction));
}
