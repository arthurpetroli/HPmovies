import { BookOpen, RefreshCw } from 'lucide-react';
export function MangaError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="catalog-state" role="alert"><span className="state-icon"><BookOpen size={28} /></span><h2>Não foi possível abrir esta história</h2><p>{message}</p><button className="button-primary" onClick={retry}><RefreshCw size={16} />Tentar novamente</button><a className="manga-source" href="https://mangadex.org" target="_blank" rel="noopener noreferrer">Visitar MangaDex ↗</a></div>;
}
export function MangaLoading() { return <div className="manga-grid" aria-busy="true" aria-label="Carregando mangás">{Array.from({ length: 12 }, (_, index) => <div key={index}><div className="skeleton skeleton-poster" /><div className="skeleton skeleton-title" /></div>)}</div>; }
