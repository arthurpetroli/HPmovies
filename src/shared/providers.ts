export interface CatalogAnime {
  id: string;
  title: string;
  titleOriginal?: string;
  characters?: Array<{ id: string; name: string; image?: string; role?: string }>;
  season?: string;
  poster: string;
  banner?: string;
  description?: string;
  score?: number;
  year?: number;
  format?: string;
  status?: string;
  genres: string[];
  episodeCount?: number;
  duration?: number;
  relations?: Array<{ relation: string; anime: CatalogAnime }>;
  recommendations?: CatalogAnime[];
  externalLinks?: Array<{ site: string; url: string }>;
}

export interface CatalogQuery {
  season?: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
  search?: string;
  genre?: string;
  year?: number;
  format?: string;
  sort?: 'popular' | 'score' | 'trending' | 'newest';
  status?: string;
  page?: number;
}

export interface CatalogPage {
  items: CatalogAnime[];
  page: number;
  hasNextPage: boolean;
  total?: number;
}

export interface CatalogHome {
  trending: CatalogAnime[];
  popular: CatalogAnime[];
  airing: CatalogAnime[];
  topRated: CatalogAnime[];
  upcoming: CatalogAnime[];
}

export interface AnimeCatalogProvider {
  home(): Promise<CatalogHome>;
  search(query: CatalogQuery): Promise<CatalogPage>;
  details(id: string): Promise<CatalogAnime>;
  genres(): Promise<string[]>;
}

export interface StreamSubtitle {
  format?: 'vtt' | 'srt' | 'ass';
  id: string;
  url: string;
  label: string;
  language: string;
  kind?: 'subtitles' | 'captions';
  default?: boolean;
}

export interface StreamSource {
  url: string;
  type: 'hls' | 'mp4';
  label?: string;
  height?: number;
  providerId?: string;
  providerName?: string;
  quality?: string;
  audioLanguage?: string;
  subtitles?: StreamSubtitle[];
  available?: boolean;
}

export interface StreamingEpisode {
  id: string;
  title: string;
  number?: number;
  thumbnail?: string;
  duration?: number;
  available?: boolean;
}

export interface Playback {
  episode: StreamingEpisode;
  sources: StreamSource[];
  subtitles: StreamSubtitle[];
  audioLanguages: string[];
  intro?: { start: number; end: number };
  nextEpisodeId?: string;
  previousEpisodeId?: string;
  expiresAt?: string;
  attribution?: { label: string; url: string; license: string };
  isDemo: boolean;
  diagnostics?: ProviderDiagnostic[];
}

export interface StreamingAvailability {
  available: boolean;
  episodes: StreamingEpisode[];
  message?: string;
  state?: ProviderState;
  diagnostics?: ProviderDiagnostic[];
}

export interface AnimeStreamingProvider {
  episodes(animeId: string): Promise<StreamingAvailability>;
  playback(episodeId: string): Promise<Playback>;
}

export type ProviderState = 'available' | 'unavailable' | 'checking' | 'empty' | 'unauthorized' | 'connection_error';

export interface ProviderDiagnostic {
  id: string;
  name: string;
  enabled: boolean;
  state: ProviderState;
  technicalAvailable: boolean;
  authorized: boolean;
  checkedAt: string;
  message: string;
  capabilities: string[];
}

/** A permitted, direct playback source after external provider normalization. */
export interface StreamingSource extends StreamSource {
  providerId: string;
  providerName: string;
  subtitles: StreamSubtitle[];
  available: boolean;
}
