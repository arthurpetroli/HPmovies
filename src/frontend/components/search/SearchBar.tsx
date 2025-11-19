import React from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onOpenFilters: () => void;
}

export function SearchBar({ value, onChange, onOpenFilters }: SearchBarProps) {
  return (
    <div className="flex gap-4 mb-6">
      <div className="relative flex-1">
        <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Buscar filmes, séries..."
          className="w-full pl-12 pr-4 py-4 bg-zinc-800/50 backdrop-blur-sm border border-zinc-700/50 rounded-2xl text-white placeholder-white/50 focus:outline-none focus:border-pink-500/50 focus:bg-zinc-800/70 transition-all duration-300"
        />
      </div>
      <button
        onClick={onOpenFilters}
        className="px-6 py-4 bg-zinc-800/50 backdrop-blur-sm hover:bg-zinc-700/50 rounded-2xl text-white transition-all duration-300 border border-zinc-700/50 hover:border-zinc-600/50 flex items-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
        </svg>
        <span className="hidden md:inline">Filtros</span>
      </button>
    </div>
  );
}