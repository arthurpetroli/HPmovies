import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Menu, X } from 'lucide-react';

export const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(searchQuery)}`;
    }
  };

  return (
    <nav className="bg-[#201f31] text-white sticky top-0 z-50 shadow-lg border-b border-gray-800">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Logo e Menu Mobile */}
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)} 
            className="lg:hidden text-gray-300 hover:text-white"
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <Link to="/" className="text-2xl font-bold text-[#ffbade] tracking-wider">
            HP<span className="text-white">movies</span>
          </Link>
        </div>

        {/* Barra de Busca Centralizada */}
        <form onSubmit={handleSearch} className="hidden lg:flex flex-1 max-w-xl relative">
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar anime..." 
            className="w-full bg-white text-black px-4 py-2 pr-12 rounded-sm focus:outline-none focus:ring-2 focus:ring-[#ffbade]"
          />
          <button type="submit" className="absolute right-0 top-0 h-full px-3 text-gray-600 hover:text-[#ffbade]">
            <Search size={20} />
          </button>
        </form>

        {/* Navegação Desktop (Sem Login/Discord) */}
        <div className="hidden lg:flex items-center gap-6 text-sm font-medium text-gray-300">
          <Link to="/" className="hover:text-[#ffbade] transition-colors">Home</Link>
          <Link to="/movies" className="hover:text-[#ffbade] transition-colors">Filmes</Link>
          <Link to="/tv-series" className="hover:text-[#ffbade] transition-colors">Séries</Link>
          <Link to="/most-popular" className="hover:text-[#ffbade] transition-colors">Populares</Link>
          <Link to="/top-airing" className="hover:text-[#ffbade] transition-colors">Em Lançamento</Link>
        </div>
      </div>

      {/* Menu Mobile Expandido */}
      {isMenuOpen && (
        <div className="lg:hidden bg-[#201f31] border-t border-gray-700 p-4 absolute w-full left-0">
          <form onSubmit={handleSearch} className="mb-4 flex">
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar..." 
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-l-sm outline-none"
            />
            <button className="bg-[#ffbade] text-black px-3 rounded-r-sm">
              <Search size={18} />
            </button>
          </form>
          <div className="flex flex-col gap-3 text-gray-300">
            <Link to="/" className="hover:text-white">Home</Link>
            <Link to="/movies" className="hover:text-white">Filmes</Link>
            <Link to="/tv-series" className="hover:text-white">Séries</Link>
            <Link to="/most-popular" className="hover:text-white">Populares</Link>
          </div>
        </div>
      )}
    </nav>
  );
};