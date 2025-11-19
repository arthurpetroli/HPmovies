import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import aniwatchService from '../services/aniwatch';
import { AnimeCard } from '../components/anime/AnimeCard';
import type { Anime } from '../types/anime';

const categoryNames: Record<string, string> = {
  'most-popular': 'Mais Popular',
  'most-favorite': 'Mais Favoritos',
  'completed': 'Completos',
  'recently-updated': 'Atualizados Recentemente',
  'recently-added': 'Adicionados Recentemente',
  'top-upcoming': 'Próximos Lançamentos',
  'top-airing': 'Em Exibição',
  'movie': 'Filmes',
  'special': 'Especiais',
  'ova': 'OVAs',
  'ona': 'ONAs',
  'tv': 'TV',
  'top-10': 'Top 10'
};

export const AnimeCategoryPage: React.FC = () => {
  const { category } = useParams<{ category: string }>();
  const [animes, setAnimes] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (category) {
      loadCategoryAnimes(category, 1);
    }
  }, [category]);

  const loadCategoryAnimes = async (cat: string, page: number) => {
    try {
      setLoading(true);
      setError(null);

      console.log('📡 Buscando categoria:', cat, 'página:', page);
      const response = await aniwatchService.getAnimeByCategory(cat, page);
      
      console.log('📦 Resposta completa:', response);

      // Tenta diferentes estruturas de resposta
      let categoryData = null;
      
      if (response.data?.data) {
        // Estrutura: { success: true, data: { data: { animes: [...] } } }
        categoryData = response.data.data;
      } else if (response.data) {
        // Estrutura: { success: true, data: { animes: [...] } }
        categoryData = response.data;
      } else {
        categoryData = response;
      }

      console.log('✅ Dados processados:', categoryData);

      if (categoryData?.animes && Array.isArray(categoryData.animes)) {
        setAnimes(categoryData.animes);
        setCurrentPage(categoryData.currentPage || page);
        setTotalPages(categoryData.totalPages || 1);
        
        console.log(`📊 ${categoryData.animes.length} animes carregados`);
      } else {
        console.warn('⚠️ Nenhum anime encontrado na resposta');
        setAnimes([]);
      }
    } catch (err: any) {
      console.error('❌ Erro ao carregar categoria:', err);
      
      if (err.code === 'ERR_NETWORK') {
        setError('Erro de conexão. Verifique se o backend está rodando.');
      } else if (err.response?.status === 404) {
        setError(`Categoria "${cat}" não encontrada.`);
      } else {
        setError(err.message || 'Erro ao carregar animes. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (category) {
      loadCategoryAnimes(category, newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-pink-500 mx-auto mb-4"></div>
          <p className="text-white text-xl">Carregando {categoryNames[category || ''] || 'animes'}...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center px-4">
        <div className="text-center max-w-2xl">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-white mb-4">Erro ao Carregar</h2>
          <p className="text-gray-300 mb-6">{error}</p>
          
          <div className="flex gap-4 justify-center">
            <button
              onClick={() => category && loadCategoryAnimes(category, currentPage)}
              className="bg-pink-500 hover:bg-pink-600 text-white px-8 py-3 rounded-lg transition font-semibold"
            >
              🔄 Tentar Novamente
            </button>
            <button
              onClick={() => window.history.back()}
              className="bg-gray-700 hover:bg-gray-600 text-white px-8 py-3 rounded-lg transition font-semibold"
            >
              ← Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 pt-20 px-4 md:px-8 lg:px-16">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">
          {categoryNames[category || ''] || category}
        </h1>

        {animes.length === 0 ? (
          <div className="flex flex-col justify-center items-center py-20">
            <div className="text-gray-400 text-xl mb-2">📭 Nenhum anime encontrado</div>
            <button
              onClick={() => window.history.back()}
              className="mt-4 bg-pink-500 hover:bg-pink-600 text-white px-6 py-2 rounded-lg transition"
            >
              ← Voltar
            </button>
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
                  ← Anterior
                </button>

                <span className="text-white px-4">
                  Página {currentPage} de {totalPages}
                </span>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
                >
                  Próxima →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};