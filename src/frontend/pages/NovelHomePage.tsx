import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, Search, Star } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { NovelLanguage, NovelProviderId, NovelQuery, NovelTitle } from '../../shared/novel';
import { isNativeNovelId, novelDetailsPath, novelLanguageLabel, novelProviderLabel, novelProviderLanguage, novelReaderPath } from '../../shared/novelIdentity';
import { genreLabel } from '../components/filters/genreLabels';
import { CatalogError, CatalogSkeleton } from '../components/ui/CatalogState';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { novelService } from '../services/novels';
import { novelLibrary, useNovelLibrary } from '../services/novelLibrary';
import { providerForNovelLanguage, readNovelSelection, resolveNovelSelection, saveNovelSelection } from '../services/novelSelection';
import './novel.css';

export function NovelCard({ novel, language }: { novel: NovelTitle; language?: string }) {
  const { saved } = useNovelLibrary();
  const exists = saved.some((entry) => entry.novel.id === novel.id);
  const path = `${novelDetailsPath(novel.id)}${!isNativeNovelId(novel.id) && !novel.isDemo && language ? `?${new URLSearchParams({ language })}` : ''}`;
  return <article className="anime-card group"><div className="anime-card-art">
    <Link to={path} aria-label={`Ver ${novel.title}`} className="block h-full"><span className="poster-fallback" aria-hidden="true"><BookOpen size={28} /><span>{novel.title}</span></span>{novel.poster && <img src={novel.poster} alt={novel.title} loading="lazy" className="card-poster-image" onError={(event) => { event.currentTarget.style.opacity = '0'; }} />}<span className="card-shade" /><span className="card-hover-action"><BookOpen size={22} /><span>Ver detalhes</span></span></Link>
    <div className="card-topline"><span className="format-badge">{novel.isDemo ? 'DEMONSTRAÇÃO' : 'NOVEL'}</span>{novel.score != null && <span className="score-badge"><Star size={11} fill="currentColor" />{(novel.score / 10).toFixed(1)}</span>}</div>
    <button className={`card-save ${exists ? 'is-saved' : ''}`} aria-label={`${exists ? 'Remover' : 'Salvar'} ${novel.title}`} aria-pressed={exists} onClick={() => novelLibrary.toggle(novel)}>{exists ? <Check size={17} /> : <Bookmark size={17} />}</button>
  </div><Link to={path} className="card-title">{novel.title}</Link><div className="card-meta">{novel.year && <span>{novel.year}</span>}{novel.volumes != null ? <span>{novel.volumes} volumes</span> : novel.genres[0] && <span>{genreLabel(novel.genres[0])}</span>}</div></article>;
}

