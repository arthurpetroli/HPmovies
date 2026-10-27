import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_READER_PREFERENCES, normalizeReaderPreferences, readReaderPreferences, readerPageStep, saveReaderPreferences } from '../src/frontend/components/manga/readerPreferences';
describe('manga reader preferences and page navigation', () => {
  it('bounds stored zoom and width, rejecting invalid themes and modes', () => {
    expect(normalizeReaderPreferences({ mode: 'unknown', theme: '<script>', width: Infinity, zoom: NaN })).toEqual(DEFAULT_READER_PREFERENCES);
    expect(normalizeReaderPreferences({ mode: 'double', zoom: 99, width: -10, direction: 'ltr', fit: 'height' })).toMatchObject({ mode: 'double', zoom: 2.5, width: 400, direction: 'ltr', fit: 'height' });
  });
  it('navigates both directions without crossing a chapter boundary', () => {
    expect(readerPageStep(0, -1, 12, 'single')).toBe(0);
    expect(readerPageStep(11, 1, 12, 'vertical')).toBe(11);
    expect(readerPageStep(2, 1, 12, 'double')).toBe(4);
    expect(readerPageStep(4, -1, 12, 'double')).toBe(2);
    expect(readerPageStep(2, 1, 12, 'single')).toBe(3);
  });
  it('survives blocked and malformed preference storage', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '{broken', setItem: () => { throw new Error('Blocked'); } } });
    expect(readReaderPreferences()).toEqual(DEFAULT_READER_PREFERENCES);
    expect(saveReaderPreferences(DEFAULT_READER_PREFERENCES)).toBe(false);
    vi.unstubAllGlobals();
  });
});
