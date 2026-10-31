import { BookOpen, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRef, useState } from 'react';
import type { MangaTitle } from '../../../shared/manga';
import { mangaLibrary, useMangaLibrary } from '../../services/mangaLibrary';
import { mangaService, mangaStatusLabel } from '../../services/manga';
import { mangaDetailsPath } from '../../../shared/mangaIdentity';

export function MangaCard({ manga, language }: { manga: MangaTitle; language?: string }) {
  const [failed, setFailed] = useState(false);
  const [cover, setCover] = useState({ src: manga.poster, revision: 0 });
  const refreshed = useRef(false);
  const imageError = () => {
    if (!refreshed.current && cover.src.includes('/manga/image/')) {
      refreshed.current = true;
      void mangaService.details(manga.id).then((fresh) => {
        if (fresh.poster) setCover({ src: fresh.poster, revision: 1 }); else setFailed(true);
      }).catch(() => setFailed(true));
    } else setFailed(true);
  };
  const { saved } = useMangaLibrary();
  const favorite = saved.some((entry) => entry.manga.id === manga.id && entry.favorite);
  const path = `${mangaDetailsPath(manga.id)}${language && language !== 'all' ? `?${new URLSearchParams({ language })}` : ''}`;
  return <article className="manga-card"><Link to={path} className="manga-card-art">
    {cover.src && !failed ? <img key={cover.revision} src={cover.src} alt={manga.title} loading="lazy" decoding="async" onError={imageError} /> : <div className="manga-cover-fallback"><BookOpen size={32} /><span>Capa indisponível</span></div>}
    <span className="manga-card-badge">{manga.availableLanguages.includes('pt-br') ? 'PT-BR' : 'MANGÁ'}</span>
    <span className="manga-card-read"><BookOpen size={22} />Explorar história</span>
  </Link><button className={`manga-favorite ${favorite ? 'active' : ''}`} onClick={() => mangaLibrary.toggleFavorite(manga)} aria-label={`${favorite ? 'Remover' : 'Adicionar'} ${manga.title} ${favorite ? 'dos' : 'aos'} favoritos`} aria-pressed={favorite}><Heart size={18} fill={favorite ? 'currentColor' : 'none'} /></button>
    <Link to={path} className="manga-card-title">{manga.title}</Link><p>{mangaStatusLabel(manga.status)}{manga.year ? ` · ${manga.year}` : ''}</p>
  </article>;
}
export function MangaRow({ title, subtitle, items, href, language }: { title: string; subtitle: string; items: MangaTitle[]; href: string; language?: string }) {
  if (!items.length) return null;
  return <section className="manga-row"><div className="section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><Link to={href}>Ver todos →</Link></div><div className="manga-carousel scrollbar-hide">{items.slice(0, 12).map((manga) => <MangaCard manga={manga} key={manga.id} language={language} />)}</div></section>;
}
