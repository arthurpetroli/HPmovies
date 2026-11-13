import { useCallback, useState } from 'react';
import { ArrowLeft, ArrowRight, Film, Search, SearchX } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { cinemaService } from '../services/cinema';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { CatalogError } from '../components/ui/CatalogState';

export function CinemaPage() {
  const [params, setParams] = useSearchParams();
  return <CinemaCatalog key={params.toString()} params={params} onChange={setParams} />;
}

function CinemaCatalog({ params, onChange }: { params: URLSearchParams; onChange: (params: URLSearchParams) => void }) {
  const type = params.get('type') === 'series' ? 'series' : 'movie';
  const [search, setSearch] = useState(params.get('q') || '');
  const [retry, setRetry] = useState(0);
  const [filterRetry, setFilterRetry] = useState(0);
  const region = params.get('region') || 'BR';
  const provider = params.get('provider') || '';
  const currentSearch = params.get('q') || '';
  const rawPage = Number(params.get('page'));
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 1000 ? rawPage : 1;
  const queryKey = JSON.stringify({ type, page, region, provider: provider || undefined, search: currentSearch || undefined });
  const loader = useCallback(() => cinemaService.catalog({ type, page, region, provider: provider || undefined, search: currentSearch || undefined }), [type, page, region, provider, currentSearch]);
  const { data, loading, error } = useCatalogRequest(`cinema:${queryKey}:${retry}`, loader);
  const filterLoader = useCallback(() => cinemaService.filters(), []);
  const filters = useCatalogRequest(`cinema-filters:${filterRetry}`, filterLoader);
  const providers = filters.data?.providers || [];
  const selectedProvider = providers.find(item => item.id === provider);
  const providerAvailable = !selectedProvider?.regions || selectedProvider.regions.includes(region);
  const preferredProviders = ['nfx', 'dnp', 'prv', 'amp', 'hlu', 'atp', 'mxx', 'hbm', 'gop'];
  const regionProviders = providers.filter(item => !item.regions || item.regions.includes(region) || item.id === 'hlu' || item.id === provider);
  const visibleProviders = [...preferredProviders.flatMap(id => regionProviders.filter(item => item.id === id)),
    ...regionProviders.filter(item => !preferredProviders.includes(item.id))];
  const update = (values: Record<string, string>) => {
    // Router navigation updates the URL before its React transition commits.
    // A second filter event must merge the latest query, including a just-submitted search.
    const next = new URLSearchParams(window.location.search);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    onChange(next);
  };
  return <main id="main-content" className="page-shell content-width">
    <div className="page-heading"><h1>Filmes e séries.</h1><p>Explore o catálogo, filtre por streaming e escolha sua próxima história.</p></div>
    <div className="mb-5 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-[auto_1fr_auto_2fr]">
      <label className="grid gap-2 text-sm text-slate-300">Catálogo<select className="min-h-11 rounded-lg border border-white/15 bg-[#151d25] px-3 py-3 text-white" value={type} onChange={event => update({ type: event.target.value, page: '' })}><option value="movie">Filmes</option><option value="series">Séries</option></select></label>
      <label className="grid min-w-0 gap-2 text-sm text-slate-300">Streaming<select className="min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-[#151d25] px-3 py-3 text-white" value={provider} disabled={filters.loading} onChange={event => update({ provider: event.target.value, page: '' })}>
        <option value="">Todos os streamings</option>
        {provider && !selectedProvider && <option value={provider}>{provider}</option>}
        {visibleProviders.map(item => <option key={item.id} value={item.id} disabled={!!item.regions && !item.regions.includes(region)}>{item.label}{item.regions && !item.regions.includes(region) ? ` · ${item.regions.map(id => filters.data?.regions.find(entry => entry.id === id)?.label || id).join(', ')}` : ''}</option>)}
      </select></label>
      <label className="grid min-w-0 gap-2 text-sm text-slate-300">Região<select className="min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-[#151d25] px-3 py-3 text-white" value={region} disabled={filters.loading} onChange={event => {
        const nextRegion = event.target.value;
        update({ region: nextRegion, provider: selectedProvider?.regions && !selectedProvider.regions.includes(nextRegion) ? '' : provider, page: '' });
      }}>
        {filters.data?.regions.length ? filters.data.regions.map(item => <option key={item.id} value={item.id}>{item.label}</option>) : <option value={region}>{region === 'BR' ? 'Brasil' : region === 'US' ? 'Estados Unidos' : region}</option>}
      </select></label>
      <form role="search" className="flex min-w-0 flex-1 flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); update({ q: search.trim(), page: '' }); }}>
        <label className="grid min-w-0 flex-1 gap-2 text-sm text-slate-300">Buscar filmes e séries<input className="min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-[#151d25] px-3 py-3 text-white" type="search" maxLength={120} placeholder="Nome do filme ou da série" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <button className="button-primary min-h-11" type="submit"><Search size={17} aria-hidden="true" />Buscar</button>
      </form>
    </div>
    {filters.error && <p className="mb-4 text-sm text-amber-200" role="status">Não foi possível carregar os filtros. <button className="min-h-11 underline underline-offset-4" type="button" onClick={() => setFilterRetry(value => value + 1)}>Tentar filtros novamente</button></p>}
    <p className="mb-6 text-xs leading-relaxed text-slate-400">A oferta de cada streaming varia por região. O filtro não garante disponibilidade de vídeo nas fontes do player.</p>
    {!providerAvailable && <p className="mb-4 text-sm text-amber-200" role="status">Este streaming não está listado na região escolhida. Troque a região ou escolha outro serviço.</p>}
    <p className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400"><span role="status">{loading ? 'Carregando títulos…' : `${data?.items.length || 0} títulos nesta página`}</span><Link className="text-teal-300 underline underline-offset-4" to="/sources?kind=stremio">Abrir pelo ID IMDb</Link></p>
    {data?.notice && <p className="mb-6 max-w-3xl text-sm leading-relaxed text-slate-400">{data.notice}</p>}
    {loading ? <div role="status" className="catalog-grid" aria-label="Carregando filmes e séries">{Array.from({ length: 12 }, (_, index) => <div key={index} className="skeleton-card"><div className="skeleton-poster skeleton" /><div className="skeleton-title skeleton" /></div>)}</div> : error ? <CatalogError message={error} onRetry={() => setRetry(value => value + 1)} /> : !data?.items.length ? <div className="catalog-state"><SearchX size={30} aria-hidden="true" /><h2>Nenhum título encontrado</h2><p>Experimente outro nome ou troque entre filmes e séries.</p></div> : <>
      <div className="catalog-grid">{data.items.map(item => <Link key={`${item.type}:${item.id}`} className="group block min-w-0" to={`/cinema/${item.type}/${item.id}?${params}`} aria-label={`Ver ${item.title}`}>
        <div className="relative mb-3 aspect-[2/3] overflow-hidden rounded-lg bg-white/5">{item.poster ? <img className="h-full w-full object-cover transition duration-200 group-hover:opacity-80 motion-reduce:transition-none" src={item.poster} alt="" loading="lazy" /> : <div className="flex h-full items-center justify-center text-slate-500"><Film size={34} aria-hidden="true" /></div>}</div>
        <h2 className="text-sm font-semibold leading-relaxed text-slate-100 group-hover:text-teal-300">{item.title}</h2><p className="mt-1 text-xs text-slate-400">{[item.year, item.type === 'movie' ? 'Filme' : 'Série', item.rating !== undefined ? `IMDb ${item.rating.toLocaleString('pt-BR')}` : ''].filter(Boolean).join(' · ')}</p>
      </Link>)}</div>
      <nav className="pagination flex-wrap" aria-label="Páginas de filmes e séries"><button className="button-secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}><ArrowLeft size={16} aria-hidden="true" />Anterior</button><span>Página <strong>{page}</strong></span><button className="button-secondary" disabled={!data.hasNextPage || page >= 1000} onClick={() => update({ page: String(page + 1) })}>Próxima<ArrowRight size={16} aria-hidden="true" /></button></nav>
    </>}
    <p className="mt-10 max-w-3xl text-xs leading-relaxed text-slate-500">Metadados do Cinemeta e filtros de streaming do JustWatch. Sinopses seguem o idioma da fonte. Um título no catálogo não garante vídeo ou legenda disponível.</p>
  </main>;
}
