import { useCallback, useState } from 'react';
import { BookOpen, Search, ArrowRight } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { MangaQuery } from '../../shared/manga';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { mangaService } from '../services/manga';
import { useMangaLibrary } from '../services/mangaLibrary';
import { MangaCard, MangaRow } from '../components/manga/MangaCard';
import { MangaError, MangaLoading } from '../components/manga/MangaState';
import '../manga.css';

export function MangaHomePage() {
  const [params, setParams] = useSearchParams(); const [retry, setRetry] = useState(0);
  const search = params.get('search') || ''; const pageValue = Number(params.get('page') || 1); const page = Number.isInteger(pageValue) && pageValue >= 1 && pageValue <= 416 ? pageValue : 1;
  const [draft, setDraft] = useState(search);
  const tag = params.get('tag') || ''; const sort = params.get('sort') || ''; const status = params.get('status') || '';
  const browsing = !!(search || tag || sort || status || page > 1);
  const homeLoader = useCallback(() => browsing ? Promise.resolve(null) : mangaService.home(), [browsing]);
  const queryLoader = useCallback(() => browsing ? mangaService.search({ search, tag, sort: (sort || 'popular') as MangaQuery['sort'], status: status as MangaQuery['status'], page }) : Promise.resolve(null), [browsing, search, tag, sort, status, page]);
  const tagsLoader = useCallback(() => mangaService.tags(), []);
  const home = useCatalogRequest(`manga-home:${browsing}:${retry}`, homeLoader);
  const catalog = useCatalogRequest(`manga-search:${params}:${retry}`, queryLoader);
  const tags = useCatalogRequest('manga-tags', tagsLoader);
  const { history, storageError } = useMangaLibrary();
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete('page'); setParams(next); };
  const error = browsing ? catalog.error : home.error; const loading = browsing ? catalog.loading : home.loading;
  return <main id="main-content" className="manga-page content-width page-shell">
    <div className="manga-heading"><div><span className="eyebrow">HPMOVIES · MANGÁS</span><h1>Uma página. Outro universo.</h1><p>Descubra novas histórias e acompanhe as suas favoritas, com prioridade para português brasileiro.</p></div><span className="manga-heading-icon"><BookOpen size={40} /></span></div>
    <form className="manga-filters" onSubmit={(event) => { event.preventDefault(); update('search', draft.trim()); }}>
      <label className="manga-search"><Search size={18} /><input aria-label="Buscar mangá por título" placeholder="Busque sua próxima leitura" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={120} /><button type="submit" className="button-primary">Buscar</button></label>
      <label>Gênero<select value={tag} onChange={(event) => update('tag', event.target.value)}><option value="">Todos os gêneros</option>{tags.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Ordenação<select value={sort} onChange={(event) => update('sort', event.target.value)}><option value="">Destaques</option><option value="popular">Mais populares</option><option value="rating">Mais bem avaliados</option><option value="latest">Últimas atualizações</option><option value="newest">Adicionados recentemente</option></select></label>
      <label>Publicação<select value={status} onChange={(event) => update('status', event.target.value)}><option value="">Todos</option><option value="ongoing">Em publicação</option><option value="completed">Concluídos</option><option value="hiatus">Em pausa</option></select></label>
    </form>
    {storageError && <p className="manga-notice" role="status">{storageError}</p>}
    {!browsing && history.length > 0 && <section className="manga-resume-row"><div className="section-heading"><div><h2>Continue sua leitura</h2><p>Suas histórias esperam por você.</p></div></div><div className="manga-resume-list">{history.slice(0, 4).map((item) => <Link key={item.manga.id} to={`/manga/${item.manga.id}/read/${item.chapterId}`} className="manga-resume-card"><BookOpen size={22} /><div><strong>{item.manga.title}</strong><span>{item.chapterTitle} · página {item.page + 1} de {item.pageCount}</span></div><ArrowRight size={18} /></Link>)}</div></section>}
    {loading ? <MangaLoading /> : error ? <MangaError message={error} retry={() => setRetry((value) => value + 1)} /> : browsing ? <section><div className="section-heading"><div><h2>{search ? `Resultados para “${search}”` : 'Explore o catálogo'}</h2><p>{catalog.data?.total ?? 0} títulos encontrados no MangaDex</p></div><Link to="/manga">Limpar filtros</Link></div>{catalog.data?.items.length ? <div className="manga-grid">{catalog.data.items.map((manga) => <MangaCard key={manga.id} manga={manga} />)}</div> : <div className="catalog-state"><BookOpen size={32} /><h2>Nenhuma história encontrada</h2><p>Tente outro título ou ajuste os filtros.</p></div>}<nav className="manga-pagination" aria-label="Paginação dos mangás"><button className="button-secondary" disabled={page <= 1} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(page - 1)); setParams(next); }}>Anterior</button><span>Página {page}</span><button className="button-secondary" disabled={!catalog.data?.hasNextPage} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(page + 1)); setParams(next); }}>Próxima</button></nav></section> : home.data && <>
      {home.data.warnings.map((warning) => <p className="manga-notice" key={warning}>{warning}</p>)}
      <MangaRow title="Histórias que todo mundo está lendo" subtitle="Os mangás mais seguidos da comunidade MangaDex." items={home.data.popular} href="/manga?sort=popular" />
      <MangaRow title="Um capítulo atrás do outro" subtitle="Histórias em publicação para acompanhar." items={home.data.ongoing} href="/manga?status=ongoing&sort=popular" />
      <MangaRow title="Leituras inesquecíveis" subtitle="Os títulos mais bem avaliados pela comunidade." items={home.data.topRated} href="/manga?sort=rating" />
      <MangaRow title="Acabaram de ganhar um capítulo" subtitle="Atualizações mais recentes no catálogo." items={home.data.latest} href="/manga?sort=latest" />
    </>}
    <p className="manga-credit">Catálogo e capítulos via <a href="https://mangadex.org" target="_blank" rel="noopener noreferrer">MangaDex ↗</a>. Idiomas e disponibilidade variam por edição.</p>
  </main>;
}
