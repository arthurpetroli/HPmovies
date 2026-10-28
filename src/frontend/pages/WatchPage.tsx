import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Film, Info, Loader2, Subtitles } from 'lucide-react';
import type { CatalogAnime, Playback, StreamingAvailability, StreamingEpisode, StreamSource, StreamSubtitle } from '../../shared/providers';
import { selectWatchEpisode, watchEpisodes, watchPlayback, watchStart } from '../services/watchEntry';
import { libraryService } from '../services/library';
import { catalogService } from '../services/catalog';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { VideoPlayer } from '../components/player/VideoPlayer';
import type { VideoPlayerHandle, VideoSourceError } from '../components/player/VideoPlayer';
import { WatchEpisodeList } from '../components/player/WatchEpisodeList';
import { WatchArtwork } from '../components/player/WatchLoadingShell';
import { orderedPlaybackSources, portugueseCaptionRank, subtitlesForSource } from '../components/player/playbackUtils';
import { sourceQuery, sourceSuffix, sourceTitles } from '../services/content';
import { AutomaticSubtitles } from '../components/player/AutomaticSubtitles';
import { episodeEnding, episodeIntro } from '../services/intro';
import { setWatchPreference, useWatchPreferences } from '../services/watchPreferences';
import '../watch.css';

interface WatchSession { key: string; playback: Playback; resumeTime: number; anime?: CatalogAnime }
interface WatchLocation { anime?: CatalogAnime; episode?: StreamingEpisode; autoPlay?: boolean; resume?: boolean; fromSources?: boolean }

export function WatchPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const [episodeAttempt, setEpisodeAttempt] = useState(0);
  const routeId = params['*'] || params.episodeId || '';
  const entryId = /^anime\/([^/]+)$/.exec(routeId)?.[1];
  const preferredEpisodeValue = query.get('episode');
  const preferredEpisode = preferredEpisodeValue !== null && /^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/.test(preferredEpisodeValue)
    && Number(preferredEpisodeValue) <= 100_000 ? Number(preferredEpisodeValue) : undefined;
  const routeEpisodeId = entryId ? '' : routeId;
  const state = location.state as WatchLocation | null;
  const suppliedAnime = state?.anime || libraryService.getProgress(routeEpisodeId)?.anime;
  const animeId = String(entryId || suppliedAnime?.id || /^(?:tatakai|toko):([1-9]\d*):/.exec(routeEpisodeId)?.[1] || '');
  const hasSuppliedAnime = !!suppliedAnime;
  const catalogLoader = useCallback(() => animeId && !hasSuppliedAnime ? catalogService.details(animeId) : Promise.resolve(null), [animeId, hasSuppliedAnime]);
  const catalog = useCatalogRequest(`watch-anime:${animeId}`, catalogLoader);
  const anime = suppliedAnime || catalog.data || undefined;
  const requestQuery = sourceQuery(query);
  const rememberedTitles = sourceTitles.get('anime', routeEpisodeId);
  const titleHints = requestQuery.titles?.length ? requestQuery.titles : rememberedTitles.length ? rememberedTitles
    : state?.anime ? [state.anime.title, state.anime.titleOriginal || ''].filter(Boolean)
    : entryId && anime ? [anime.title, anime.titleOriginal || ''].filter(Boolean) : [];
  const hints = sourceSuffix({ ...requestQuery, titles: titleHints });
  const listTitleKey = JSON.stringify(titleHints.length ? titleHints : [anime?.title, anime?.titleOriginal].filter(Boolean));
  const indexEnabled = !!animeId && (listTitleKey !== '[]' || !catalog.loading);
  const episodesLoader = useCallback(() => indexEnabled ? watchEpisodes(animeId, JSON.parse(listTitleKey) as string[], episodeAttempt > 0) : Promise.resolve(null), [indexEnabled, animeId, listTitleKey, episodeAttempt]);
  const episodeList = useCatalogRequest(`watch-episodes:${animeId}:${listTitleKey}:${indexEnabled}:${episodeAttempt}`, episodesLoader);
  const startEnabled = !!entryId && indexEnabled;
  const entryLoader = useCallback(() => startEnabled ? watchStart(animeId, JSON.parse(listTitleKey) as string[], episodeAttempt > 0, preferredEpisode) : Promise.resolve(null), [startEnabled, animeId, listTitleKey, episodeAttempt, preferredEpisode]);
  const entry = useCatalogRequest(`watch-start:${animeId}:${listTitleKey}:${startEnabled}:${episodeAttempt}:${preferredEpisode}`, entryLoader);
  const selected = entryId ? entry.data?.episode || (!entry.loading && preferredEpisode === undefined ? selectWatchEpisode(entryId, episodeList.data?.episodes || []) : undefined) : undefined;
  const episodeId = selected?.id || routeEpisodeId;
  const entryError = entryId && startEnabled && !entry.loading && (preferredEpisode !== undefined || !episodeList.loading) && !selected
    ? entry.error || episodeList.error || episodeList.data?.message || 'Os episódios deste anime ainda não foram encontrados nas fontes conectadas.' : '';
  const context = entryId ? { ...state, anime, episode: selected, resume: true } : state;

  useEffect(() => {
    if (entryId && selected) navigate(`/watch/${encodeURIComponent(selected.id)}${hints}`, {
      replace: true, state: { anime, episode: selected, autoPlay: state?.autoPlay === true, resume: true },
    });
  }, [entryId, selected, hints, anime, state?.autoPlay, navigate]);

  // One route component keeps the stage mounted during entry and episode changes.
  return <WatchEpisode episodeId={episodeId} context={context} hints={hints} anime={anime} entryMode={!!entryId}
    entryError={entryError} episodeList={{ ...episodeList, loading: !!entryId && !indexEnabled || episodeList.loading }}
    onRetryEpisodes={() => setEpisodeAttempt(value => value + 1)} />;
}

