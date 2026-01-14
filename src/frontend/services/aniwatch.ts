import axios from 'axios';

// Em desenvolvimento, usamos o proxy do Vite (/api) para evitar erros de CORS.
// Em produção, usamos a URL completa ou a variável de ambiente.
const API_BASE_URL = import.meta.env.DEV ? '/api/v2/hianime' : 'http://localhost:4000/api/v2/hianime';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

type EpisodeCategory = 'sub' | 'dub' | 'raw';

const unwrapResponse = (response: any) => {
  if (response?.data?.data) return response.data.data;
  if (response?.data) return response.data;
  return response;
};

const aniwatchService = {
  // Homepage data
  getHomePage: async () => {
    try {
      console.log('🏠 Buscando dados da home...');
      const response = await api.get('/home');
      console.log('✅ Home data:', response.data);
      return unwrapResponse(response);
    } catch (error: any) {
      console.error('❌ Erro ao buscar home:', error);
      throw error;
    }
  },

  // Search anime
  searchAnime: async (query: string, page: number = 1) => {
    try {
      console.log(`🔍 Buscando: "${query}" (página ${page})`);
      const response = await api.get(`/search`, {
        params: { q: query, page },
      });
      console.log('✅ Resposta da busca:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro na busca:', error);
      throw error;
    }
  },

  // Search suggestions (autocomplete)
  searchSuggestions: async (query: string) => {
    try {
      console.log(`💡 Buscando sugestões para: "${query}"`);
      const response = await api.get(`/search/suggestion`, {
        params: { q: query },
      });
      console.log('✅ Sugestões:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao buscar sugestões:', error);
      // Retornar array vazio em caso de erro para não quebrar a UI
      return { data: { suggestions: [] } };
    }
  },

  // Get anime info
  getAnimeInfo: async (animeId: string) => {
    try {
      console.log(`📺 Buscando info do anime: ${animeId}`);
      const response = await api.get(`/anime/${animeId}`);
      console.log('✅ Info do anime:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao buscar info:', error);
      throw error;
    }
  },

  // Get anime episodes
  getAnimeEpisodes: async (animeId: string) => {
    try {
      console.log(`📺 Buscando episódios: ${animeId}`);
      const response = await api.get(`/anime/${animeId}/episodes`);
      console.log('✅ Episódios:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao buscar episódios:', error);
      throw error;
    }
  },

  // Get episode servers
  getEpisodeServers: async (episodeId: string) => {
    try {
      console.log(`📡 Buscando servidores para episódio: ${episodeId}`);
      const response = await api.get(`/episode/servers`, {
        params: { animeEpisodeId: episodeId },
      });
      console.log('✅ Servidores:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao buscar servidores:', error.response?.data || error);
      throw error;
    }
  },

  // Get episode sources
  getEpisodeSources: async (
    episodeId: string,
    server?: string,
    category: EpisodeCategory = 'sub'
  ) => {
    try {
      console.log(
        `🎬 Buscando fontes: episodeId=${episodeId}, server=${server}, category=${category}`
      );

      const params: any = {
        animeEpisodeId: episodeId,
        category: category,
      };

      if (server) {
        params.server = server;
      }

      const response = await api.get(`/episode/sources`, { params });
      console.log('✅ Fontes recebidas:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao buscar fontes:', error.response?.data || error);
      throw error;
    }
  },

  // Get anime by category
  getAnimeByCategory: async (category: string, page: number = 1) => {
    try {
      console.log(`📂 Buscando categoria: ${category} (página ${page})`);
      const response = await api.get(`/category/${category}`, {
        params: { page },
      });
      console.log('✅ Animes da categoria:', response.data);
      return unwrapResponse(response);
    } catch (error: any) {
      console.error('❌ Erro ao buscar categoria:', error);
      throw error;
    }
  },

  // Get anime by genre
  getAnimeByGenre: async (genre: string, page: number = 1) => {
    try {
      console.log(`🎭 Buscando gênero: ${genre} (página ${page})`);
      const response = await api.get(`/genre/${genre}`, {
        params: { page },
      });
      console.log('✅ Animes do gênero:', response.data);
      return unwrapResponse(response);
    } catch (error: any) {
      console.error('❌ Erro ao buscar gênero:', error);
      throw error;
    }
  },
};

export default aniwatchService;
