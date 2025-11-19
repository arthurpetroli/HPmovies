import React from 'react';

interface GenreChipsProps {
  selected: string | null;
  onSelect: (genre: string | null) => void;
  list: string[];
}

export function GenreChips({ selected, onSelect, list }: GenreChipsProps) {
  const displayGenres = list.slice(0, 12); // Limitar para não quebrar o layout

  return (
    <div className="flex flex-wrap gap-3 mb-8">
      <button
        onClick={() => onSelect(null)}
        className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
          selected === null
            ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-lg scale-105'
            : 'bg-zinc-800/50 text-white/70 hover:bg-zinc-700/50 hover:text-white border border-zinc-700/30'
        }`}
      >
        Todos
      </button>
      {displayGenres.map((genre) => (
        <button
          key={genre}
          onClick={() => onSelect(genre)}
          className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
            selected === genre
              ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-lg scale-105'
              : 'bg-zinc-800/50 text-white/70 hover:bg-zinc-700/50 hover:text-white border border-zinc-700/30'
          }`}
        >
          {genre}
        </button>
      ))}
    </div>
  );
}