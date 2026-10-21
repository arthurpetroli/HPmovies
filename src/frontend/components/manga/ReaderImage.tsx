import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
export function ReaderImage({ src, number, eager = false, onLoaded, onVisible }: { src: string; number: number; eager?: boolean; onLoaded?: () => void; onVisible?: () => void }) {
  const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
  return <div className="reader-image-frame" data-page={number - 1} onFocus={onVisible}>
    {failed ? <div className="reader-image-error" role="alert"><p>A página {number} não carregou.</p><button className="button-secondary" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}><RefreshCw size={16} />Recarregar página</button><span>Se o endereço expirou, use “Atualizar capítulo” no leitor.</span></div> : <img key={`${src}:${attempt}`} className="reader-image" src={src} alt={`Página ${number}`} loading={eager ? 'eager' : 'lazy'} decoding="async" onLoad={onLoaded} onError={() => setFailed(true)} />}
    <span className="reader-page-label">{number}</span>
  </div>;
}
