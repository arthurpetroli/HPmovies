import type { NovelChapterList, NovelPage, NovelProvider, NovelReadingResult, NovelTitle } from '../../shared/novel';
import { requestData } from './http';

export function isNovel(value: unknown): value is NovelTitle {
  if (!value || typeof value !== 'object') return false;
  const novel = value as Record<string, unknown>;
  return typeof novel.id === 'string' && typeof novel.title === 'string' && typeof novel.poster === 'string'
    && Array.isArray(novel.genres) && novel.genres.every((genre) => typeof genre === 'string');
}
const isPage = (value: unknown): value is NovelPage => {
  const page = value as NovelPage | null;
  return !!page && Array.isArray(page.items) && page.items.every(isNovel)
    && Number.isInteger(page.page) && page.page > 0 && typeof page.hasNextPage === 'boolean';
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
    && typeof content.providerId === 'string' && Array.isArray(content.paragraphs)
    && content.paragraphs.every((paragraph) => typeof paragraph === 'string')
    && (!content.available || (!!content.novel && isNovel(content.novel) && !!content.chapter
      && typeof content.chapter.id === 'string' && typeof content.chapter.title === 'string'
      && typeof content.chapter.language === 'string' && content.paragraphs.length > 0));
};

export const novelService: NovelProvider = {
  search: (query) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
    return requestData(`/novels/search?${params}`, isPage);
  },
  genres: () => requestData('/novels/genres', (value): value is string[] => Array.isArray(value) && value.every((genre) => typeof genre === 'string')),
  details: (id) => requestData(`/novels/${encodeURIComponent(id)}`, isNovel),
  chapters: (id) => requestData(`/novels/${encodeURIComponent(id)}/chapters`, isChapters),
  content: (id, chapterId) => requestData(`/novels/${encodeURIComponent(id)}/chapters/${encodeURIComponent(chapterId)}/content`, isContent),
};
