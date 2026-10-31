import type { MangaChapter, MangaChapterPage, MangaChapterPages, MangaHome, MangaPage, MangaProviderId, MangaQuery, MangaTag, MangaTitle } from '../../shared/manga';
import { isMangaChapterId, isMangaTagId, isMangaWorkId, mangaChapterBelongsTo, mangaProviderForId } from '../../shared/mangaIdentity';
import { API_BASE_URL, requestData } from './http';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const uint = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const https = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};
const imageGateway = (value: unknown): value is string => typeof value === 'string' && /^\/api\/manga\/image\/[0-9a-f-]{36}$/.test(value);
const configuredGateway = (value: unknown): value is string => typeof value === 'string' && value.startsWith(`${API_BASE_URL}/manga/image/`) && uuid(value.slice(`${API_BASE_URL}/manga/image/`.length));
const imageSource = (value: unknown): value is string => imageGateway(value) || configuredGateway(value) || https(value);
const resolveImage = (value: string): string => imageGateway(value) ? `${API_BASE_URL}${value.slice(4)}` : value;
const resolveCard = (value: MangaTitle): MangaTitle => ({ ...value, poster: resolveImage(value.poster) });
export function isManga(value: unknown): value is MangaTitle {
  return object(value) && isMangaWorkId(value.id) && typeof value.title === 'string' && typeof value.poster === 'string'
    && (value.poster === '' || imageSource(value.poster)) && stringList(value.availableLanguages) && stringList(value.authors)
    && (value.contentRating === 'safe' || value.contentRating === 'suggestive') && https(value.sourceUrl)
    && (value.providerId === undefined || value.providerId === mangaProviderForId(value.id))
    && (value.providerName === undefined || typeof value.providerName === 'string')
    && Array.isArray(value.tags) && value.tags.every((tag) => object(tag) && isMangaTagId(tag.id) && mangaProviderForId(tag.id) === mangaProviderForId(value.id as string) && typeof tag.name === 'string');
}
export function isMangaChapter(value: unknown): value is MangaChapter {
  return object(value) && isMangaChapterId(value.id) && isMangaWorkId(value.mangaId) && mangaChapterBelongsTo(value.id, value.mangaId) && typeof value.title === 'string'
    && typeof value.language === 'string' && /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(value.language)
    && (value.chapter === null || typeof value.chapter === 'string') && (value.volume === null || typeof value.volume === 'string')
    && uint(value.pages) && stringList(value.groups) && (value.externalUrl === undefined || https(value.externalUrl));
}
export const mangaService = {
  home: (language = 'pt-br', provider: MangaProviderId = 'mangadex') => requestData<MangaHome>(`/manga/home?${new URLSearchParams({ language, provider })}`, (value): value is MangaHome => object(value)
    && ['popular', 'topRated', 'ongoing', 'latest'].every((key) => Array.isArray(value[key]) && value[key].every(isManga)) && stringList(value.warnings)).then((value) => ({ ...value, popular: value.popular.map(resolveCard), topRated: value.topRated.map(resolveCard), ongoing: value.ongoing.map(resolveCard), latest: value.latest.map(resolveCard) })),
  search: (query: MangaQuery) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
    return requestData<MangaPage>(`/manga/search?${params}`, (value): value is MangaPage => object(value) && Array.isArray(value.items) && value.items.every(isManga)
      && uint(value.page) && value.page > 0 && uint(value.total) && typeof value.hasNextPage === 'boolean').then((value) => ({ ...value, items: value.items.map(resolveCard) }));
  },
  details: (id: string) => requestData<MangaTitle>(`/manga/${encodeURIComponent(id)}`, isManga).then(resolveCard),
  tags: (provider: MangaProviderId = 'mangadex') => requestData<MangaTag[]>(`/manga/tags?${new URLSearchParams({ provider })}`, (value): value is MangaTag[] => Array.isArray(value) && value.every((tag) => object(tag) && isMangaTagId(tag.id) && typeof tag.name === 'string')),
  chapters: (id: string, language = 'pt-br', page = 1) => requestData<MangaChapterPage>(`/manga/${encodeURIComponent(id)}/chapters?${new URLSearchParams({ language, page: String(page) })}`, (value): value is MangaChapterPage => object(value)
    && Array.isArray(value.items) && value.items.every(isMangaChapter) && typeof value.language === 'string' && uint(value.page) && value.page > 0 && uint(value.total) && typeof value.hasNextPage === 'boolean'),
  pages: (chapterId: string) => requestData<MangaChapterPages>(`/manga/chapter/${encodeURIComponent(chapterId)}/pages`, (value): value is MangaChapterPages => object(value)
    && isMangaChapter(value.chapter) && Array.isArray(value.pages) && value.pages.every(imageSource) && https(value.sourceUrl)
    && (value.navigation === undefined || object(value.navigation) && (value.navigation.previousId === undefined || isMangaChapterId(value.navigation.previousId)) && (value.navigation.nextId === undefined || isMangaChapterId(value.navigation.nextId)))).then((value) => ({ ...value, pages: value.pages.map(resolveImage) })),
};
export const mangaLanguageLabel = (language: string) => ({ 'pt-br': 'Português brasileiro', pt: 'Português · todas as variantes', 'pt-pt': 'Português (Portugal)', all: 'Todos os idiomas', en: 'Inglês', es: 'Espanhol', 'es-la': 'Espanhol (América Latina)', ja: 'Japonês', fr: 'Francês', ko: 'Coreano', zh: 'Chinês' }[language] ?? language.toUpperCase());
export const mangaStatusLabel = (status?: string) => ({ ongoing: 'Em publicação', completed: 'Concluído', hiatus: 'Em pausa', cancelled: 'Cancelado' }[status ?? ''] ?? status ?? 'Mangá');