interface WatchEpisodeProps {
  episodeId: string;
  context: WatchLocation | null;
  hints: string;
  anime?: CatalogAnime;
  entryMode: boolean;
  entryError: string;
  episodeList: { data: StreamingAvailability | null; loading: boolean; error: string };
  onRetryEpisodes: () => void;
}

function WatchEpisode({ episodeId, context, hints, anime, entryMode, entryError, episodeList, onRetryEpisodes }: WatchEpisodeProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const playerRef = useRef<VideoPlayerHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<WatchSession | null>(null);
  const [source, setSource] = useState<StreamSource | null>(null);
  const [captionStatus, setCaptionStatus] = useState({ sourceUrl: '', machineTranslated: false });
  const [result, setResult] = useState({ key: '', error: '' });
  const [attempt, setAttempt] = useState(0);
  const [sourceAttempt, setSourceAttempt] = useState(0);
  const [continuePlaying, setContinuePlaying] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const failedSourcesRef = useRef(new Set<string>());
  const { autoNext, autoSkipIntro } = useWatchPreferences();
  const sourceEpisode = /^(tatakai|toko):([1-9]\d*):(\d+(?:\.\d+)?)$/.exec(episodeId);
  const titleKey = JSON.stringify(sourceQuery(new URLSearchParams(hints)).titles);
  const episodes = episodeList.data?.episodes || [];
  const requestKey = `${episodeId}:${hints}:${attempt}`;
  const loading = !episodeId || result.key !== requestKey;
  const error = !episodeId ? entryError : loading ? '' : result.error;
  const playback = session?.playback;
  const ready = !loading && !error && session?.key === requestKey && !!source;
  const navigationAutoPlay = context?.autoPlay === true && window.history.state?.usr?.autoPlay === true;
  const initialIntentRef = useRef({ key: requestKey, autoPlay: navigationAutoPlay, resume: context?.resume === true, anime });
  useLayoutEffect(() => {
    if (initialIntentRef.current.key !== requestKey) initialIntentRef.current = { key: requestKey, autoPlay: navigationAutoPlay, resume: context?.resume === true, anime };
  }, [requestKey, context, anime, navigationAutoPlay]);
  const incoming = context?.episode?.id === episodeId ? context.episode : episodes.find(episode => episode.id === episodeId);
  const displayedEpisode = ready && playback ? {
    ...playback.episode,
    title: /^Episódio \d+(?:\.\d+)?$/.test(playback.episode.title) ? incoming?.title || playback.episode.title : playback.episode.title,
    thumbnail: playback.episode.thumbnail || incoming?.thumbnail,
  } : incoming;
  const displayedTitle = displayedEpisode?.title || (sourceEpisode ? `Episódio ${sourceEpisode[3]}` : episodeId === 'demo' ? 'Demonstração do player' : 'Episódio');
  const artwork = displayedEpisode?.thumbnail || anime?.banner || anime?.poster;
  const sourceBack = new URLSearchParams(hints);
  if (sourceEpisode) { sourceBack.set('kind', 'anime'); sourceBack.set('id', sourceEpisode[2]); sourceBack.set('episode', sourceEpisode[3]); }
  const returnToSources = context?.fromSources || !!sourceQuery(new URLSearchParams(hints)).source;
  const backPath = returnToSources && sourceEpisode ? `/sources?${sourceBack}` : anime ? `/anime/${encodeURIComponent(anime.id)}` : sourceEpisode ? `/sources?${sourceBack}` : '/explore';
  const backLabel = returnToSources && sourceEpisode ? 'Voltar às fontes' : anime ? 'Voltar ao anime' : sourceEpisode ? 'Voltar às fontes' : 'Voltar ao catálogo';

  useLayoutEffect(() => {
    // Navigation intent is consumed once. Reloads/history must resume progress,
    // and a later source retry must not restart the new episode from zero.
    // Updating only this browser entry avoids scheduling a router replacement
    // that could race Back while a cached episode is already ready to display.
    if (!episodeId || entryMode || !context?.autoPlay) return;
    const browserState = window.history.state as { key?: string; usr?: WatchLocation } | null;
    if ((browserState?.key || 'default') !== location.key || window.location.pathname !== location.pathname || window.location.search !== location.search) return;
    window.history.replaceState({ ...browserState, usr: { ...context, autoPlay: false, resume: false } }, '');
  }, [context, episodeId, entryMode, location.key, location.pathname, location.search]);

  useEffect(() => {
    if (!episodeId) return;
    let active = true;
    const intent = initialIntentRef.current;
    const queryTitles = JSON.parse(titleKey) as string[];
    const titles = queryTitles?.length ? queryTitles : intent.anime ? [intent.anime.title, intent.anime.titleOriginal || ''].filter(Boolean) : sourceTitles.get('anime', episodeId);
    void watchPlayback(episodeId, titles, attempt > 0).then(value => {
      if (!active) return;
      if (!value.sources.length) throw new Error('A reprodução ainda não está disponível para este episódio.');
      sourceTitles.save('anime', episodeId, titles);
      const previous = libraryService.getProgress(episodeId);
      const startAutomatically = intent.autoPlay;
      intent.autoPlay = false;
      setSession({ key: requestKey, playback: value, anime: intent.anime, resumeTime: (!startAutomatically || intent.resume) && previous && !previous.completed ? previous.currentTime : 0 });
      setSource(orderedPlaybackSources(value)[0]);
      setSourceAttempt(value => value + 1);
      failedSourcesRef.current.clear();
      setRecoveryNotice(null);
      setExhausted(false);
      setContinuePlaying(startAutomatically);
      setResult({ key: requestKey, error: '' });
    }).catch((cause: unknown) => {
      if (active) setResult({ key: requestKey, error: cause instanceof Error ? cause.message : 'Não foi possível carregar o vídeo. Tente novamente em instantes.' });
    });
    return () => { active = false; };
  }, [episodeId, requestKey, titleKey, attempt]);

  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const observer = new ResizeObserver(() => {
      screen.closest<HTMLElement>('.watch-layout')?.style.setProperty('--watch-player-height', `${screen.getBoundingClientRect().height}px`);
    });
    observer.observe(screen);
    return () => observer.disconnect();
  }, []);

  const saveProgress = useCallback((currentTime: number, duration: number) => {
    if (!session) return;
    const sessionAnimeId = /^(?:tatakai|toko):([1-9]\d*):/.exec(session.playback.episode.id)?.[1];
    const progressAnime = session.anime || (anime?.id === sessionAnimeId ? anime : undefined);
    libraryService.saveProgress({ episodeId: session.playback.episode.id, title: session.playback.episode.title, anime: progressAnime, currentTime, duration });
  }, [session, anime]);
  const sourceUrl = source?.url ?? '';
  const playingEpisodeId = playback?.episode.id || episodeId;
  const resolveIntro = useCallback((duration: number, signal: AbortSignal) => episodeIntro(playingEpisodeId, duration, signal), [playingEpisodeId]);
  const resolveEnding = useCallback((duration: number, signal: AbortSignal) => episodeEnding(playingEpisodeId, duration, signal), [playingEpisodeId]);
  const nextEpisode = ready && playback?.nextEpisodeId ? episodes.find(episode => episode.id === playback.nextEpisodeId) : undefined;
  const indexedEpisodes = episodes.filter(item => item.id.split(':')[0] === episodeId.split(':')[0]);
  const indexedPosition = indexedEpisodes.findIndex(item => item.id === episodeId);
  const nextCandidate = ready ? playback?.nextEpisodeId || (indexedPosition >= 0 ? indexedEpisodes[indexedPosition + 1]?.id : undefined) : undefined;
  const nextId = episodes.find(item => item.id === nextCandidate)?.available === false ? undefined : nextCandidate;
  const previousCandidate = ready ? playback?.previousEpisodeId || (indexedPosition > 0 ? indexedEpisodes[indexedPosition - 1]?.id : undefined) : undefined;
  const previousId = episodes.find(item => item.id === previousCandidate)?.available === false ? undefined : previousCandidate;
  const prepareNextEpisode = useCallback(() => {
    if (nextId) void watchPlayback(nextId, JSON.parse(titleKey) as string[]).catch(() => { /* Optional preparation never interrupts the current episode. */ });
  }, [nextId, titleKey]);
  const navigateEpisode = (episode: StreamingEpisode) => {
    if (episode.id === episodeId || episode.available === false) return;
    navigate(`/watch/${encodeURIComponent(episode.id)}${hints}`, { state: { anime, episode, autoPlay: true, fromSources: context?.fromSources } });
  };
  const goToNextEpisode = () => {
    // BrowserRouter updates the URL before React commits the next episode.
    // Deduplicate that pending target, while allowing Back to reopen it even
    // when the intervening React render was cancelled before its commit.
    if (!nextId || window.location.pathname === `/watch/${encodeURIComponent(nextId)}`) return;
    navigateEpisode(nextEpisode || episodes.find(episode => episode.id === nextId) || { id: nextId, title: 'Próximo episódio' });
  };
  const updateCaptionStatus = useCallback((subtitle: StreamSubtitle | undefined) => {
    const machineTranslated = subtitle?.machineTranslated === true;
    setCaptionStatus(previous => previous.sourceUrl === sourceUrl && previous.machineTranslated === machineTranslated
      ? previous : { sourceUrl, machineTranslated });
  }, [sourceUrl]);

  const recoverSource = useCallback((failure: VideoSourceError) => {
    if (!session || !source || session.key !== requestKey) return;
    failedSourcesRef.current.add(source.url);
    // Each distinct URL is tried once per cycle. A source can appear more than
    // once with different labels, so indexes alone cannot bound recovery.
    const next = orderedPlaybackSources(session.playback).find(item => !failedSourcesRef.current.has(item.url));
    if (!next) {
      setExhausted(true);
      setRecoveryNotice('Todas as fontes disponíveis falharam. Você pode escolher uma fonte manualmente ou tentar as fontes novamente.');
      return;
    }
    setSession({ ...session, resumeTime: failure.currentTime });
    setContinuePlaying(failure.playRequested);
    setRecoveryNotice(`A fonte anterior não respondeu. Tentando ${next.label || 'outra fonte disponível'}…`);
    setSource(next);
  }, [session, source, requestKey]);
  const chooseSource = (chosen: StreamSource) => {
    if (!session) return;
    setSession({ ...session, resumeTime: playerRef.current?.getPosition() ?? session.resumeTime });
    setContinuePlaying(playerRef.current?.getPlayRequested() ?? false);
    failedSourcesRef.current.clear();
    setExhausted(false);
    setRecoveryNotice(null);
    setSource(chosen);
    setSourceAttempt(value => value + 1);
  };
  const addAutomaticSubtitle = (track: StreamSubtitle) => {
    if (!session || !source) return;
    const tracks = [track, ...subtitlesForSource(session.playback, source).filter(item => item.id !== track.id)];
    const updatedSource = { ...source, subtitles: tracks };
    setSession({ ...session, playback: { ...session.playback,
      sources: session.playback.sources.map(item => item.url === source.url ? updatedSource : item),
      ...(session.playback.sources[0]?.url === source.url ? { subtitles: tracks } : {}),
    } });
    setSource(updatedSource);
    playerRef.current?.selectSubtitle(track);
  };
  const activeSubtitles = playback && source ? subtitlesForSource(playback, source) : [];
  const portugueseRank = Math.min(4, ...activeSubtitles.map(track => portugueseCaptionRank(track.language)));

  return <main id="main-content" className="watch-page">
    {anime && <div className="watch-backdrop" aria-hidden="true"><WatchArtwork image={anime.banner} fallback={anime.poster} /></div>}
    <div className="watch-layout">
      <div className="watch-screen" ref={screenRef}>
        <div className="watch-stage" ref={stageRef} aria-busy={loading && !error} aria-label="Área de reprodução">
          {session && source ? <VideoPlayer ref={playerRef} key={`${session.key}:${source.url}:${sourceAttempt}`} source={source}
            fullscreenContainerRef={stageRef} suspended={!ready} autoSkipIntro={autoSkipIntro} poster={session.playback.episode.thumbnail || anime?.banner || anime?.poster}
            subtitles={activeSubtitles} intro={source.url === session.playback.sources[0]?.url ? session.playback.intro : undefined}
            introResolver={resolveIntro} ending={source.url === session.playback.sources[0]?.url ? session.playback.ending : undefined}
            endingResolver={nextId ? resolveEnding : undefined} onNextEpisode={nextId ? goToNextEpisode : undefined}
            onPrepareNextEpisode={nextId ? prepareNextEpisode : undefined}
            onEnded={autoNext && nextId ? goToNextEpisode : undefined} initialTime={session.resumeTime} onProgress={saveProgress}
            onSourceError={recoverSource} onSourcePlaying={() => setRecoveryNotice(null)} onSubtitleChange={updateCaptionStatus} autoPlay={continuePlaying} />
            : <WatchArtwork image={artwork} fallback={anime?.poster} />}
          {!ready && <div className={`watch-transition${error ? ' is-error' : ''}`}>
            <WatchArtwork image={artwork} fallback={anime?.poster} />
            {error ? <><Film size={28} aria-hidden="true" /><h2>{episodeId === 'demo' ? 'Não foi possível preparar o player' : 'Episódio indisponível'}</h2><p role="alert">{error}</p><button className="button-primary" onClick={() => episodeId ? setAttempt(value => value + 1) : onRetryEpisodes()}>Tentar novamente</button></>
              : <><Loader2 size={32} className="animate-spin" aria-hidden="true" /><span role="status">{incoming?.number != null ? `Preparando episódio ${incoming.number}…` : 'Abrindo episódio…'}</span><small>{anime?.title || displayedTitle}</small></>}
          </div>}
        </div>
        <div className="watch-transport">
          <label className="watch-autonext"><input type="checkbox" checked={autoNext} onChange={event => setWatchPreference('autoNext', event.target.checked)} />Avançar ao terminar</label>
          <nav className="watch-navigation" aria-label="Navegação entre episódios">
            {previousId && <Link to={`/watch/${encodeURIComponent(previousId)}${hints}`} state={{ anime, episode: episodes.find(item => item.id === previousId), autoPlay: true }}><ArrowLeft size={15} aria-hidden="true" />Episódio anterior</Link>}
            {nextId && <Link to={`/watch/${encodeURIComponent(nextId)}${hints}`} state={{ anime, episode: nextEpisode, autoPlay: true }} onPointerEnter={prepareNextEpisode} onFocus={prepareNextEpisode} onClick={event => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault(); goToNextEpisode();
            }}>Próximo episódio<ArrowRight size={15} aria-hidden="true" /></Link>}
          </nav>
        </div>
        {ready && recoveryNotice && <div role="status" className={`mt-3 rounded-lg border px-4 py-3 text-sm ${exhausted ? 'border-amber-400/20 bg-amber-400/5 text-amber-200' : 'border-teal-400/20 bg-teal-400/5 text-slate-300'}`}><p>{recoveryNotice}</p>{exhausted && <button type="button" className="button-primary mt-3" onClick={() => setAttempt(value => value + 1)}>Tentar fontes novamente</button>}</div>}
      </div>
      <aside className="watch-sidebar"><WatchEpisodeList episodes={episodes} currentEpisodeId={episodeId} anime={anime} hints={hints}
        loading={episodeList.loading} error={episodeList.error || (episodeList.data?.state === 'connection_error' ? episodeList.data.message || 'Não foi possível carregar a lista.' : '')}
        onRetry={onRetryEpisodes} onNavigate={navigateEpisode} /></aside>
      <section className="watch-details">
        <p className="watch-episode-label"><Film size={14} aria-hidden="true" />{playback?.isDemo ? 'Demonstração do player' : displayedEpisode?.number != null ? `Episódio ${displayedEpisode.number}` : 'Agora assistindo'}</p>
        <h1>{displayedTitle}</h1>
        {anime ? <article className="watch-anime-summary">
          <Link className="watch-anime-poster" to={`/anime/${encodeURIComponent(anime.id)}`} aria-label={`Ver anime ${anime.title}`}><WatchArtwork image={anime.poster} /></Link>
          <div className="watch-anime-copy"><Link className="watch-anime-title" to={`/anime/${encodeURIComponent(anime.id)}`}>{anime.title}</Link>
            <p>{[anime.year, anime.format?.replaceAll('_', ' '), anime.episodeCount != null ? `${anime.episodeCount} episódios` : ''].filter(Boolean).join(' · ')}</p>
            {anime.description && <p className="watch-anime-description">{anime.description}</p>}
          </div>
          <Link className="button-secondary" to={`/anime/${encodeURIComponent(anime.id)}`}>Ver anime<ArrowRight size={15} aria-hidden="true" /></Link>
        </article> : <Link to={backPath} className="watch-breadcrumb"><ArrowLeft size={16} aria-hidden="true" />{backLabel}</Link>}
        {anime && returnToSources && <Link to={backPath} className="watch-breadcrumb"><ArrowLeft size={16} aria-hidden="true" />{backLabel}</Link>}
        {ready && playback && <>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-teal-400" />Fonte autorizada</span>
            <span className="flex items-center gap-1.5"><Subtitles size={14} />{portugueseRank === 0 ? 'Faixa PT-BR disponível' : portugueseRank < 4 ? 'Legenda em português disponível' : activeSubtitles.length ? 'Outros idiomas de legenda disponíveis' : 'Sem legendas disponíveis'}</span>
            {playback.audioLanguages.length > 0 && <span>Áudio: {playback.audioLanguages.join(', ')}</span>}
          </div>
          {activeSubtitles.some(track => track.id.startsWith('opensubtitles-')) && <p className="mt-4 text-xs leading-relaxed text-slate-400">Legendas externas do OpenSubtitles para este episódio. Se a versão tiver tempos diferentes, escolha outra faixa ou ajuste a sincronização nas configurações do player.</p>}
          {playback.isDemo && <div className="mt-6 flex gap-3 rounded-xl border border-teal-400/15 bg-teal-400/5 p-4 text-sm leading-relaxed text-slate-300"><Info className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" /><p>Este vídeo autorizado permite testar a reprodução, a qualidade e os controles. A faixa PT-BR contém orientações originais sobre o player. O catálogo de animes é separado da disponibilidade de episódios licenciados.</p></div>}
          {playback.attribution && <p className="mt-5 text-xs leading-relaxed text-slate-500">Conteúdo: <a href={playback.attribution.url} target="_blank" rel="noreferrer" className="text-slate-300 underline decoration-white/20 underline-offset-4 hover:text-teal-300">{playback.attribution.label}</a> · {playback.attribution.license}</p>}
        </>}
      </section>
      {ready && playback && source && <>
        <aside aria-labelledby="watch-experience-title" className="watch-preferences">
          <h2 id="watch-experience-title" className="text-base font-semibold text-white">Sua experiência</h2><p className="mt-2 text-xs leading-relaxed text-slate-500">A reprodução usa apenas as fontes disponíveis para este conteúdo.</p>
          <label className="mt-6 block"><span className="mb-2 block text-xs font-medium text-slate-400">Fonte de vídeo</span><select className="w-full rounded-lg border border-white/15 bg-[#151d25] px-3 py-2.5 text-sm text-white focus:border-teal-400 focus:outline-none" value={source.url} onChange={event => {
            const chosen = playback.sources.find(item => item.url === event.target.value);
            if (!chosen || chosen.url === source.url) return;
            chooseSource(chosen);
          }}>{orderedPlaybackSources(playback).map((item, index) => {
            const rank = Math.min(4, ...subtitlesForSource(playback, item).map(track => portugueseCaptionRank(track.language)));
            return <option key={`${item.url}:${index}`} value={item.url}>{item.label ?? (item.type === 'hls' ? 'HLS · qualidade automática' : 'MP4 · original')}{rank === 0 ? ' · legendas PT-BR' : rank < 4 ? ' · legendas em português' : ''}</option>;
          })}</select></label>
          <AutomaticSubtitles key={source.url} tracks={activeSubtitles} onReady={addAutomaticSubtitle} />
          {captionStatus.sourceUrl === source.url && captionStatus.machineTranslated && <p role="status" aria-atomic="true" className="mt-4 rounded-lg bg-white/5 p-3 text-xs leading-relaxed text-slate-300">Tradução automática: pode conter erros.</p>}
          <div className="mt-6 border-t border-white/10 pt-5"><h3 className="text-xs font-semibold text-slate-300">Controles rápidos</h3><dl className="mt-3 space-y-3 text-xs text-slate-500"><div className="flex justify-between gap-4"><dt>Reproduzir / pausar</dt><dd className="text-slate-300">Espaço ou K</dd></div><div className="flex justify-between gap-4"><dt>Avançar / voltar 10s</dt><dd className="text-slate-300">← / →</dd></div><div className="flex justify-between gap-4"><dt>Tela cheia / som</dt><dd className="text-slate-300">F / M</dd></div></dl><p className="mt-3 text-[11px] leading-relaxed text-slate-600">Os atalhos funcionam com o foco no player.</p></div>
          <div className="mt-6 rounded-lg bg-white/5 p-3 text-xs leading-relaxed text-slate-400">Seu progresso é salvo neste navegador. Use a página inicial para continuar assistindo depois.</div>
          {playback.attribution && <a className="mt-5 flex items-center justify-between gap-2 text-xs text-slate-400 transition hover:text-teal-300" href={playback.attribution.url} target="_blank" rel="noreferrer">Conhecer o projeto do vídeo<ExternalLink size={13} /></a>}
        </aside>
      </>}
    </div>
  </main>;
}
