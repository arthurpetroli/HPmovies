import { useCallback, useState } from 'react';
import { Search, VenetianMask } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { AdultCatalogQuery } from '../../shared/adult';
import type { CatalogAnime, CatalogPage } from '../../shared/providers';
import { AdultCard } from '../components/adult/AdultCard';
import { AdultGate } from '../components/adult/AdultGate';
import { AnimeRowCarousel } from '../components/anime/AnimeRowCarousel';
import { CatalogError, CatalogSkeleton } from '../components/ui/CatalogState';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { adultService } from '../services/adult';
import '../adult.css';

const SORTS: Array<{ value: NonNullable<AdultCatalogQuery['sort']>; label: string }> = [
  { value: 'popular', label: 'Mais populares' }, { value: 'trending', label: 'Em alta' },
  { value: 'score', label: 'Mais bem avaliados' }, { value: 'newest', label: 'Mais recentes' },
];
const stateLabels: Record<string, string> = { available: 'Disponível', unavailable: 'Não configurada', unauthorized: 'Aguardando permissão', connection_error: 'Sem conexão', empty: 'Sem resultados', checking: 'Verificando' };
const card = (anime: CatalogAnime) => <AdultCard anime={anime} />;

export function AdultHomePage() {
  return <AdultGate><AdultHome /></AdultGate>;
}

function AdultSources() {
  const [open, setOpen] = useState(false);
  const loader = useCallback(() => open ? adultService.sources() : Promise.resolve(null), [open]);
  const sources = useCatalogRequest(`adult-sources:${open}`, loader);
  return <details className="adult-sources" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Fontes de vídeo do conteúdo adulto</summary>
    <p>O catálogo vem do AniList. O vídeo vem das fontes de anime já configuradas e da hentai-api, quando HENTAI_API_URL aponta para uma instância sua.</p>
    {open && (sources.loading ? <p role="status">Verificando fontes…</p> : sources.error ? <p role="alert">{sources.error}</p>
      : <ul>{sources.data?.diagnostics.map(item => <li key={item.id}><strong>{item.name}</strong><span data-state={item.state}>{stateLabels[item.state] || item.state}</span><small>{item.message}</small></li>)}</ul>)}
  </details>;
}

