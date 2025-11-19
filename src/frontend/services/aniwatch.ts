import axios, { AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_ANIWATCH_API_URL || 'http://localhost:4000';

console.log('🔧 API Base URL:', API_BASE_URL);

const aniwatchApi = axios.create({
  baseURL: `${API_BASE_URL}/api/v2/hianime`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: false, // Mudar para false para evitar problemas de CORS
});

// Interceptor para log de requisições
aniwatchApi.interceptors.request.use(
  (config) => {
    console.log('📤 Request:', {
      method: config.method?.toUpperCase(),
      url: config.url,
      baseURL: config.baseURL,
      fullURL: `${config.baseURL}${config.url}`,
      params: config.params,
    });
    return config;
  },
  (error) => {
    console.error('❌ Request Error:', error);
    return Promise.reject(error);
  }
);

// Interceptor para log de respostas
aniwatchApi.interceptors.response.use(
  (response) => {
    console.log('✅ Response:', {
      status: response.status,
      url: response.config.url,
      dataKeys: Object.keys(response.data || {}),
      data: response.data,
    });
    return response;
  },
  (error: AxiosError) => {
    console.error('❌ Response Error:', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url,
    });
    return Promise.reject(error);
  }
);

export interface AnimeSearchResult {
  id: string;
  name: string;
  jname: string;
  poster: string;
  duration: string;
  type: string;
  rating: string | null;
  episodes: {
    sub: number;
    dub: number;
  };
}

export interface AnimeInfo {
  anime: {
    info: {
      id: string;
      name: string;
      poster: string;
      description: string;
      stats: {
        rating: string;
        quality: string;
        episodes: {
          sub: number;
          dub: number;
        };
        type: string;
        duration: string;
      };
    };
    moreInfo: {
      aired: string;
      genres: string[];
      status: string;
      studios: string;
      producers: string[];
    };
  };
}

export interface Episode {
  title: string;
  episodeId: string;
  number: number;
  isFiller: boolean;
}

export interface EpisodeServer {
  serverName: string;
  serverId: number;
}

export interface StreamingLink {
  url: string;
  quality: string;
  isM3U8: boolean;
}

export const aniwatchService = {
  // Home page com animes em destaque
  getHomePage: async () => {
    try {
      const response = await aniwatchApi.get('/home');
      return response.data;
    } catch (error) {
      console.error('Error in getHomePage:', error);
      throw error;
    }
  },

  // Buscar animes
  searchAnime: async (query: string, page: number = 1) => {
    try {
      const response = await aniwatchApi.get('/search', {
        params: { q: query, page }
      });
      return response.data;
    } catch (error) {
      console.error('Error in searchAnime:', error);
      throw error;
    }
  },

  // Sugestões de busca
  searchSuggestions: async (query: string) => {
    try {
      const response = await aniwatchApi.get('/search/suggestion', {
        params: { q: query }
      });
      return response.data;
    } catch (error) {
      console.error('Error in searchSuggestions:', error);
      throw error;
    }
  },

  // Detalhes do anime
  getAnimeInfo: async (animeId: string) => {
    try {
      console.log('🎯 Getting anime info for ID:', animeId);
      // CORREÇÃO: Remover /info da URL
      const response = await aniwatchApi.get(`/anime/${animeId}`);
      console.log('✅ Anime info response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Error getting anime info:', error);
      throw error;
    }
  },

  // Episódios do anime
  getAnimeEpisodes: async (animeId: string) => {
    try {
      console.log('🎯 Getting episodes for ID:', animeId);
      const response = await aniwatchApi.get(`/anime/${animeId}/episodes`);
      console.log('✅ Episodes response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Error getting episodes:', error);
      throw error;
    }
  },

  // Servidores de um episódio
  getEpisodeServers: async (episodeId: string) => {
    try {
      const response = await aniwatchApi.get('/episode/servers', {
        params: { episodeId }
      });
      return response.data;
    } catch (error) {
      console.error('Error in getEpisodeServers:', error);
      throw error;
    }
  },

  // Links de streaming
  getEpisodeSources: async (episodeId: string, server: string = 'hd-1', category: string = 'sub') => {
    try {
      const response = await aniwatchApi.get('/episode/sources', {
        params: { episodeId, server, category }
      });
      return response.data;
    } catch (error) {
      console.error('Error in getEpisodeSources:', error);
      throw error;
    }
  },

  // Animes por gênero
  getAnimeByGenre: async (genreName: string, page: number = 1) => {
    try {
      const response = await aniwatchApi.get('/genre', {
        params: { name: genreName, page }
      });
      return response.data;
    } catch (error) {
      console.error('Error in getAnimeByGenre:', error);
      throw error;
    }
  },

  // Animes por categoria
  getAnimeByCategory: async (category: string, page: number = 1) => {
    try {
      const response = await aniwatchApi.get('/category', {
        params: { category, page }
      });
      return response.data;
    } catch (error) {
      console.error('Error in getAnimeByCategory:', error);
      throw error;
    }
  },

  // Animes por produtor
  getAnimeByProducer: async (producerName: string, page: number = 1) => {
    try {
      const response = await aniwatchApi.get('/producer', {
        params: { name: producerName, page }
      });
      return response.data;
    } catch (error) {
      console.error('Error in getAnimeByProducer:', error);
      throw error;
    }
  },

  // Cronograma de episódios
  getEstimatedSchedule: async (date: string) => {
    try {
      const response = await aniwatchApi.get('/schedule/estimated-schedule', {
        params: { date }
      });
      return response.data;
    } catch (error) {
      console.error('Error in getEstimatedSchedule:', error);
      throw error;
    }
  },
};

export default aniwatchService;