export function NovelHomePage() {
  const [params, setParams] = useSearchParams();
  const [retry, setRetry] = useState(0);
  const savedSelection = readNovelSelection();
  const searchParam = params.get('q') ?? '';
  const [draft, setDraft] = useState({ source: searchParam, value: searchParam });
  if (draft.source !== searchParam) setDraft({ source: searchParam, value: searchParam });
  const rawPage = Number(params.get('page') ?? 1), rawYear = Number(params.get('year'));
  const { provider, language } = resolveNovelSelection(params, savedSelection);
  const native = provider !== 'anilist';
  useEffect(() => saveNovelSelection({ provider, language }), [provider, language]);
  const query: NovelQuery = {
    provider, language,
    search: searchParam || undefined, genre: params.get('genre') || undefined,
    sort: (native ? ['popular', 'newest'] : ['popular', 'score', 'trending', 'newest']).includes(params.get('sort') ?? '') ? params.get('sort') as NovelQuery['sort'] : 'popular',
    status: !native && ['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'].includes(params.get('status') ?? '') ? params.get('status')! : undefined,
    year: !native && Number.isInteger(rawYear) && rawYear >= 1900 && rawYear <= 2100 ? rawYear : undefined,
    page: Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 1000 ? rawPage : 1,
  };
  const key = JSON.stringify(query);
  const load = useCallback(() => novelService.search(JSON.parse(key) as NovelQuery), [key]);
  const loadGenres = useCallback(() => novelService.genres(provider), [provider]);
  const { data, loading, error } = useCatalogRequest(`novels:${key}:${retry}`, load);
  const { data: genres, error: genreError } = useCatalogRequest(`novel-genres:${provider}:${retry}`, loadGenres);
  const { history, storageError } = useNovelLibrary();
  const resume = history.filter((entry, index, list) => !entry.completed && list.findIndex((item) => item.novel.id === entry.novel.id) === index).slice(0, 4);
  const update = (field: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set('provider', provider); next.set('language', language);
    if (value) next.set(field, value); else next.delete(field);
    next.delete('page');
    if (field === 'provider' || field === 'language') {
      ['genre', 'year', 'status', 'sort'].forEach(key => next.delete(key));
      if (field === 'language') next.set('provider', providerForNovelLanguage(value as NovelLanguage));
      else next.set('language', novelProviderLanguage(value as NovelProviderId) ?? language);
    }
    setParams(next);
  };
  const page = (value: number) => { const next = new URLSearchParams(params); next.set('provider', provider); next.set('language', language); next.set('page', String(value)); setParams(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return <main id="main-content" className="page-shell content-width novel-home">
    <div className="page-heading"><span className="eyebrow">UM UNIVERSO EM PALAVRAS</span><h1>Histórias para ler no seu ritmo.</h1><p>Explore light novels, descubra novos mundos e organize sua próxima leitura.</p></div>
    <Link className="button-secondary mb-6" to={`/sources?${new URLSearchParams({ kind: 'novel', language })}`}>Consultar novel pelas fontes<ArrowRight size={16} /></Link>
    {!native && <aside className="novel-demo-callout"><span className="novel-demo-icon"><BookOpen size={26} /></span><div><span className="eyebrow">EXPLORE O LEITOR</span><h2>Uma pequena história, uma nova experiência.</h2><p>Teste fonte, espaçamento, temas e retomada com um texto original em português.</p></div><Link className="button-secondary" to="/novel/demo/read/1">Abrir demonstração<ArrowRight size={16} /></Link></aside>}
    {storageError && <p className="subtle-error" role="status">{storageError}</p>}
    {resume.length > 0 && <section className="novel-resume"><div className="section-heading"><div><h2>Continue a leitura</h2><p>Seu lugar está guardado neste navegador.</p></div></div><div className="novel-resume-grid">{resume.map((entry) => <Link className="novel-resume-card" key={entry.novel.id} to={novelReaderPath(entry.novel.id, entry.chapterId)}><BookOpen size={22} /><div><strong>{entry.novel.title}</strong><span>{entry.chapterTitle} · {Math.round((entry.position + 1) / entry.paragraphCount * 100)}%</span></div><ArrowRight size={17} /></Link>)}</div></section>}
    <div className="section-heading"><div><h2>{query.search ? `Resultados para “${query.search}”` : 'Descubra sua próxima leitura'}</h2><p>{native ? `Catálogo e capítulos em ${novelLanguageLabel(novelProviderLanguage(provider)!).toLowerCase()} por ${novelProviderLabel(provider)}. Escolha uma obra para começar a ler.` : 'Metadados do AniList. O idioma selecionado será aplicado aos capítulos das fontes conectadas.'}</p></div></div>
    <form role="search" className="explore-search novel-search" onSubmit={(event) => { event.preventDefault(); update('q', draft.value.trim()); }}><Search size={18} /><input type="search" aria-label="Pesquisar light novels" placeholder="Buscar pelo nome da novel" value={draft.source === searchParam ? draft.value : searchParam} onChange={(event) => setDraft({ source: searchParam, value: event.target.value })} /><button className="button-primary button-sm">Buscar</button></form>
    <div className="novel-filter-grid">
      <label className="novel-provider-filter">Provedor<select value={provider} onChange={event => update('provider', event.target.value)}><option value="novelmania">Novel Mania · PT-BR</option><option value="wuxiaworldsite">WuxiaWorld.site · Inglês</option><option value="anilist">AniList · catálogo</option></select></label>
      <label>Idioma<select value={language} onChange={event => update('language', event.target.value)}><option value="pt-br">Português brasileiro</option><option value="en">Inglês</option></select></label>
      <label>Gênero<select value={query.genre ?? ''} onChange={(event) => update('genre', event.target.value)}><option value="">Todos os gêneros</option>{genres?.map((genre) => <option key={genre} value={genre}>{genreLabel(genre)}</option>)}</select></label>
      <label>Ordenar por<select value={query.sort} onChange={(event) => update('sort', event.target.value)}><option value="popular">Populares</option>{!native && <><option value="score">Mais bem avaliadas</option><option value="trending">Em alta</option></>}<option value="newest">Mais recentes</option></select></label>
      {!native && <><label>Status<select value={query.status ?? ''} onChange={(event) => update('status', event.target.value)}><option value="">Todos</option><option value="RELEASING">Em publicação</option><option value="FINISHED">Concluído</option><option value="NOT_YET_RELEASED">Em breve</option><option value="HIATUS">Em pausa</option><option value="CANCELLED">Cancelado</option></select></label>
      <label>Ano<input type="number" min={1900} max={2100} placeholder="Qualquer ano" value={params.get('year') ?? ''} onChange={(event) => update('year', event.target.value)} /></label></>}
    </div>
    {genreError && <p className="subtle-error" role="status">Não foi possível carregar os gêneros. <button className="text-link" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></p>}
    <div className="results-heading" aria-live="polite"><span>{loading ? 'Encontrando histórias...' : `${data?.items.length ?? 0} novels nesta página`}</span>{params.size > 0 && <button className="clear-filters" onClick={() => setParams({ provider, language })}>Limpar busca e filtros</button>}</div>
    {loading ? <CatalogSkeleton /> : error ? <CatalogError message={error} onRetry={() => setRetry((value) => value + 1)} /> : !data?.items.length ? <div className="catalog-state"><BookOpen size={30} /><h2>Nenhuma novel encontrada</h2><p>{data?.message || 'Experimente outro título ou ajuste os filtros.'}</p><button className="button-secondary" onClick={() => setParams({ provider, language })}>Explorar novels</button></div> : <><div className="catalog-grid">{data.items.map((novel) => <NovelCard key={novel.id} novel={novel} language={language} />)}</div><nav className="pagination" aria-label="Páginas de novels"><button className="button-secondary" disabled={data.page <= 1} onClick={() => page(data.page - 1)}><ArrowLeft size={16} />Anterior</button><span>Página <strong>{data.page}</strong></span><button className="button-secondary" disabled={!data.hasNextPage} onClick={() => page(data.page + 1)}>Próxima<ArrowRight size={16} /></button></nav></>}
  </main>;
}
