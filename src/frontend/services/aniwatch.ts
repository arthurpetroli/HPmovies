import axios from 'axios';

const API_BASE_URL = 'http://localhost:4000/api/v2/hianime';

// Criar instância do axios
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const aniwatchService = {
  // Homepage data
  getHomePage: async () => {
    try {
      console.log('🏠 Buscando dados da home...');
      const response = await api.get('/home');
      console.log('✅ Home data:', response.data);
      return response.data;
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
        params: { q: query, page }
      });
      console.log('✅ Resultados da busca:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro na busca:', error);
      throw error;
    }
  },

  // Get anime info
  getAnimeInfo: async (animeId: string) => {
    try {
      console.log(`📖 Buscando info do anime: ${animeId}`);
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

  // Get episode sources
  getEpisodeSources: async (episodeId: string) => {
    try {
      console.log(`🎬 Buscando fontes do episódio: ${episodeId}`);
      const response = await api.get(`/episode/sources`, {
        params: { animeEpisodeId: episodeId }
      });
      console.log('✅ Fontes do episódio:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao buscar fontes:', error);
      throw error;
    }
  },

  // Get anime by category
  getAnimeByCategory: async (category: string, page: number = 1) => {
    try {
      console.log(`📂 Buscando categoria: ${category} (página ${page})`);
      const response = await api.get(`/category/${category}`, {
        params: { page }
      });
      console.log(`✅ Categoria ${category}:`, response.data);
      return response.data;
    } catch (error: any) {
      console.error(`❌ Erro ao buscar categoria ${category}:`, error);
      throw error;
    }
  },

  // Get anime by genre
  getAnimeByGenre: async (genre: string, page: number = 1) => {
    try {
      console.log(`🎭 Buscando gênero: ${genre} (página ${page})`);
      const response = await api.get(`/genre/${genre}`, {
        params: { page }
      });
      console.log(`✅ Gênero ${genre}:`, response.data);
      return response.data;
    } catch (error: any) {
      console.error(`❌ Erro ao buscar gênero ${genre}:`, error);
      throw error;
    }
  },

  // Get episode servers
  getEpisodeServers: async (episodeId: string) => {
    try {
      console.log(`🖥️ Buscando servidores: ${episodeId}`);
      const response = await api.get(`/episode/servers`, {
        params: { animeEpisodeId: episodeId }
      });
      console.log('✅ Servidores:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao buscar servidores:', error);
      throw error;
    }
  },
};

export default aniwatchService;