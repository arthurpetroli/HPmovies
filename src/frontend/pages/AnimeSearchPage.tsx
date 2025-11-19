import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { AnimeCard } from '../components/anime/AnimeCard';
import aniwatchService from '../services/aniwatch';
import type { Anime } from '../types/anime';

export const AnimeSearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [animes, setAnimes] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const query = searchParams.get('q');
    if (query) {
      setSearchQuery(query);
      performSearch(query, 1);
    }
  }, [searchParams]);

  const performSearch = async (query: string, page: number) => {
    if (!query.trim()) return;

    try {
      setLoading(true);
      setError(null);

      const response = await aniwatchService.searchAnime(query, page);

      if (response.data?.animes) {
        setAnimes(response.data.animes);
        setCurrentPage(response.data.currentPage || 1);
        setTotalPages(response.data.totalPages || 1);
      } else {
        setAnimes([]);
      }
    } catch (err: any) {
      console.error('Erro ao buscar animes:', err);
      setError('Erro ao buscar animes. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const handlePageChange = (newPage: number) => {
    performSearch(searchQuery, newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-gray-900 pt-20 px-4 md:px-8 lg:px-16">
      {/* Search Header */}
      <div className="max-w-7xl mx-auto mb-8">
        <h1 className="text-3xl font-bold text-white mb-6">Pesquisar Anime</h1>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Digite o nome do anime..."
            className="w-full bg-gray-800 text-white rounded-lg pl-12 pr-4 py-4 focus:outline-none focus:ring-2 focus:ring-pink-500"
          />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-pink-500 hover:bg-pink-600 text-white px-6 py-2 rounded-lg transition-colors"
          >
            Buscar
          </button>
        </form>
      </div>

      {/* Results */}
      <div className="max-w-7xl mx-auto">
        {loading && (
          <div className="flex justify-center items-center py-20">
            <div className="text-white text-xl">Carregando...</div>
          </div>
        )}

        {error && (
          <div className="flex justify-center items-center py-20">
            <div className="text-red-500 text-xl">{error}</div>
          </div>
        )}

        {!loading && !error && animes.length === 0 && searchQuery && (
          <div className="flex flex-col justify-center items-center py-20">
            <div className="text-gray-400 text-xl mb-2">Nenhum resultado encontrado</div>
            <div className="text-gray-500">Tente buscar com outros termos</div>
          </div>
        )}

        {!loading && !error && animes.length > 0 && (
          <>
            <div className="mb-4 text-gray-400">
              Encontrados {animes.length} resultados para "{searchQuery}"
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mb-8">
              {animes.map((anime) => (
                <AnimeCard key={anime.id} anime={anime} />
              ))}
            </div>

            {/* Pagination */}
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