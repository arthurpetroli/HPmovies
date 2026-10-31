import type { MangaChapter } from './manga.js';

export type MangaArchiveScope = 'all' | 'volume';
export type MangaArchiveState = 'queued' | 'downloading' | 'ready' | 'failed' | 'cancelled';

export interface MangaArchiveRequest {
  mangaId: string;
  language: string;
  scope: MangaArchiveScope;
  volume?: string | null;
  group?: string;
}

export interface MangaArchivePlan {
  mangaId: string;
  title: string;
  language: string;
  chapters: MangaChapter[];
  volumes: { volume: string | null; chapters: number }[];
  externalChapters: number;
  groups: string[];
  warnings: string[];
}

export interface MangaArchiveJob {
  id: string;
  state: MangaArchiveState;
  title: string;
  completedChapters: number;
  totalChapters: number;
  completedPages: number;
  bytes: number;
  message: string;
  fileUrl?: string;
}
