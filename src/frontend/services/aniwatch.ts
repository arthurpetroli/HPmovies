import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_ANIWATCH_API_URL || 'http://localhost:4000';

console.log('🔧 API Base URL:', API_BASE_URL);

const aniwatchApi = axios.create({
  baseURL: `${API_BASE_URL}/api/v2/hianime`,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  }
});

// Interceptor para log de requisições
aniwatchApi.interceptors.request.use(
  (config) => {
    console.log('📤 Requisição:', config.method?.toUpperCase(), config.url);
    return config;
  },
  (error) => {
    console.error('❌ Erro na requisição:', error);
    return Promise.reject(error);
  }
);

// Interceptor para log de respostas
aniwatchApi.interceptors.response.use(
  (response) => {
    console.log('📥 Resposta:', response.status, response.config.url);
    console.log('📦 Dados:', response.data);
    return response;
  },
  (error) => {
    console.error('❌ Erro na resposta:', error.response?.status, error.message);
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
    const response = await aniwatchApi.get('/home');
    return response.data;
  },

  // Buscar animes
  searchAnime: async (query: string, page: number = 1) => {
    const response = await aniwatchApi.get('/search', {
      params: { q: query, page }
    });
    return response.data;
  },

  // Sugestões de busca
  searchSuggestions: async (query: string) => {
    const response = await aniwatchApi.get('/search/suggestion', {
      params: { q: query }
    });
    return response.data;
  },

  // Detalhes do anime
  getAnimeInfo: async (animeId: string) => {
    const response = await aniwatchApi.get('/anime/info', {
      params: { id: animeId }
    });
    return response.data;
  },

  // Episódios do anime
  getAnimeEpisodes: async (animeId: string) => {
    const response = await aniwatchApi.get('/anime/episodes', {
      params: { id: animeId }
    });
    return response.data;
  },

  // Servidores de um episódio
  getEpisodeServers: async (episodeId: string) => {
    const response = await aniwatchApi.get('/episode/servers', {
      params: { episodeId }
    });
    return response.data;
  },

  // Links de streaming
  getEpisodeSources: async (episodeId: string, server: string = 'hd-1', category: string = 'sub') => {
    const response = await aniwatchApi.get('/episode/sources', {
      params: { episodeId, server, category }
    });
    return response.data;
  },

  // Animes por gênero
  getAnimeByGenre: async (genreName: string, page: number = 1) => {
    const response = await aniwatchApi.get('/genre', {
      params: { name: genreName, page }
    });
    return response.data;
  },

  // Animes por categoria
  getAnimeByCategory: async (category: string, page: number = 1) => {
    const response = await aniwatchApi.get('/category', {
      params: { category, page }
    });
    return response.data;
  },

  // Animes por produtor
  getAnimeByProducer: async (producerName: string, page: number = 1) => {
    const response = await aniwatchApi.get('/producer', {
      params: { name: producerName, page }
    });
    return response.data;
  },

  // Cronograma de episódios
  getEstimatedSchedule: async (date: string) => {
    const response = await aniwatchApi.get('/schedule/estimated-schedule', {
      params: { date }
    });
    return response.data;
  },
};

export default aniwatchService;