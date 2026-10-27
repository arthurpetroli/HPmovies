import { useState } from 'react';
import { ChevronLeft, ChevronRight, Film, Play, RefreshCw, Search, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CatalogAnime, StreamingAvailability } from '../../../shared/providers';
import { sourceSuffix } from '../../services/content';
import './animeEpisodes.css';

const PAGE_SIZE = 24;
const RANGE_SIZE = 50;
const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

interface Props {
  anime: CatalogAnime;
  availability: StreamingAvailability | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}

export function AnimeEpisodeList({ anime, availability, loading, error, onRetry }: Props) {
  const [search, setSearch] = useState('');
  const [range, setRange] = useState('all');
  const [page, setPage] = useState(1);
  const episodes = availability?.episodes ?? [];
  const query = searchable(search.trim());
  const ranges = [...new Set(episodes.flatMap(episode => episode.number != null && episode.number >= 1
    ? [Math.floor((episode.number - 1) / RANGE_SIZE)] : []))].sort((a, b) => a - b);
  const filtered = episodes.filter(episode => (!query || String(episode.number) === query || searchable(episode.title).includes(query))
    && (range === 'all' || (episode.number != null && Math.floor((episode.number - 1) / RANGE_SIZE) === Number(range))));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const suffix = sourceSuffix({ titles: [anime.title, anime.titleOriginal || ''].filter(Boolean) });
  const failed = !!error || availability?.state === 'connection_error';

  return <section className="anime-episodes" aria-labelledby="anime-episodes-heading" id="episodios">
    <div className="anime-episodes-heading">
      <div><h2 id="anime-episodes-heading">Episódios</h2><p>{loading ? 'Buscando episódios deste anime…' : episodes.length ? `${episodes.length} ${episodes.length === 1 ? 'episódio' : 'episódios'}` : 'Escolha um episódio para assistir.'}</p></div>
    </div>
    {loading ? <div className="anime-episode-grid" aria-busy="true" aria-label="Carregando episódios">{Array.from({ length: 6 }, (_, index) => <div className="anime-episode-skeleton skeleton" key={index} />)}</div>
      : episodes.length ? <>
        {(episodes.length > PAGE_SIZE || ranges.length > 1) && <div className="anime-episode-filters">
          <label className="anime-episode-search"><Search size={17} /><input type="search" aria-label="Buscar episódio por número ou título" placeholder="Buscar número ou título do episódio" value={search} onChange={event => { setSearch(event.target.value); setRange('all'); setPage(1); }} /></label>
          {ranges.length > 1 && <label className="anime-episode-range"><span>Intervalo</span><select aria-label="Intervalo de episódios" value={range} onChange={event => { setRange(event.target.value); setSearch(''); setPage(1); }}><option value="all">Todos os episódios</option>{ranges.map(value => <option key={value} value={value}>{value * RANGE_SIZE + 1}–{(value + 1) * RANGE_SIZE}</option>)}</select></label>}
        </div>}
        {visible.length ? <div className="anime-episode-grid" aria-label="Lista de episódios">{visible.map(episode => {
          const content = <>{episode.thumbnail ? <img className="anime-episode-thumbnail" src={episode.thumbnail} alt="" loading="lazy" /> : <span className="anime-episode-number">{episode.number != null ? String(episode.number).padStart(2, '0') : <Film size={20} />}</span>}<div className="anime-episode-caption">{episode.number != null && <span>Episódio {episode.number}</span>}<h3>{episode.title}</h3>{episode.available === false ? <small>Indisponível no momento</small> : episode.duration != null && <small>{Math.round(episode.duration / 60)} min</small>}</div><Play size={18} aria-hidden="true" /></>;
          return episode.available === false ? <div className="anime-episode-card is-unavailable" key={episode.id} aria-disabled="true">{content}</div>
            : <Link className="anime-episode-card" key={episode.id} to={`/watch/${encodeURIComponent(episode.id)}${suffix}`} state={{ anime }} aria-label={`Assistir ${episode.number != null ? `episódio ${episode.number} — ` : ''}${episode.title}`}>{content}</Link>;
        })}</div> : <div className="anime-episodes-empty" role="status"><SearchX size={24} /><h3>Nenhum episódio encontrado nesta busca</h3><p>Tente outro número ou parte do título.</p><button className="text-link" onClick={() => { setSearch(''); setRange('all'); setPage(1); }}>Limpar busca</button></div>}
        {totalPages > 1 && <nav className="anime-episode-pagination" aria-label="Paginação dos episódios"><button className="button-secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Página anterior de episódios"><ChevronLeft size={16} />Anterior</button><span aria-live="polite">{currentPage} de {totalPages}</span><button className="button-secondary" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} aria-label="Próxima página de episódios">Próxima<ChevronRight size={16} /></button></nav>}
      </> : <div className="anime-episodes-empty" role={failed ? 'alert' : 'status'}><Film size={27} /><h3>{failed ? 'Não foi possível carregar os episódios' : 'Nenhum episódio encontrado para este anime'}</h3><p>{error || availability?.message || 'Os episódios deste título ainda não foram encontrados nas fontes conectadas.'}</p><button className="button-secondary" onClick={onRetry}><RefreshCw size={15} />Buscar episódios novamente</button></div>}
  </section>;
}
