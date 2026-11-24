import { useState } from 'react';
import { Film } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CatalogAnime } from '../../../shared/providers';
import '../anime/AnimeCard.css';

const formatLabels: Record<string, string> = { TV: 'Série', TV_SHORT: 'Série curta', MOVIE: 'Filme', SPECIAL: 'Especial', OVA: 'OVA', ONA: 'ONA' };

/** Same look as the anime card, without the general library: adult titles are never saved there. */
export function AdultCard({ anime }: { anime: CatalogAnime }) {
  const [failedPoster, setFailedPoster] = useState<string>();
  const format = anime.format ? formatLabels[anime.format] || anime.format.replaceAll('_', ' ') : undefined;
  const episodes = anime.episodeCount != null ? `${anime.episodeCount} ${anime.episodeCount === 1 ? 'episódio' : 'episódios'}` : undefined;
  const metadata = [format, anime.year, episodes].filter(Boolean).slice(0, 2);
  return <article className="anime-card anime-preview-card" data-preview-open="false">
    <Link to={`/adult/anime/${encodeURIComponent(anime.id)}`} className="anime-card-open" aria-label={anime.title}>
      <div className="anime-card-art">
        <span className="poster-fallback" aria-hidden="true"><Film size={28} /><span>{anime.title}</span></span>
        {anime.poster && failedPoster !== anime.poster && <img src={anime.poster} alt="" loading="lazy" decoding="async" width={460} height={690} className="card-poster-image" onError={() => setFailedPoster(anime.poster)} />}
      </div>
      <span className="card-title">{anime.title}</span>
      <div className="card-meta">{metadata.map(value => <span key={value}>{value}</span>)}</div>
    </Link>
  </article>;
}
