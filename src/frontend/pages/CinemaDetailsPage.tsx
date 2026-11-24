import { useCallback, useState } from 'react';
import { ArrowLeft, Film, Play } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { CinemaType } from '../../shared/cinema';
import { cinemaService, cinemaWatchPath } from '../services/cinema';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { CatalogError } from '../components/ui/CatalogState';

export function CinemaDetailsPage() {
  const { type = '', imdb = '' } = useParams();
  if (!['movie', 'series'].includes(type) || !/^tt\d{5,12}$/.test(imdb)) return <main id="main-content" className="page-shell content-width"><div className="catalog-state"><h1>Título inválido</h1><p>Escolha um filme ou série no catálogo.</p><Link className="button-secondary" to="/cinema">Voltar ao catálogo</Link></div></main>;
  return <CinemaDetails key={`${type}:${imdb}`} type={type as CinemaType} id={imdb} />;
}

function CinemaDetails({ type, id }: { type: CinemaType; id: string }) {
  const [params, setParams] = useSearchParams();
  const [retry, setRetry] = useState(0);
  const [checkedAt] = useState(() => Date.now());
  const loader = useCallback(() => cinemaService.details(type, id), [type, id]);
  const { data, loading, error } = useCatalogRequest(`cinema-details:${type}:${id}:${retry}`, loader);
  const watchCinema = data ? { id: data.id, type: data.type, title: data.title, poster: data.poster,
    background: data.background, year: data.year, genres: data.genres, rating: data.rating, runtime: data.runtime } : undefined;
  const catalogParams = new URLSearchParams({ type });
  for (const name of ['q', 'page', 'provider', 'region']) if (params.get(name)) catalogParams.set(name, params.get(name)!);
  const seasons = [...new Set(data?.episodes.map(episode => episode.season) || [])].sort((a, b) => a - b);
  const selected = params.has('season') ? Number(params.get('season')) : undefined;
  const season = selected !== undefined && seasons.includes(selected) ? selected : seasons.find(number => number > 0) ?? seasons[0];
  const seasonEpisodes = data?.episodes.filter(episode => episode.season === season) || [];
  const rawEpisodePage = Number(params.get('episodesPage'));
  const totalPages = Math.max(1, Math.ceil(seasonEpisodes.length / 50));
  const episodePage = Number.isInteger(rawEpisodePage) && rawEpisodePage >= 1 && rawEpisodePage <= totalPages ? rawEpisodePage : 1;
  const episodes = seasonEpisodes.slice((episodePage - 1) * 50, episodePage * 50);
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); if (key === 'season') next.delete('episodesPage'); setParams(next); };
  return <main id="main-content" className="page-shell content-width">
    <Link className="button-secondary mb-7" to={`/cinema?${catalogParams}`}><ArrowLeft size={16} aria-hidden="true" />Voltar a filmes e séries</Link>
    {loading ? <div role="status" className="min-h-72 py-10 text-slate-300">Carregando informações do título…</div> : error ? <CatalogError message={error} onRetry={() => setRetry(value => value + 1)} /> : data && <>
      <article className="surface-card relative overflow-hidden">
        {data.background && <img className="absolute inset-0 h-full w-full object-cover opacity-10" src={data.background} alt="" />}
        <div className="relative flex flex-col gap-7 p-5 sm:flex-row sm:p-8">
          <div className="aspect-[2/3] w-36 shrink-0 overflow-hidden rounded-lg bg-white/5 sm:w-44">{data.poster ? <img className="h-full w-full object-cover" src={data.poster} alt={`Pôster de ${data.title}`} /> : <div className="flex h-full items-center justify-center text-slate-500"><Film size={36} aria-hidden="true" /></div>}</div>
          <div className="min-w-0 self-center"><p className="mb-3 text-sm text-teal-300">{type === 'movie' ? 'Filme' : 'Série'}{data.year ? ` · ${data.year}` : ''}</p><h1 className="break-words text-3xl font-bold leading-tight sm:text-4xl">{data.title}</h1><p className="mt-4 text-sm text-slate-300">{[...data.genres, data.runtime, data.rating !== undefined ? `IMDb ${data.rating.toLocaleString('pt-BR')}` : ''].filter(Boolean).join(' · ')}</p>
            {data.description && <p className="mt-5 max-w-3xl text-sm leading-relaxed text-slate-300">{data.description}</p>}
            {type === 'movie' && <Link className="button-primary mt-6" to={cinemaWatchPath(type, id, data.title, undefined, undefined, params.toString())} state={{ cinema: watchCinema }}><Play size={17} aria-hidden="true" />Consultar fontes e assistir</Link>}
            <p className="mt-5 text-xs leading-relaxed text-slate-400">Vídeo, áudio e legendas serão verificados nas fontes ao abrir o player.</p>
          </div>
        </div>
      </article>
      {type === 'series' && <section className="mt-9" aria-labelledby="cinema-episodes-title"><div className="mb-5 flex flex-wrap items-end justify-between gap-5"><div><h2 id="cinema-episodes-title" className="text-2xl font-semibold">Episódios</h2><p className="mt-2 text-sm text-slate-400">Numeração da edição IMDb. A disponibilidade de vídeo depende das fontes.</p></div>{seasons.length > 0 && <label className="grid gap-2 text-sm text-slate-300">Temporada<select className="field-control" value={season} onChange={event => update('season', event.target.value)}>{seasons.map(number => <option key={number} value={number}>{number === 0 ? 'Especiais' : `Temporada ${number}`}</option>)}</select></label>}</div>
        {!episodes.length ? <p className="surface-card p-5 text-sm text-slate-400">O catálogo não forneceu episódios para esta série. <Link className="text-teal-300 underline" to={`/sources?kind=stremio&imdb=${id}&title=${encodeURIComponent(data.title)}`}>Consultar pela numeração IMDb</Link>.</p> : <div className="grid gap-3 md:grid-cols-2">{episodes.map(episode => {
          const future = !!episode.released && new Date(episode.released).getTime() > checkedAt;
          const content = <><div className="min-w-0 flex-1"><strong className="block text-sm text-slate-100">{episode.episode}. {episode.title}</strong><span className="mt-2 block text-xs text-slate-400">{future ? 'Ainda não estreou' : `Temporada ${episode.season} · consultar fontes`}</span></div>{!future && <Play className="shrink-0 text-teal-300" size={17} aria-hidden="true" />}</>;
          const className = 'flex min-h-20 min-w-0 items-center gap-4 rounded-xl border border-white/10 p-4';
          return future ? <div key={episode.id} className={`${className} opacity-60`} aria-disabled="true">{content}</div> : <Link key={episode.id} className={`${className} hover:border-teal-400/40`} to={cinemaWatchPath(type, id, data.title, episode.season, episode.episode, params.toString())} state={{ cinema: watchCinema, episode: { id: `stremio:all:${id}:${episode.season}:${episode.episode}`, number: episode.episode, title: episode.title, thumbnail: episode.thumbnail } }} aria-label={`Assistir temporada ${episode.season}, episódio ${episode.episode}: ${episode.title}`}>{content}</Link>;
        })}</div>}
        {totalPages > 1 && <nav className="pagination flex-wrap" aria-label="Páginas de episódios"><button className="button-secondary" disabled={episodePage === 1} onClick={() => update('episodesPage', String(episodePage - 1))}>Anterior</button><span>{episodePage} de {totalPages}</span><button className="button-secondary" disabled={episodePage === totalPages} onClick={() => update('episodesPage', String(episodePage + 1))}>Próxima</button></nav>}
      </section>}
      <p className="mt-9 text-xs leading-relaxed text-slate-500">Informações do Cinemeta. Sinopse e títulos de episódios seguem o idioma da fonte. ID IMDb: {data.id}.</p>
    </>}
  </main>;
}
