import axios from 'axios';

// Em desenvolvimento, usamos o proxy do Vite (/api) para evitar erros de CORS.
// Em produção, usamos a URL completa ou a variável de ambiente.
const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '/api/v2/hianime' : 'https://comparable-robyn-petroli-58d47e57.koyeb.app/api/v2/hianime');

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

const upgradeImg = (url: string | undefined, type: 'landscape' | 'portrait' = 'portrait') => {
  if (!url) return url;
  const targetRes = type === 'landscape' ? '1920x1080' : '800x1200';
  return url.replace(/(\d+x\d+)/, targetRes);
};

const aniwatchService = {
  // Homepage data
  getHomePage: async () => {
    try {
      console.log('🏠 Buscando dados da home...');
      const response = await api.get('/home');
      console.log('✅ Home data:', response.data);
      const data = unwrapResponse(response);

      if (data.spotlightAnimes) {
        data.spotlightAnimes = data.spotlightAnimes.map((anime: any) => ({
          ...anime,
          poster: upgradeImg(anime.poster, 'landscape'),
        }));
      }

      return data;
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

      const data = response.data;
      if (data?.anime?.info?.poster) {
        data.anime.info.poster = upgradeImg(data.anime.info.poster, 'portrait');
      }
      return data;
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

  // Helper para gerar a URL do proxy corretamente usando a base configurada
  getProxyUrl: (url: string, referer?: string) => {
    const params = new URLSearchParams();
    params.append('url', url);
    if (referer) params.append('referer', referer);
    return `${API_BASE_URL}/proxy-stream?${params.toString()}`;
  },
};

export default aniwatchService;
