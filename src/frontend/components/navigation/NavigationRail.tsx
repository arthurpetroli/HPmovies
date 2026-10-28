import { useEffect, useRef } from 'react';
import { BookOpen, BookText, CalendarDays, ChevronLeft, ChevronRight, Compass, Flame, History, Home, Library, Play, Radio, Search, Settings2, Sparkles } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import './navigationRail.css';

const destinations = [
  { to: '/', label: 'Início', icon: Home },
  { to: '/explore?sort=trending', label: 'Em alta', icon: Flame },
  { to: '/explore', label: 'Explorar animes', icon: Compass },
  { to: '/schedule', label: 'Agenda de lançamentos', icon: CalendarDays },
  { to: '/library?tab=history', label: 'Histórico', icon: History },
  { to: '/explore?sort=newest', label: 'Novidades', icon: Sparkles },
  { to: '/library', label: 'Minha lista', icon: Library },
  { to: '/manga', label: 'Mangás', icon: BookOpen },
  { to: '/novels', label: 'Light novels', icon: BookText },
];

export function NavigationRail({ expanded, onToggle, onSearch, onSettings }: { expanded: boolean; onToggle: () => void; onSearch: () => void; onSettings: () => void }) {
  const { pathname, search } = useLocation();
  const activeDestination = (to: string) => {
    const [path, query] = to.split('?');
    if (path !== pathname) return false;
    const current = new URLSearchParams(search);
    if (query) return [...new URLSearchParams(query)].every(([key, value]) => current.get(key) === value);
    if (path === '/explore') return !['trending', 'newest'].includes(current.get('sort') || '');
    return path !== '/library' || current.get('tab') !== 'history';
  };
  const rail = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onToggle(); };
    const outside = (event: PointerEvent) => { if (window.matchMedia('(max-width: 900px)').matches && !rail.current?.contains(event.target as Node)) onToggle(); };
    window.addEventListener('keydown', close);
    document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', close); document.removeEventListener('pointerdown', outside); };
  }, [expanded, onToggle]);
  return <aside ref={rail} className={`navigation-rail${expanded ? ' is-expanded' : ''}`} aria-label="Menu lateral">
    <Link to="/" className="rail-brand" aria-label="HPmovies — início"><Play size={22} fill="currentColor" aria-hidden="true" />{expanded && <span>HPmovies</span>}</Link>
    <button type="button" className="rail-expand" aria-label={expanded ? 'Recolher navegação' : 'Expandir navegação'} aria-expanded={expanded} onClick={onToggle}>{expanded ? <ChevronLeft size={19} aria-hidden="true" /> : <ChevronRight size={19} aria-hidden="true" />}{expanded && <span>Recolher menu</span>}</button>
    <nav aria-label="Navegação lateral">
      {destinations.map(({ to, label, icon: Icon }, index) => <div className="rail-item" key={to}>
        {index === 3 && <button type="button" className="rail-link" aria-label="Buscar animes" onClick={onSearch}><Search size={21} aria-hidden="true" /><span className="rail-label">Buscar animes</span></button>}
        <Link className="rail-link" to={to} aria-label={label} aria-current={activeDestination(to) ? 'page' : undefined} onClick={event => { if (expanded && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && window.matchMedia('(max-width: 900px)').matches) onToggle(); }}><Icon size={21} aria-hidden="true" /><span className="rail-label">{label}</span></Link>
      </div>)}
    </nav>
    <div className="rail-bottom"><Link className="rail-link" to="/providers" aria-label="Fontes e disponibilidade"><Radio size={21} aria-hidden="true" /><span className="rail-label">Fontes e disponibilidade</span></Link>
      <button type="button" className="rail-link" aria-label="Configurações" onClick={onSettings}><Settings2 size={21} aria-hidden="true" /><span className="rail-label">Configurações</span></button>
    </div>
  </aside>;
}
