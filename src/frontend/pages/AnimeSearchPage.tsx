import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import aniwatchService from '../services/aniwatch';
import { AnimeCard } from '../components/anime/AnimeCard';
import type { Anime } from '../types/anime';

export const AnimeSearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [animes, setAnimes] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);

  useEffect(() => {
    if (query) {
      searchAnimes(query, 1);
    }
  }, [query]);

  const searchAnimes = async (searchQuery: string, page: number) => {
    try {
      setLoading(true);
      const response = await aniwatchService.searchAnime(searchQuery, page);
      setAnimes(response.data?.animes || []);
      setHasNextPage(response.data?.hasNextPage || false);
      setCurrentPage(page);
    } catch (error) {
      console.error('Erro na busca:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    searchAnimes(query, newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center">
        <div className="text-white text-2xl">Buscando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 pt-20 px-4 md:px-8">
      <h1 className="text-3xl font-bold text-white mb-6">
        Resultados para: <span className="text-pink-500">{query}</span>
      </h1>

      {animes.length === 0 ? (
        <div className="text-center text-gray-400 mt-20">
          <p className="text-xl">Nenhum anime encontrado</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {animes.map((anime) => (
              <AnimeCard key={anime.id} anime={anime} />
            ))}
          </div>

          <div className="flex justify-center gap-4 mt-8 mb-8">
            {currentPage > 1 && (
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-2 rounded-lg transition"
              >
                Anterior
              </button>
            )}
            <span className="text-white flex items-center">
              Página {currentPage}
            </span>
            {hasNextPage && (
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                className="bg-pink-500 hover:bg-pink-600 text-white px-6 py-2 rounded-lg transition"
              >
                Próxima
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};