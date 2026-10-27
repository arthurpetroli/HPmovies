import { useCallback, useState } from 'react';
import { ArrowLeft, ArrowRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CatalogQuery } from '../../shared/providers';
import { AnimeCard } from '../components/anime/AnimeCard';
import { FilterDrawer, FilterFields } from '../components/filters/FilterDrawer';
import { GenreChips } from '../components/filters/GenreChips';
import { CatalogEmpty, CatalogError, CatalogSkeleton } from '../components/ui/CatalogState';
import { catalogService } from '../services/catalog';
import { useCatalogRequest } from '../hooks/useCatalogRequest';

const validSort = (value: string | null): CatalogQuery['sort'] => ['popular', 'score', 'trending', 'newest'].includes(value || '') ? value as CatalogQuery['sort'] : undefined;
export function ExplorePage({ title = 'Seu próximo anime está aqui.', initialQuery = {} }: { title?: string; initialQuery?: CatalogQuery }) {
  const [params, setParams] = useSearchParams();
  const [retry, setRetry] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const searchParam = params.get('q') || '';
  const [searchDraft, setSearchDraft] = useState({ source: searchParam, value: searchParam });
  if (searchDraft.source !== searchParam) setSearchDraft({ source: searchParam, value: searchParam });
  const search = searchDraft.source === searchParam ? searchDraft.value : searchParam;
  const yearParam = Number(params.get('year'));
  const query: CatalogQuery = {
    ...initialQuery,
    search: params.get('q') || initialQuery.search || undefined,
    genre: params.has('genre') ? params.get('genre') || undefined : initialQuery.genre,
    year: params.has('year') ? (Number.isInteger(yearParam) && yearParam >= 1940 && yearParam <= 2100 ? yearParam : undefined) : initialQuery.year,
    season: (['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(params.get('season') || '') ? params.get('season') as CatalogQuery['season'] : initialQuery.season),
    format: params.has('format') ? params.get('format') || undefined : initialQuery.format,
    status: params.has('status') ? params.get('status') || undefined : initialQuery.status,
    sort: validSort(params.get('sort')) || initialQuery.sort || 'popular',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const queryKey = JSON.stringify(query);
  const loader = useCallback(() => catalogService.search(JSON.parse(queryKey) as CatalogQuery), [queryKey]);
  const genreLoader = useCallback(() => catalogService.genres(), []);
  const { data: result, loading, error } = useCatalogRequest(`search:${queryKey}:${retry}`, loader);
  const { data: genreData, error: genreError } = useCatalogRequest(`genres:${retry}`, genreLoader);
  const genres = genreData || [];
  const update = (key: keyof CatalogQuery, value: string) => { const next = new URLSearchParams(params); const name = key === 'search' ? 'q' : key; next.set(name, value); next.delete('page'); setParams(next); };
  const applyFilters = (values: CatalogQuery) => { const next = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (value != null && value !== '' && key !== 'page') next.set(key === 'search' ? 'q' : key, String(value)); }); for (const key of ['genre', 'year', 'season', 'format', 'status']) if (!next.has(key)) next.set(key, ''); setParams(next); };
  const changePage = (page: number) => { const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const activeFilters = [query.genre, query.year, query.season, query.format, query.status].filter(Boolean).length;
  return <main id="main-content" className="page-shell content-width explore-page">
    <div className="page-heading"><span className="eyebrow">DESCUBRA NOVAS HISTÓRIAS</span><h1>{query.search ? `Resultados para “${query.search}”` : title}</h1><p>Dos clássicos que você ama às histórias que ainda vai conhecer.</p></div>
    <Link className="button-secondary mb-6" to="/sources?kind=anime">Abrir episódio pelas fontes<ArrowRight size={16} /></Link>
    <div className="explore-search-row"><form role="search" className="explore-search" onSubmit={(event) => { event.preventDefault(); update('search', search.trim()); }}><Search size={18} /><input aria-label="Pesquisar no catálogo" placeholder="Buscar pelo nome do anime" type="search" value={search} onChange={(event) => setSearchDraft({ source: searchParam, value: event.target.value })} /><button className="button-primary button-sm" type="submit">Buscar</button></form><button className="button-secondary mobile-filter-button" onClick={() => setDrawer(true)}><SlidersHorizontal size={17} />Filtros{activeFilters > 0 && <span>{activeFilters}</span>}</button></div>
    <div className="desktop-filters"><FilterFields values={query} genresAll={genres} onChange={update} /></div>
    {genreError && <div className="subtle-error" role="status">Os gêneros não carregaram. <button className="text-link" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div>}
    {genres.length > 0 && <GenreChips selected={query.genre || null} list={genres.slice(0, 11)} onSelect={(genre) => update('genre', genre || '')} />}
    <div className="results-heading"><span aria-live="polite">{loading ? 'Encontrando histórias...' : `${result?.items.length || 0} animes nesta página`}{!loading && result?.total != null && result.total > 0 && <small> · {result.total.toLocaleString('pt-BR')} no catálogo</small>}</span>{activeFilters > 0 && <button className="clear-filters" onClick={() => applyFilters({ search: query.search, sort: 'popular' })}><X size={14} />Limpar filtros</button>}</div>
    {loading ? <CatalogSkeleton /> : error ? <CatalogError message={error} onRetry={() => setRetry((value) => value + 1)} /> : !result?.items.length ? <CatalogEmpty /> : <><div className="catalog-grid">{result.items.map((anime) => <AnimeCard key={anime.id} anime={anime} />)}</div><nav className="pagination" aria-label="Páginas do catálogo"><button className="button-secondary" disabled={result.page <= 1} onClick={() => changePage(result.page - 1)}><ArrowLeft size={16} />Anterior</button><span>Página <strong>{result.page}</strong></span><button className="button-secondary" disabled={!result.hasNextPage} onClick={() => changePage(result.page + 1)}>Próxima<ArrowRight size={16} /></button></nav></>}
    <FilterDrawer open={drawer} onClose={() => setDrawer(false)} values={query} genresAll={genres} onApply={applyFilters} />
  </main>;
}
