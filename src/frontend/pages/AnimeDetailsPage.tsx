import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import aniwatchService from '../services/aniwatch';
import type { AnimeDetails, Episode } from '../types/anime';
import { Play, Calendar, Star, ArrowLeft } from 'lucide-react';

export const AnimeDetailsPage: React.FC = () => {
  const { animeId } = useParams<{ animeId: string }>();
  const navigate = useNavigate();
  const [anime, setAnime] = useState<AnimeDetails | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (animeId) {
      console.log('🎬 Loading anime with ID:', animeId);
      loadAnimeData(animeId);
    }
  }, [animeId]);

  const loadAnimeData = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('📡 Fetching anime info for:', id);
      
      const [infoData, episodesData] = await Promise.all([
        aniwatchService.getAnimeInfo(id),
        aniwatchService.getAnimeEpisodes(id),
      ]);

      console.log('✅ Anime info received:', infoData);
      console.log('✅ Episodes received:', episodesData);

      if (!infoData?.data?.anime?.info) {
        throw new Error('Dados do anime não encontrados');
      }

      setAnime(infoData.data.anime.info);
      setEpisodes(episodesData.data?.episodes || []);
    } catch (error: any) {
      console.error('❌ Erro ao carregar anime:', error);
      setError(error?.response?.data?.message || 'Erro ao carregar anime. Verifique se o ID está correto.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-2xl">Carregando...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center px-4">
        <div className="text-red-500 text-2xl mb-4">⚠️ {error}</div>
        <div className="text-gray-400 mb-2">ID recebido: {animeId}</div>
        <button
          onClick={() => navigate('/')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg flex items-center gap-2"
        >
          <ArrowLeft size={20} />
          Voltar para Home
        </button>
      </div>
    );
  }

  if (!anime) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-2xl">Anime não encontrado</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Hero Background */}
      <div
        className="relative h-[50vh] bg-cover bg-center"
        style={{ backgroundImage: `url(${anime.poster})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent" />
      </div>

      {/* Content */}
      <div className="relative -mt-32 px-8 md:px-16">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Poster */}
          <img
            src={anime.poster}
            alt={anime.name}
            className="w-64 h-96 object-cover rounded-lg shadow-2xl"
          />

          {/* Info */}
          <div className="flex-1">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">{anime.name}</h1>

            <div className="flex flex-wrap gap-4 mb-6">
              {anime.stats?.rating && (
                <div className="flex items-center gap-2 bg-yellow-500 text-black px-3 py-1 rounded">
                  <Star size={16} fill="currentColor" />
                  {anime.stats.rating}
                </div>
              )}
              {anime.stats?.type && (
                <span className="bg-purple-600 px-3 py-1 rounded uppercase font-semibold">
                  {anime.stats.type}
                </span>
              )}
              {anime.stats?.episodes && (
                <>
                  {anime.stats.episodes.sub > 0 && (
                    <span className="bg-blue-600 px-3 py-1 rounded">
                      SUB {anime.stats.episodes.sub}
                    </span>
                  )}
                  {anime.stats.episodes.dub > 0 && (
                    <span className="bg-green-600 px-3 py-1 rounded">
                      DUB {anime.stats.episodes.dub}
                    </span>
                  )}
                </>
              )}
            </div>

            <p className="text-gray-300 mb-6 leading-relaxed">
              {anime.description}
            </p>

            {anime.moreInfo && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {anime.moreInfo.status && (
                  <div>
                    <span className="text-gray-400">Status:</span>{' '}
                    <span className="text-white font-semibold">{anime.moreInfo.status}</span>
                  </div>
                )}
                {anime.moreInfo.aired && (
                  <div>
                    <span className="text-gray-400">Lançamento:</span>{' '}
                    <span className="text-white font-semibold">{anime.moreInfo.aired}</span>
                  </div>
                )}
                {anime.moreInfo.studios && (
                  <div>
                    <span className="text-gray-400">Estúdio:</span>{' '}
                    <span className="text-white font-semibold">{anime.moreInfo.studios}</span>
                  </div>
                )}
                {anime.moreInfo.genres && anime.moreInfo.genres.length > 0 && (
                  <div className="col-span-full">
                    <span className="text-gray-400">Gêneros:</span>{' '}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {anime.moreInfo.genres.map((genre) => (
                        <span
                          key={genre}
                          className="bg-gray-700 px-3 py-1 rounded-full text-sm"
                        >
                          {genre}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Episodes Section */}
        <div className="mt-12">
          <h2 className="text-3xl font-bold mb-6">Episódios</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {episodes.map((episode) => (
              <Link
                key={episode.episodeId}
                to={`/watch/${episode.episodeId}`}
                className={`bg-gray-800 hover:bg-gray-700 p-4 rounded-lg transition ${
                  episode.isFiller ? 'border-2 border-yellow-500' : ''
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <Play size={16} />
                  <span className="font-semibold">EP {episode.number}</span>
                </div>
                {episode.title && (
                  <p className="text-xs text-gray-400 mt-2 text-center line-clamp-2">
                    {episode.title}
                  </p>
                )}
                {episode.isFiller && (
                  <span className="text-xs text-yellow-500 block text-center mt-1">
                    Filler
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};