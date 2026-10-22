import type { ChapterQuery, ContentChapter, ContentChapterList, ContentPages, ReadingKind } from '../../shared/content';
import type { Playback } from '../../shared/providers';
import { apiMediaUrl, requestData } from './http';
import { isPlayback, playbackMedia } from './streaming';

export interface SourceQuery extends ChapterQuery { source?: 'tatakai' | 'toko' }

export function sourceQuery(params: URLSearchParams): SourceQuery {
  const source = params.get('source');
  return {
    source: source === 'tatakai' || source === 'toko' ? source : undefined,
    provider: params.get('provider') || undefined,
    language: params.get('language') === 'all' ? undefined : params.get('language') || undefined,
    titles: [...params.getAll('title'), ...params.getAll('titles[]')].filter(Boolean).slice(0, 5),
  };
}

export function sourceParams(query: SourceQuery = {}): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ['source', 'provider', 'language'] as const) if (query[key]) params.set(key, query[key]!);
  query.titles?.filter(Boolean).slice(0, 5).forEach(title => params.append('title', title));
  return params;
}

export const sourceSuffix = (query: SourceQuery = {}) => {
  const params = sourceParams(query);
  return params.size ? `?${params}` : '';
};

// Remember title hints so entries opened again from the library still resolve
// while the metadata catalog is unavailable. No credentials or media URLs.
export const sourceTitles = {
  get(kind: string, id: string): string[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(`hpmovies.source-titles:${kind}:${id}`) || '[]');
      return Array.isArray(value) ? value.filter((title): title is string => typeof title === 'string' && title.length > 0 && title.length <= 200).slice(0, 5) : [];
    } catch { return []; }
  },
  save(kind: string, id: string, titles?: string[]) {
    if (!titles?.length) return;
    try { localStorage.setItem(`hpmovies.source-titles:${kind}:${id}`, JSON.stringify(titles.slice(0, 5))); } catch { /* Hints in the URL remain usable. */ }
  },
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const chapter = (value: unknown): value is ContentChapter => object(value) && typeof value.id === 'string' && typeof value.workId === 'string'
  && typeof value.providerId === 'string' && typeof value.providerName === 'string' && typeof value.title === 'string'
  && typeof value.language === 'string' && typeof value.available === 'boolean' && strings(value.credits)
  && (value.number === undefined || typeof value.number === 'string');

export const contentService = {
  playback: (id: string, episode: string, query: SourceQuery = {}) => {
    // The streaming endpoint accepts the source and title hints, not reading filters.
    return requestData<Playback>(`/content/anime/${encodeURIComponent(id)}/episodes/${encodeURIComponent(episode)}${sourceSuffix({ source: query.source, titles: query.titles })}`, isPlayback, { timeoutMs: 65_000 }).then(playback => {
      sourceTitles.save('anime', playback.episode.id, query.titles);
      return playbackMedia(playback);
    });
  },
  chapters: (kind: ReadingKind, id: string, query: SourceQuery = {}) => requestData<ContentChapterList>(`/content/${kind}/${encodeURIComponent(id)}/chapters${sourceSuffix(query)}`,
    (value): value is ContentChapterList => object(value) && typeof value.available === 'boolean' && typeof value.state === 'string'
      && typeof value.message === 'string' && Array.isArray(value.chapters) && value.chapters.every(chapter)
      && strings(value.languages) && Array.isArray(value.diagnostics) && value.diagnostics.every(item => object(item) && typeof item.id === 'string' && typeof item.message === 'string'), { timeoutMs: 65_000 }),
  pages: (id: string, chapterId: string, query: SourceQuery = {}) => requestData<ContentPages>(`/content/manga/${encodeURIComponent(id)}/chapters/${encodeURIComponent(chapterId)}/pages${sourceSuffix(query)}`,
    (value): value is ContentPages => object(value) && chapter(value.chapter) && strings(value.pages)
      && (value.previousChapterId === undefined || typeof value.previousChapterId === 'string')
      && (value.nextChapterId === undefined || typeof value.nextChapterId === 'string'), { timeoutMs: 65_000 }).then(content => ({ ...content, pages: content.pages.map(apiMediaUrl) })),
};

interface SourcePageProgress { chapterId: string; page: number; pageCount: number }
const progressKey = (id: string, query: SourceQuery) => `hpmovies.source-manga:${id}:${query.source ?? 'all'}:${query.provider ?? 'all'}`;
export const sourceMangaProgress = {
  get(id: string, query: SourceQuery): SourcePageProgress | undefined {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(progressKey(id, query)) || 'null');
      if (object(value) && typeof value.chapterId === 'string' && Number.isSafeInteger(value.page) && Number.isSafeInteger(value.pageCount)
        && Number(value.page) >= 0 && Number(value.page) < Number(value.pageCount)) return value as unknown as SourcePageProgress;
    } catch { /* Reading remains available when browser storage is blocked. */ }
    return undefined;
  },
  save(id: string, query: SourceQuery, value: SourcePageProgress): boolean {
    try { localStorage.setItem(progressKey(id, query), JSON.stringify(value)); return true; } catch { return false; }
  },
};