function AdultHome() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q')?.trim().slice(0, 120) ?? '';
  const tag = params.get('tag')?.trim() ?? '';
  const sortParam = params.get('sort');
  const sort = SORTS.some(item => item.value === sortParam) ? sortParam as NonNullable<AdultCatalogQuery['sort']> : 'popular';
  const filtering = !!search || !!tag || !!sortParam;
  const [draft, setDraft] = useState({ key: search, value: search });
  const draftValue = draft.key === search ? draft.value : search;
  const [retry, setRetry] = useState(0);

  const homeLoader = useCallback(() => adultService.home(), []);
  const home = useCatalogRequest(`adult-home:${retry}`, homeLoader);
  const tagsLoader = useCallback(() => adultService.tags(), []);
  const tags = useCatalogRequest('adult-tags', tagsLoader);

  // Explicit coercion keeps the request key immutable for the React compiler.
  const queryKey = String(JSON.stringify([search, tag, sort, filtering]));
  const firstLoader = useCallback(() => {
    const [text, chosenTag, order, active] = JSON.parse(queryKey) as [string, string, NonNullable<AdultCatalogQuery['sort']>, boolean];
    return active ? adultService.search({ search: text || undefined, tag: chosenTag || undefined, sort: order, page: 1 }) : Promise.resolve(null);
  }, [queryKey]);
  const first = useCatalogRequest(`adult-search:${queryKey}:${retry}`, firstLoader);
  const [more, setMore] = useState<{ key: string; pages: CatalogPage[]; loading: boolean; error: string }>({ key: '', pages: [], loading: false, error: '' });
  const extra = more.key === queryKey ? more : { key: queryKey, pages: [], loading: false, error: '' };
  const lastPage = extra.pages.at(-1) ?? first.data;
  const results = [...new Map([...(first.data?.items ?? []), ...extra.pages.flatMap(page => page.items)].map(anime => [anime.id, anime])).values()];

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key); });
    setParams(next);
  };
  const loadMore = () => {
    if (!lastPage?.hasNextPage || extra.loading) return;
    const page = lastPage.page + 1;
    setMore({ ...extra, loading: true, error: '' });
    adultService.search({ search: search || undefined, tag: tag || undefined, sort, page })
      .then(value => setMore(current => current.key === queryKey ? { ...current, pages: [...current.pages, value], loading: false } : current))
      .catch((cause: unknown) => setMore(current => current.key === queryKey ? { ...current, loading: false, error: cause instanceof Error ? cause.message : 'Não foi possível carregar mais títulos.' } : current));
  };

  return <main id="main-content" className="page-shell content-width adult-page">
    <header className="page-heading adult-heading">
      <p className="adult-eyebrow"><VenetianMask size={15} aria-hidden="true" />18+ · ativado neste navegador</p>
      <h1>Conteúdo adulto</h1>
      <p>Hentai catalogado no AniList. Obras que retratam menores são bloqueadas pelo HPmovies. O que você assiste aqui não entra no histórico nem na sua lista.</p>
    </header>

    <form className="adult-toolbar" role="search" onSubmit={event => { event.preventDefault(); update({ q: draftValue.trim() }); }}>
      <label className="adult-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Buscar no catálogo adulto</span>
        <input type="search" value={draftValue} maxLength={120} placeholder="Buscar título" onChange={event => setDraft({ key: search, value: event.target.value })} /></label>
      <label className="adult-sort"><span className="sr-only">Ordenar por</span>
        <select className="field-control" value={sort} onChange={event => update({ sort: event.target.value })}>{SORTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <button type="submit" className="button-primary">Buscar</button>
    </form>
    {tags.data && tags.data.length > 0 && <div className="genre-chips scrollbar-hide adult-tags" aria-label="Filtrar por tag">
      <button type="button" className={`genre-chip ${tag ? '' : 'active'}`} aria-pressed={!tag} onClick={() => update({ tag: '' })}>Todas</button>
      {tags.data.map(name => <button type="button" key={name} className={`genre-chip ${tag === name ? 'active' : ''}`} aria-pressed={tag === name} onClick={() => update({ tag: tag === name ? '' : name })}>{name}</button>)}
    </div>}

    {filtering ? <section aria-labelledby="adult-results-heading" className="adult-results">
      <div className="section-heading"><div><h2 id="adult-results-heading">{search ? `Resultados para “${search}”` : tag ? tag : 'Catálogo adulto'}</h2><p>{SORTS.find(item => item.value === sort)?.label}{tag && search ? ` · ${tag}` : ''}</p></div>
        <button type="button" className="text-link" onClick={() => { setDraft({ key: '', value: '' }); setParams(new URLSearchParams()); }}>Limpar filtros</button></div>
      {first.loading ? <CatalogSkeleton count={12} /> : first.error ? <CatalogError message={first.error} onRetry={() => setRetry(value => value + 1)} />
        : results.length ? <>
          <div className="catalog-grid">{results.map(anime => <AdultCard key={anime.id} anime={anime} />)}</div>
          {extra.error && <p role="alert" className="adult-inline-error">{extra.error}</p>}
          {lastPage?.hasNextPage && <div className="adult-more"><button type="button" className="button-secondary" disabled={extra.loading} onClick={loadMore}>{extra.loading ? 'Carregando…' : 'Carregar mais'}</button></div>}
        </> : <div className="catalog-state"><h2>Nenhum título encontrado</h2><p>Tente outro nome ou outra tag. Títulos bloqueados pelo filtro de proteção a menores não aparecem.</p></div>}
    </section>
      : home.loading ? <CatalogSkeleton count={12} />
      : home.error ? <CatalogError message={home.error} onRetry={() => setRetry(value => value + 1)} />
      : home.data && <>
        <AnimeRowCarousel title="Em alta" subtitle="O que a comunidade do AniList está vendo agora." animes={home.data.trending} viewAllLink="/adult?sort=trending" renderItem={card} />
        <AnimeRowCarousel title="Mais populares" subtitle="Os títulos adultos mais presentes nas listas." animes={home.data.popular} viewAllLink="/adult?sort=popular" renderItem={card} />
        <AnimeRowCarousel title="Lançamentos recentes" subtitle="Do mais novo para o mais antigo." animes={home.data.recent} viewAllLink="/adult?sort=newest" renderItem={card} />
        <AnimeRowCarousel title="Mais bem avaliados" subtitle="As melhores notas no AniList." animes={home.data.topRated} viewAllLink="/adult?sort=score" renderItem={card} />
      </>}
    <AdultSources />
  </main>;
}
