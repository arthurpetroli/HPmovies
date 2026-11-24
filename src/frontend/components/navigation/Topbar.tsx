import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../search/SearchBar';
import { BrandMark } from '../ui/Brand';

/** A busca flutua sobre a arte, sem uma barra fixa; o cabeçalho ganha vidro depois de rolar. */
export function Topbar({ searchRequest = 0 }: { searchRequest?: number }) {
  const search = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(() => window.scrollY > 16);
  useEffect(() => { if (searchRequest) search.current?.querySelector('input')?.focus(); }, [searchRequest]);
  useEffect(() => {
    let frame = 0;
    const update = () => { frame = 0; setScrolled(window.scrollY > 16); };
    const scheduleUpdate = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('pageshow', scheduleUpdate);
    scheduleUpdate();
    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('pageshow', scheduleUpdate);
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      search.current?.querySelector('input')?.focus();
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  return <header className="search-header" data-scrolled={scrolled}>
    <Link to="/" className="header-brand" aria-label="HPmovies — início"><BrandMark /></Link>
    <div className="floating-search" ref={search} onPointerDown={event => { if (event.target instanceof HTMLFormElement) { event.preventDefault(); search.current?.querySelector('input')?.focus(); } }}><a className="skip-link" href="#main-content">Ir para o conteúdo</a><SearchBar /></div>
  </header>;
}
