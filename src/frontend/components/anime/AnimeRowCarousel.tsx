import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';

interface AnimeRowCarouselProps {
  title: string;
  animes: any[];
  viewAllLink?: string;
}

export const AnimeRowCarousel: React.FC<AnimeRowCarouselProps> = ({
  title,
  animes,
  viewAllLink,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 400;
      const newScrollLeft =
        direction === 'left'
          ? scrollRef.current.scrollLeft - scrollAmount
          : scrollRef.current.scrollLeft + scrollAmount;

      scrollRef.current.scrollTo({
        left: newScrollLeft,
        behavior: 'smooth',
      });
    }
  };

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setShowLeftArrow(scrollLeft > 0);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="w-1 h-8 bg-pink-500 rounded-full"></span>
          {title}
        </h2>
        {viewAllLink && (
          <Link
            to={viewAllLink}
            className="text-pink-500 hover:text-pink-400 transition flex items-center gap-2 text-sm font-medium"
          >
            Ver todos
            <span>→</span>
          </Link>
        )}
      </div>

      {/* Carousel */}
      <div className="relative group/carousel">
        {/* Left Arrow */}
        {showLeftArrow && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-gray-900/90 hover:bg-gray-800 text-white p-3 rounded-r-lg opacity-0 group-hover/carousel:opacity-100 transition-all duration-300 shadow-xl"
            aria-label="Scroll left"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        )}

        {/* Right Arrow */}
        {showRightArrow && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-gray-900/90 hover:bg-gray-800 text-white p-3 rounded-l-lg opacity-0 group-hover/carousel:opacity-100 transition-all duration-300 shadow-xl"
            aria-label="Scroll right"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        )}

        {/* Scrollable Container */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth pb-4"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {animes.map((anime, index) => (
            <AnimeCard key={anime.id || index} anime={anime} />
          ))}
        </div>
      </div>
    </div>
  );
};

// Card Component - ISOLADO para hover individual
interface AnimeCardProps {
  anime: any;
}

const AnimeCard: React.FC<AnimeCardProps> = ({ anime }) => {
  return (
    <Link
      to={`/anime/${anime.id}`}
      className="flex-shrink-0 w-[160px] sm:w-[180px] md:w-[200px] group/card"
    >
      {/* Container com hover isolado */}
      <div className="relative transform transition-transform duration-300 ease-out group-hover/card:-translate-y-3">
        {/* Image Container */}
        <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-gray-800 shadow-lg group-hover/card:shadow-2xl group-hover/card:shadow-pink-500/20 transition-all duration-300">
          <img
            src={anime.poster || anime.image}
            alt={anime.name || anime.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover/card:scale-105"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.src = 'https://via.placeholder.com/200x300?text=No+Image';
            }}
          />

          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-300" />

          {/* Badges */}
          <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
            {anime.type && (
              <span className="bg-pink-500/90 backdrop-blur-sm text-white text-xs font-semibold px-2 py-1 rounded">
                {anime.type}
              </span>
            )}
            {anime.episodes?.sub && (
              <span className="bg-gray-900/90 backdrop-blur-sm text-white text-xs px-2 py-1 rounded">
                EP {anime.episodes.sub}
              </span>
            )}
            {anime.episodes?.dub > 0 && (
              <span className="bg-blue-500/90 backdrop-blur-sm text-white text-xs px-2 py-1 rounded">
                DUB
              </span>
            )}
          </div>

          {/* Rating */}
          {anime.rating && (
            <div className="absolute top-2 right-2 bg-yellow-500/90 backdrop-blur-sm text-gray-900 text-xs font-bold px-2 py-1 rounded flex items-center gap-1 z-10">
              <span>⭐</span>
              <span>{anime.rating}</span>
            </div>
          )}

          {/* Play Icon on Hover */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 z-20">
            <div className="bg-pink-500 rounded-full p-4 transform scale-0 group-hover/card:scale-100 transition-transform duration-300">
              <svg
                className="w-6 h-6 text-white"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>

          {/* Bottom Info (visible on hover) */}
          <div className="absolute bottom-0 left-0 right-0 p-3 transform translate-y-full group-hover/card:translate-y-0 transition-transform duration-300 z-10">
            <div className="space-y-1">
              {anime.otherInfo && anime.otherInfo.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {anime.otherInfo.slice(0, 2).map((info: string, idx: number) => (
                    <span
                      key={idx}
                      className="text-xs text-gray-300 bg-gray-800/80 px-2 py-0.5 rounded"
                    >
                      {info}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="mt-3 px-1">
          <h3 className="text-white text-sm font-medium line-clamp-2 group-hover/card:text-pink-500 transition-colors duration-300">
            {anime.name || anime.title}
          </h3>
        </div>
      </div>
    </Link>
  );
};

// CSS para esconder scrollbar
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    .scrollbar-hide::-webkit-scrollbar {
      display: none;
    }
    .scrollbar-hide {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
  `;
  document.head.appendChild(style);
}