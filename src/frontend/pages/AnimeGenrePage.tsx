import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AnimeCard } from '../components/anime/AnimeCard';
import aniwatchService from '../services/aniwatch';
import type { Anime } from '../types/anime';

export const AnimeGenrePage: React.FC = () => {
  const { genre } = useParams<{ genre: string }>();
  const [animes, setAnimes] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (genre) {
      loadGenreAnimes(genre, 1);
    }
  }, [genre]);

  const loadGenreAnimes = async (genreName: string, page: number) => {
    try {
      setLoading(true);
      setError(null);

      const response = await aniwatchService.getAnimeByGenre(genreName, page);

      if (response.data?.animes) {
        setAnimes(response.data.animes);
        setCurrentPage(response.data.currentPage || 1);
        setTotalPages(response.data.totalPages || 1);
      } else {
        setAnimes([]);
      }
    } catch (err: any) {
      console.error('Error loading genre:', err);
      setError('Erro ao carregar animes. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (genre) {
      loadGenreAnimes(genre, newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center">
        <div className="text-white text-2xl">Carregando...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center">
        <div className="text-red-500 text-2xl">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 pt-20 px-4 md:px-8 lg:px-16">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8 capitalize">
          {genre?.replace(/-/g, ' ')}
        </h1>

        {animes.length === 0 ? (
          <div className="flex justify-center items-center py-20">
            <div className="text-gray-400 text-xl">Nenhum anime encontrado</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mb-8">
              {animes.map((anime) => (
                <AnimeCard key={anime.id} anime={anime} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 py-8">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
                >
                  Anterior
                </button>

                <span className="text-white px-4">
                  Página {currentPage} de {totalPages}
                </span>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
                >
                  Próxima
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};