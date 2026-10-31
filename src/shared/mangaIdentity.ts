import type { MangaProviderId } from './manga.js';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const slug = '[a-z0-9][a-z0-9_-]{0,199}';
const livreWork = new RegExp(`^mangalivre:${slug}$`);
const livreChapter = new RegExp(`^mangalivre:${slug}/${slug}$`);
const livreTag = new RegExp(`^mangalivre:tag:${slug}$`);
export const isMangaWorkId = (value: unknown): value is string => typeof value === 'string' && (uuid.test(value) || livreWork.test(value));
export const isMangaChapterId = (value: unknown): value is string => typeof value === 'string' && (uuid.test(value) || livreChapter.test(value));
export const isMangaTagId = (value: unknown): value is string => typeof value === 'string' && (uuid.test(value) || livreTag.test(value));
export const mangaProviderForId = (id: string): MangaProviderId => id.startsWith('mangalivre:') ? 'mangalivre' : 'mangadex';
export const mangaChapterBelongsTo = (chapterId: string, workId: string): boolean => isMangaChapterId(chapterId) && isMangaWorkId(workId)
  && mangaProviderForId(chapterId) === mangaProviderForId(workId) && (!chapterId.startsWith('mangalivre:') || chapterId.startsWith(`${workId}/`));
export const mangaProviderLabel = (id: MangaProviderId) => id === 'mangalivre' ? 'Mangá Livre (.to)' : 'MangaDex';
export const mangaProviderSite = (id: MangaProviderId) => id === 'mangalivre' ? 'https://mangalivre.to' : 'https://mangadex.org';
export const mangaChapterSource = (chapterId: string) => chapterId.startsWith('mangalivre:')
  ? `https://mangalivre.to/manga/${chapterId.slice('mangalivre:'.length)}/` : `https://mangadex.org/chapter/${chapterId}`;
export const mangaReaderPath = (id: string, chapterId: string) => `/manga/${encodeURIComponent(id)}/read/${encodeURIComponent(chapterId)}`;
export const mangaDetailsPath = (id: string) => `/manga/${encodeURIComponent(id)}`;
