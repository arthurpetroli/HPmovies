import { useState } from 'react';
import { Loader2, MonitorPlay } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import type { CatalogAnime, StreamingEpisode } from '../../../shared/providers';
import type { CinemaTitle } from '../../../shared/cinema';
import { libraryService } from '../../services/library';
import { cinemaForEpisode, stremioWatchIdentity } from '../../services/watchCinemaContext';
import '../../watch.css';

export function WatchArtwork({ image, fallback }: { image?: string; fallback?: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = [image, fallback].find(value => value && !failed.includes(value));
  return src ? <img src={src} alt="" className="watch-artwork" onError={() => setFailed(value => [...value, src])} />
    : <div className="watch-artwork watch-artwork-empty"><MonitorPlay size={64} aria-hidden="true" /></div>;
}

/** This small shell is available before the HLS player bundle has loaded. */
export function WatchLoadingShell() {
  const { state, pathname } = useLocation();
  const context = state as { anime?: CatalogAnime; cinema?: CinemaTitle; episode?: StreamingEpisode } | null;
  let episodeId = pathname.slice('/watch/'.length);
  try { episodeId = decodeURIComponent(episodeId); } catch { /* Invalid IDs are handled by the watch route. */ }
  const identity = stremioWatchIdentity(episodeId);
  const progress = libraryService.getProgress(episodeId);
  const cinema = cinemaForEpisode(episodeId, context?.cinema, progress?.cinema);
  const anime = identity ? undefined : context?.anime || progress?.anime;
  const image = context?.episode?.thumbnail || anime?.banner || cinema?.background;
  const fallback = anime?.poster || cinema?.poster;
  const opening = identity?.type === 'movie' ? 'Abrindo filme' : 'Abrindo episódio';
  return <main id="main-content" className="watch-page" aria-busy="true" aria-label={opening}>
    {(anime || cinema) && <div className="watch-backdrop" aria-hidden="true"><WatchArtwork image={anime?.banner || cinema?.background} fallback={fallback} /></div>}
    <div className="watch-layout">
      <div className="watch-screen"><div className="watch-stage"><WatchArtwork image={image} fallback={fallback} /><div className="watch-transition"><Loader2 size={32} className="animate-spin" aria-hidden="true" /><span role="status">{opening}…</span>{(anime?.title || cinema?.title) && <small>{anime?.title || cinema?.title}</small>}</div></div></div>
      {identity?.type === 'movie' ? <aside className="watch-sidebar"><section className="surface-card p-5"><h2 className="font-semibold">Filme completo</h2>{cinema && <p className="mt-3 text-sm text-slate-400">{cinema.title}</p>}</section></aside> : <aside className="watch-sidebar watch-sidebar-skeleton" aria-label="Episódios" aria-busy="true"><h2>Episódios</h2>{Array.from({ length: 5 }, (_, index) => <div className="skeleton" key={index} />)}</aside>}
    </div>
  </main>;
}
