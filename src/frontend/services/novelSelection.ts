import type { NovelLanguage, NovelProviderId } from '../../shared/novel';
import { novelProviderLanguage } from '../../shared/novelIdentity';

export interface NovelSelection { provider: NovelProviderId; language: NovelLanguage }
const KEY = 'hpmovies.novel-catalog.v1';
const validProvider = (value: unknown): value is NovelProviderId => value === 'novelmania' || value === 'wuxiaworldsite' || value === 'anilist';
const validLanguage = (value: unknown): value is NovelLanguage => value === 'pt-br' || value === 'en';
export const providerForNovelLanguage = (language: NovelLanguage): NovelProviderId => language === 'en' ? 'wuxiaworldsite' : 'novelmania';
export function readNovelSelection(): NovelSelection {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (value && typeof value === 'object' && 'provider' in value && 'language' in value && validProvider(value.provider) && validLanguage(value.language)) {
      return { provider: value.provider, language: novelProviderLanguage(value.provider) ?? value.language };
    }
  } catch { /* URL selection remains available when browser preferences are blocked. */ }
  return { provider: 'novelmania', language: 'pt-br' };
}
export function saveNovelSelection(value: NovelSelection) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* The selected URL retains both choices. */ }
}
export function resolveNovelSelection(params: URLSearchParams, saved: NovelSelection): NovelSelection {
  const requestedProvider = params.get('provider');
  const requestedLanguage = params.get('language')?.toLowerCase();
  const provider = validProvider(requestedProvider) ? requestedProvider : undefined;
  const language = validLanguage(requestedLanguage) ? requestedLanguage : undefined;
  if (provider) return { provider, language: language ?? novelProviderLanguage(provider) ?? saved.language };
  if (language) return { provider: providerForNovelLanguage(language), language };
  return saved;
}
