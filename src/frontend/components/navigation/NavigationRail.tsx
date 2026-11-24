import { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, BookText, CalendarDays, ChevronLeft, ChevronRight, Compass, Film, Flame, History, Home, Library, Menu, Radio, Search, Settings2, Sparkles, VenetianMask, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { BrandMark } from '../ui/Brand';
import { useAdultMode } from '../../services/adultMode';
import './navigationRail.css';

interface Destination { to?: string; label: string; short: string; icon: LucideIcon; bar?: boolean; search?: boolean }

/** `bar` marca os atalhos que ficam na barra inferior do celular; o restante vive na gaveta. */
const destinations: Destination[] = [
  { to: '/', label: 'Início', short: 'Início', icon: Home, bar: true },
  { to: '/explore?sort=trending', label: 'Em alta', short: 'Em alta', icon: Flame },
  { to: '/explore', label: 'Explorar animes', short: 'Explorar', icon: Compass, bar: true },
  { label: 'Buscar animes', short: 'Buscar', icon: Search, bar: true, search: true },
  { to: '/cinema', label: 'Filmes e séries', short: 'Filmes', icon: Film },
  { to: '/schedule', label: 'Agenda de lançamentos', short: 'Agenda', icon: CalendarDays },
  { to: '/library?tab=history', label: 'Histórico', short: 'Histórico', icon: History },
  { to: '/explore?sort=newest', label: 'Novidades', short: 'Novidades', icon: Sparkles },
  { to: '/library', label: 'Minha lista', short: 'Lista', icon: Library, bar: true },
  { to: '/manga', label: 'Mangás', short: 'Mangás', icon: BookOpen },
  { to: '/novels', label: 'Light novels', short: 'Novels', icon: BookText },
];
/** Shown only after the person enabled adult content in Sua experiência. */
const adultDestination: Destination = { to: '/adult', label: 'Conteúdo adulto', short: 'Adulto', icon: VenetianMask };

const isCompactLayout = () => window.matchMedia('(max-width: 900px)').matches;

export function NavigationRail({ expanded, onToggle, onSearch, onSettings }: { expanded: boolean; onToggle: () => void; onSearch: () => void; onSettings: () => void }) {
  const { pathname, search } = useLocation();
  const adult = useAdultMode();
  const shown = adult.enabled ? [...destinations, adultDestination] : destinations;
  const activeDestination = (to: string) => {
    const [path, query] = to.split('?');
    if (path !== pathname && !(path === '/cinema' && pathname.startsWith('/cinema/')) && !(path === '/adult' && pathname.startsWith('/adult/'))) return false;
    const current = new URLSearchParams(search);
    if (query) return [...new URLSearchParams(query)].every(([key, value]) => current.get(key) === value);
    if (path === '/explore') return !['trending', 'newest'].includes(current.get('sort') || '');
    return path !== '/library' || current.get('tab') !== 'history';
  };
  useEffect(() => {
    if (!expanded) return;
    // Com um diálogo modal aberto (ex.: configurações), Escape fecha somente o diálogo.
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) onToggle(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded, onToggle]);
  const closeDrawer = () => { if (expanded && isCompactLayout()) onToggle(); };
  const labels = (item: Pick<Destination, 'label' | 'short'>) => <><span className="rail-label">{item.label}</span><span className="rail-short" aria-hidden="true">{item.short}</span></>;
  return <>
    <aside className={`navigation-rail${expanded ? ' is-expanded' : ''}`} aria-label="Menu lateral">
      <Link to="/" className="rail-brand" aria-label="HPmovies — início"><BrandMark />{expanded && <span className="rail-wordmark">HP<span>movies</span></span>}</Link>
      <button type="button" className="rail-expand" aria-label={expanded ? 'Recolher navegação' : 'Expandir navegação'} aria-expanded={expanded} onClick={onToggle}>
        <span className="rail-expand-icon rail-expand-icon--desktop" aria-hidden="true">{expanded ? <ChevronLeft size={19} /> : <ChevronRight size={19} />}</span>
        <span className="rail-expand-icon rail-expand-icon--mobile" aria-hidden="true">{expanded ? <X size={22} /> : <Menu size={22} />}</span>
        {expanded && <span className="rail-expand-label">Recolher menu</span>}
        <span className="rail-short" aria-hidden="true">Menu</span>
      </button>
      <nav aria-label="Navegação lateral">
        {shown.map(({ to, label, short, icon: Icon, bar, search: isSearch }) => <div className="rail-item" data-bar={bar ? 'true' : undefined} key={label}>
          {isSearch
            ? <button type="button" className="rail-link" aria-label={label} onClick={() => { closeDrawer(); onSearch(); }}><Icon size={22} aria-hidden="true" />{labels({ label, short })}</button>
            : <Link className="rail-link" to={to!} aria-label={label} aria-current={activeDestination(to!) ? 'page' : undefined} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) closeDrawer(); }}><Icon size={22} aria-hidden="true" />{labels({ label, short })}</Link>}
        </div>)}
      </nav>
      <div className="rail-bottom">
        <Link className="rail-link" to="/providers" aria-label="Fontes e disponibilidade" onClick={closeDrawer}><Radio size={22} aria-hidden="true" /><span className="rail-label">Fontes e disponibilidade</span></Link>
        <button type="button" className="rail-link" aria-label="Configurações" onClick={onSettings}><Settings2 size={22} aria-hidden="true" /><span className="rail-label">Configurações</span></button>
      </div>
    </aside>
    {expanded && <div className="rail-scrim" aria-hidden="true" onClick={onToggle} />}
  </>;
}
