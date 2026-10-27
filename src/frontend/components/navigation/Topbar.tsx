import { useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronDown, Menu, Play, Search, X } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { SearchBar } from '../search/SearchBar';

const navigation = [
  { label: 'Início', to: '/' },
  { label: 'Animes', to: '/explore' },
  { label: 'Mangás', to: '/manga' },
  { label: 'Novels', to: '/novels' },
];
const moreNavigation = [
  { label: 'Mais populares', to: '/category/most-popular' },
  { label: 'Em exibição', to: '/category/top-airing' },
  { label: 'Próximos lançamentos', to: '/category/top-upcoming' },
  { label: 'Fontes', to: '/sources' },
  { label: 'Disponibilidade das fontes', to: '/providers' },
];

export function Brand() {
  return <Link to="/" className="brand" aria-label="HPmovies — início"><span className="brand-icon"><Play size={18} fill="currentColor" /></span><span>HP<span className="brand-light">movies</span><span className="brand-dot">.</span></span></Link>;
}

export function Topbar() {
  const location = useLocation();
  const [panelState, setPanelState] = useState<{ key: string; type: 'search' | 'menu' | 'more' | null }>({ key: location.key, type: null });
  const activePanel = panelState.key === location.key ? panelState.type : null;
  const menuOpen = activePanel === 'menu';
  const searchOpen = activePanel === 'search';
  const moreOpen = activePanel === 'more';
  const panel = useRef<HTMLElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const togglePanel = (type: 'search' | 'menu' | 'more') => setPanelState({ key: location.key, type: activePanel === type ? null : type });
  useEffect(() => {
    if (!activePanel) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPanelState({ key: location.key, type: null });
      ({ search: searchButton, menu: menuButton, more: moreButton })[activePanel].current?.focus();
    };
    const outside = (event: MouseEvent | FocusEvent) => { if (panel.current && !panel.current.contains(event.target as Node)) setPanelState({ key: location.key, type: null }); };
    document.addEventListener('keydown', close);
    document.addEventListener('mousedown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('mousedown', outside); document.removeEventListener('focusin', outside); };
  }, [activePanel, location.key]);
  return <header className="topbar" ref={panel}>
    <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
    <div className="topbar-inner content-width">
      <Brand />
      <nav className="desktop-navigation" aria-label="Principal">
        {navigation.map((item) => <NavLink key={item.to} end={item.to === '/'} to={item.to}>{item.label}</NavLink>)}
        <div className="nav-more"><button ref={moreButton} className="nav-more-button" aria-expanded={moreOpen} aria-controls="more-navigation" onClick={() => togglePanel('more')}>Mais <ChevronDown size={16} /></button>{moreOpen && <div id="more-navigation" className="nav-dropdown">{moreNavigation.map(item => <NavLink key={item.to} to={item.to}>{item.label}</NavLink>)}</div>}</div>
      </nav>
      <div className="topbar-actions">
        <button ref={searchButton} className={`icon-button ${searchOpen ? 'selected' : ''}`} aria-label={searchOpen ? 'Fechar busca' : 'Buscar animes'} aria-expanded={searchOpen} aria-controls="header-search" onClick={() => togglePanel('search')}>{searchOpen ? <X size={22} /> : <Search size={22} />}</button>
        <Link className="icon-button header-library" to="/library" aria-label="Minha lista"><Bookmark size={21} /><span>Minha lista</span></Link>
        <button ref={menuButton} className="icon-button mobile-menu" aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => togglePanel('menu')}>{menuOpen ? <X size={23} /> : <Menu size={23} />}</button>
      </div>
    </div>
    {searchOpen && <div className="header-search content-width" id="header-search"><SearchBar onClose={() => setPanelState({ key: location.key, type: null })} autoFocus /></div>}
    {menuOpen && <nav className="mobile-navigation" id="mobile-navigation" aria-label="Principal no celular">{[...navigation, ...moreNavigation, { label: 'Minha lista', to: '/library' }].map((item) => <NavLink key={item.to} end={item.to === '/'} to={item.to}>{item.label}</NavLink>)}</nav>}
  </header>;
}
