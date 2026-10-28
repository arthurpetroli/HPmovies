import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CatalogAnime } from '../../../shared/providers';
import { catalogService } from '../../services/catalog';
import { sourceSuffix } from '../../services/content';
import { prepareAnimeWatch } from '../../services/watchEntry';

export function SearchBar({ onClose, autoFocus = false }: { onClose?: () => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<CatalogAnime[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listId = useId();
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    let active = true;
    if (query.trim().length < 2) return;
    const timer = window.setTimeout(() => {
      catalogService.search({ search: query.trim(), page: 1 }).then((result) => { if (active) setSuggestions(result.items.slice(0, 5)); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);
  const changeQuery = (value: string) => { setQuery(value); setOpen(true); setSelected(-1); setSuggestions([]); setError(false); setLoading(value.trim().length >= 2); };
  const go = (path: string) => { setOpen(false); onClose?.(); navigate(path); };
  const watch = (anime: CatalogAnime) => {
    setOpen(false);
    onClose?.();
    void prepareAnimeWatch(anime);
    navigate(`/watch/anime/${encodeURIComponent(anime.id)}${sourceSuffix({ titles: [anime.title, anime.titleOriginal || ''].filter(Boolean) })}`, { state: { anime, autoPlay: true } });
  };
  const hasPanel = open && query.trim().length >= 2;
  return <div className="search-component">
    <form role="search" onSubmit={(event) => { event.preventDefault(); if (selected >= 0 && suggestions[selected]) watch(suggestions[selected]); else if (query.trim()) go(`/search?q=${encodeURIComponent(query.trim())}`); }}>
      <Search size={20} className="search-leading" />
      <input ref={input} value={query} type="search" placeholder="Buscar anime..." aria-label="Buscar animes" autoComplete="off" role="combobox" aria-expanded={hasPanel} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={selected >= 0 ? `${listId}-${selected}` : undefined} onChange={(event) => { changeQuery(event.target.value); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} onKeyDown={(event) => { if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setSelected((value) => (value + 1) % suggestions.length); } if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setSelected((value) => (value - 1 + suggestions.length) % suggestions.length); } if (event.key === 'Escape') setOpen(false); }} />
      {query && <button type="button" className="search-clear" aria-label="Limpar busca" onClick={() => { changeQuery(''); input.current?.focus(); }}><X size={18} /></button>}
      <button type="submit" className="search-submit" aria-label="Ver resultados"><Search size={18} aria-hidden="true" /></button>
    </form>
    {hasPanel && <div className="search-suggestions"><div className="suggestions-label">{loading ? <><LoaderCircle size={14} className="animate-spin" />Buscando no catálogo</> : 'Resultados rápidos'}</div><div role="listbox" id={listId} aria-label="Sugestões de animes">{suggestions.map((anime, index) => <button type="button" role="option" aria-selected={selected === index} id={`${listId}-${index}`} key={anime.id} className={`suggestion ${selected === index ? 'active' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => watch(anime)}><img src={anime.poster} alt="" /><span><strong>{anime.title}</strong><small>{[anime.year, anime.format?.replace('_', ' ')].filter(Boolean).join(' · ')}</small></span><ArrowUpRight size={16} /></button>)}</div>{!loading && !suggestions.length && <p className="suggestions-empty">{error ? 'Busca indisponível. Tente novamente em instantes.' : 'Nenhum anime encontrado. Tente outro título.'}</p>}{suggestions.length > 0 && <button type="button" className="suggestions-all" onMouseDown={(event) => event.preventDefault()} onClick={() => go(`/search?q=${encodeURIComponent(query.trim())}`)}>Ver todos os resultados <ArrowUpRight size={15} /></button>}</div>}
  </div>;
}
