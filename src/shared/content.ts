import type { CatalogAnime, Playback, ProviderDiagnostic, ProviderState, StreamingAvailability } from './providers.js';

export type ContentKind = 'anime' | 'manga' | 'novel';
export type ReadingKind = 'manga' | 'novel';
/** Stable qualified identities prevent mixing MangaDex UUIDs with AniList numbers. */
export interface ContentWork {
  id: string;
  kind: ContentKind;
  title: string;
  poster?: string;
  description?: string;
  providerId: string;
  language?: string;
  sourceUrl?: string;
  attribution?: string;
  license?: string;
  isDemo?: boolean;
  anime?: CatalogAnime;
}

export interface ContentChapter {
  id: string;
  workId: string;
  providerId: string;
  providerName: string;
  number?: string;
  title: string;
  language: string;
  credits: string[];
  available: boolean;
}

export interface ChapterQuery { provider?: string; language?: string; titles?: string[] }
export interface ContentChapterList {
  partial?: boolean;
  available: boolean;
  state: ProviderState;
  message: string;
  chapters: ContentChapter[];
  languages: string[];
  diagnostics: ProviderDiagnostic[];
}

export interface ContentPages {
  chapter: ContentChapter;
  pages: string[];
  previousChapterId?: string;
  nextChapterId?: string;
  sourceUrl?: string;
  attribution?: string;
  isDemo?: boolean;
}

export interface ContentText {
  chapter: ContentChapter;
  paragraphs: string[];
  previousChapterId?: string;
  nextChapterId?: string;
  sourceUrl?: string;
  attribution?: string;
  isDemo?: boolean;
}

export interface ReadingContentProvider {
  readonly id: string;
  supports(kind: ReadingKind, workId: string): boolean;
  diagnostic(): Promise<ProviderDiagnostic>;
  chapters(kind: ReadingKind, workId: string, query?: ChapterQuery): Promise<ContentChapterList>;
  pages(workId: string, chapterId: string, query?: ChapterQuery): Promise<ContentPages>;
  text(workId: string, chapterId: string, query?: ChapterQuery): Promise<ContentText>;
}

export interface OwnedContentProvider extends ReadingContentProvider {
  works(): Promise<ContentWork[]>;
  episodes(workId: string): Promise<StreamingAvailability>;
  playback(episodeId: string): Promise<Playback>;
}
