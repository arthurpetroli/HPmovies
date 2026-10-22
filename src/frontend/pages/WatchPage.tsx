import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Film, Info, Loader2, Subtitles } from 'lucide-react';
import type { CatalogAnime, Playback, StreamSource } from '../../shared/providers';
import { streamingService } from '../services/streaming';
import { libraryService } from '../services/library';
import { VideoPlayer } from '../components/player/VideoPlayer';
import type { VideoPlayerHandle, VideoSourceError } from '../components/player/VideoPlayer';
import { orderedPlaybackSources, portugueseCaptionRank, subtitlesForSource } from '../components/player/playbackUtils';
import { sourceQuery, sourceSuffix, sourceTitles } from '../services/content';

interface WatchSession { playback: Playback; resumeTime: number }

export function WatchPage() {
  const params = useParams();
  const location = useLocation();
  const [query] = useSearchParams();
  const episodeId = params['*'] || params.episodeId || '';
  const state = location.state as { anime?: CatalogAnime } | null;
  const requestQuery = sourceQuery(query);
  const hints = sourceSuffix({ ...requestQuery, titles: requestQuery.titles?.length ? requestQuery.titles : sourceTitles.get('anime', episodeId) });
  return <WatchEpisode key={`${episodeId}:${hints}`} episodeId={episodeId} anime={state?.anime} hints={hints} />;
}

