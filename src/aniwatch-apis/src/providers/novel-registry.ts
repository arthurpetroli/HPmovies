import type { ChapterQuery } from '../../../shared/content.js';
import type { NovelProvider, NovelProviderId, NovelQuery, NovelTitle } from '../../../shared/novel.js';
import { isNativeNovelId, isNovelWorkId, nativeNovelChapterBelongsTo, nativeNovelLanguageMatches, novelLanguageLabel, novelProviderForId, novelProviderLabel, novelProviderLanguage } from '../../../shared/novelIdentity.js';
import { ApiError } from '../config/apiError.js';
import { validateNovelQuery } from './novels.js';
import { NovelManiaProvider } from './novelmania-novels.js';

export function validateNovelProvider(value = 'anilist'): NovelProviderId {
  if (value !== 'anilist' && value !== 'novelmania' && value !== 'wuxiaworldsite') throw new ApiError(400, 'INVALID_NOVEL_PROVIDER', 'Escolha Novel Mania, WuxiaWorld.site ou AniList.');
  return value;
}
export function validateReadingNovelId(id: string): string {
  if (!isNovelWorkId(id)) throw new ApiError(400, 'INVALID_NOVEL_ID', 'Identificador de novel inválido.');
  return id;
}
export function validateReadingNovelQuery(params: Record<string, string>): NovelQuery {
  const { provider, language, ...filters } = params;
  const selected = validateNovelProvider(provider);
  const normalizedLanguage = language?.toLowerCase();
  if (normalizedLanguage !== undefined && normalizedLanguage !== 'pt-br' && normalizedLanguage !== 'en') throw new ApiError(400, 'INVALID_NOVEL_LANGUAGE', 'Escolha português brasileiro ou inglês.');
  return { ...validateNovelQuery(filters), provider: selected, ...(normalizedLanguage ? { language: normalizedLanguage } : {}) };
}
const wrongEdition = () => new ApiError(502, 'INVALID_NOVEL_RESPONSE', 'A fonte retornou outra obra, capítulo ou idioma. Abra novamente a lista de capítulos.');

/** Reading sources retain their identity and language; AniList keeps its connected-source flow. */
export class NovelRegistry implements NovelProvider {
  private readonly sources: Partial<Record<NovelProviderId, NovelProvider>>;
  constructor(private readonly anilist: NovelProvider, native: NovelProvider = new NovelManiaProvider(), english?: NovelProvider) {
    this.sources = { anilist, novelmania: native, wuxiaworldsite: english };
  }
  private source(provider: NovelProviderId): NovelProvider {
    const selected = this.sources[validateNovelProvider(provider)];
    if (!selected) throw new ApiError(503, 'NOVEL_PROVIDER_UNAVAILABLE', 'Esta fonte de novels não está disponível. Escolha outro provedor.');
    return selected;
  }
  private card(novel: NovelTitle, provider: NovelProviderId): NovelTitle {
    const language = novelProviderLanguage(provider);
    if (!isNovelWorkId(novel.id) || novelProviderForId(novel.id) !== provider || novel.providerId && novel.providerId !== provider
      || language && (novel.isDemo || novel.availableLanguages && !novel.availableLanguages.includes(language))) throw wrongEdition();
    return { ...novel, providerId: provider, providerName: novelProviderLabel(provider) };
  }
  async search(query: NovelQuery) {
    const { provider = 'anilist', language, ...filters } = query;
    const expectedLanguage = novelProviderLanguage(provider);
    if (language && expectedLanguage && language.toLowerCase() !== expectedLanguage) return { items: [], page: filters.page ?? 1, hasNextPage: false, total: 0,
      message: `${novelProviderLabel(provider)} oferece capítulos em ${novelLanguageLabel(expectedLanguage).toLowerCase()}. Escolha uma fonte compatível com o idioma desejado.` };
    const result = await this.source(provider).search(filters);
    return { ...result, items: result.items.map(novel => this.card(novel, provider)) };
  }
  genres(provider: NovelProviderId = 'anilist') { return this.source(provider).genres(); }
  async details(id: string) {
    validateReadingNovelId(id);
    const provider = novelProviderForId(id);
    const novel = await this.source(provider).details(id);
    if (novel.id !== id) throw wrongEdition();
    return this.card(novel, provider);
  }
  async chapters(id: string, query?: ChapterQuery) {
    validateReadingNovelId(id);
    if (!isNativeNovelId(id)) return this.anilist.chapters(id, query);
    const provider = novelProviderForId(id); const language = novelProviderLanguage(provider)!;
    if (!nativeNovelLanguageMatches(id, query?.language)) return { available: false, status: 'unavailable' as const, providerId: provider, message: `Esta fonte oferece a edição em ${novelLanguageLabel(language).toLowerCase()}. Escolha uma fonte compatível com o idioma desejado.`, chapters: [] };
    const result = await this.source(provider).chapters(id, query);
    if (result.providerId !== provider || result.chapters.some(chapter => !nativeNovelChapterBelongsTo(chapter.id, id) || chapter.language.toLowerCase() !== language)) throw wrongEdition();
    return result;
  }
  async content(id: string, chapterId: string, query?: ChapterQuery) {
    validateReadingNovelId(id);
    if (!isNativeNovelId(id)) return this.anilist.content(id, chapterId, query);
    if (!nativeNovelChapterBelongsTo(chapterId, id)) throw new ApiError(400, 'INVALID_NOVEL_CHAPTER', 'O capítulo não pertence à novel escolhida.');
    const provider = novelProviderForId(id); const language = novelProviderLanguage(provider)!;
    if (!nativeNovelLanguageMatches(id, query?.language)) return { available: false, status: 'unavailable' as const, providerId: provider, message: `Esta edição está em ${novelLanguageLabel(language).toLowerCase()}, conforme a fonte.`, paragraphs: [] };
    const result = await this.source(provider).content(id, chapterId, query);
    if (result.providerId !== provider) throw wrongEdition();
    if (result.available && (result.novel?.id !== id || result.chapter?.id !== chapterId || result.chapter.language.toLowerCase() !== language || result.isDemo
      || [result.previousChapterId, result.nextChapterId].some(next => next !== undefined && !nativeNovelChapterBelongsTo(next, id)))) throw wrongEdition();
    return result.available && result.novel ? { ...result, novel: this.card(result.novel, provider) } : result;
  }
}
