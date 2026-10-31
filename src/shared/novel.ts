import type { ChapterQuery } from './content.js';

export type NovelProviderId = 'anilist' | 'novelmania' | 'wuxiaworldsite';
export type NovelLanguage = 'pt-br' | 'en';

/** Novel metadata and permitted text are deliberately independent. */
export interface NovelTitle {
  id: string;
  title: string;
  titleOriginal?: string;
  poster: string;
  banner?: string;
  description?: string;
  genres: string[];
  year?: number;
  score?: number;
  status?: string;
  volumes?: number;
  chapterCount?: number;
  authors?: string[];
  externalLinks?: Array<{ site: string; url: string }>;
  isDemo?: boolean;
  providerId?: NovelProviderId;
  providerName?: string;
  sourceUrl?: string;
  availableLanguages?: string[];
}

export interface NovelQuery {
  provider?: NovelProviderId;
  language?: string;
  search?: string;
  genre?: string;
  year?: number;
  status?: string;
  sort?: 'popular' | 'score' | 'trending' | 'newest';
  page?: number;
}

export interface NovelPage {
  items: NovelTitle[];
  page: number;
  hasNextPage: boolean;
  total?: number;
  message?: string;
}

export interface NovelChapter {
  id: string;
  number: number;
  title: string;
  language: string;
  displayLabel?: string;
}

export interface NovelChapterList {
  available: boolean;
  status: 'available' | 'unavailable' | 'not_authorized';
  providerId: string;
  message: string;
  chapters: NovelChapter[];
}

export interface NovelReadingResult {
  available: boolean;
  status: NovelChapterList['status'];
  providerId: string;
  message: string;
  paragraphs: string[];
  novel?: NovelTitle;
  chapter?: NovelChapter;
  previousChapterId?: string;
  nextChapterId?: string;
  isDemo?: boolean;
  attribution?: string;
  sourceUrl?: string;
}

export interface NovelProvider {
  search(query: NovelQuery): Promise<NovelPage>;
  genres(provider?: NovelProviderId): Promise<string[]>;
  details(id: string): Promise<NovelTitle>;
  chapters(id: string, query?: ChapterQuery): Promise<NovelChapterList>;
  content(id: string, chapterId: string, query?: ChapterQuery): Promise<NovelReadingResult>;
}
