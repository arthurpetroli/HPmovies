import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import aniwatchService from '../services/aniwatch';
import { AnimeCard } from '../components/anime/AnimeCard';
import type { Anime } from '../types/anime';

const categoryNames: Record<string, string> = {
  'most-popular': 'Mais Popular',
  'most-favorite': 'Favoritos',
  'completed': 'Completos',
  'recently-updated': 'Atualizados Recentemente',
  'recently-added': 'Adicionados Recentemente',
  'top-upcoming': 'Próximos Lançamentos',
  'top-airing': 'No Ar',
  'subbed-anime': 'Legendados',
  'dubbed-anime': 'Dublados',
};

export const AnimeCategoryPage: React.FC = () => {
  const { category } = useParams<{ category: string }>();
  const [animes, setAnimes] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);

  useEffect(() => {
    if (category) {
      loadAnimes(category, 1);
    }
  }, [category]);

  const loadAnimes = async (cat: string, page: number) => {
    try {
      setLoading(true);
      const response = await aniwatchService.getAnimeByCategory(cat, page);
      setAnimes(response.data?.animes || []);
      setHasNextPage(response.data?.hasNextPage || false);
      setCurrentPage(page);
    } catch (error) {
      console.error('Erro ao carregar categoria:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (category) {
      loadAnimes(category, newPage);
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

  return (
    <div className="min-h-screen bg-gray-900 pt-20 px-4 md:px-8">
      <h1 className="text-4xl font-bold text-white mb-8">
        {categoryNames[category || ''] || category}
      </h1>

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
        <span className="text-white flex items-center">Página {currentPage}</span>
        {hasNextPage && (
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            className="bg-pink-500 hover:bg-pink-600 text-white px-6 py-2 rounded-lg transition"
          >
            Próxima
          </button>
        )}
      </div>
    </div>
  );
};