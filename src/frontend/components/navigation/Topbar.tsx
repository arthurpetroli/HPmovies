import React from 'react';
import type { PageType } from '../../types';

interface TopbarProps {
  currentPage: PageType;
  onNavigate: (page: PageType) => void;
}

export function Topbar({ currentPage, onNavigate }: TopbarProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-zinc-950/80 border-b border-white/5">
      <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <button 
            onClick={() => onNavigate('home')}
            className="text-2xl font-black text-transparent bg-gradient-to-r from-pink-500 to-rose-500 bg-clip-text hover:from-pink-400 hover:to-rose-400 transition-all duration-300"
          >
            HPmovie
          </button>
          
          <nav className="hidden md:flex items-center gap-1">
            <button 
              onClick={() => onNavigate('home')}
              className={`px-6 py-2 rounded-full font-medium transition-all duration-300 ${
                currentPage === 'home' 
                  ? 'bg-white/10 text-white' 
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              Início
            </button>
            <button 
              onClick={() => onNavigate('movies')}
              className={`px-6 py-2 rounded-full font-medium transition-all duration-300 ${
                currentPage === 'movies' 
                  ? 'bg-white/10 text-white' 
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              Filmes
            </button>
            <button 
              onClick={() => onNavigate('series')}
              className={`px-6 py-2 rounded-full font-medium transition-all duration-300 ${
                currentPage === 'series' 
                  ? 'bg-white/10 text-white' 
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              Séries
            </button>
          </nav>
        </div>
        
        <button className="px-6 py-2 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-semibold rounded-full transition-all duration-300 hover:scale-105 shadow-lg">
          Login
        </button>
      </div>
    </header>
  );
}