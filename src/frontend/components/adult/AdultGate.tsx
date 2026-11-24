import type { ReactNode } from 'react';
import { VenetianMask } from 'lucide-react';
import { Link } from 'react-router-dom';
import { openSettings, useAdultMode } from '../../services/adultMode';
import '../../adult.css';

/** Adult pages render only after the person enabled adult content in this browser. */
export function AdultGate({ children }: { children: ReactNode }) {
  const adult = useAdultMode();
  if (adult.enabled) return <>{children}</>;
  return <main id="main-content" className="page-shell content-width">
    <div className="catalog-state adult-gate">
      <span className="state-icon"><VenetianMask size={28} aria-hidden="true" /></span>
      <h1>Conteúdo adulto desativado</h1>
      <p>Para ver esta seção, ative “Mostrar conteúdo adulto (18+)” em Configurações › Sua experiência e confirme sua idade.</p>
      <div className="adult-gate-actions">
        <button type="button" className="button-primary" onClick={openSettings}>Abrir configurações</button>
        <Link to="/" className="button-secondary">Voltar ao início</Link>
      </div>
    </div>
  </main>;
}
