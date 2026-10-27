import { useCallback, useState } from 'react';
import { ArrowRight, ArrowUpRight, Compass, MonitorPlay, Play, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnimeHero } from '../components/anime/AnimeHero';
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
  return <main id="main-content" className="home-page">
    {loading ? <><div className="hero-skeleton skeleton"><div className="content-width"><div className="skeleton hero-skeleton-title" /><div className="skeleton hero-skeleton-text" /></div></div><div className="content-width page-body"><CatalogSkeleton count={6} /></div></> : error ? <div className="content-width page-shell"><div className="page-heading"><span className="eyebrow">ANIMES, MANGÁS E LIGHT NOVELS</span><h1>Um universo de histórias.<br />No seu ritmo.</h1><p>Guarde seus favoritos e continue de onde parou.</p></div><div className="format-discovery"><Link to="/explore"><Compass /><h2>Descobrir animes</h2><p>Dos clássicos aos próximos lançamentos.</p><ArrowUpRight /></Link><Link to="/manga"><MonitorPlay /><h2>Explorar mangás</h2><p>Capítulos e edições com preferência PT-BR.</p><ArrowUpRight /></Link><Link to="/novels"><TrendingUp /><h2>Ler novas histórias</h2><p>Light novels e uma experiência de leitura própria.</p><ArrowUpRight /></Link></div><ContinueWatching history={history} /><CatalogError message={error} onRetry={() => setRetry((value) => value + 1)} /><div className="flex flex-wrap justify-center gap-4 pb-12"><Link to="/watch/demo" className="button-primary"><Play size={16} />Testar player</Link><Link to="/novel/demo" className="button-secondary">Experimentar leitor textual</Link><Link to="/providers" className="button-secondary">Consultar fontes</Link></div></div> : home && <>
      {highlights.length > 0 && <AnimeHero anime={highlights[slide % highlights.length]} index={slide % highlights.length} total={highlights.length} onSelect={setSlide} />}
      <div className="content-width page-body">
        <div className="discovery-strip"><div><Compass size={19} /><strong>Encontre sua próxima história</strong><span>Um universo de animes para explorar.</span></div><Link to="/explore">Explorar catálogo <ArrowRight size={16} /></Link></div>
        <ContinueWatching history={history} />
        {list.length > 0 && <AnimeRowCarousel title="Histórias que você guardou" subtitle="Sua próxima sessão pode estar aqui." animes={list.map(entry => entry.anime).slice(0, 12)} viewAllLink="/library" />}
        <AnimeRowCarousel title="Em alta agora" subtitle="As histórias que estão conquistando a comunidade." animes={home.trending} viewAllLink="/explore?sort=trending" />
        <section className="genre-section"><div className="section-heading"><div><span className="eyebrow">SEU CLIMA, SEU ANIME</span><h2>Qual mundo você quer explorar?</h2></div></div><div className="genre-discovery scrollbar-hide">{genres.map((genre, index) => <Link key={genre} to={`/explore?genre=${encodeURIComponent(genre)}`} className={`genre-tile genre-tile-${index % 4}`}><span className="genre-tile-decoration" /><span>{genreLabel(genre)}</span><ArrowUpRight size={18} /></Link>)}</div></section>
        <AnimeRowCarousel title="Os favoritos de todo mundo" subtitle="Grandes histórias que merecem um lugar na sua lista." animes={home.popular} viewAllLink="/category/most-popular" ranked />
        <AnimeRowCarousel title="A temporada está acontecendo" subtitle="Animes em exibição para acompanhar de perto." animes={home.airing} viewAllLink="/category/top-airing" />
        <section className="demo-feature"><div className="demo-feature-art" aria-hidden="true"><span className="demo-orbit orbit-one" /><span className="demo-orbit orbit-two" /><span className="demo-play"><Play size={33} fill="currentColor" /></span><span className="demo-art-label"><MonitorPlay size={13} /> PLAYER HPMOVIES</span></div><div className="demo-feature-copy"><span className="eyebrow">CONHEÇA A EXPERIÊNCIA</span><h2>Sua próxima sessão começa com um bom player.</h2><p>Explore os controles, as legendas e a retomada de reprodução em um vídeo demonstrativo autorizado.</p><Link to="/watch/demo" className="button-primary"><Play size={16} fill="currentColor" />Testar player · demonstração</Link><span className="demo-note">Vídeo de demonstração. Episódios de anime dependem de um provedor autorizado.</span></div></section>
        <AnimeRowCarousel title="Histórias que deixam uma marca" subtitle="Os animes mais bem avaliados no AniList." animes={home.topRated} viewAllLink="/explore?sort=score" />
        {['Action', 'Fantasy', 'Romance'].map((genre) => { const items = all.filter((anime) => anime.genres.includes(genre)); return items.length >= 3 ? <AnimeRowCarousel key={genre} title={{ Action: 'Uma dose extra de adrenalina', Fantasy: 'Mundos além da imaginação', Romance: 'Histórias para sentir' }[genre] || genreLabel(genre)} subtitle={genreLabel(genre)} animes={items.slice(0, 12)} viewAllLink={`/explore?genre=${genre}`} /> : null; })}
        <AnimeRowCarousel title="Já no seu radar" subtitle="Os próximos lançamentos para ficar de olho." animes={home.upcoming} viewAllLink="/category/top-upcoming" />
        <section className="format-discovery"><Link to="/manga"><Compass /><h2>Mais histórias entre páginas.</h2><p>Explore o catálogo de mangás e encontre edições em português.</p><ArrowUpRight /></Link><Link to="/novels"><TrendingUp /><h2>Uma pausa para imaginar.</h2><p>Descubra light novels e leve sua leitura para outro universo.</p><ArrowUpRight /></Link></section>
        <div className="catalog-end"><TrendingUp size={25} /><h2>Sempre existe uma nova história.</h2><p>Descubra mais títulos, gêneros e mundos no catálogo.</p><Link to="/explore" className="button-secondary">Continuar explorando <ArrowRight size={16} /></Link></div>
      </div>
    </>}
  </main>;
}
