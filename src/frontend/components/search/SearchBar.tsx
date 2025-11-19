import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import aniwatchService from '../../services/aniwatch';

interface SearchBarProps {
  onClose?: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        return;
      }

      try {
        const response = await aniwatchService.searchSuggestions(query);
        setSuggestions(response.data?.suggestions || []);
      } catch (error) {
        console.error('Erro ao buscar sugestões:', error);
        setSuggestions([]);
      }
    };

    const debounce = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(debounce);
  }, [query]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query)}`);
      setShowSuggestions(false);
      onClose?.();
    }
  };

  const handleSuggestionClick = (suggestion: any) => {
    navigate(`/anime/${suggestion.id}`);
    setShowSuggestions(false);
    setQuery('');
    onClose?.();
  };

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <form onSubmit={handleSearch}>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Buscar anime..."
            className="w-full bg-gray-800 text-white rounded-lg pl-12 pr-12 py-3 focus:outline-none focus:ring-2 focus:ring-pink-500"
          />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSuggestions([]);
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </form>

      {/* Suggestions Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 rounded-lg shadow-xl max-h-96 overflow-y-auto z-50">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              onClick={() => handleSuggestionClick(suggestion)}
              className="w-full flex items-center gap-3 p-3 hover:bg-gray-700 transition-colors text-left"
            >
              <img
                src={suggestion.poster}
                alt={suggestion.name}
                className="w-12 h-16 object-cover rounded"
              />
              <div className="flex-1">
                <div className="text-white font-medium">{suggestion.name}</div>
                {suggestion.jname && (
                  <div className="text-gray-400 text-sm">{suggestion.jname}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};