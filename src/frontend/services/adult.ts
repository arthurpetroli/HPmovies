import { ADULT_CONSENT_HEADER, ADULT_CONSENT_VALUE } from '../../shared/adult';
import type { AdultCatalogHome, AdultCatalogQuery, AdultSources, AdultStatus } from '../../shared/adult';
import type { CatalogAnime, CatalogPage, Playback, StreamingAvailability } from '../../shared/providers';
import { isCatalogAnime } from './catalog';
import { requestData } from './http';
import { isPlayback, playbackMedia } from './streaming';
import { readAdultMode } from './adultMode';

const isList = (value: unknown): value is CatalogAnime[] => Array.isArray(value) && value.every(isCatalogAnime);
const isHome = (value: unknown): value is AdultCatalogHome => !!value && typeof value === 'object'
  && ['trending', 'popular', 'recent', 'topRated'].every(key => isList((value as Record<string, unknown>)[key]));
const isPage = (value: unknown): value is CatalogPage => {
  const page = value as CatalogPage | null;
  return !!page && isList(page.items) && typeof page.page === 'number' && typeof page.hasNextPage === 'boolean';
};
const isAvailability = (value: unknown): value is StreamingAvailability => {
  const availability = value as StreamingAvailability | null;
  return !!availability && typeof availability.available === 'boolean' && Array.isArray(availability.episodes)
    && availability.episodes.every(episode => !!episode && typeof episode.id === 'string' && typeof episode.title === 'string');
};

/** Adult requests leave the browser only after the person enabled the mode here. */
function adultRequest<T>(path: string, validate: (data: unknown) => data is T, timeoutMs?: number): Promise<T> {
  if (!readAdultMode().enabled) return Promise.reject(new Error('Ative o conteúdo adulto em Configurações › Sua experiência.'));
  return requestData(`/adult${path}`, validate, { timeoutMs, headers: { [ADULT_CONSENT_HEADER]: ADULT_CONSENT_VALUE } });
}

export const adultService = {
  status: () => requestData('/adult/status', (value): value is AdultStatus => !!value && typeof (value as AdultStatus).enabled === 'boolean'),
  home: () => adultRequest('/catalog/home', isHome),
  search: (query: AdultCatalogQuery) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
    return adultRequest(`/catalog/search?${params}`, isPage);
  },
  tags: () => adultRequest('/catalog/tags', (value): value is string[] => Array.isArray(value) && value.every(tag => typeof tag === 'string')),
  details: (id: string) => adultRequest(`/catalog/anime/${encodeURIComponent(id)}`, isCatalogAnime),
  episodes: (id: string) => adultRequest(`/anime/${encodeURIComponent(id)}/episodes`, isAvailability, 65_000),
  playback: (id: string, episode: number, refresh = false): Promise<Playback> =>
    adultRequest(`/anime/${encodeURIComponent(id)}/episodes/${episode}${refresh ? '?refresh=1' : ''}`, isPlayback, 65_000).then(playbackMedia),
  sources: () => adultRequest('/sources', (value): value is AdultSources => !!value && Array.isArray((value as AdultSources).diagnostics)),
};
