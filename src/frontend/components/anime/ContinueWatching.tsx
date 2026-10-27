import { Check, Film, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { WatchProgress } from '../../services/library';

export function HistoryCard({ progress }: { progress: WatchProgress }) {
  const percent = Math.min(100, Math.max(0, progress.currentTime / progress.duration * 100));
  return <Link to={`/watch/${encodeURIComponent(progress.episodeId)}`} state={{ anime: progress.anime }} className="history-card"><div className="history-art">{progress.anime?.banner || progress.anime?.poster ? <img src={progress.anime.banner || progress.anime.poster} alt="" loading="lazy" /> : <div className="history-demo-art"><Film size={38} /><span>HPmovies player</span></div>}<span className="history-play"><Play size={21} fill="currentColor" /></span>{!progress.anime && <span className="history-demo-label">DEMONSTRAÇÃO</span>}<span className="history-progress"><span style={{ width: `${percent}%` }} /></span></div><div className="history-caption"><strong>{progress.anime?.title || progress.title}</strong><span>{progress.completed ? <><Check size={13} />Concluído</> : `${Math.ceil((progress.duration - progress.currentTime) / 60)} min restantes`}</span></div></Link>;
}
export function ContinueWatching({ history }: { history: WatchProgress[] }) {
  const items = history.filter((entry) => !entry.completed && entry.currentTime > 0).slice(0, 6);
  if (!items.length) return null;
  return <section className="catalog-row"><div className="section-heading"><div><h2>Continue de onde parou</h2><p>A próxima cena está esperando por você.</p></div><Link to="/library?tab=history" className="text-link">Ver histórico</Link></div><div className="history-carousel scrollbar-hide">{items.map((entry) => <HistoryCard key={entry.episodeId} progress={entry} />)}</div></section>;
}
