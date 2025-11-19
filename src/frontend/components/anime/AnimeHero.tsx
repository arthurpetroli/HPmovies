import React from 'react';
import { Play, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Anime } from '../../types/anime';

interface AnimeHeroProps {
  anime: Anime;
}

export const AnimeHero: React.FC<AnimeHeroProps> = ({ anime }) => {
  return (
    <div className="relative h-[70vh] w-full">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(${anime.poster})`,
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-gray-900 via-transparent to-transparent" />
      </div>

      {/* Content */}
      <div className="relative h-full flex items-center px-8 md:px-16">
        <div className="max-w-2xl">
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-4">
            {anime.name}
          </h1>
          
          {anime.jname && (
            <p className="text-xl text-gray-300 mb-4">{anime.jname}</p>
          )}

          <div className="flex gap-4 mb-6 text-sm text-gray-300">
            {anime.rating && (
              <span className="flex items-center gap-1">
                <span className="text-yellow-500">⭐</span>
                {anime.rating}
              </span>
            )}
            {anime.type && (
              <span className="uppercase font-semibold">{anime.type}</span>
            )}
            {anime.episodes && (
              <>
                {anime.episodes.sub > 0 && (
                  <span className="bg-blue-600 px-2 py-1 rounded">
                    SUB {anime.episodes.sub}
                  </span>
                )}
                {anime.episodes.dub > 0 && (
                  <span className="bg-green-600 px-2 py-1 rounded">
                    DUB {anime.episodes.dub}
                  </span>
                )}
              </>
            )}
          </div>

          <div className="flex gap-4">
            <Link
              to={`/anime/${anime.id}`}
              className="flex items-center gap-2 bg-white text-black px-8 py-3 rounded-md font-semibold hover:bg-gray-200 transition"
            >
              <Play size={20} fill="currentColor" />
              Assistir
            </Link>
            <Link
              to={`/anime/${anime.id}`}
              className="flex items-center gap-2 bg-gray-700/80 text-white px-8 py-3 rounded-md font-semibold hover:bg-gray-600/80 transition"
            >
              <Info size={20} />
              Mais Informações
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};