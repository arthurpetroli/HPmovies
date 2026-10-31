import type { NovelLanguage, NovelProviderId } from './novel.js';

const slug = '[a-z0-9][a-z0-9_-]{0,199}';
const nativeWork = new RegExp(`^(?:novelmania|wuxiaworldsite):${slug}$`);
const nativeChapter = new RegExp(`^(?:novelmania|wuxiaworldsite):${slug}/${slug}$`);
export const isNativeNovelId = (value: unknown): value is string => typeof value === 'string' && nativeWork.test(value);
export const isNativeNovelChapterId = (value: unknown): value is string => typeof value === 'string' && nativeChapter.test(value);
export const isNovelWorkId = (value: unknown): value is string => typeof value === 'string' && (value === 'demo' || /^[1-9]\d{0,8}$/.test(value) || isNativeNovelId(value));
export const nativeNovelChapterBelongsTo = (id: string, work: string) => isNativeNovelChapterId(id) && isNativeNovelId(work) && id.startsWith(`${work}/`);
export const novelDetailsPath = (id: string) => `/novel/${encodeURIComponent(id)}`;
export const novelReaderPath = (id: string, chapterId: string) => `${novelDetailsPath(id)}/read/${encodeURIComponent(chapterId)}`;
export const novelProviderForId = (id: string): NovelProviderId => id.startsWith('wuxiaworldsite:') ? 'wuxiaworldsite' : id.startsWith('novelmania:') ? 'novelmania' : 'anilist';
export const novelProviderLabel = (provider: NovelProviderId) => ({ novelmania: 'Novel Mania', wuxiaworldsite: 'WuxiaWorld.site', anilist: 'AniList' }[provider]);
export const novelProviderLanguage = (provider: NovelProviderId): NovelLanguage | undefined => provider === 'anilist' ? undefined : provider === 'wuxiaworldsite' ? 'en' : 'pt-br';
export const novelLanguageLabel = (language: string) => ({ 'pt-br': 'Português brasileiro', en: 'Inglês', pt: 'Português', all: 'Todos os idiomas' }[language.toLowerCase()] ?? language);
export const novelCatalogPath = (provider: NovelProviderId, language?: string) => `/novels?${new URLSearchParams({ provider, ...(language || novelProviderLanguage(provider) ? { language: language || novelProviderLanguage(provider)! } : {}) })}`;
export function nativeNovelLanguageMatches(id: string, language?: string): boolean {
  if (!isNativeNovelId(id)) return true;
  const expected = novelProviderLanguage(novelProviderForId(id));
  const requested = language?.toLowerCase();
  return requested === undefined || requested === 'all' || requested === expected || requested === 'pt' && expected === 'pt-br';
}
