import type { CatalogAnime, ProviderDiagnostic } from './providers.js';

/** Sent only by a browser where the person enabled adult content and confirmed being 18 or older. */
export const ADULT_CONSENT_HEADER = 'X-HPMovies-Adult';
export const ADULT_CONSENT_VALUE = '18+';

export interface AdultStatus {
  /** The backend operator allows adult routes (ADULT_CONTENT_ENABLED=true). */
  enabled: boolean;
}

export interface AdultCatalogHome {
  trending: CatalogAnime[];
  popular: CatalogAnime[];
  recent: CatalogAnime[];
  topRated: CatalogAnime[];
}

export interface AdultCatalogQuery {
  search?: string;
  tag?: string;
  sort?: 'popular' | 'score' | 'trending' | 'newest';
  page?: number;
}

export interface AdultSources {
  diagnostics: ProviderDiagnostic[];
}
