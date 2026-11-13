import type { CinemaCatalog, CinemaCatalogFilters, CinemaDetails, CinemaQuery, CinemaTitle, CinemaType } from '../../shared/cinema';
import { requestData } from './http';
import { isCinemaTitle } from './watchCinemaContext';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const title: (value: unknown) => value is CinemaTitle = isCinemaTitle;

export const cinemaService = {
  filters() {
    return requestData<CinemaCatalogFilters>('/cinema/filters', (value): value is CinemaCatalogFilters => object(value)
      && Array.isArray(value.providers) && value.providers.length <= 1000
      && value.providers.every(item => object(item) && typeof item.id === 'string' && typeof item.label === 'string'
        && (item.regions === undefined || Array.isArray(item.regions) && item.regions.every(region => typeof region === 'string')))
      && Array.isArray(value.regions) && value.regions.length > 0 && value.regions.length <= 100
      && value.regions.every(item => object(item) && typeof item.id === 'string' && typeof item.label === 'string'));
  },
  catalog(query: CinemaQuery) {
    const params = new URLSearchParams({ type: query.type, page: String(query.page) });
    if (query.search) params.set('search', query.search);
    if (query.provider) params.set('provider', query.provider);
    if (query.region) params.set('region', query.region);
    return requestData<CinemaCatalog>(`/cinema/catalog?${params}`, (value): value is CinemaCatalog => object(value)
      && Array.isArray(value.items) && value.items.every(item => title(item) && item.type === query.type)
      && value.page === query.page && typeof value.hasNextPage === 'boolean');
  },
  details(type: CinemaType, id: string) {
    return requestData<CinemaDetails>(`/cinema/${type}/${encodeURIComponent(id)}`, (value): value is CinemaDetails => title(value)
      && value.id === id && value.type === type && object(value) && Array.isArray(value.episodes)
      && value.episodes.every(episode => object(episode) && typeof episode.id === 'string'
        && Number.isInteger(episode.season) && Number(episode.season) >= 0 && Number.isInteger(episode.episode) && Number(episode.episode) >= 1
        && episode.id === `${id}:${episode.season}:${episode.episode}` && typeof episode.title === 'string'
        && (episode.released === undefined || typeof episode.released === 'string')
        && (episode.thumbnail === undefined || typeof episode.thumbnail === 'string')));
  },
};

export function cinemaWatchPath(type: CinemaType, id: string, name: string, season?: number, episode?: number, returnQuery = ''): string {
  const playbackId = type === 'movie' ? `stremio:all:movie:${id}` : `stremio:all:${id}:${season}:${episode}`;
  const params = new URLSearchParams({ cinema: type, title: name });
  if (returnQuery) params.set('catalog', returnQuery);
  return `/watch/${encodeURIComponent(playbackId)}?${params}`;
}
