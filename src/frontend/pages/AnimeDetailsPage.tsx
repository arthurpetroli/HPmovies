import { useCallback, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bookmark, Check, Clock3, ExternalLink, Heart, MonitorPlay, Play, Star } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { AnimeRowCarousel } from '../components/anime/AnimeRowCarousel';
import { genreLabel } from '../components/filters/genreLabels';
import { CatalogError } from '../components/ui/CatalogState';
import { catalogService } from '../services/catalog';
import { libraryService, useLibrary } from '../services/library';
import { streamingService } from '../services/streaming';
import { useCatalogRequest } from '../hooks/useCatalogRequest';

const statusLabels: Record<string, string> = { RELEASING: 'Em exibição', FINISHED: 'Concluído', NOT_YET_RELEASED: 'Em breve', CANCELLED: 'Cancelado', HIATUS: 'Em pausa' };
const relationLabels: Record<string, string> = { SEQUEL: 'Continuação', PREQUEL: 'Anterior', SIDE_STORY: 'História paralela', ALTERNATIVE: 'Versão alternativa', SPIN_OFF: 'Spin-off', PARENT: 'História principal', SUMMARY: 'Resumo', COMPILATION: 'Compilação', OTHER: 'Relacionado', CHARACTER: 'Personagem' };
export function AnimeDetailsPage() {
  const { animeId = '' } = useParams();
  const [retry, setRetry] = useState(0);
  const [expandedAnime, setExpandedAnime] = useState('');
  const expanded = expandedAnime === animeId;
  const loader = useCallback(() => catalogService.details(animeId), [animeId]);
  const { data: anime, loading, error } = useCatalogRequest(`details:${animeId}:${retry}`, loader);
  const titleKey = JSON.stringify([anime?.title, anime?.titleOriginal].filter(Boolean));
  const streamLoader = useCallback(() => streamingService.episodes(animeId, JSON.parse(titleKey) as string[]), [animeId, titleKey]);
  const { data: availability, error: streamError } = useCatalogRequest(`episodes:${animeId}:${titleKey}:${retry}`, streamLoader);
  const { list } = useLibrary();
  const entry = list.find((saved) => saved.anime.id === animeId);
  if (loading) return <main id="main-content" className="details-page" aria-busy="true" aria-label="Carregando detalhes"><div className="details-banner skeleton" /><div className="content-width details-body"><div className="details-main"><div className="details-poster skeleton" /><div className="details-content"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-meta" /><div className="skeleton skeleton-description" /></div></div></div></main>;
  if (error || !anime) return <main id="main-content" className="page-shell content-width"><Link className="back-link" to="/explore"><ArrowLeft size={16} />Voltar ao catálogo</Link><CatalogError message={error} onRetry={() => setRetry((value) => value + 1)} /></main>;
  const links = (anime.externalLinks || []).filter((link) => /^https:\/\//i.test(link.url));
  const seasons = (anime.relations || []).filter((relation) => relation.anime.id !== anime.id);
  const episodes = availability?.available ? availability.episodes : [];
  return <main id="main-content" className="details-page">
    <div className="details-banner">{(anime.banner || anime.poster) && <img src={anime.banner || anime.poster} alt="" />}<div className="details-banner-shade" /><div className="content-width"><Link to="/explore" className="back-link"><ArrowLeft size={16} />Voltar ao catálogo</Link></div></div>
    <div className="content-width details-body">
      <div className="details-main">
        <div className="details-aside"><img className="details-poster" src={anime.poster} alt={anime.title} /><div className="details-aside-note"><Bookmark size={15} />Seu próximo anime favorito?</div></div>
        <div className="details-content">
          <div className="details-top-meta">{anime.status && <span className={`status-pill ${anime.status === 'RELEASING' ? 'airing' : ''}`}>{anime.status === 'RELEASING' && <span />}{statusLabels[anime.status] || anime.status}</span>}{anime.format && <span>{anime.format.replace('_', ' ')}</span>}{anime.year && <span>{anime.year}</span>}</div>
          <h1>{anime.title}</h1>
          {anime.titleOriginal && anime.titleOriginal !== anime.title && <p className="details-original">{anime.titleOriginal}</p>}
          <div className="details-stats">{anime.score != null && <div className="details-score"><Star size={20} fill="currentColor" /><strong>{(anime.score / 10).toFixed(1)}</strong><span>Nota no AniList</span></div>}{anime.episodeCount != null && <div><MonitorPlay size={17} /><span>{anime.episodeCount} episódios no catálogo</span></div>}{anime.duration != null && <div><Clock3 size={16} /><span>{anime.duration} min por episódio</span></div>}</div>
          <div className="details-genres">{anime.genres.map((genre) => <Link className="genre-chip" key={genre} to={`/explore?genre=${encodeURIComponent(genre)}`}>{genreLabel(genre)}</Link>)}</div>
          <p className={`details-description ${expanded ? 'expanded' : ''}`}>{anime.description || 'A sinopse deste anime ainda não está disponível no catálogo.'}</p>
          {anime.description && anime.description.length > 400 && <button className="text-link synopsis-toggle" onClick={() => setExpandedAnime(expanded ? '' : animeId)} aria-expanded={expanded}>{expanded ? 'Ler menos' : 'Ler sinopse completa'}</button>}
          <div className="details-buttons">{episodes.length > 0 && <Link className="button-primary" to={`/watch/${encodeURIComponent(episodes[0].id)}`} state={{ anime }}><Play size={17} fill="currentColor" />Assistir</Link>}<button className={episodes.length > 0 ? 'button-secondary' : 'button-primary'} onClick={() => libraryService.toggle(anime)} aria-pressed={!!entry}>{entry ? <Check size={17} /> : <Bookmark size={17} />}{entry ? 'Na minha lista' : 'Adicionar à lista'}</button><button className={`button-secondary favorite-button ${entry?.favorite ? 'selected' : ''}`} onClick={() => libraryService.toggleFavorite(anime)} aria-pressed={!!entry?.favorite}>{<Heart size={17} fill={entry?.favorite ? 'currentColor' : 'none'} />}{entry?.favorite ? 'Favorito' : 'Favoritar'}</button></div>
        </div>
      </div>
      <section className="episodes-section"><div className="section-heading"><div><h2>Episódios e disponibilidade</h2><p>Uma boa experiência começa com uma fonte de reprodução autorizada.</p></div>{episodes.length > 0 && <span className="episode-count">{episodes.length} episódios disponíveis</span>}</div>
        {!availability && !streamError ? <div className="availability-loading skeleton" aria-busy="true" aria-label="Consultando episódios" /> : episodes.length ? <div className="episode-grid">{episodes.map((episode) => <Link key={episode.id} to={`/watch/${encodeURIComponent(episode.id)}`} state={{ anime }} className="episode-card">{episode.thumbnail && <div className="episode-thumbnail"><img src={episode.thumbnail} alt="" loading="lazy" /><Play size={21} /></div>}<div className="episode-caption">{episode.number != null && <span>EPISÓDIO {episode.number}</span>}<h3>{episode.title}</h3>{episode.duration != null && <small>{Math.round(episode.duration / 60)} min</small>}</div><Play size={18} /></Link>)}</div> : <div className="availability-panel"><span className="availability-icon"><MonitorPlay size={27} /></span><div><h3>{streamError ? 'Não foi possível consultar os episódios' : 'Este anime ainda não tem reprodução disponível aqui'}</h3><p>{streamError ? 'Tente novamente para verificar a disponibilidade das fontes autorizadas.' : availability?.message || 'O título faz parte do catálogo. Os episódios estarão disponíveis quando houver uma fonte de vídeo autorizada.'}</p><div className="availability-links">{streamError ? <button className="text-link" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button> : <Link to="/watch/demo" className="text-link">Conhecer o player · vídeo demonstrativo <ArrowUpRight size={15} /></Link>}</div></div></div>}
      </section>
      {links.length > 0 && <section className="external-section"><div><h3>Encontre mais sobre esta história</h3><p>Links oficiais e serviços informados pelo AniList. A disponibilidade varia por região.</p></div><div className="external-links">{links.map((link) => <a className="button-secondary button-sm" key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.site}<ExternalLink size={14} /></a>)}</div></section>}
      {seasons.length > 0 && <section className="catalog-row"><div className="section-heading"><div><h2>Temporadas e histórias relacionadas</h2><p>Continue explorando esse universo.</p></div></div><div className="relations-carousel scrollbar-hide">{seasons.map(({ relation, anime: related }) => <Link key={`${relation}-${related.id}`} className="relation-card" to={`/anime/${related.id}`}><img src={related.poster} alt="" loading="lazy" /><div><span>{relationLabels[relation] || relation}</span><h3>{related.title}</h3><small>{[related.year, related.format?.replace('_', ' ')].filter(Boolean).join(' · ')}</small></div><ArrowUpRight size={17} /></Link>)}</div></section>}
      {!!anime.characters?.length && <section className="catalog-row"><div className="section-heading"><div><h2>Quem faz parte desta história</h2><p>Personagens e seus papéis no anime.</p></div></div><div className="character-list">{anime.characters.map(character => <article key={character.id}>{character.image && <img src={character.image} alt="" loading="lazy" />}<div><h3>{character.name}</h3><p>{character.role === 'MAIN' ? 'Principal' : character.role === 'SUPPORTING' ? 'Coadjuvante' : 'Participação'}</p></div></article>)}</div></section>}
      {anime.recommendations && <AnimeRowCarousel title="Mais histórias para sua lista" subtitle="Recomendações da comunidade do AniList." animes={anime.recommendations} />}
    </div>
  </main>;
}
