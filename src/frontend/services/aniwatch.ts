import axios from 'axios';
import { API_BASE_URL } from './http';

// Legacy compatibility only. Current pages use independent catalog/streaming providers.
const LEGACY_API_BASE_URL = import.meta.env.VITE_API_URL || `${API_BASE_URL}/v2/hianime`;
const api = axios.create({ baseURL: LEGACY_API_BASE_URL, timeout: 12_000 });

const aniwatchService = {
  getHomePage: async () => (await api.get('/home')).data.data,
  searchAnime: async (q: string, page = 1) => (await api.get('/search', { params: { q, page } })).data,
  searchSuggestions: async (q: string) => (await api.get('/search/suggestion', { params: { q } })).data,
  getAnimeInfo: async (id: string) => (await api.get(`/anime/${encodeURIComponent(id)}`)).data,
  getAnimeEpisodes: async (id: string) => (await api.get(`/anime/${encodeURIComponent(id)}/episodes`)).data,
  getEpisodeServers: async (animeEpisodeId: string) => (await api.get('/episode/servers', { params: { animeEpisodeId } })).data,
  getEpisodeSources: async (animeEpisodeId: string, server?: string, category: 'sub' | 'dub' | 'raw' = 'sub') =>
    (await api.get('/episode/sources', { params: { animeEpisodeId, server, category } })).data,
  getAnimeByCategory: async (category: string, page = 1) =>
    (await api.get(`/category/${encodeURIComponent(category)}`, { params: { page } })).data.data,
  getAnimeByGenre: async (genre: string, page = 1) =>
    (await api.get(`/genre/${encodeURIComponent(genre)}`, { params: { page } })).data.data,
};

export default aniwatchService;
