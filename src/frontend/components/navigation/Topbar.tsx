import { useEffect, useRef, useState } from 'react';
import { Bookmark, Menu, Play, Search, X } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { SearchBar } from '../search/SearchBar';

const navigation = [{ label: 'Início', to: '/' }, { label: 'Animes', to: '/explore' }, { label: 'Mangás', to: '/manga' }, { label: 'Novels', to: '/novels' }, { label: 'Populares', to: '/category/most-popular' }, { label: 'Fontes', to: '/sources' }, { label: 'Minha Lista', to: '/library' }];

export function Brand() {
  return <Link to="/" className="brand" aria-label="HPmovies — início"><span className="brand-icon"><Play size={18} fill="currentColor" /></span><span>HP<span className="brand-light">movies</span><span className="brand-dot">.</span></span></Link>;
}

export function Topbar() {
  const location = useLocation();
  const [panelState, setPanelState] = useState<{ key: string; type: 'search' | 'menu' | null }>({ key: location.key, type: null });
  const menuOpen = panelState.key === location.key && panelState.type === 'menu';
  const searchOpen = panelState.key === location.key && panelState.type === 'search';
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!searchOpen && !menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanelState({ key: location.key, type: null }); };
    const outside = (event: MouseEvent) => { if (panel.current && !panel.current.contains(event.target as Node)) setPanelState({ key: location.key, type: null }); };
    document.addEventListener('keydown', close);
    document.addEventListener('mousedown', outside);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('mousedown', outside); };
  }, [searchOpen, menuOpen, location.key]);
  return <header className="topbar" ref={panel}>
    <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
    <div className="topbar-inner content-width">
      <Brand />
      <nav className="desktop-navigation" aria-label="Principal">{navigation.map((item) => <NavLink key={item.to} end={item.to === '/'} to={item.to}>{item.label}</NavLink>)}</nav>
      <div className="topbar-actions"><span className="local-badge"><span />Pessoal</span><button className={`icon-button ${searchOpen ? 'selected' : ''}`} aria-label={searchOpen ? 'Fechar busca' : 'Buscar animes'} aria-expanded={searchOpen} aria-controls="header-search" onClick={() => setPanelState({ key: location.key, type: searchOpen ? null : 'search' })}>{searchOpen ? <X size={21} /> : <Search size={21} />}</button><Link className="icon-button mobile-library" to="/library" aria-label="Minha lista"><Bookmark size={19} /></Link><button className="icon-button mobile-menu" aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setPanelState({ key: location.key, type: menuOpen ? null : 'menu' })}>{menuOpen ? <X size={23} /> : <Menu size={23} />}</button></div>
    </div>
    {searchOpen && <div className="header-search content-width" id="header-search"><SearchBar onClose={() => setPanelState({ key: location.key, type: null })} autoFocus /></div>}
    {menuOpen && <nav className="mobile-navigation" id="mobile-navigation" aria-label="Principal no celular">{navigation.map((item) => <NavLink key={item.to} end={item.to === '/'} to={item.to}>{item.label}</NavLink>)}</nav>}
  </header>;
}
