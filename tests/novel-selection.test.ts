import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerForNovelLanguage, readNovelSelection, resolveNovelSelection, saveNovelSelection } from '../src/frontend/services/novelSelection';
import type { NovelSelection } from '../src/frontend/services/novelSelection';

const key = 'hpmovies.novel-catalog.v1';
const portuguese: NovelSelection = { provider: 'novelmania', language: 'pt-br' };
const english: NovelSelection = { provider: 'wuxiaworldsite', language: 'en' };
const storageWith = (value: unknown) => {
  const storage = { getItem: vi.fn(() => JSON.stringify(value)), setItem: vi.fn() };
  vi.stubGlobal('localStorage', storage);
  return storage;
};

describe('novel catalog language preferences', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to Portuguese when preferences have not been saved', () => {
    const storage = storageWith(null);
    expect(readNovelSelection()).toEqual(portuguese);
    expect(storage.getItem).toHaveBeenCalledWith(key);
  });

  it('restores English and canonicalizes native source languages in saved preferences', () => {
    storageWith(english);
    expect(readNovelSelection()).toEqual(english);
    storageWith({ provider: 'wuxiaworldsite', language: 'pt-br' });
    expect(readNovelSelection()).toEqual(english);
    storageWith({ provider: 'novelmania', language: 'en' });
    expect(readNovelSelection()).toEqual(portuguese);
  });

  it('preserves the chosen AniList reading language without claiming a native catalog language', () => {
    for (const language of ['en', 'pt-br'] as const) {
      const selection: NovelSelection = { provider: 'anilist', language };
      storageWith(selection);
      expect(readNovelSelection()).toEqual(selection);
    }
  });

  it('ignores malformed or unsupported saved provider and language values', () => {
    for (const value of [[], 'en', 1, {}, { provider: 'wuxiaworldsite' }, { language: 'en' }, { provider: 'unknown', language: 'en' }, { provider: 'novelmania', language: 'ja' }, { provider: 'anilist', language: null }]) {
      storageWith(value);
      expect(readNovelSelection()).toEqual(portuguese);
    }
  });

  it('keeps catalog selection usable when preference reads are blocked or corrupt', () => {
    for (const getItem of [() => '{corrupt JSON', () => { throw new Error('Synthetic storage restriction'); }]) {
      vi.stubGlobal('localStorage', { getItem });
      expect(readNovelSelection()).toEqual(portuguese);
      expect(resolveNovelSelection(new URLSearchParams('language=en'), readNovelSelection())).toEqual(english);
    }
  });

  it('stores only the selected provider and language under the catalog preference key', () => {
    const storage = storageWith(null);
    saveNovelSelection(english);
    expect(storage.setItem).toHaveBeenCalledWith(key, JSON.stringify(english));
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('leaves URL selection available when saving preferences is blocked', () => {
    vi.stubGlobal('localStorage', { setItem: vi.fn(() => { throw new Error('Synthetic storage restriction'); }) });
    expect(() => saveNovelSelection(english)).not.toThrow();
    expect(resolveNovelSelection(new URLSearchParams('provider=wuxiaworldsite&language=en'), portuguese)).toEqual(english);
  });

  it('resolves language-only links to their native provider and normalizes language case', () => {
    expect(providerForNovelLanguage('en')).toBe('wuxiaworldsite');
    expect(providerForNovelLanguage('pt-br')).toBe('novelmania');
    expect(resolveNovelSelection(new URLSearchParams('language=EN'), portuguese)).toEqual(english);
    expect(resolveNovelSelection(new URLSearchParams('language=PT-BR'), english)).toEqual(portuguese);
    expect(resolveNovelSelection(new URLSearchParams('provider=unknown&language=en'), portuguese)).toEqual(english);
  });

  it('prioritizes a recognized URL provider and uses its native language when omitted', () => {
    expect(resolveNovelSelection(new URLSearchParams('provider=wuxiaworldsite'), portuguese)).toEqual(english);
    expect(resolveNovelSelection(new URLSearchParams('provider=novelmania'), english)).toEqual(portuguese);
    expect(resolveNovelSelection(new URLSearchParams('provider=anilist'), english)).toEqual({ provider: 'anilist', language: 'en' });
    expect(resolveNovelSelection(new URLSearchParams('provider=anilist&language=pt-br'), english)).toEqual({ provider: 'anilist', language: 'pt-br' });
  });

  it('preserves an explicit incompatible URL edition so the catalog can explain its unavailability', () => {
    expect(resolveNovelSelection(new URLSearchParams('provider=novelmania&language=en'), portuguese)).toEqual({ provider: 'novelmania', language: 'en' });
    expect(resolveNovelSelection(new URLSearchParams('provider=wuxiaworldsite&language=pt-br'), english)).toEqual({ provider: 'wuxiaworldsite', language: 'pt-br' });
  });

  it('falls back to saved choices without mutating search, filters or the original URL parameters', () => {
    const params = new URLSearchParams('provider=unknown&language=ja&q=QA&genre=Fantasy&page=3');
    const original = params.toString();
    expect(resolveNovelSelection(params, english)).toEqual(english);
    expect(params.toString()).toBe(original);
    expect(resolveNovelSelection(new URLSearchParams(), english)).toEqual(english);
  });
});
