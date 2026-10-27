import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Check, Film, Info, Star, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CatalogAnime } from '../../../shared/providers';
import { libraryService, useLibrary } from '../../services/library';
import { genreLabel } from '../filters/genreLabels';
import './AnimeCard.css';

const formatLabels: Record<string, string> = {
  TV: 'Série', TV_SHORT: 'Série curta', MOVIE: 'Filme', SPECIAL: 'Especial',
  OVA: 'OVA', ONA: 'ONA', MUSIC: 'Música',
};
const statusLabels: Record<string, string> = {
  RELEASING: 'Em exibição', FINISHED: 'Concluído', NOT_YET_RELEASED: 'Em breve',
  CANCELLED: 'Cancelado', HIATUS: 'Em pausa',
};

export function AnimeCard({ anime, rank }: { anime: CatalogAnime; rank?: number }) {
  const { list } = useLibrary();
  const saved = list.some((entry) => entry.anime.id === anime.id);
  const [openMode, setOpenMode] = useState<'hover' | 'focus' | 'touch' | null>(null);
  const [failedPoster, setFailedPoster] = useState<string>();
  const cardRef = useRef<HTMLElement>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const previewId = useId();
  const previewOpen = openMode !== null;
  const detailsUrl = `/anime/${anime.id}`;
  const format = anime.format ? formatLabels[anime.format] || anime.format.replaceAll('_', ' ') : undefined;
  const episodes = anime.episodeCount != null ? `${anime.episodeCount} ${anime.episodeCount === 1 ? 'episódio' : 'episódios'}` : undefined;
  const metadata = [format, anime.year, episodes].filter(Boolean);

  useEffect(() => {
    if (openMode !== 'touch') return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !cardRef.current?.contains(event.target)) setOpenMode(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [openMode]);

  return (
    <article
      ref={cardRef}
      className="anime-card anime-preview-card"
      data-preview-open={previewOpen}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setOpenMode((current) => current || 'hover');
      }}
      onPointerLeave={() => {
        if (!cardRef.current?.querySelector(':focus-visible')) setOpenMode((current) => current === 'touch' ? current : null);
      }}
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) setOpenMode((current) => current || 'focus');
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpenMode((current) => current === 'touch' ? current : null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && previewOpen) {
          event.preventDefault();
          event.stopPropagation();
          previewButtonRef.current?.focus({ preventScroll: true });
          setOpenMode(null);
        }
      }}
    >
      <Link to={detailsUrl} aria-label={anime.title} className="anime-card-open">
        <div className="anime-card-art">
          <span className="poster-fallback" aria-hidden="true"><Film size={28} /><span>{anime.title}</span></span>
          {anime.poster && failedPoster !== anime.poster && (
            <img
              src={anime.poster}
              alt=""
              loading="lazy"
              decoding="async"
              width={460}
              height={690}
              className="card-poster-image"
              onError={() => setFailedPoster(anime.poster)}
            />
          )}
          {saved && <span className="anime-card-saved" aria-label="Na minha lista"><Check size={16} aria-hidden="true" /></span>}
          {rank != null && <span className="card-rank" aria-label={`Posição ${rank}`}>{rank}</span>}
        </div>
        <span className="card-title">{anime.title}</span>
        <div className="card-meta">{metadata.slice(0, 2).map((value) => <span key={value}>{value}</span>)}</div>

        <section id={previewId} className="anime-card-preview" aria-label={`Prévia de ${anime.title}`} aria-hidden={!previewOpen} inert={!previewOpen}>
          <h3>{anime.title}</h3>
          {anime.score != null && (
            <p className="anime-card-rating"><Star size={15} fill="currentColor" aria-hidden="true" /><strong>{(anime.score / 10).toFixed(1)}</strong><span>/ 10 no AniList</span></p>
          )}
          <p className="anime-card-preview-meta">{metadata.join(' · ')}</p>
          {anime.status && <p className="anime-card-status">{statusLabels[anime.status] || anime.status}</p>}
          <p className="anime-card-synopsis">{anime.description || 'A sinopse ainda não está disponível no catálogo.'}</p>
          {!!anime.genres.length && <p className="anime-card-genres">{anime.genres.slice(0, 2).map(genreLabel).join(' · ')}</p>}
          <div className="anime-card-preview-actions">
            <span className="anime-card-details"><ArrowUpRight size={18} aria-hidden="true" /><span>Ver anime</span></span>
          </div>
        </section>
      </Link>
      {previewOpen && <button type="button" onClick={() => libraryService.toggle(anime)} className={`card-save ${saved ? 'is-saved' : ''}`} aria-label={saved ? `Remover ${anime.title} da lista` : `Adicionar ${anime.title} à lista`} title={saved ? 'Na minha lista' : 'Adicionar à minha lista'} aria-pressed={saved}>
        {saved ? <Check size={20} aria-hidden="true" /> : <Bookmark size={20} aria-hidden="true" />}
      </button>}
      <button
        ref={previewButtonRef}
        type="button"
        className="anime-card-preview-toggle"
        aria-label={`${previewOpen ? 'Fechar' : 'Ver'} prévia de ${anime.title}`}
        aria-expanded={previewOpen}
        aria-controls={previewId}
        onClick={() => setOpenMode((current) => current ? null : 'touch')}
      >
        {previewOpen ? <X size={18} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />}
      </button>
    </article>
  );
}
