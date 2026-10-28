import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Film, Play, RefreshCw, Search, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CatalogAnime, StreamingEpisode } from '../../../shared/providers';
import { sourceSuffix } from '../../services/content';
import './watchEpisodes.css';

const GROUP_SIZE = 50;
const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

interface Props {
  episodes: StreamingEpisode[];
  currentEpisodeId: string;
  anime?: CatalogAnime;
  hints?: string;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onNavigate: (episode: StreamingEpisode) => void;
}

function EpisodeArtwork({ episode, anime }: { episode: StreamingEpisode; anime?: CatalogAnime }) {
  const [failed, setFailed] = useState<string[]>([]);
  const images = [episode.thumbnail, anime?.banner, anime?.poster].filter((value): value is string => !!value);
  const image = images.find(value => !failed.includes(value));
  return <span className="watch-episodes-artwork" aria-hidden="true">
    {image ? <img src={image} alt="" loading="lazy" onError={() => setFailed(previous => [...previous, image])} /> : <Film size={24} />}
    {episode.number != null && <span className="watch-episodes-number">{String(episode.number).padStart(2, '0')}</span>}
  </span>;
}

export function WatchEpisodeList({ episodes, currentEpisodeId, anime, hints, loading, error, onRetry, onNavigate }: Props) {
  const [filters, setFilters] = useState({ episodeId: currentEpisodeId, search: '', group: null as number | null, page: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  // Follow episode navigation without resetting filters when only loading state changes.
  const activeFilters = filters.episodeId === currentEpisodeId ? filters : { episodeId: currentEpisodeId, search: '', group: null, page: 0 };
  if (filters.episodeId !== currentEpisodeId) setFilters(activeFilters);
  const currentIndex = Math.max(0, episodes.findIndex(episode => episode.id === currentEpisodeId));
  const groups = Array.from({ length: Math.ceil(episodes.length / GROUP_SIZE) }, (_, index) => index);
  const selectedGroup = Math.min(activeFilters.group ?? Math.floor(currentIndex / GROUP_SIZE), Math.max(0, groups.length - 1));
  const query = searchable(activeFilters.search.trim());
  const matches = query ? episodes.filter(episode => String(episode.number) === query || searchable(episode.title).includes(query)) : [];
  const totalPages = Math.max(1, Math.ceil(matches.length / GROUP_SIZE));
  const currentPage = Math.min(activeFilters.page, totalPages - 1);
  const visible = query ? matches.slice(currentPage * GROUP_SIZE, (currentPage + 1) * GROUP_SIZE)
    : episodes.slice(selectedGroup * GROUP_SIZE, (selectedGroup + 1) * GROUP_SIZE);
  const suffix = hints ?? sourceSuffix({ titles: [anime?.title || '', anime?.titleOriginal || ''].filter(Boolean) });

  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current) return;
    // Scroll this list alone; scrollIntoView would also move the player off-screen.
    const offset = current.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    list.scrollTop = Math.max(0, offset - (list.clientHeight - current.clientHeight) / 2);
  }, [currentEpisodeId, selectedGroup, query, currentPage, episodes]);

  const clearFilters = () => setFilters({ episodeId: currentEpisodeId, search: '', group: null, page: 0 });
  const rangeLabel = (group: number) => {
    const first = episodes[group * GROUP_SIZE];
    const last = episodes[Math.min((group + 1) * GROUP_SIZE, episodes.length) - 1];
    return `${first?.number ?? group * GROUP_SIZE + 1}–${last?.number ?? Math.min((group + 1) * GROUP_SIZE, episodes.length)}`;
  };

  return <section className="watch-episodes" aria-labelledby="watch-episodes-heading" aria-busy={loading}>
    <header className="watch-episodes-heading"><h2 id="watch-episodes-heading">Episódios</h2>{episodes.length > 0 && <span>{episodes.length}</span>}</header>
    {error && <div className="watch-episodes-message" role="alert"><p>{error}</p><button type="button" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Tentar novamente</button></div>}
    {loading && !episodes.length ? <div className="watch-episodes-skeletons" aria-label="Carregando episódios">{Array.from({ length: 5 }, (_, index) => <div className="watch-episodes-skeleton" key={index}><span className="skeleton" /><div><span className="skeleton" /><span className="skeleton" /></div></div>)}</div>
      : episodes.length ? <>
        <div className="watch-episodes-filters">
          <label className="watch-episodes-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Buscar episódio no player" placeholder="Número ou título" value={activeFilters.search} onChange={event => setFilters({ ...activeFilters, search: event.target.value, page: 0 })} /></label>
          {groups.length > 1 && !query && <label className="watch-episodes-range"><span>Intervalo</span><select aria-label="Intervalo de episódios do player" value={selectedGroup} onChange={event => setFilters({ ...activeFilters, group: Number(event.target.value), page: 0 })}>{groups.map(group => <option key={group} value={group}>{rangeLabel(group)}</option>)}</select></label>}
        </div>
        <div className="watch-episodes-list" ref={listRef}>
          {visible.length ? visible.map(episode => {
            const current = episode.id === currentEpisodeId;
            const label = `${episode.number != null ? `episódio ${episode.number} — ` : ''}${episode.title}`;
            const content = <><EpisodeArtwork episode={episode} anime={anime} /><span className="watch-episodes-caption"><strong>{episode.title}</strong><span>{current ? <><Play size={11} fill="currentColor" aria-hidden="true" />Em reprodução</> : episode.available === false ? 'Indisponível' : episode.number != null ? `Episódio ${episode.number}` : 'Assistir episódio'}</span></span></>;
            return episode.available === false ? <div key={episode.id} className="watch-episodes-item is-unavailable" aria-disabled="true">{content}</div>
              : <Link key={episode.id} className={`watch-episodes-item${current ? ' is-current' : ''}`} to={`/watch/${encodeURIComponent(episode.id)}${suffix}`} state={{ anime, episode, autoPlay: true }} aria-label={`Assistir ${label}`} aria-current={current ? 'page' : undefined} onClick={event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onNavigate(episode);
              }}>{content}</Link>;
          }) : <div className="watch-episodes-empty" role="status"><SearchX size={23} aria-hidden="true" /><p>Nenhum episódio encontrado.</p><button type="button" onClick={clearFilters}>Limpar busca</button></div>}
        </div>
        {query && <div className="watch-episodes-results" aria-live="polite"><span>{matches.length} {matches.length === 1 ? 'resultado' : 'resultados'}</span>{totalPages > 1 && <nav aria-label="Páginas da busca de episódios"><button type="button" aria-label="Página anterior da busca de episódios" disabled={currentPage === 0} onClick={() => setFilters({ ...activeFilters, page: currentPage - 1 })}><ChevronLeft size={17} /></button><span>{currentPage + 1} de {totalPages}</span><button type="button" aria-label="Próxima página da busca de episódios" disabled={currentPage === totalPages - 1} onClick={() => setFilters({ ...activeFilters, page: currentPage + 1 })}><ChevronRight size={17} /></button></nav>}</div>}
      </> : !error && <div className="watch-episodes-empty"><Film size={26} aria-hidden="true" /><p>A lista de episódios ainda não está disponível.</p><button type="button" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Buscar episódios novamente</button></div>}
  </section>;
}
