import React, { useEffect, useState } from 'react';
import aniwatchService from '../services/aniwatch';
import { AnimeHero } from '../components/anime/AnimeHero';
import { AnimeRowCarousel } from '../components/anime/AnimeRowCarousel';
import type { Anime } from '../types/anime';

export const AnimeHomePage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [spotlightAnimes, setSpotlightAnimes] = useState<Anime[]>([]);
  const [trendingAnimes, setTrendingAnimes] = useState<Anime[]>([]);
  const [latestEpisodes, setLatestEpisodes] = useState<Anime[]>([]);
  const [topUpcoming, setTopUpcoming] = useState<Anime[]>([]);
  const [topAiring, setTopAiring] = useState<Anime[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHomeData();
  }, []);

  const loadHomeData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('🔄 Carregando dados da home...');
      const response = await aniwatchService.getHomePage();
      console.log('📦 Resposta completa:', response);
      
      // Tenta diferentes estruturas de resposta
      let homeData = null;
      
      if (response.data?.data) {
        // Estrutura: { success: true, data: { data: { ... } } }
        homeData = response.data.data;
      } else if (response.data) {
        // Estrutura: { success: true, data: { ... } }
        homeData = response.data;
      } else if (response.success && response.data) {
        // Estrutura: { success: true, data: { ... } }
        homeData = response.data;
      } else {
        homeData = response;
      }
      
      console.log('✅ Dados processados:', homeData);
      
      if (homeData) {
        setSpotlightAnimes(homeData.spotlightAnimes || []);
        setTrendingAnimes(homeData.trendingAnimes || []);
        setLatestEpisodes(homeData.latestEpisodeAnimes || []);
        setTopUpcoming(homeData.topUpcomingAnimes || []);
        setTopAiring(homeData.topAiringAnimes || []);
        
        console.log('📊 Animes carregados:');
        console.log('  - Spotlight:', homeData.spotlightAnimes?.length || 0);
        console.log('  - Trending:', homeData.trendingAnimes?.length || 0);
        console.log('  - Latest:', homeData.latestEpisodeAnimes?.length || 0);
        console.log('  - Upcoming:', homeData.topUpcomingAnimes?.length || 0);
        console.log('  - Airing:', homeData.topAiringAnimes?.length || 0);
      } else {
        console.error('❌ Resposta sem dados válidos');
        setError('Resposta da API sem dados válidos');
      }
    } catch (error: any) {
      console.error('💥 Erro completo:', error);
      
      if (error.code === 'ERR_NETWORK') {
        setError('❌ Erro de rede: Não foi possível conectar ao servidor.\n\nVerifique se o backend está rodando:\ncd src/aniwatch-api && npm start');
      } else if (error.response?.status === 404) {
        setError('❌ Endpoint não encontrado (404)');
      } else if (error.message?.includes('CORS')) {
        setError('❌ Erro de CORS: O servidor bloqueou a requisição');
      } else {
        setError(`❌ Erro: ${error.message || 'Erro desconhecido'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center pt-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-pink-500 mx-auto mb-4"></div>
          <p className="text-white text-xl">Carregando animes...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center pt-20 px-4">
        <div className="text-center max-w-2xl">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-white mb-4">Erro ao Carregar</h2>
          <pre className="text-gray-300 mb-6 text-left bg-gray-800 p-4 rounded-lg overflow-auto">
            {error}
          </pre>
          
          <div className="bg-gray-800 rounded-lg p-4 mb-6 text-left">
            <p className="text-gray-400 text-sm mb-2">🔧 Como resolver:</p>
            <ol className="text-gray-300 text-sm space-y-2 list-decimal list-inside">
              <li>Certifique-se que o backend está rodando na porta 4000</li>
              <li>Verifique o terminal do backend para ver se há erros</li>
              <li>Teste diretamente: <a href="http://localhost:4000/health" target="_blank" className="text-blue-400 hover:underline">http://localhost:4000/health</a></li>
              <li>Teste a API: <a href="http://localhost:4000/api/v2/hianime/home" target="_blank" className="text-blue-400 hover:underline">http://localhost:4000/api/v2/hianime/home</a></li>
            </ol>
          </div>
          
          <button
            onClick={loadHomeData}
            className="bg-pink-500 hover:bg-pink-600 text-white px-8 py-3 rounded-lg transition font-semibold"
          >
            🔄 Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  const hasAnimes = spotlightAnimes.length > 0 || 
                    trendingAnimes.length > 0 || 
                    latestEpisodes.length > 0 || 
                    topAiring.length > 0 || 
                    topUpcoming.length > 0;

  if (!hasAnimes) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center pt-20 px-4">
        <div className="text-center">
          <p className="text-gray-400 text-xl mb-4">📭 Nenhum anime disponível no momento</p>
          <button
            onClick={loadHomeData}
            className="bg-pink-500 hover:bg-pink-600 text-white px-6 py-2 rounded-lg transition"
          >
            🔄 Recarregar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 pt-16">
      {/* Hero Section */}
      {spotlightAnimes.length > 0 && (
        <AnimeHero anime={spotlightAnimes[0]} />
      )}

      {/* Content Sections */}
      <div className="px-4 md:px-8 py-8 space-y-12">
        {trendingAnimes.length > 0 && (
          <AnimeRowCarousel
            title="🔥 Em Alta"
            animes={trendingAnimes}
            viewAllLink="/category/most-popular"
          />
        )}

        {latestEpisodes.length > 0 && (
          <AnimeRowCarousel
            title="📺 Últimos Episódios"
            animes={latestEpisodes}
            viewAllLink="/category/recently-updated"
          />
        )}

        {topAiring.length > 0 && (
          <AnimeRowCarousel
            title="⚡ No Ar"
            animes={topAiring}
            viewAllLink="/category/top-airing"
          />
        )}

        {topUpcoming.length > 0 && (
          <AnimeRowCarousel
            title="🎬 Próximos Lançamentos"
            animes={topUpcoming}
            viewAllLink="/category/top-upcoming"
          />
        )}
      </div>
    </div>
  );
};