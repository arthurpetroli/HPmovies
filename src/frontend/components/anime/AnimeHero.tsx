import { useRef, useState } from 'react';
import type { CSSProperties, TouchEvent } from 'react';
import { Bookmark, Check, ChevronLeft, ChevronRight, Flame, Play, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CatalogAnime } from '../../../shared/providers';
import { libraryService, useLibrary } from '../../services/library';
import { genreLabel } from '../filters/genreLabels';
import { AnimeWatchLink } from './AnimeWatchLink';
import './animeHero.css';

const formatLabels: Record<string, string> = {
  TV: 'Série', TV_SHORT: 'Série curta', MOVIE: 'Filme', SPECIAL: 'Especial',
  OVA: 'OVA', ONA: 'ONA', MUSIC: 'Música',
};

/**
 * A arte nítida respeita a resolução real do banner (sem ampliar além de 1,5×).
 * A luz ambiente ao redor vem da cópia desfocada da página inicial (.home-ambient).
 */
function HeroArtwork({ anime }: { anime: CatalogAnime }) {
  const [bannerFailed, setBannerFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [artSize, setArtSize] = useState<{ width: number; height: number }>();
  const isPoster = !anime.banner || bannerFailed;
  const source = isPoster ? anime.poster : anime.banner;
  const usable = source && !posterFailed ? source : undefined;

  const artworkStyle = !isPoster && artSize ? {
    '--hero-art-max-width': `${artSize.width * 1.5}px`,
    '--hero-art-max-height': `${artSize.height * 1.5}px`,
  } as CSSProperties : undefined;

  return <>
    <div className={`discover-hero__media${isPoster ? ' discover-hero__media--poster' : ''}`} style={artworkStyle} aria-hidden="true">
      {usable && <img
        className="discover-hero__artwork"
        src={usable}
        alt=""
        fetchPriority="high"
        decoding="async"
        onLoad={(event) => setArtSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => {
          if (!isPoster) setBannerFailed(true);
          else setPosterFailed(true);
        }}
      />}
    </div>
  </>;
}

export function AnimeHero({ anime, index = 0, total = 1, onSelect, items, badge = 'Em destaque' }: { anime: CatalogAnime; index?: number; total?: number; onSelect?: (index: number) => void; items?: CatalogAnime[]; badge?: string }) {
  const { list } = useLibrary();
  const saved = list.some((entry) => entry.anime.id === anime.id);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const endTouch = (event: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || !onSelect || total < 2) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    onSelect(dx < 0 ? (index + 1) % total : (index - 1 + total) % total);
  };

  return (
    <section
      className={`anime-hero discover-hero${anime.title.length > 90 ? ' discover-hero--long-title' : anime.title.length > 45 ? ' discover-hero--compact-title' : ''}`}
      aria-label="Anime em destaque"
      aria-roledescription="carrossel"
      onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }}
      onTouchEnd={endTouch}
    >
      <HeroArtwork key={anime.id} anime={anime} />
      <div className="discover-hero__scrim" aria-hidden="true" />
      <div className="discover-hero__grain" aria-hidden="true" />
      <div className="discover-hero__content content-width">
        <div className="discover-hero__copy" aria-live="polite" aria-atomic="true">
          <div className="discover-hero__slide" key={anime.id}>
            <span className="discover-hero__eyebrow"><Flame size={15} aria-hidden="true" />{badge}</span>
            <h1>{anime.title}</h1>
            {anime.titleOriginal && anime.titleOriginal !== anime.title && <p className="discover-hero__original">{anime.titleOriginal}</p>}
            <div className="discover-hero__metadata">
              {anime.score != null && <span className="discover-hero__rating" aria-label={`Nota ${(anime.score / 10).toFixed(1)} de 10 no AniList`} title="Avaliação no AniList"><Star size={14} fill="currentColor" aria-hidden="true" /><strong>{(anime.score / 10).toFixed(1)}</strong><span>/ 10</span></span>}
              {anime.year && <span>{anime.year}</span>}
              {anime.format && <span>{formatLabels[anime.format] || anime.format.replaceAll('_', ' ')}</span>}
              {anime.episodeCount != null && <span>{anime.episodeCount} {anime.episodeCount === 1 ? 'episódio' : 'episódios'}</span>}
            </div>
            {anime.description && <p className="discover-hero__description">{anime.description}</p>}
          </div>
        </div>
        {anime.genres.length > 0 && <div className="discover-hero__genres" aria-label="Gêneros">{anime.genres.slice(0, 3).map((genre) => <Link key={genre} to={`/explore?genre=${encodeURIComponent(genre)}`}>{genreLabel(genre)}</Link>)}</div>}
        <div className="discover-hero__actions">
          <AnimeWatchLink anime={anime} className="button-primary discover-hero__primary"><Play size={18} fill="currentColor" aria-hidden="true" />Assistir agora</AnimeWatchLink>
          <button
            className={`discover-hero__save${saved ? ' is-saved' : ''}`}
            onClick={() => libraryService.toggle(anime)}
            aria-pressed={saved}
            aria-label={saved ? 'Na minha lista' : 'Adicionar à minha lista'}
            title={saved ? 'Remover da minha lista' : 'Adicionar à minha lista'}
          >{saved ? <Check size={22} aria-hidden="true" /> : <Bookmark size={22} aria-hidden="true" />}</button>
        </div>
      </div>
      {total > 1 && onSelect && <div className="discover-hero__navigation content-width" role="group" aria-label="Navegação dos destaques">
        <div className="discover-hero__indicators">{Array.from({ length: total }, (_, position) => {
          const item = items?.[position];
          return <button
            key={position}
            className={position === index ? 'is-active' : ''}
            aria-label={`Destaque ${position + 1}`}
            aria-current={position === index ? 'true' : undefined}
            onClick={() => onSelect(position)}
          >{item?.poster && <span className="discover-hero__thumb" aria-hidden="true"><img src={item.poster} alt="" loading="lazy" decoding="async" /></span>}<span className="discover-hero__bar" aria-hidden="true" /></button>;
        })}</div>
        <div className="discover-hero__arrows">
          <span className="discover-hero__count" aria-hidden="true">{index + 1}<span> / {total}</span></span>
          <button aria-label="Destaque anterior" onClick={() => onSelect((index - 1 + total) % total)}><ChevronLeft size={22} aria-hidden="true" /></button>
          <button aria-label="Próximo destaque" onClick={() => onSelect((index + 1) % total)}><ChevronRight size={22} aria-hidden="true" /></button>
        </div>
      </div>}
    </section>
  );
}
