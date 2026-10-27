import type { AnimeCatalogProvider, CatalogAnime, CatalogHome, CatalogPage } from '../../shared/providers';
import { requestData } from './http';

export function isCatalogAnime(value: unknown): value is CatalogAnime {
  if (!value || typeof value !== 'object') return false;
  const anime = value as Record<string, unknown>;
  return typeof anime.id === 'string' && typeof anime.title === 'string'
    && typeof anime.poster === 'string' && Array.isArray(anime.genres)
    && anime.genres.every((genre) => typeof genre === 'string');
}

const isPage = (value: unknown): value is CatalogPage => {
  const page = value as CatalogPage | null;
  return !!page && Array.isArray(page.items) && page.items.every(isCatalogAnime)
    && typeof page.page === 'number' && typeof page.hasNextPage === 'boolean';
};

const isHome = (value: unknown): value is CatalogHome => {
  if (!value || typeof value !== 'object') return false;
  const home = value as Record<string, unknown>;
  return ['trending', 'popular', 'airing', 'topRated', 'upcoming']
    .every((key) => Array.isArray(home[key]) && (home[key] as unknown[]).every(isCatalogAnime));
};

export const catalogService: AnimeCatalogProvider = {
  home: () => requestData('/catalog/home', isHome),
  search: (query) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    return requestData(`/catalog/search?${params}`, isPage);
  },
  details: (id) => requestData(`/catalog/anime/${encodeURIComponent(id)}`, isCatalogAnime),
  genres: () => requestData('/catalog/genres', (value): value is string[] =>
    Array.isArray(value) && value.every((genre) => typeof genre === 'string')),
};

export default catalogService;
