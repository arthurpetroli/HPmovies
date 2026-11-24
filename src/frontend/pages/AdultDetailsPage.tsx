import { useCallback, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Film, Play, RefreshCw, Star } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { CatalogAnime, StreamingEpisode } from '../../shared/providers';
import { AdultCard } from '../components/adult/AdultCard';
import { AdultGate } from '../components/adult/AdultGate';
import { AnimeRowCarousel } from '../components/anime/AnimeRowCarousel';
import { CatalogError } from '../components/ui/CatalogState';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { adultService } from '../services/adult';
import '../animeDetails.css';
import '../components/anime/animeEpisodes.css';
import '../adult.css';

const statusLabels: Record<string, string> = { RELEASING: 'Em exibição', FINISHED: 'Concluído', NOT_YET_RELEASED: 'Em breve', CANCELLED: 'Cancelado', HIATUS: 'Em pausa' };
const formatLabels: Record<string, string> = { TV: 'Série de TV', TV_SHORT: 'Série curta', MOVIE: 'Filme', SPECIAL: 'Especial', OVA: 'OVA', ONA: 'ONA' };
const relationLabels: Record<string, string> = { SEQUEL: 'Continuação', PREQUEL: 'Anterior', SIDE_STORY: 'História paralela', ALTERNATIVE: 'Versão alternativa', SPIN_OFF: 'Spin-off', PARENT: 'História principal', SUMMARY: 'Resumo', COMPILATION: 'Compilação', OTHER: 'Relacionado' };
const card = (anime: CatalogAnime) => <AdultCard anime={anime} />;

export function AdultDetailsPage() {
  return <AdultGate><AdultDetails /></AdultGate>;
}

function Artwork({ anime, backdrop = false }: { anime: CatalogAnime; backdrop?: boolean }) {
  const [failed, setFailed] = useState<string[]>([]);
  const image = (backdrop ? [anime.banner, anime.poster] : [anime.poster]).find((source): source is string => !!source && !failed.includes(source));
  return image ? <img src={image} alt={backdrop ? '' : `Capa de ${anime.title}`} onError={() => setFailed(value => [...value, image])} />
    : <div className="anime-details-artwork-empty"><Film size={42} aria-hidden="true" /><span>{backdrop ? '' : anime.title}</span></div>;
}

function Episodes({ anime, episodes, loading, error, message, onRetry }: { anime: CatalogAnime; episodes: StreamingEpisode[]; loading: boolean; error: string; message?: string; onRetry: () => void }) {
  return <section className="anime-episodes" aria-labelledby="adult-episodes-heading" id="episodios">
    <div className="anime-episodes-heading"><div><h2 id="adult-episodes-heading">Episódios</h2><p>{loading ? 'Consultando as fontes conectadas…' : episodes.length ? `${episodes.length} ${episodes.length === 1 ? 'episódio' : 'episódios'}` : 'Nenhum episódio encontrado.'}</p></div></div>
    {message && !loading && episodes.length > 0 && <p className="adult-episodes-note" role="status">{message}</p>}
    {loading ? <div className="anime-episode-grid" aria-busy="true" aria-label="Carregando episódios">{Array.from({ length: 4 }, (_, index) => <div className="anime-episode-skeleton skeleton" key={index} />)}</div>
      : episodes.length ? <div className="anime-episode-grid" aria-label="Lista de episódios">{episodes.map(episode => {
        const content = <>{episode.thumbnail ? <img className="anime-episode-thumbnail" src={episode.thumbnail} alt="" loading="lazy" /> : <span className="anime-episode-number">{String(episode.number ?? 1).padStart(2, '0')}</span>}<div className="anime-episode-caption">{episode.title !== `Episódio ${episode.number}` && <span>Episódio {episode.number}</span>}<h3>{episode.title}</h3>{episode.available === false && <small>Indisponível no momento</small>}</div><Play size={18} aria-hidden="true" /></>;
        return episode.available === false ? <div className="anime-episode-card is-unavailable" key={episode.id} aria-disabled="true">{content}</div>
          : <Link className="anime-episode-card" key={episode.id} to={`/adult/watch/${encodeURIComponent(anime.id)}/${episode.number}`} aria-label={`Assistir episódio ${episode.number} — ${episode.title}`}>{content}</Link>;
      })}</div>
      : <div className="anime-episodes-empty" role={error ? 'alert' : 'status'}><Film size={27} /><h3>{error ? 'Não foi possível consultar as fontes' : 'Nenhum episódio encontrado'}</h3><p>{error || message || 'As fontes conectadas não retornaram episódios para este título.'}</p><button className="button-secondary" onClick={onRetry}><RefreshCw size={15} />Consultar novamente</button></div>}
  </section>;
}

