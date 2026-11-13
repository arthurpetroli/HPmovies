export type CinemaType = 'movie' | 'series';

export interface CinemaTitle {
  id: string;
  type: CinemaType;
  title: string;
  poster?: string;
  background?: string;
  description?: string;
  year?: string;
  genres: string[];
  rating?: number;
  runtime?: string;
}

export interface CinemaEpisode {
  id: string;
  season: number;
  episode: number;
  title: string;
  released?: string;
  thumbnail?: string;
}

export interface CinemaDetails extends CinemaTitle {
  episodes: CinemaEpisode[];
}

export interface CinemaCatalog {
  items: CinemaTitle[];
  page: number;
  hasNextPage: boolean;
  notice?: string;
}

export interface CinemaQuery {
  type: CinemaType;
  search?: string;
  page: number;
  provider?: string;
  region?: string;
}

export interface CinemaCatalogFilters {
  providers: Array<{ id: string; label: string; regions?: string[] }>;
  regions: Array<{ id: string; label: string }>;
}

export interface CinemaProvider {
  catalog(query: CinemaQuery): Promise<CinemaCatalog>;
  details(type: CinemaType, id: string): Promise<CinemaDetails>;
  filters?(): Promise<CinemaCatalogFilters>;
}
