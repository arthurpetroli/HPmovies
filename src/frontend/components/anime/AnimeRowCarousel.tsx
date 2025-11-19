import React, { useRef } from 'react';
import { AnimeCard } from './AnimeCard';
import type { Anime } from '../../types/anime';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface AnimeRowCarouselProps {
  title: string;
  animes: Anime[];
  viewAllLink?: string;
}

export const AnimeRowCarousel: React.FC<AnimeRowCarouselProps> = ({
  title,
  animes,
  viewAllLink,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -800 : 800;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  if (!animes || animes.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {viewAllLink && (
          <a
            href={viewAllLink}
            className="text-blue-400 hover:text-blue-300 text-sm font-medium"
          >
            Ver todos →
          </a>
        )}
      </div>

      <div className="relative group">
        {/* Botão Esquerda */}
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-black/70 hover:bg-black/90 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronLeft size={24} />
        </button>

        {/* Scroll Container */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {animes.map((anime) => (
            <div key={anime.id} className="flex-none w-[160px]">
              <AnimeCard anime={anime} />
            </div>
          ))}
        </div>

        {/* Botão Direita */}
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-black/70 hover:bg-black/90 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronRight size={24} />
        </button>
      </div>
    </div>
  );
};