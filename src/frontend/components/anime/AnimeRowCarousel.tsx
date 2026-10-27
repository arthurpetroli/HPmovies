import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CatalogAnime } from '../../../shared/providers';
import { AnimeCard } from './AnimeCard';

export function AnimeRowCarousel({ title, subtitle, animes, viewAllLink, ranked = false }: { title: string; subtitle?: string; animes: CatalogAnime[]; viewAllLink?: string; ranked?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState({ left: false, right: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setArrows({ left: element.scrollLeft > 2, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 2 });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    update();
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, [animes]);
  if (!animes.length) return null;
  return (
    <section className="catalog-row">
      <div className="section-heading">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <div className="row-actions">
          {viewAllLink && <Link to={viewAllLink} className="text-link">Ver todos <ArrowRight size={15} /></Link>}
          <div className="carousel-arrows">
            <button className="icon-button" onClick={() => ref.current?.scrollBy({ left: -ref.current.clientWidth * .8, behavior: 'smooth' })} disabled={!arrows.left} aria-label={`Anteriores em ${title}`}><ChevronLeft size={19} /></button>
            <button className="icon-button" onClick={() => ref.current?.scrollBy({ left: ref.current.clientWidth * .8, behavior: 'smooth' })} disabled={!arrows.right} aria-label={`Próximos em ${title}`}><ChevronRight size={19} /></button>
          </div>
        </div>
      </div>
      <div ref={ref} className="anime-carousel scrollbar-hide">{animes.map((anime, index) => <AnimeCard key={anime.id} anime={anime} rank={ranked ? index + 1 : undefined} />)}</div>
    </section>
  );
}
