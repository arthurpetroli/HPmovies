import { useState } from 'react';
import { Loader2, MonitorPlay } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import type { CatalogAnime, StreamingEpisode } from '../../../shared/providers';
import '../../watch.css';

export function WatchArtwork({ image, fallback }: { image?: string; fallback?: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = [image, fallback].find(value => value && !failed.includes(value));
  return src ? <img src={src} alt="" className="watch-artwork" onError={() => setFailed(value => [...value, src])} />
    : <div className="watch-artwork watch-artwork-empty"><MonitorPlay size={64} aria-hidden="true" /></div>;
}

/** This small shell is available before the HLS player bundle has loaded. */
export function WatchLoadingShell() {
  const { state } = useLocation();
  const context = state as { anime?: CatalogAnime; episode?: StreamingEpisode } | null;
  return <main id="main-content" className="watch-page" aria-busy="true" aria-label="Abrindo episódio">
    <div className="watch-layout">
      <div className="watch-screen"><div className="watch-stage"><WatchArtwork image={context?.episode?.thumbnail} fallback={context?.anime?.banner || context?.anime?.poster} /><div className="watch-transition"><Loader2 size={32} className="animate-spin" aria-hidden="true" /><span role="status">Abrindo episódio…</span></div></div></div>
      <aside className="watch-sidebar watch-sidebar-skeleton" aria-label="Episódios" aria-busy="true"><h2>Episódios</h2>{Array.from({ length: 5 }, (_, index) => <div className="skeleton" key={index} />)}</aside>
    </div>
  </main>;
}
