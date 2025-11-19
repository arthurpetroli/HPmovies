import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import aniwatchService from '../services/aniwatch';
import { AnimeCard } from '../components/anime/AnimeCard';
import type { Anime, ANIME_GENRES } from '../types/anime';
import { ANIME_GENRES as genres } from '../types/anime';

export const AnimeGenrePage: React.FC = () => {
  const { genreName } = useParams<{ genreName: string }>();
  const [animes, setAnimes] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState(genreName || 'Action');

  useEffect(() => {
    loadAnimes(selectedGenre, 1);
  }, [selectedGenre]);

  const loadAnimes = async (genre: string, page: number) => {
    try {
      setLoading(true);
      const response = await aniwatchService.getAnimeByGenre(genre, page);
      setAnimes(response.data?.animes || []);
      setHasNextPage(response.data?.hasNextPage || false);
      setCurrentPage(page);
    } catch (error) {
      console.error('Erro ao carregar gênero:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    loadAnimes(selectedGenre, newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-gray-900 pt-20 px-4 md:px-8">
      <h1 className="text-4xl font-bold text-white mb-6">Gêneros</h1>

      {/* Genre Chips */}
      <div className="flex flex-wrap gap-2 mb-8">
        {genres.map((genre) => (
          <button
            key={genre}
            onClick={() => setSelectedGenre(genre)}
            className={`px-4 py-2 rounded-full transition ${
              selectedGenre === genre
                ? 'bg-pink-500 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {genre}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-white mt-20">Carregando...</div>
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
        </>
      )}
    </div>
  );
};