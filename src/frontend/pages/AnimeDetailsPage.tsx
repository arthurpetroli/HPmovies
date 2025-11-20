import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import aniwatchService from '../services/aniwatch';

export const AnimeDetailsPage: React.FC = () => {
  const { animeId } = useParams<{ animeId: string }>();
  const navigate = useNavigate();

  const [animeInfo, setAnimeInfo] = useState<any>(null);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAnimeData = async () => {
      if (!animeId) {
        setError('ID do anime não fornecido');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        console.log('📺 Carregando dados do anime:', animeId);

        // Buscar informações do anime
        const infoResponse = await aniwatchService.getAnimeInfo(animeId);
        console.log('✅ Info do anime:', infoResponse);
        
        // A resposta vem com { success: true, data: { anime: {...} } }
        const info = infoResponse?.data?.anime || infoResponse?.anime || infoResponse;
        setAnimeInfo(info);

        // Buscar episódios
        const epsResponse = await aniwatchService.getAnimeEpisodes(animeId);
        console.log('✅ Episódios:', epsResponse);
        
        // A resposta vem com { success: true, data: { episodes: [...] } }
        const eps = epsResponse?.data?.episodes || epsResponse?.episodes || [];
        setEpisodes(eps);

      } catch (err: any) {
        console.error('❌ Erro ao carregar anime:', err);
        setError(err.response?.data?.message || 'Erro ao carregar anime');
      } finally {
        setLoading(false);
      }
    };

    loadAnimeData();
  }, [animeId]);

  const handleWatchEpisode = (episode: any) => {
    // O episodeId já vem no formato correto: "steinsgate-3?ep=213"
    console.log('🎬 Clicando no episódio:', episode);
    console.log('🎯 Episode ID:', episode.episodeId);
    navigate(`/watch/${episode.episodeId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent" />
          <p className="text-white">Carregando anime...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-xl">❌ {error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-pink-500 hover:bg-pink-600 text-white px-6 py-3 rounded-lg transition"
          >
            Voltar para Home
          </button>
        </div>
      </div>
    );
  }

  if (!animeInfo) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center">
        <p className="text-white">Anime não encontrado</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 pt-20">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-8">
        {/* Botão voltar */}
        <button
          onClick={() => navigate(-1)}
          className="text-pink-500 hover:text-pink-400 transition flex items-center gap-2"
        >
          <span>←</span> Voltar
        </button>

        {/* Info do anime */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1">
            <img
              src={animeInfo.info?.poster || animeInfo.poster}
              alt={animeInfo.info?.name || animeInfo.name}
              className="w-full rounded-lg shadow-lg"
              onError={(e) => {
                e.currentTarget.src = 'https://via.placeholder.com/300x450?text=No+Image';
              }}
            />
          </div>

          <div className="md:col-span-2 space-y-4">
            <h1 className="text-3xl md:text-4xl font-bold text-white">
              {animeInfo.info?.name || animeInfo.name || 'Sem título'}
            </h1>

            {animeInfo.info?.description && (
              <p className="text-gray-300 leading-relaxed">
                {animeInfo.info.description}
              </p>
            )}

            {/* Stats */}
            <div className="flex flex-wrap gap-2">
              {animeInfo.info?.stats?.episodes?.sub && (
                <span className="bg-pink-500/20 text-pink-400 px-3 py-1 rounded-full text-sm">
                  {animeInfo.info.stats.episodes.sub} eps (leg)
                </span>
              )}
              {animeInfo.info?.stats?.episodes?.dub > 0 && (
                <span className="bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full text-sm">
                  {animeInfo.info.stats.episodes.dub} eps (dub)
                </span>
              )}
              {animeInfo.info?.stats?.type && (
                <span className="bg-purple-500/20 text-purple-400 px-3 py-1 rounded-full text-sm">
                  {animeInfo.info.stats.type}
                </span>
              )}
              {animeInfo.info?.stats?.rating && (
                <span className="bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full text-sm">
                  ⭐ {animeInfo.info.stats.rating}
                </span>
              )}
            </div>

            {/* Gêneros */}
            {animeInfo.moreInfo?.genres && animeInfo.moreInfo.genres.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-white font-semibold">Gêneros</h3>
                <div className="flex flex-wrap gap-2">
                  {animeInfo.moreInfo.genres.map((genre: string, idx: number) => (
                    <span
                      key={idx}
                      className="bg-gray-700 text-gray-200 px-3 py-1 rounded-full text-sm"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Lista de episódios */}
        {episodes.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-white">
              Episódios ({episodes.length})
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
              {episodes.map((episode: any) => (
                <button
                  key={episode.episodeId}
                  onClick={() => handleWatchEpisode(episode)}
                  className="bg-gray-800 hover:bg-pink-500 text-white px-4 py-3 rounded-lg transition-all hover:scale-105 font-medium group"
                  title={episode.title || `Episódio ${episode.number}`}
                >
                  <div className="text-center">
                    <p className="text-lg font-bold">EP {episode.number}</p>
                    {episode.title && (
                      <p className="text-xs text-gray-400 group-hover:text-white truncate mt-1">
                        {episode.title}
                      </p>
                    )}
                    {episode.isFiller && (
                      <span className="block text-xs text-yellow-400 mt-1">
                        Filler
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {episodes.length === 0 && (
          <div className="bg-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-400">Nenhum episódio disponível</p>
          </div>
        )}
      </div>
    </div>
  );
};