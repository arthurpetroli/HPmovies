import React, { useState, useEffect } from 'react';
import type { FilterValues } from '../../types';

interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  values: {
    name: string;
    yearFrom?: number;
    yearTo?: number;
    minRating?: number;
    genre?: string | null;
    sort?: 'popular' | 'recent' | 'rating';
  };
  onApply: (values: FilterDrawerProps['values']) => void;
  genresAll: string[];
}

export function FilterDrawer({ open, onClose, values, onApply, genresAll }: FilterDrawerProps) {
  const [local, setLocal] = useState(values);
  
  useEffect(() => {
    setLocal(values);
  }, [values]);
  
  if (!open) return null;
  
  const handleApply = () => {
    onApply(local);
  };

  const handleClear = () => {
    const cleared: FilterValues = { 
      name: '', 
      genre: null, 
      sort: 'popular' 
    };
    setLocal(cleared);
    onApply(cleared);
  };
  
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-80 bg-zinc-900 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Filtros</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            ✕
          </button>
        </div>
        <div className="text-white/80">
          <p>Filtros em desenvolvimento...</p>
        </div>
      </div>
    </div>
  );
}