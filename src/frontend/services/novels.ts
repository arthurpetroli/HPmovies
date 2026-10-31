import type { NovelChapterList, NovelPage, NovelProvider, NovelReadingResult, NovelTitle } from '../../shared/novel';
import { requestData } from './http';
import { sourceSuffix, sourceTitles } from './content';
import type { ChapterQuery } from '../../shared/content';
import { isNativeNovelId, isNovelWorkId, nativeNovelChapterBelongsTo, novelProviderForId, novelProviderLanguage } from '../../shared/novelIdentity';

const safeUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};

export function isNovel(value: unknown): value is NovelTitle {
  if (!value || typeof value !== 'object') return false;
  const novel = value as Record<string, unknown>;
  return isNovelWorkId(novel.id) && typeof novel.title === 'string' && typeof novel.poster === 'string' && (!novel.poster || safeUrl(novel.poster))
    && (novel.sourceUrl === undefined || safeUrl(novel.sourceUrl)) && (novel.providerId === undefined || novel.providerId === novelProviderForId(novel.id))
    && (novel.providerName === undefined || typeof novel.providerName === 'string')
    && (novel.availableLanguages === undefined || Array.isArray(novel.availableLanguages) && novel.availableLanguages.every(language => typeof language === 'string')
      && (!isNativeNovelId(novel.id) || novel.availableLanguages.includes(novelProviderLanguage(novelProviderForId(novel.id))!)))
    && Array.isArray(novel.genres) && novel.genres.every((genre) => typeof genre === 'string');
}
const isPage = (value: unknown): value is NovelPage => {
  const page = value as NovelPage | null;
  return !!page && Array.isArray(page.items) && page.items.every(isNovel)
    && Number.isInteger(page.page) && page.page > 0 && typeof page.hasNextPage === 'boolean'
    && (page.message === undefined || typeof page.message === 'string');
};
const isChapters = (value: unknown): value is NovelChapterList => {
  const list = value as NovelChapterList | null;
  return !!list && typeof list.available === 'boolean' && typeof list.message === 'string'
    && ['available', 'unavailable', 'not_authorized'].includes(list.status) && typeof list.providerId === 'string'
    && Array.isArray(list.chapters) && list.chapters.every((chapter) => chapter && typeof chapter.id === 'string'
      && typeof chapter.title === 'string' && Number.isFinite(chapter.number) && typeof chapter.language === 'string');
};
const isContent = (value: unknown): value is NovelReadingResult => {
  const content = value as NovelReadingResult | null;
  return !!content && typeof content.available === 'boolean' && typeof content.message === 'string'
    && ['available', 'unavailable', 'not_authorized'].includes(content.status)
    && typeof content.providerId === 'string' && (content.sourceUrl === undefined || safeUrl(content.sourceUrl)) && Array.isArray(content.paragraphs)
    && content.paragraphs.every((paragraph) => typeof paragraph === 'string')
    && (!content.available || (!!content.novel && isNovel(content.novel) && !!content.chapter
      && typeof content.chapter.id === 'string' && typeof content.chapter.title === 'string'
      && typeof content.chapter.language === 'string' && content.paragraphs.length > 0));
};

function readingHints(id: string, query?: ChapterQuery): ChapterQuery {
  if (isNativeNovelId(id)) return query ?? {};
  if (query?.titles?.length) sourceTitles.save('novel', id, query.titles);
  return { ...query, titles: query?.titles?.length ? query.titles : sourceTitles.get('novel', id) };
}

export const novelService: NovelProvider = {
  search: (query) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
    return requestData(`/novels/search?${params}`, isPage).then(value => {
      const provider = query.provider ?? 'anilist';
      if (value.items.some(novel => novelProviderForId(novel.id) !== provider)) throw new Error('A fonte retornou obras de outro provedor. Atualize o catálogo.');
      return value;
    });
  },
  genres: (provider = 'anilist') => requestData(`/novels/genres?${new URLSearchParams({ provider })}`, (value): value is string[] => Array.isArray(value) && value.every((genre) => typeof genre === 'string')),
  details: (id) => requestData(`/novels/${encodeURIComponent(id)}`, isNovel).then(value => {
    if (value.id !== id) throw new Error('A fonte retornou outra obra. Abra novamente o catálogo.');
    return value;
  }),
  chapters: (id, query) => requestData(`/novels/${encodeURIComponent(id)}/chapters${sourceSuffix(readingHints(id, query))}`, isChapters, { timeoutMs: 65_000 }).then(value => {
    if (isNativeNovelId(id) && (value.providerId !== novelProviderForId(id) || value.chapters.some(chapter => !nativeNovelChapterBelongsTo(chapter.id, id) || chapter.language.toLowerCase() !== novelProviderLanguage(novelProviderForId(id))))) throw new Error('A fonte retornou capítulos de outra obra, provedor ou idioma.');
    return value;
  }),
  content: (id, chapterId, query) => requestData(`/novels/${encodeURIComponent(id)}/chapters/${encodeURIComponent(chapterId)}/content${sourceSuffix(readingHints(id, query))}`, isContent, { timeoutMs: 65_000 }).then(value => {
    if (value.available && (value.novel?.id !== id || value.chapter?.id !== chapterId)) throw new Error('A fonte retornou outro capítulo. Abra novamente a lista de capítulos.');
    if (isNativeNovelId(id) && (value.providerId !== novelProviderForId(id) || value.available && (value.chapter?.language.toLowerCase() !== novelProviderLanguage(novelProviderForId(id)) || value.isDemo || [value.previousChapterId, value.nextChapterId].some(next => next !== undefined && !nativeNovelChapterBelongsTo(next, id))))) throw new Error('A edição retornada não corresponde à obra, ao provedor ou ao idioma escolhido.');
    return value;
  }),
};
