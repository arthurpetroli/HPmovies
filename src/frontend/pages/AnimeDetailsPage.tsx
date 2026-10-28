import { useCallback, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bookmark, Check, ExternalLink, Film, Heart, Play, Star } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { CatalogAnime } from '../../shared/providers';
import { AnimeEpisodeList } from '../components/anime/AnimeEpisodeList';
import { AnimeWatchLink } from '../components/anime/AnimeWatchLink';
import { AnimeRowCarousel } from '../components/anime/AnimeRowCarousel';
import { genreLabel } from '../components/filters/genreLabels';
import { CatalogError } from '../components/ui/CatalogState';
import { catalogService } from '../services/catalog';
import { libraryService, useLibrary } from '../services/library';
import { streamingService } from '../services/streaming';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import '../animeDetails.css';

const statusLabels: Record<string, string> = { RELEASING: 'Em exibição', FINISHED: 'Concluído', NOT_YET_RELEASED: 'Em breve', CANCELLED: 'Cancelado', HIATUS: 'Em pausa' };
const formatLabels: Record<string, string> = { TV: 'Série de TV', TV_SHORT: 'Série curta', MOVIE: 'Filme', SPECIAL: 'Especial', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Música' };
const seasonLabels: Record<string, string> = { WINTER: 'Inverno', SPRING: 'Primavera', SUMMER: 'Verão', FALL: 'Outono' };
const countryLabels: Record<string, string> = { JP: 'Japão', CN: 'China', KR: 'Coreia do Sul', TW: 'Taiwan', US: 'Estados Unidos' };
const relationLabels: Record<string, string> = { SEQUEL: 'Continuação', PREQUEL: 'Anterior', SIDE_STORY: 'História paralela', ALTERNATIVE: 'Versão alternativa', SPIN_OFF: 'Spin-off', PARENT: 'História principal', SUMMARY: 'Resumo', COMPILATION: 'Compilação', OTHER: 'Relacionado', CHARACTER: 'Personagem' };
const monthLabels = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

function dateLabel(date: CatalogAnime['startDate']) {
  if (!date?.year) return 'Não informada';
  if (!date.month || !monthLabels[date.month - 1]) return String(date.year);
  return `${date.day ? `${date.day} de ` : ''}${monthLabels[date.month - 1]} de ${date.year}`;
}

function AnimeArtwork({ anime, backdrop = false }: { anime: CatalogAnime; backdrop?: boolean }) {
  const [failed, setFailed] = useState<string[]>([]);
  const sources = backdrop ? [anime.banner, anime.poster] : [anime.poster];
  const image = sources.find((source): source is string => !!source && !failed.includes(source));
  return image ? <img src={image} alt={backdrop ? '' : `Capa de ${anime.title}`} fetchPriority={backdrop ? 'auto' : 'high'} onError={() => setFailed(value => [...value, image])} />
    : <div className="anime-details-artwork-empty"><Film size={42} aria-hidden="true" /><span>{backdrop ? '' : anime.title}</span></div>;
}

function AnimeTrailer({ anime }: { anime: CatalogAnime }) {
  const [playing, setPlaying] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const trailer = anime.trailer;
  const youtube = trailer?.site === 'youtube' && /^[a-zA-Z0-9_-]{11}$/.test(trailer.id);
  const dailymotion = trailer?.site === 'dailymotion' && /^[a-zA-Z0-9]{1,32}$/.test(trailer.id);
  if (!trailer || !youtube && !dailymotion) return <div className="anime-details-trailer-empty"><Film size={24} aria-hidden="true" /><p>O catálogo ainda não informou um trailer.</p></div>;
  const href = youtube ? `https://www.youtube.com/watch?v=${trailer.id}` : `https://www.dailymotion.com/video/${trailer.id}`;
  const thumbnail = !imageFailed ? trailer.thumbnail || anime.banner || anime.poster : undefined;
  return <section className="anime-details-trailer" aria-labelledby="anime-trailer-heading">
    <div className="anime-details-section-title"><h2 id="anime-trailer-heading">Trailer</h2><a href={href} target="_blank" rel="noopener noreferrer">Abrir no {youtube ? 'YouTube' : 'Dailymotion'}<ExternalLink size={14} aria-hidden="true" /></a></div>
    {playing && youtube ? <iframe title={`Trailer de ${anime.title}`} src={`https://www.youtube-nocookie.com/embed/${trailer.id}?autoplay=1&rel=0`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      : youtube ? <button type="button" className="anime-details-trailer-preview" aria-label={`Reproduzir trailer de ${anime.title}`} onClick={() => setPlaying(true)}>
        {thumbnail && <img src={thumbnail} alt="" loading="lazy" onError={() => setImageFailed(true)} />}<span className="anime-details-trailer-play"><Play size={27} fill="currentColor" aria-hidden="true" /></span><span className="anime-details-trailer-caption">Assistir ao trailer</span>
      </button> : <a className="anime-details-trailer-preview" href={href} target="_blank" rel="noopener noreferrer">
        {thumbnail && <img src={thumbnail} alt="" loading="lazy" onError={() => setImageFailed(true)} />}<span className="anime-details-trailer-play"><Play size={27} fill="currentColor" aria-hidden="true" /></span><span className="anime-details-trailer-caption">Assistir ao trailer no Dailymotion</span>
      </a>}
  </section>;
}

export function AnimeDetailsPage() {
  const { animeId = '' } = useParams();
  const location = useLocation();
  const [retry, setRetry] = useState(0);
  const [episodeRetry, setEpisodeRetry] = useState(0);
  const [expandedAnime, setExpandedAnime] = useState('');
  const expanded = expandedAnime === animeId;
  const loader = useCallback(() => catalogService.details(animeId), [animeId]);
  const { data: anime, loading, error } = useCatalogRequest(`details:${animeId}:${retry}`, loader);
  const titleKey = JSON.stringify([anime?.title, anime?.titleOriginal].filter(Boolean));
  const streamLoader = useCallback(() => {
    const titles = JSON.parse(titleKey) as string[];
    return titles.length ? streamingService.episodes(animeId, titles) : Promise.resolve(null);
  }, [animeId, titleKey]);
  const { data: availability, error: streamError, loading: episodesLoading } = useCatalogRequest(`episodes:${animeId}:${titleKey}:${episodeRetry}`, streamLoader);
  const { list } = useLibrary();
  const entry = list.find((saved) => saved.anime.id === animeId);
  if (loading) return <main id="main-content" className="anime-details" aria-busy="true" aria-label="Carregando detalhes"><div className="anime-details-ambient skeleton" /><div className="anime-details-container"><div className="anime-details-loading"><div className="anime-details-cover skeleton" /><div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-meta" /><div className="skeleton skeleton-description" /></div></div></div></main>;
  if (error || !anime) return <main id="main-content" className="page-shell content-width"><Link className="back-link" to="/explore"><ArrowLeft size={16} />Voltar ao catálogo</Link><CatalogError message={error} onRetry={() => setRetry((value) => value + 1)} /></main>;
  const links = (anime.externalLinks || []).filter((link) => /^https:\/\//i.test(link.url));
  const seasons = (anime.relations || []).filter((relation) => relation.anime.id !== anime.id);
  const firstEpisode = availability?.episodes.find(episode => episode.available !== false);
  const season = [anime.season ? seasonLabels[anime.season] || anime.season : '', anime.year].filter(Boolean).join(' de ');
  const facts = [
    ['Formato', anime.format ? formatLabels[anime.format] || anime.format.replaceAll('_', ' ') : 'Não informado'],
    ['Status', anime.status ? statusLabels[anime.status] || anime.status : 'Não informado'],
    ['Nota', anime.score != null ? `${(anime.score / 10).toFixed(1)} / 10 no AniList` : 'Ainda sem nota'],
    ['Episódios', anime.episodeCount != null ? `${anime.episodeCount} no catálogo` : 'Não informado'],
    ['Duração', anime.duration != null ? `${anime.duration} min por episódio` : 'Não informada'],
    ['Temporada', season || 'Não informada'],
    ['Estreia', dateLabel(anime.startDate || (anime.year ? { year: anime.year } : undefined))],
    ['Conclusão', dateLabel(anime.endDate)],
    ['Estúdios', anime.studios?.length ? anime.studios.join(', ') : 'Não informados'],
    ['Popularidade', anime.popularity != null ? `${anime.popularity.toLocaleString('pt-BR')} listas no AniList` : 'Não informada'],
    ['País de origem', anime.countryOfOrigin ? countryLabels[anime.countryOfOrigin] || anime.countryOfOrigin : 'Não informado'],
    ['Título original', anime.titleOriginal || 'Não informado'],
    ...(anime.titleNative ? [['Título nativo', anime.titleNative]] : []),
  ];
  const sections = [
    { id: 'visao-geral', label: 'Visão geral' }, { id: 'episodios', label: 'Episódios' },
    ...(anime.characters?.length ? [{ id: 'personagens', label: 'Personagens' }] : []),
    ...(seasons.length ? [{ id: 'relacionados', label: 'Relacionados' }] : []),
  ];
  return <main id="main-content" className="anime-details">
    <div className="anime-details-ambient" aria-hidden="true"><AnimeArtwork key={`background-${anime.id}`} anime={anime} backdrop /></div>
    <div className="anime-details-container">
      <Link to="/explore" className="anime-details-back"><ArrowLeft size={16} aria-hidden="true" />Voltar ao catálogo</Link>
      <div className="anime-details-grid">
        <aside className="anime-details-sidebar" aria-label="Capa e informações do anime">
          <div className="anime-details-cover"><AnimeArtwork key={anime.id} anime={anime} /></div>
          <div className={`anime-details-actions${firstEpisode ? '' : ' has-no-watch'}`}>
            {firstEpisode && <AnimeWatchLink anime={anime} className="anime-details-watch"><Play size={18} fill="currentColor" aria-hidden="true" />Assistir agora</AnimeWatchLink>}
            <div className="anime-details-save-actions"><button type="button" onClick={() => libraryService.toggle(anime)} aria-pressed={!!entry}>{entry ? <Check size={17} aria-hidden="true" /> : <Bookmark size={17} aria-hidden="true" />}{entry ? 'Na minha lista' : 'Adicionar à lista'}</button><button type="button" className={entry?.favorite ? 'is-favorite' : ''} onClick={() => libraryService.toggleFavorite(anime)} aria-pressed={!!entry?.favorite} aria-label={entry?.favorite ? 'Remover dos favoritos' : 'Favoritar'} title={entry?.favorite ? 'Remover dos favoritos' : 'Favoritar'}><Heart size={18} fill={entry?.favorite ? 'currentColor' : 'none'} aria-hidden="true" /></button></div>
          </div>
          <section className="anime-details-facts" aria-labelledby="anime-facts-heading"><h2 id="anime-facts-heading">Informações do anime</h2><dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
        </aside>
        <div className="anime-details-main">
          <header className="anime-details-heading">
            <div className="anime-details-topline">{anime.status && <span className={anime.status === 'RELEASING' ? 'is-airing' : ''}>{anime.status === 'RELEASING' && <span className="anime-details-live-dot" />}{statusLabels[anime.status] || anime.status}</span>}{anime.format && <span>{formatLabels[anime.format] || anime.format}</span>}{anime.year && <span>{anime.year}</span>}</div>
            <h1>{anime.title}</h1>
            {anime.titleOriginal && anime.titleOriginal !== anime.title && <p className="anime-details-original">{anime.titleOriginal}</p>}
            {anime.score != null && <p className="anime-details-rating"><Star size={17} fill="currentColor" aria-hidden="true" /><strong>{(anime.score / 10).toFixed(1)}</strong><span>/ 10 no AniList</span></p>}
            {anime.genres.length > 0 && <div className="anime-details-genres" aria-label="Gêneros">{anime.genres.map((genre) => <Link key={genre} to={`/explore?genre=${encodeURIComponent(genre)}`}>{genreLabel(genre)}</Link>)}</div>}
          </header>
          <nav className="anime-details-sections" aria-label="Seções do anime">{sections.map(section => <a key={section.id} href={`#${section.id}`} aria-current={(location.hash || '#visao-geral') === `#${section.id}` ? 'location' : undefined}>{section.label}</a>)}</nav>
          <div className="anime-details-body">
            <section className="anime-details-overview" aria-labelledby="anime-overview-heading" id="visao-geral">
              <div className="anime-details-section-title"><h2 id="anime-overview-heading">Sobre o anime</h2></div>
              <p className={`anime-details-synopsis${expanded ? ' is-expanded' : ''}`}>{anime.description?.replace(/\n{3,}/g, '\n\n') || 'A sinopse deste anime ainda não está disponível no catálogo.'}</p>
              {anime.description && anime.description.length > 400 && <button type="button" className="anime-details-expand" onClick={() => setExpandedAnime(expanded ? '' : animeId)} aria-expanded={expanded}>{expanded ? 'Ler menos' : 'Ler sinopse completa'}</button>}
              <AnimeTrailer key={anime.id} anime={anime} />
            </section>
            <AnimeEpisodeList key={animeId} anime={anime} availability={availability} loading={episodesLoading} error={streamError} onRetry={() => setEpisodeRetry(value => value + 1)} />
            {!!anime.characters?.length && <section className="anime-details-characters" id="personagens" aria-labelledby="anime-characters-heading"><div className="anime-details-section-title"><h2 id="anime-characters-heading">Personagens</h2><span>Quem faz parte desta história</span></div><div className="character-list">{anime.characters.map(character => <article key={character.id}>{character.image ? <img src={character.image} alt="" loading="lazy" /> : <span className="anime-details-character-empty"><Film size={22} aria-hidden="true" /></span>}<div><h3>{character.name}</h3><p>{character.role === 'MAIN' ? 'Principal' : character.role === 'SUPPORTING' ? 'Coadjuvante' : 'Participação'}</p></div></article>)}</div></section>}
            {seasons.length > 0 && <section className="anime-details-relations" id="relacionados" aria-labelledby="anime-relations-heading"><div className="anime-details-section-title"><h2 id="anime-relations-heading">Temporadas e histórias relacionadas</h2></div><div className="relations-carousel scrollbar-hide">{seasons.map(({ relation, anime: related }) => <Link key={`${relation}-${related.id}`} className="relation-card" to={`/anime/${related.id}`}><img src={related.poster} alt="" loading="lazy" /><div><span>{relationLabels[relation] || relation}</span><h3>{related.title}</h3><small>{[related.year, related.format?.replace('_', ' ')].filter(Boolean).join(' · ')}</small></div><ArrowUpRight size={17} aria-hidden="true" /></Link>)}</div></section>}
            {anime.recommendations && <AnimeRowCarousel title="Mais histórias para sua lista" subtitle="Recomendações da comunidade do AniList." animes={anime.recommendations} />}
            {links.length > 0 && <section className="anime-details-external" aria-labelledby="anime-external-heading"><div className="anime-details-section-title"><h2 id="anime-external-heading">Explore mais</h2></div><p>Sites e serviços informados pelo AniList. A disponibilidade varia por região.</p><div>{links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.site}<ExternalLink size={14} aria-hidden="true" /></a>)}</div></section>}
          </div>
        </div>
      </div>
    </div>
  </main>;
}
