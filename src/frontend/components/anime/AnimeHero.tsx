import { ArrowUpRight, Bookmark, Check, ChevronLeft, ChevronRight, Sparkles, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CatalogAnime } from '../../../shared/providers';
import { libraryService, useLibrary } from '../../services/library';
import { genreLabel } from '../filters/genreLabels';

export function AnimeHero({ anime, index = 0, total = 1, onSelect }: { anime: CatalogAnime; index?: number; total?: number; onSelect?: (index: number) => void }) {
  const { list } = useLibrary();
  const saved = list.some((entry) => entry.anime.id === anime.id);
  return (
    <section className="anime-hero" aria-label="Anime em destaque">
      <img key={anime.id} className={`hero-image ${anime.banner ? '' : 'hero-image-poster'}`} src={anime.banner || anime.poster} alt="" fetchPriority="high" />
      <div className="hero-gradient" />
      <div className="hero-content content-width">
        <div className="hero-eyebrow"><span className="live-dot" /><Sparkles size={13} /> EM DESTAQUE</div>
        <div className="hero-metadata">{anime.score != null && <span className="hero-score"><Star size={14} fill="currentColor" />{(anime.score / 10).toFixed(1)}</span>}{anime.year && <span>{anime.year}</span>}{anime.format && <span>{anime.format.replace('_', ' ')}</span>}{anime.episodeCount != null && <span>{anime.episodeCount} episódios</span>}</div>
        <h1>{anime.title}</h1>
        {anime.titleOriginal && anime.titleOriginal !== anime.title && <p className="hero-original">{anime.titleOriginal}</p>}
        {anime.description && <p className="hero-description">{anime.description}</p>}
        <div className="hero-genres">{anime.genres.slice(0, 3).map((genre) => <Link key={genre} to={`/explore?genre=${encodeURIComponent(genre)}`}>{genreLabel(genre)}</Link>)}</div>
        <div className="hero-buttons">
          <Link className="button-primary" to={`/anime/${anime.id}`}>Explorar anime <ArrowUpRight size={18} /></Link>
          <button className="button-secondary" onClick={() => libraryService.toggle(anime)} aria-pressed={saved}>{saved ? <Check size={17} /> : <Bookmark size={17} />}{saved ? 'Na minha lista' : 'Minha lista'}</button>
        </div>
      </div>
      {total > 1 && onSelect && <div className="hero-bottom content-width">
        <div className="hero-pagination"><span className="hero-page-current">{String(index + 1).padStart(2, '0')}</span><span className="hero-page-divider" /><span>{String(total).padStart(2, '0')}</span><div className="hero-dots">{Array.from({ length: total }, (_, position) => <button key={position} className={position === index ? 'active' : ''} aria-label={`Destaque ${position + 1}`} aria-current={position === index ? 'true' : undefined} onClick={() => onSelect(position)} />)}</div></div>
        <div className="hero-arrows"><button className="icon-button" aria-label="Destaque anterior" onClick={() => onSelect((index - 1 + total) % total)}><ChevronLeft size={20} /></button><button className="icon-button" aria-label="Próximo destaque" onClick={() => onSelect((index + 1) % total)}><ChevronRight size={20} /></button></div>
      </div>}
    </section>
  );
}
