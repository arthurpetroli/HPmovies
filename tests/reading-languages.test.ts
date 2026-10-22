import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourceParams, sourceQuery } from '../src/frontend/services/content';
import { contentLanguageLabel, readReadingLanguage, saveReadingLanguage, validReadingLanguage } from '../src/frontend/services/readingLanguages';

afterEach(() => { vi.unstubAllGlobals(); });

describe('reading language preferences', () => {
  it('starts in Brazilian Portuguese and recovers when storage is unavailable', () => {
    expect(readReadingLanguage()).toBe('pt-BR');
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Blocked'); } });
    expect(readReadingLanguage()).toBe('pt-BR');
    expect(() => saveReadingLanguage('en')).not.toThrow();
  });
  it('persists only valid explicit selections and labels real regional identities', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
    saveReadingLanguage('PT_br'); expect(readReadingLanguage()).toBe('pt-BR');
    saveReadingLanguage('pt'); expect(readReadingLanguage()).toBe('pt');
    saveReadingLanguage('all'); expect(readReadingLanguage()).toBe('all');
    saveReadingLanguage('<script>'); expect(readReadingLanguage()).toBe('pt-BR');
    expect(contentLanguageLabel('pt-PT')).toBe('Português (Portugal)');
    expect(validReadingLanguage('fr')).toBe('fr');
  });
  it('never sends the UI all-languages marker to a provider and retains provider and title hints', () => {
    const query = sourceQuery(new URLSearchParams({ source: 'tatakai', provider: 'comick', language: 'all', title: 'Título' }));
    expect(query.language).toBeUndefined();
    const params = sourceParams(query);
    expect(params.has('language')).toBe(false);
    expect(params.get('provider')).toBe('comick');
    expect(params.get('title')).toBe('Título');
  });
});
