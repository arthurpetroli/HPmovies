/** Normalized MangaDex contracts. React never consumes provider-specific payloads. */
export interface MangaTag { id: string; name: string }
export interface MangaTitle {
  id: string;
  title: string;
  originalTitle?: string;
  poster: string;
  description?: string;
  status?: string;
  year?: number;
  originalLanguage?: string;
  availableLanguages: string[];
  tags: MangaTag[];
  authors: string[];
  contentRating: 'safe' | 'suggestive';
  sourceUrl: string;
}
export interface MangaQuery {
  language?: string;
  search?: string;
  tag?: string;
  status?: 'ongoing' | 'completed' | 'hiatus' | 'cancelled';
  sort?: 'popular' | 'rating' | 'latest' | 'newest';
  page?: number;
}
export interface MangaPage { items: MangaTitle[]; page: number; total: number; hasNextPage: boolean }
export interface MangaHome { popular: MangaTitle[]; topRated: MangaTitle[]; ongoing: MangaTitle[]; latest: MangaTitle[]; warnings: string[] }
export interface MangaChapter {
  id: string;
  mangaId: string;
  title: string;
  chapter: string | null;
  volume: string | null;
  language: string;
  groups: string[];
  pages: number;
  publishedAt?: string;
  externalUrl?: string;
}
export interface MangaChapterPage {
  items: MangaChapter[];
  language: string;
  page: number;
  total: number;
  hasNextPage: boolean;
}
export interface MangaChapterPages { chapter: MangaChapter; pages: string[]; sourceUrl: string; navigation?: { previousId?: string; nextId?: string } }
export interface MangaCatalogProvider {
  home(language?: string): Promise<MangaHome>;
  search(query: MangaQuery): Promise<MangaPage>;
  details(id: string): Promise<MangaTitle>;
  tags(): Promise<MangaTag[]>;
}
export interface MangaChapterProvider {
  chapters(mangaId: string, language?: string, page?: number): Promise<MangaChapterPage>;
  pages(chapterId: string): Promise<MangaChapterPages>;
}

export interface MangaImageProvider {
  image(token: string): Promise<{ bytes: Uint8Array; contentType: string; cacheControl: string }>;
}