function AdultDetails() {
  const { animeId = '' } = useParams();
  const [retry, setRetry] = useState(0);
  const [episodeRetry, setEpisodeRetry] = useState(0);
  const [expanded, setExpanded] = useState('');
  const loader = useCallback(() => adultService.details(animeId), [animeId]);
  const { data: anime, loading, error } = useCatalogRequest(`adult-details:${animeId}:${retry}`, loader);
  const ready = !!anime;
  const episodesLoader = useCallback(() => ready ? adultService.episodes(animeId) : Promise.resolve(null), [ready, animeId]);
  const episodes = useCatalogRequest(`adult-episodes:${animeId}:${ready}:${episodeRetry}`, episodesLoader);
  if (loading) return <main id="main-content" className="anime-details" aria-busy="true" aria-label="Carregando detalhes"><div className="anime-details-ambient skeleton" /><div className="anime-details-container"><div className="anime-details-loading"><div className="anime-details-cover skeleton" /><div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-meta" /><div className="skeleton skeleton-description" /></div></div></div></main>;
  if (error || !anime) return <main id="main-content" className="page-shell content-width"><Link className="back-link" to="/adult"><ArrowLeft size={16} />Voltar ao conteúdo adulto</Link><CatalogError message={error} onRetry={() => setRetry(value => value + 1)} /></main>;
  const list = episodes.data?.episodes ?? [];
  const first = list.find(episode => episode.available !== false);
  const relations = (anime.relations ?? []).filter(relation => relation.anime.id !== anime.id);
  const isExpanded = expanded === animeId;
  const facts = [
    ['Formato', anime.format ? formatLabels[anime.format] || anime.format.replaceAll('_', ' ') : 'Não informado'],
    ['Status', anime.status ? statusLabels[anime.status] || anime.status : 'Não informado'],
    ['Episódios', anime.episodeCount != null ? `${anime.episodeCount} no catálogo` : 'Não informado'],
    ['Duração', anime.duration != null ? `${anime.duration} min por episódio` : 'Não informada'],
    ['Ano', anime.year ? String(anime.year) : 'Não informado'],
    ['Estúdios', anime.studios?.length ? anime.studios.join(', ') : 'Não informados'],
    ['Título original', anime.titleOriginal || 'Não informado'],
    ...(anime.synonyms?.length ? [['Também conhecido como', anime.synonyms.slice(0, 4).join(' · ')]] : []),
  ];
  return <main id="main-content" className="anime-details">
    <div className="anime-details-ambient" aria-hidden="true"><Artwork key={`background-${anime.id}`} anime={anime} backdrop /></div>
    <div className="anime-details-container">
      <Link to="/adult" className="anime-details-back"><ArrowLeft size={16} aria-hidden="true" />Voltar ao conteúdo adulto</Link>
      <div className="anime-details-grid">
        <aside className="anime-details-sidebar" aria-label="Capa e informações">
          <div className="anime-details-cover"><Artwork key={anime.id} anime={anime} /></div>
          <div className="anime-details-actions has-no-watch">
            <Link className="anime-details-watch" to={`/adult/watch/${encodeURIComponent(anime.id)}/${first?.number ?? 1}`}><Play size={18} fill={first ? 'currentColor' : 'none'} aria-hidden="true" />{first ? 'Assistir agora' : 'Consultar fontes e assistir'}</Link>
          </div>
          <section className="anime-details-facts" aria-labelledby="adult-facts-heading"><h2 id="adult-facts-heading">Informações</h2><dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
        </aside>
        <div className="anime-details-main">
          <header className="anime-details-heading">
            <div className="anime-details-topline"><span>18+</span>{anime.format && <span>{formatLabels[anime.format] || anime.format}</span>}{anime.year && <span>{anime.year}</span>}</div>
            <h1>{anime.title}</h1>
            {anime.titleOriginal && anime.titleOriginal !== anime.title && <p className="anime-details-original">{anime.titleOriginal}</p>}
            {anime.score != null && <p className="anime-details-rating"><Star size={17} fill="currentColor" aria-hidden="true" /><strong>{(anime.score / 10).toFixed(1)}</strong><span>/ 10 no AniList</span></p>}
            {anime.genres.length > 0 && <div className="anime-details-genres" aria-label="Gêneros">{anime.genres.map(genre => <span key={genre}>{genre}</span>)}</div>}
          </header>
          <div className="anime-details-body">
            <section className="anime-details-overview" aria-labelledby="adult-overview-heading" id="visao-geral">
              <div className="anime-details-section-title"><h2 id="adult-overview-heading">Sinopse</h2></div>
              <p className={`anime-details-synopsis${isExpanded ? ' is-expanded' : ''}`}>{anime.description?.replace(/\n{3,}/g, '\n\n') || 'A sinopse deste título ainda não está disponível no catálogo.'}</p>
              {anime.description && anime.description.length > 400 && <button type="button" className="anime-details-expand" onClick={() => setExpanded(isExpanded ? '' : animeId)} aria-expanded={isExpanded}>{isExpanded ? 'Ler menos' : 'Ler sinopse completa'}</button>}
            </section>
            <Episodes anime={anime} episodes={list} loading={episodes.loading} error={episodes.error} message={episodes.data?.message} onRetry={() => setEpisodeRetry(value => value + 1)} />
            {relations.length > 0 && <section className="anime-details-relations" aria-labelledby="adult-relations-heading"><div className="anime-details-section-title"><h2 id="adult-relations-heading">Relacionados</h2></div><div className="relations-carousel scrollbar-hide">{relations.map(({ relation, anime: related }) => <Link key={`${relation}-${related.id}`} className="relation-card" to={`/adult/anime/${related.id}`}><img src={related.poster} alt="" loading="lazy" /><div><span>{relationLabels[relation] || relation}</span><h3>{related.title}</h3><small>{[related.year, related.format?.replace('_', ' ')].filter(Boolean).join(' · ')}</small></div><ArrowUpRight size={17} aria-hidden="true" /></Link>)}</div></section>}
            {!!anime.recommendations?.length && <AnimeRowCarousel title="Recomendações" subtitle="Sugestões da comunidade do AniList." animes={anime.recommendations} renderItem={card} />}
          </div>
        </div>
      </div>
    </div>
  </main>;
}
