import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Film, Loader2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AdultGate } from '../components/adult/AdultGate';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { WatchArtwork } from '../components/player/WatchLoadingShell';
import { orderedPlaybackSources, subtitlesForSource } from '../components/player/playbackUtils';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { adultService } from '../services/adult';
import { setWatchPreference, useWatchPreferences } from '../services/watchPreferences';
import '../watch.css';
import '../adult.css';

export function AdultWatchPage() {
  return <AdultGate><AdultWatch /></AdultGate>;
}

/** A lean player page: no history, list or "continue watching" entries for adult titles. */
function AdultWatch() {
  const { animeId = '', episode: episodeParam = '' } = useParams();
  const episode = /^[1-9]\d{0,3}$/.test(episodeParam) ? Number(episodeParam) : 0;
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const { autoNext } = useWatchPreferences();
  const [attempt, setAttempt] = useState({ key: '', count: 0 });
  const key = `${animeId}:${episode}`;
  const count = attempt.key === key ? attempt.count : 0;
  const retry = () => setAttempt({ key, count: count + 1 });

  const detailsLoader = useCallback(() => adultService.details(animeId), [animeId]);
  const details = useCatalogRequest(`adult-watch-details:${animeId}`, detailsLoader);
  const episodesLoader = useCallback(() => adultService.episodes(animeId), [animeId]);
  const episodes = useCatalogRequest(`adult-watch-episodes:${animeId}`, episodesLoader);
  const playbackLoader = useCallback(() => episode ? adultService.playback(animeId, episode, count > 0) : Promise.reject(new Error('Episódio inválido.')), [animeId, episode, count]);
  const playback = useCatalogRequest(`adult-playback:${key}:${count}`, playbackLoader);

  // Failed sources are skipped in order; a manual choice overrides the order.
  const sessionKey = `${key}:${count}`;
  const [choice, setChoice] = useState<{ key: string; url: string; failed: string[] }>({ key: '', url: '', failed: [] });
  const current = choice.key === sessionKey ? choice : { key: sessionKey, url: '', failed: [] };
  const sources = playback.data ? orderedPlaybackSources(playback.data) : [];
  const source = sources.find(item => item.url === current.url && !current.failed.includes(item.url)) ?? sources.find(item => !current.failed.includes(item.url));
  const exhausted = !!playback.data && !source;

  const anime = details.data;
  const list = episodes.data?.episodes ?? [];
  const position = list.findIndex(item => item.number === episode);
  const next = position >= 0 ? list.slice(position + 1).find(item => item.available !== false) : undefined;
  const previous = position > 0 ? list.slice(0, position).reverse().find(item => item.available !== false) : undefined;
  const watchPath = (number?: number) => `/adult/watch/${encodeURIComponent(animeId)}/${number}`;
  const goToNext = next?.number ? () => navigate(watchPath(next.number)) : undefined;
  const artwork = anime?.banner || anime?.poster;

  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const observer = new ResizeObserver(() => screen.closest<HTMLElement>('.watch-layout')?.style.setProperty('--watch-player-height', `${screen.getBoundingClientRect().height}px`));
    observer.observe(screen);
    return () => observer.disconnect();
  }, []);

  return <main id="main-content" className="watch-page adult-watch">
    {anime && <div className="watch-backdrop" aria-hidden="true"><WatchArtwork image={anime.banner} fallback={anime.poster} /></div>}
    <div className="watch-layout">
      <div className="watch-screen" ref={screenRef}>
        <div className="watch-stage" ref={stageRef} aria-busy={playback.loading} aria-label="Área de reprodução">
          {source && playback.data ? <VideoPlayer key={`${sessionKey}:${source.url}`} source={source} poster={artwork} subtitles={subtitlesForSource(playback.data, source)}
            fullscreenContainerRef={stageRef} autoPlay onRetrySources={retry} onNextEpisode={goToNext} onEnded={autoNext ? goToNext : undefined}
            onSourceError={() => setChoice({ key: sessionKey, url: '', failed: [...current.failed, source.url] })} />
            : <div className={`watch-transition${playback.error || exhausted ? ' is-error' : ''}`}>
              <WatchArtwork image={artwork} fallback={anime?.poster} />
              {playback.loading ? <><Loader2 size={32} className="animate-spin" aria-hidden="true" /><span role="status">Preparando episódio {episode}…</span><small>{anime?.title}</small></>
                : <><Film size={28} aria-hidden="true" /><h2>Episódio indisponível</h2><p role="alert">{playback.error || 'Todas as fontes disponíveis falharam neste episódio.'}</p><button type="button" className="button-primary" onClick={retry}>Consultar as fontes novamente</button></>}
            </div>}
        </div>
        <div className="watch-transport">
          <label className="watch-autonext"><input type="checkbox" checked={autoNext} onChange={event => setWatchPreference('autoNext', event.target.checked)} />Avançar ao terminar</label>
          <nav className="watch-navigation" aria-label="Navegação entre episódios">
            {previous?.number && <Link to={watchPath(previous.number)}><ArrowLeft size={15} aria-hidden="true" />Episódio anterior</Link>}
            {next?.number && <Link to={watchPath(next.number)}>Próximo episódio<ArrowRight size={15} aria-hidden="true" /></Link>}
          </nav>
        </div>
      </div>
      <aside className="watch-sidebar">
        <section className="adult-watch-episodes" aria-labelledby="adult-watch-episodes-heading">
          <h2 id="adult-watch-episodes-heading">Episódios</h2>
          {episodes.loading ? <p role="status">Consultando as fontes…</p> : episodes.error ? <p role="alert">{episodes.error}</p>
            : list.length ? <ol>{list.map(item => <li key={item.id}>{item.available === false
              ? <span aria-disabled="true">Episódio {item.number} · indisponível</span>
              : <Link to={watchPath(item.number)} aria-current={item.number === episode ? 'page' : undefined}><strong>Episódio {item.number}</strong>{item.title !== `Episódio ${item.number}` && <small>{item.title}</small>}</Link>}</li>)}</ol>
            : <p>{episodes.data?.message || 'Nenhum episódio encontrado.'}</p>}
        </section>
      </aside>
      <section className="watch-details">
        <p className="watch-episode-label"><Film size={14} aria-hidden="true" />Episódio {episode}</p>
        <h1>{anime?.title ?? 'Conteúdo adulto'}</h1>
        <Link to={`/adult/anime/${encodeURIComponent(animeId)}`} className="watch-breadcrumb"><ArrowLeft size={16} aria-hidden="true" />Voltar ao título</Link>
        {playback.data && sources.length > 1 && <label className="adult-source-choice"><span>Fonte de vídeo</span>
          <select className="field-control" value={source?.url ?? ''} onChange={event => setChoice({ key: sessionKey, url: event.target.value, failed: current.failed.filter(url => url !== event.target.value) })}>
            {sources.map((item, index) => <option key={`${item.url}:${index}`} value={item.url}>{item.label ?? (item.type === 'hls' ? 'HLS · qualidade automática' : 'MP4 · original')}</option>)}
          </select></label>}
        <p className="adult-privacy-note">O progresso do conteúdo adulto não é salvo no histórico nem em Continuar assistindo.</p>
      </section>
    </div>
  </main>;
}
