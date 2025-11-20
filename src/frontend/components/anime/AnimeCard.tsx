import React from 'react';
import { Link } from 'react-router-dom';

interface AnimeCardProps {
  anime?: any;
  id?: string;
  title?: string;
  image?: string;
  type?: string;
  episodes?: any;
  rating?: string;
}

export const AnimeCard: React.FC<AnimeCardProps> = ({
  anime,
  id,
  title,
  image,
  type,
  episodes,
  rating,
}) => {
  const animeId = anime?.id || id;
  const animeTitle = anime?.name || anime?.title || title;
  const animeImage = anime?.poster || anime?.image || image;
  const animeType = anime?.type || type;
  const animeEpisodes = anime?.episodes || episodes;
  const animeRating = anime?.rating || rating;

  return (
    <Link
      to={`/anime/${animeId}`}
      className="group block"
    >
      <div className="relative transition-transform duration-300 ease-out group-hover:-translate-y-2">
        {/* Image Container */}
        <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-gray-800 shadow-lg group-hover:shadow-2xl group-hover:shadow-pink-500/20 transition-all duration-300">
          <img
            src={animeImage}
            alt={animeTitle}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.src = 'https://via.placeholder.com/300x450?text=No+Image';
            }}
          />

          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          {/* Badges */}
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {animeType && (
              <span className="bg-pink-500/90 backdrop-blur-sm text-white text-xs font-semibold px-2 py-1 rounded">
                {animeType}
              </span>
            )}
            {animeEpisodes?.sub && (
              <span className="bg-gray-900/90 backdrop-blur-sm text-white text-xs px-2 py-1 rounded">
                EP {animeEpisodes.sub}
              </span>
            )}
            {animeEpisodes?.dub > 0 && (
              <span className="bg-blue-500/90 backdrop-blur-sm text-white text-xs px-2 py-1 rounded">
                DUB
              </span>
            )}
          </div>

          {/* Rating */}
          {animeRating && (
            <div className="absolute top-2 right-2 bg-yellow-500/90 backdrop-blur-sm text-gray-900 text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
              <span>⭐</span>
              <span>{animeRating}</span>
            </div>
          )}

          {/* Play Icon on Hover */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="bg-pink-500 rounded-full p-4 transform scale-0 group-hover:scale-100 transition-transform duration-300">
              <svg
                className="w-6 h-6 text-white"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="mt-3 px-1">
          <h3 className="text-white text-sm font-medium line-clamp-2 group-hover:text-pink-500 transition-colors duration-300">
            {animeTitle}
          </h3>
        </div>
      </div>
    </Link>
  );
};