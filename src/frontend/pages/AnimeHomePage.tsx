import { useCallback, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Compass, MonitorPlay, Play, Star, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnimeHero } from '../components/anime/AnimeHero';
import { AnimeWatchLink } from '../components/anime/AnimeWatchLink';
import { AnimeRowCarousel } from '../components/anime/AnimeRowCarousel';
import { ContinueWatching } from '../components/anime/ContinueWatching';
import { genreLabel } from '../components/filters/genreLabels';
import { CatalogError, CatalogSkeleton } from '../components/ui/CatalogState';
import { catalogService } from '../services/catalog';
import { useLibrary } from '../services/library';
import { useCatalogRequest } from '../hooks/useCatalogRequest';

export function AnimeHomePage() {
  const [retry, setRetry] = useState(0);
  const [slide, setSlide] = useState(0);
  const { history, list } = useLibrary();
  const loader = useCallback(() => catalogService.home(), []);
  const { data: home, loading, error } = useCatalogRequest(`home:${retry}`, loader);
  const highlights = home?.trending.slice(0, 5) || [];
  const all = home ? [...new Map([...home.trending, ...home.popular, ...home.topRated, ...home.airing].map((anime) => [anime.id, anime])).values()] : [];
  const genres = [...new Set(all.flatMap((anime) => anime.genres))].slice(0, 9);
  const featured = home?.topRated.find(anime => anime.banner && anime.id !== highlights[0]?.id);
  return <main id="main-content" className="home-page">
    {loading ? <><div className="hero-skeleton skeleton"><div className="content-width"><div className="skeleton hero-skeleton-title" /><div className="skeleton hero-skeleton-text" /></div></div><div className="content-width page-body"><CatalogSkeleton count={6} /></div></> : error ? <div className="content-width page-shell"><div className="page-heading"><span className="eyebrow">ANIMES, MANGÁS E LIGHT NOVELS</span><h1>Um universo de histórias.<br />No seu ritmo.</h1><p>Guarde seus favoritos e continue de onde parou.</p></div><div className="format-discovery"><Link to="/explore"><Compass /><h2>Descobrir animes</h2><p>Dos clássicos aos próximos lançamentos.</p><ArrowUpRight /></Link><Link to="/manga"><MonitorPlay /><h2>Explorar mangás</h2><p>Capítulos e edições com preferência PT-BR.</p><ArrowUpRight /></Link><Link to="/novels"><TrendingUp /><h2>Ler novas histórias</h2><p>Light novels e uma experiência de leitura própria.</p><ArrowUpRight /></Link></div><ContinueWatching history={history} /><CatalogError message={error} onRetry={() => setRetry((value) => value + 1)} /><div className="flex flex-wrap justify-center gap-4 pb-12"><Link to="/watch/demo" className="button-primary"><Play size={16} />Testar player</Link><Link to="/novel/demo" className="button-secondary">Experimentar leitor textual</Link><Link to="/providers" className="button-secondary">Consultar fontes</Link></div></div> : home && <>
      {highlights.length > 0 && <AnimeHero anime={highlights[slide % highlights.length]} index={slide % highlights.length} total={highlights.length} onSelect={setSlide} />}
      <div className="content-width page-body">
        <nav className="discover-navigation scrollbar-hide" aria-label="Descobrir animes"><Link to="/" aria-current="page">Para você</Link><Link to="/category/most-popular">Populares</Link><Link to="/category/top-airing">Em exibição</Link><Link to="/category/top-upcoming">Em breve</Link><Link to="/explore">Todos os animes</Link></nav>
        <ContinueWatching history={history} />
        <AnimeRowCarousel title="Em alta agora" subtitle="As histórias que estão conquistando a comunidade." animes={home.trending} viewAllLink="/explore?sort=trending" />
        <AnimeRowCarousel title="Os favoritos de todo mundo" subtitle="Grandes histórias que merecem um lugar na sua lista." animes={home.popular} viewAllLink="/category/most-popular" ranked />
        {featured && <section className="editorial-feature" aria-label="Uma história para descobrir"><AnimeWatchLink anime={featured} className="editorial-feature-art" aria-label={`Assistir ${featured.title}`}><img className="editorial-feature-backdrop" src={featured.banner} alt="" loading="lazy" decoding="async" /><img className="editorial-feature-poster" src={featured.poster} alt={featured.title} loading="lazy" decoding="async" /></AnimeWatchLink><div className="editorial-feature-copy"><div className="editorial-feature-meta">{featured.score != null && <span><Star size={15} fill="currentColor" />{(featured.score / 10).toFixed(1)} no AniList</span>}{featured.genres[0] && <span>{genreLabel(featured.genres[0])}</span>}</div><h2>{featured.title}</h2>{featured.description && <p>{featured.description}</p>}<AnimeWatchLink anime={featured} className="button-primary"><Play size={17} />Assistir agora</AnimeWatchLink></div></section>}
        <section className="genre-section"><div className="section-heading"><div><h2>Encontre seu próximo universo</h2><p>Uma história para cada momento.</p></div></div><div className="genre-discovery scrollbar-hide">{genres.map((genre, index) => { const artwork = all.find(anime => anime.genres.includes(genre)); return <Link key={genre} to={`/explore?genre=${encodeURIComponent(genre)}`} className={`genre-tile genre-tile-${index % 4}`}>{artwork && <img src={artwork.banner || artwork.poster} alt="" loading="lazy" decoding="async" />}<span>{genreLabel(genre)}</span><ArrowUpRight size={18} /></Link>; })}</div></section>
        <AnimeRowCarousel title="A temporada está acontecendo" subtitle="Animes em exibição para acompanhar de perto." animes={home.airing} viewAllLink="/category/top-airing" />
        <AnimeRowCarousel title="Histórias que deixam uma marca" subtitle="Os animes mais bem avaliados no AniList." animes={home.topRated} viewAllLink="/explore?sort=score" />
        {['Action', 'Fantasy', 'Romance'].map((genre) => { const items = all.filter((anime) => anime.genres.includes(genre)); return items.length >= 3 ? <AnimeRowCarousel key={genre} title={{ Action: 'Uma dose extra de adrenalina', Fantasy: 'Mundos além da imaginação', Romance: 'Histórias para sentir' }[genre] || genreLabel(genre)} subtitle={genreLabel(genre)} animes={items.slice(0, 12)} viewAllLink={`/explore?genre=${genre}`} /> : null; })}
        <AnimeRowCarousel title="Já no seu radar" subtitle="Os próximos lançamentos para ficar de olho." animes={home.upcoming} viewAllLink="/category/top-upcoming" />
        {list.length > 0 && <AnimeRowCarousel title="Histórias que você guardou" subtitle="Sua próxima sessão pode estar aqui." animes={list.map(entry => entry.anime).slice(0, 12)} viewAllLink="/library" />}
        <section className="format-discovery"><Link to="/manga"><BookOpen /><h2>Mais histórias entre páginas.</h2><p>Explore mangás e encontre sua próxima leitura em português.</p><ArrowUpRight /></Link><Link to="/novels"><Compass /><h2>Uma pausa para imaginar.</h2><p>Descubra light novels e leve sua leitura para outro universo.</p><ArrowUpRight /></Link></section>
        <div className="catalog-end"><Compass size={28} /><h2>Sempre existe uma nova história.</h2><p>Descubra mais títulos, gêneros e mundos no catálogo.</p><Link to="/explore" className="button-secondary">Continuar explorando <ArrowRight size={16} /></Link><div><Link to="/watch/demo" className="text-link"><MonitorPlay size={15} />Experimentar o player de demonstração</Link></div></div>
      </div>
    </>}
  </main>;
}