function WatchEpisode({ episodeId, anime, hints }: { episodeId: string; anime?: CatalogAnime; hints: string }) {
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [session, setSession] = useState<WatchSession | null>(null);
  const [source, setSource] = useState<StreamSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const failedSourcesRef = useRef(new Set<string>());
  const [sourceAttempt, setSourceAttempt] = useState(0);
  const [continuePlaying, setContinuePlaying] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const sourceEpisode = /^(tatakai|toko):([1-9]\d*):(\d+(?:\.\d+)?)$/.exec(episodeId);
  const sourceBack = new URLSearchParams(hints);
  if (sourceEpisode) { sourceBack.set('kind', 'anime'); sourceBack.set('id', sourceEpisode[2]); sourceBack.set('episode', sourceEpisode[3]); }
  const backPath = !anime && sourceEpisode ? `/sources?${sourceBack}` : '/explore';

  useEffect(() => {
    let active = true;
    const queryTitles = sourceQuery(new URLSearchParams(hints)).titles;
    const titles = queryTitles?.length ? queryTitles : anime ? [anime.title, anime.titleOriginal || ''].filter(Boolean) : sourceTitles.get('anime', episodeId);
    void streamingService.playback(episodeId, titles).then(playback => {
      if (!active) return;
      if (!playback.sources.length) throw new Error('A reprodução ainda não está disponível para este episódio.');
      sourceTitles.save('anime', episodeId, titles);
      const previous = libraryService.getProgress(episodeId);
      setSession({ playback, resumeTime: previous && !previous.completed ? previous.currentTime : 0 });
      setSource(orderedPlaybackSources(playback)[0]);
      failedSourcesRef.current.clear();
      setRecoveryNotice(null);
      setExhausted(false);
      setContinuePlaying(false);
      setError(null);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      setSession(null);
      setSource(null);
      setLoading(false);
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o vídeo. Tente novamente em instantes.');
    });
    return () => { active = false; };
  }, [episodeId, attempt, anime, hints]);

  const saveProgress = useCallback((currentTime: number, duration: number) => {
    if (!session) return;
    libraryService.saveProgress({ episodeId, title: session.playback.episode.title, anime, currentTime, duration });
  }, [episodeId, session, anime]);

  const recoverSource = useCallback((failure: VideoSourceError) => {
    if (!session || !source) return;
    failedSourcesRef.current.add(source.url);
    // Each distinct URL is tried once per cycle. A source can appear more than
    // once with different labels, so indexes alone cannot bound recovery.
    const next = orderedPlaybackSources(session.playback).find(item => !failedSourcesRef.current.has(item.url));
    if (!next) {
      setExhausted(true);
      setRecoveryNotice('Todas as fontes disponíveis falharam. Você pode escolher uma fonte manualmente ou tentar as fontes novamente.');
      return;
    }
    setSession({ playback: session.playback, resumeTime: failure.currentTime });
    setContinuePlaying(failure.playRequested);
    setRecoveryNotice(`A fonte anterior não respondeu. Tentando ${next.label || 'outra fonte disponível'}…`);
    setSource(next);
  }, [session, source]);

  const chooseSource = (chosen: StreamSource) => {
    if (!session) return;
    const currentPosition = playerRef.current?.getPosition() ?? session.resumeTime;
    setSession({ playback: session.playback, resumeTime: currentPosition });
    setContinuePlaying(playerRef.current?.getPlayRequested() ?? false);
    failedSourcesRef.current.clear();
    setExhausted(false);
    setRecoveryNotice(null);
    setSource(chosen);
    setSourceAttempt(value => value + 1);
  };

  if (loading) return <main id="main-content" className="mx-auto flex min-h-[70vh] max-w-7xl items-center justify-center px-5 pt-24 text-white"><div role="status" className="flex items-center gap-3"><Loader2 className="h-6 w-6 animate-spin text-teal-400" />Preparando o player...</div></main>;
  if (error || !session || !source) return <main id="main-content" className="mx-auto flex min-h-[75vh] max-w-4xl flex-col items-center justify-center gap-6 px-6 pt-24 text-center">
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5"><Film className="h-10 w-10 text-teal-300" /></div>
    <div><h1 className="mb-3 text-2xl font-bold text-white">{episodeId === 'demo' ? 'Não foi possível preparar o player' : 'Episódio indisponível'}</h1><p role="alert" className="max-w-xl text-sm leading-relaxed text-slate-400">{error}</p></div>
    <div className="flex flex-wrap justify-center gap-3">{episodeId !== 'demo' && <Link className="rounded-lg bg-teal-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-300" to="/watch/demo">Experimentar o player</Link>}<Link className="rounded-lg border border-white/15 px-5 py-3 text-sm font-medium text-white hover:bg-white/5" to="/explore">Explorar catálogo</Link>
      <button className="rounded-lg border border-white/15 px-5 py-3 text-sm text-white hover:bg-white/5" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Tentar novamente</button>
    </div>
  </main>;

  const { playback, resumeTime } = session;
  const activeSubtitles = subtitlesForSource(playback, source);
  const portugueseRank = Math.min(4, ...activeSubtitles.map(track => portugueseCaptionRank(track.language)));
  return (
    <main id="main-content" className="mx-auto max-w-[1440px] px-4 pb-20 pt-24 sm:px-8 lg:px-12">
      <Link to={backPath} className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"><ArrowLeft size={16} />{backPath.startsWith('/sources') ? 'Voltar às fontes' : 'Voltar ao catálogo'}</Link>
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <VideoPlayer ref={playerRef} key={`${episodeId}:${source.url}:${sourceAttempt}`} source={source} poster={playback.episode.thumbnail} subtitles={activeSubtitles} intro={playback.intro} initialTime={resumeTime} onProgress={saveProgress} onSourceError={recoverSource} onSourcePlaying={() => setRecoveryNotice(null)} autoPlay={continuePlaying} />
          {recoveryNotice && <div role="status" className={`mt-3 rounded-lg border px-4 py-3 text-sm ${exhausted ? 'border-amber-400/20 bg-amber-400/5 text-amber-200' : 'border-teal-400/20 bg-teal-400/5 text-slate-300'}`}><p>{recoveryNotice}</p>{exhausted && <button type="button" className="mt-3 rounded-lg bg-teal-400 px-4 py-2 font-semibold text-slate-950 hover:bg-teal-300" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Tentar fontes novamente</button>}</div>}
          <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
            <div><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300"><Film size={13} />{playback.isDemo ? 'Demonstração do player' : 'Agora assistindo'}</div><h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{playback.episode.title}</h1></div>
            {playback.previousEpisodeId && <Link to={`/watch/${encodeURIComponent(playback.previousEpisodeId)}${hints}`} state={{ anime }} className="button-secondary"><ArrowLeft size={16} />Episódio anterior</Link>}
            {playback.nextEpisodeId && <Link to={`/watch/${encodeURIComponent(playback.nextEpisodeId)}${hints}`} state={{ anime }} className="inline-flex items-center gap-2 rounded-lg bg-teal-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-300">Próximo episódio<ArrowRight size={16} /></Link>}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-teal-400" />Fonte autorizada</span>
            <span className="flex items-center gap-1.5"><Subtitles size={14} />{portugueseRank === 0 ? 'Faixa PT-BR disponível' : portugueseRank < 4 ? 'Legenda em português disponível' : activeSubtitles.length ? 'Outros idiomas de legenda disponíveis' : 'Sem legendas disponíveis'}</span>
            {playback.audioLanguages.length > 0 && <span>Áudio: {playback.audioLanguages.join(', ')}</span>}
          </div>
          {activeSubtitles.some(track => track.id.startsWith('opensubtitles-')) && <p className="mt-4 text-xs leading-relaxed text-slate-400">Legendas externas do OpenSubtitles para este episódio. Se a versão tiver tempos diferentes, escolha outra faixa ou ajuste a sincronização nas configurações do player.</p>}
          {playback.isDemo && <div className="mt-6 flex gap-3 rounded-xl border border-teal-400/15 bg-teal-400/5 p-4 text-sm leading-relaxed text-slate-300"><Info className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" /><p>Este vídeo autorizado permite testar a reprodução, a qualidade e os controles. A faixa PT-BR contém orientações originais sobre o player. O catálogo de animes é separado da disponibilidade de episódios licenciados.</p></div>}
          {playback.attribution && <p className="mt-5 text-xs leading-relaxed text-slate-500">Conteúdo: <a href={playback.attribution.url} target="_blank" rel="noreferrer" className="text-slate-300 underline decoration-white/20 underline-offset-4 hover:text-teal-300">{playback.attribution.label}</a> · {playback.attribution.license}</p>}
        </section>

        <aside className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <h2 className="text-base font-semibold text-white">Sua experiência</h2><p className="mt-2 text-xs leading-relaxed text-slate-500">A reprodução usa apenas as fontes disponíveis para este conteúdo.</p>
          <label className="mt-6 block"><span className="mb-2 block text-xs font-medium text-slate-400">Fonte de vídeo</span><select className="w-full rounded-lg border border-white/15 bg-[#151d25] px-3 py-2.5 text-sm text-white focus:border-teal-400 focus:outline-none" value={source.url} onChange={event => {
            const chosen = playback.sources.find(item => item.url === event.target.value);
            if (!chosen || chosen.url === source.url) return;
            chooseSource(chosen);
          }}>{orderedPlaybackSources(playback).map((item, index) => {
            const rank = Math.min(4, ...subtitlesForSource(playback, item).map(track => portugueseCaptionRank(track.language)));
            return <option key={`${item.url}:${index}`} value={item.url}>{item.label ?? (item.type === 'hls' ? 'HLS · qualidade automática' : 'MP4 · original')}{rank === 0 ? ' · legendas PT-BR' : rank < 4 ? ' · legendas em português' : ''}</option>;
          })}</select></label>
          <div className="mt-6 border-t border-white/10 pt-5"><h3 className="text-xs font-semibold text-slate-300">Controles rápidos</h3><dl className="mt-3 space-y-3 text-xs text-slate-500"><div className="flex justify-between gap-4"><dt>Reproduzir / pausar</dt><dd className="text-slate-300">Espaço ou K</dd></div><div className="flex justify-between gap-4"><dt>Avançar / voltar 10s</dt><dd className="text-slate-300">← / →</dd></div><div className="flex justify-between gap-4"><dt>Tela cheia / som</dt><dd className="text-slate-300">F / M</dd></div></dl><p className="mt-3 text-[11px] leading-relaxed text-slate-600">Os atalhos funcionam com o foco no player.</p></div>
          <div className="mt-6 rounded-lg bg-white/5 p-3 text-xs leading-relaxed text-slate-400">Seu progresso é salvo neste navegador. Use a página inicial para continuar assistindo depois.</div>
          {playback.attribution && <a className="mt-5 flex items-center justify-between gap-2 text-xs text-slate-400 transition hover:text-teal-300" href={playback.attribution.url} target="_blank" rel="noreferrer">Conhecer o projeto do vídeo<ExternalLink size={13} /></a>}
        </aside>
      </div>
    </main>
  );
}
