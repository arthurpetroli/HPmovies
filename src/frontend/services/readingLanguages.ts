const KEY = 'hpmovies.reading-language.v1';

export const readingLanguages = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'pt', label: 'Português · todas as variantes' },
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'en', label: 'Inglês' },
  { value: 'ja', label: 'Japonês' },
  { value: 'all', label: 'Todos os idiomas' },
];

export function validReadingLanguage(value: string | null): string | undefined {
  if (!value) return undefined;
  const code = value.trim().replace(/_/g, '-').toLowerCase();
  if (code === 'all') return code;
  if (code.length > 39 || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/.test(code)) return undefined;
  return code === 'pt-br' ? 'pt-BR' : code === 'pt-pt' ? 'pt-PT' : code;
}

export function readReadingLanguage(): string {
  try { return validReadingLanguage(localStorage.getItem(KEY)) ?? 'pt-BR'; } catch { return 'pt-BR'; }
}

export function saveReadingLanguage(language: string) {
  try { localStorage.setItem(KEY, validReadingLanguage(language) ?? 'pt-BR'); } catch { /* URL selection remains usable. */ }
}

export function contentLanguageLabel(language: string): string {
  return readingLanguages.find(option => option.value.toLowerCase() === language.toLowerCase())?.label ?? language;
}
