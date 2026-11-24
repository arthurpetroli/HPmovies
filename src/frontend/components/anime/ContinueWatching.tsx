import { useEffect, useState } from 'react';
import { Check, Film, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { libraryService } from '../../services/library';
import type { WatchProgress } from '../../services/library';
import { historyWatchLocation, progressDisplayTitle, progressEpisodeLabel } from '../../services/historyProgress';
import { cinemaForEpisode, stremioWatchIdentity } from '../../services/watchCinemaContext';
import { historyCinemaMetadata } from '../../services/historyCinema';

export function HistoryCard({ progress }: { progress: WatchProgress }) {
  const percent = Math.min(100, Math.max(0, progress.currentTime / progress.duration * 100));
  const cinema = cinemaForEpisode(progress.episodeId, progress.cinema);
  const identity = stremioWatchIdentity(progress.episodeId);
  const type = identity?.type, imdb = identity?.imdb;
  const needsMetadata = !!identity && (!cinema || !cinema.background && !cinema.poster);
  useEffect(() => {
    if (!type || !imdb || !needsMetadata) return;
    let active = true;
    void historyCinemaMetadata(type, imdb).then(metadata => { if (active && metadata) libraryService.updateCinemaMetadata(imdb, type, metadata); });
    return () => { active = false; };
  }, [type, imdb, needsMetadata]);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const images = [cinema?.background, cinema?.poster, progress.anime?.banner, progress.anime?.poster];
  const image = images.find((value): value is string => !!value && !failedImages.includes(value));
  const demo = progress.episodeId === 'demo' || progress.isDemo === true;
  const location = historyWatchLocation(progress);
  const episodeLabel = progressEpisodeLabel(progress);
  const title = progressDisplayTitle(progress);
  return <Link to={location.to} state={location.state} className="history-card" aria-label={`Continuar ${title}${episodeLabel ? ` · ${episodeLabel}` : ''}`}><div className="history-art">{image ? <img src={image} alt="" loading="lazy" onError={() => setFailedImages(previous => [...previous, image])} /> : <div className="history-demo-art"><Film size={38} aria-hidden="true" /><span>{demo ? 'HPmovies player' : identity?.type === 'movie' ? 'Filme' : identity?.type === 'series' ? 'Série' : 'Vídeo'}</span></div>}<span className="history-play"><Play size={21} fill="currentColor" aria-hidden="true" /></span>{demo && <span className="history-demo-label">DEMONSTRAÇÃO</span>}<span className="history-progress"><span style={{ width: `${percent}%` }} /></span></div><div className="history-caption"><strong>{title}</strong>{episodeLabel && <p>{episodeLabel}</p>}<span>{progress.completed ? <><Check size={13} />Concluído</> : `${Math.max(0, Math.ceil((progress.duration - progress.currentTime) / 60))} min restantes`}</span></div></Link>;
}
export function ContinueWatching({ history }: { history: WatchProgress[] }) {
  const items = history.filter((entry) => !entry.completed && entry.currentTime > 0).slice(0, 6);
  if (!items.length) return null;
  return <section className="catalog-row"><div className="section-heading"><div><h2>Continue de onde parou</h2><p>A próxima cena está esperando por você.</p></div><Link to="/library?tab=history" className="text-link">Ver histórico</Link></div><div className="history-carousel scrollbar-hide">{items.map((entry) => <HistoryCard key={entry.episodeId} progress={entry} />)}</div></section>;
}
