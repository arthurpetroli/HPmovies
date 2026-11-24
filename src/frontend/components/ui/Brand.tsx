import { Play } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Marca do HPmovies: um botão de reproduzir em menta, usado no dock, no cabeçalho e no rodapé. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return <span className="brand-mark" style={{ width: size, height: size, borderRadius: Math.round(size * .33) }} aria-hidden="true"><Play size={Math.round(size * .42)} fill="currentColor" strokeWidth={2.4} /></span>;
}

export function Brand() {
  return <Link to="/" className="brand" aria-label="HPmovies — início"><BrandMark /><span>HP<span className="brand-light">movies</span><span className="brand-dot">.</span></span></Link>;
}
