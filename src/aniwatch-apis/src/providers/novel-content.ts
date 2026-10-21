import type { NovelChapter, NovelChapterList, NovelProvider, NovelReadingResult, NovelTitle } from '../../../shared/novel.js';
import type { ContentChapter } from '../../../shared/content.js';
import type { ContentQuery } from './content-registry.js';
import { ContentRegistry } from './content-registry.js';
import { AniListNovelProvider, validateNovelId } from './novels.js';

const normalizedChapter = (chapter: ContentChapter, index: number): NovelChapter => ({
  id: chapter.id, number: Number.isFinite(Number(chapter.number)) && chapter.number !== undefined ? Number(chapter.number) : index + 1,
  title: chapter.title, language: chapter.language,
});

/** Metadata and authorized text have independent failure boundaries. */
export class NovelContentProvider implements NovelProvider {
  constructor(readonly catalog: NovelProvider = new AniListNovelProvider(), readonly reading: ContentRegistry) {}
  search: NovelProvider['search'] = query => this.catalog.search(query);
  genres = () => this.catalog.genres();
  details = (id: string) => this.catalog.details(id);

  async chapters(id: string, query: ContentQuery = {}): Promise<NovelChapterList> {
    validateNovelId(id);
    if (id === 'demo') return this.catalog.chapters(id);
    const metadata = query.titles?.length ? undefined : await this.catalog.details(id).catch(() => undefined);
    const context = metadata ? { ...query, titles: [metadata.title, metadata.titleOriginal || ''].filter(Boolean) } : query;
    const result = await this.reading.chapters('novel', `anilist:${id}`, context);
    const noPermission = result.diagnostics.every(provider => !provider.authorized);
    return { available: result.available, status: result.available ? 'available' : noPermission || result.state === 'unauthorized' ? 'not_authorized' : 'unavailable', providerId: query.source ?? 'registry', message: result.message, chapters: result.chapters.map(normalizedChapter) };
  }

  async content(id: string, chapterId: string, query: ContentQuery = {}): Promise<NovelReadingResult> {
    validateNovelId(id);
    if (id === 'demo') return this.catalog.content(id, chapterId);
    const metadata = await this.catalog.details(id).catch(() => undefined);
    const context = !query.titles?.length && metadata ? { ...query, titles: [metadata.title, metadata.titleOriginal || ''].filter(Boolean) } : query;
    const content = await this.reading.text(`anilist:${id}`, chapterId, context);
    const novel: NovelTitle = metadata ?? { id, title: query.titles?.[0] ?? `Novel · AniList ${id}`, poster: '', genres: [] };
    return { available: true, status: 'available', providerId: content.chapter.providerId, message: 'Texto fornecido pela fonte conectada.', paragraphs: content.paragraphs, chapter: normalizedChapter(content.chapter, 0), novel, previousChapterId: content.previousChapterId, nextChapterId: content.nextChapterId, isDemo: content.isDemo ?? false, attribution: content.attribution ?? [content.chapter.providerName, ...content.chapter.credits].join(' · ') };
  }
}
