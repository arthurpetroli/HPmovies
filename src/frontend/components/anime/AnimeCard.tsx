import { Bookmark, Check, Film, Info, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CatalogAnime } from '../../../shared/providers';
import { libraryService, useLibrary } from '../../services/library';

export function AnimeCard({ anime, rank }: { anime: CatalogAnime; rank?: number }) {
  const { list } = useLibrary();
  const saved = list.some((entry) => entry.anime.id === anime.id);
  return (
    <article className="anime-card group">
      <div className="anime-card-art">
        <Link to={`/anime/${anime.id}`} aria-label={`Ver ${anime.title}`} className="block h-full">
          <span className="poster-fallback" aria-hidden="true"><Film size={28} /><span>{anime.title}</span></span>
          {anime.poster && <img src={anime.poster} alt={anime.title} loading="lazy" className="card-poster-image" onError={(event) => { event.currentTarget.style.opacity = '0'; }} />}
          <span className="card-shade" />
          <span className="card-hover-action"><Info size={22} /><span>Ver detalhes</span></span>
        </Link>
        <div className="card-topline">
          {anime.format && <span className="format-badge">{anime.format.replace('_', ' ')}</span>}
          {anime.score != null && <span className="score-badge"><Star size={11} fill="currentColor" />{(anime.score / 10).toFixed(1)}</span>}
        </div>
        <button onClick={() => libraryService.toggle(anime)} className={`card-save ${saved ? 'is-saved' : ''}`} aria-label={saved ? `Remover ${anime.title} da lista` : `Adicionar ${anime.title} à lista`} title={saved ? 'Na minha lista' : 'Adicionar à minha lista'} aria-pressed={saved}>
          {saved ? <Check size={17} /> : <Bookmark size={17} />}
        </button>
        {rank != null && <span className="card-rank" aria-label={`Posição ${rank}`}>{String(rank).padStart(2, '0')}</span>}
      </div>
      <Link to={`/anime/${anime.id}`} className="card-title">{anime.title}</Link>
      <div className="card-meta">{anime.year && <span>{anime.year}</span>}{anime.episodeCount != null && <><span className="meta-dot" /><span>{anime.episodeCount} episódios</span></>}{!anime.episodeCount && anime.genres[0] && <span>{anime.genres[0]}</span>}</div>
    </article>
  );
}
