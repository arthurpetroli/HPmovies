import { RefreshCw, SearchX, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';

export function CatalogError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return <div className="catalog-state" role="alert"><span className="state-icon"><WifiOff size={28} /></span><h2>O catálogo está fora de alcance</h2><p>{message || 'Não foi possível carregar os animes. Verifique sua conexão e tente novamente.'}</p><button onClick={onRetry} className="button-primary"><RefreshCw size={16} />Tentar novamente</button></div>;
}
export function CatalogEmpty() {
  return <div className="catalog-state"><span className="state-icon"><SearchX size={28} /></span><h2>Nenhum anime por aqui</h2><p>Tente outro título ou combine filtros diferentes para descobrir mais histórias.</p><Link to="/explore" className="button-secondary">Explorar o catálogo</Link></div>;
}
export function CatalogSkeleton({ count = 12 }: { count?: number }) {
  return <div className="catalog-grid" aria-busy="true" aria-label="Carregando animes">{Array.from({ length: count }, (_, index) => <div className="skeleton-card" key={index}><div className="skeleton-poster skeleton" /><div className="skeleton-title skeleton" /><div className="skeleton-meta skeleton" /></div>)}</div>;
}
