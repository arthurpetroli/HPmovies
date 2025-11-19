import React from 'react';
import { Link } from 'react-router-dom';
import type { Anime } from '../../types/anime';
import { normalizeAnimeId } from '../../utils';

interface AnimeCardProps {
  anime: Anime;
}

export const AnimeCard: React.FC<AnimeCardProps> = ({ anime }) => {
  // Debug: verificar o formato do ID
  console.log('AnimeCard - Raw ID:', anime.id, 'Name:', anime.name);
  
  try {
    const normalizedId = normalizeAnimeId(anime.id);
    console.log('AnimeCard - Normalized ID:', normalizedId);
    
    return (
      <Link to={`/anime/${normalizedId}`} className="group">
        <div className="relative overflow-hidden rounded-lg bg-gray-800 transition-transform hover:scale-105">
          <img
            src={anime.poster}
            alt={anime.name}
            className="w-full aspect-[2/3] object-cover"
            loading="lazy"
          />
          
          {/* Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <h3 className="text-white font-semibold text-sm line-clamp-2 mb-2">
                {anime.name}
              </h3>
              {anime.episodes && (
                <div className="flex gap-2 text-xs text-gray-300">
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
                </div>
              )}
            </div>
          </div>

          {/* Rating Badge */}
          {anime.rating && (
            <div className="absolute top-2 left-2 bg-yellow-500 text-black px-2 py-1 rounded text-xs font-bold">
              ⭐ {anime.rating}
            </div>
          )}

          {/* Type Badge */}
          {anime.type && (
            <div className="absolute top-2 right-2 bg-purple-600 text-white px-2 py-1 rounded text-xs font-bold uppercase">
              {anime.type}
            </div>
          )}
        </div>
        
        <h3 className="mt-2 text-white text-sm font-medium line-clamp-2">
          {anime.name}
        </h3>
      </Link>
    );
  } catch (error: any) {
    console.error('AnimeCard - Invalid ID:', error.message);
    return (
      <div className="group opacity-50 cursor-not-allowed">
        <div className="relative overflow-hidden rounded-lg bg-gray-800">
          <img
            src={anime.poster}
            alt={anime.name}
            className="w-full aspect-[2/3] object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <p className="text-red-500 text-xs text-center px-2">ID Inválido</p>
          </div>
        </div>
        <h3 className="mt-2 text-white text-sm font-medium line-clamp-2">
          {anime.name}
        </h3>
      </div>
    );
  }
};