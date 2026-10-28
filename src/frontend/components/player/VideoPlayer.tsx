import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import Hls from 'hls.js';
import { Check, Loader2, Maximize, Minimize, Pause, Play, RotateCcw, Settings, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import type { StreamSource, StreamSubtitle } from '../../../shared/providers';
import { loadConvertedSubtitle, readCaptionPreferences, saveCaptionPreferences } from './subtitles';
import { hasValidIntro, orderedSubtitles, preferredSubtitleId } from './playbackUtils';
import './playerCaptions.css';
import type { IntroTiming } from '../../services/intro';

interface VideoPlayerProps {
  ref?: Ref<VideoPlayerHandle>;
  source: StreamSource;
  poster?: string;
  subtitles?: StreamSubtitle[];
  intro?: { start: number; end: number };
  introResolver?: (duration: number, signal: AbortSignal) => Promise<IntroTiming | undefined>;
  ending?: IntroTiming;
  endingResolver?: (duration: number, signal: AbortSignal) => Promise<IntroTiming | undefined>;
  onNextEpisode?: () => void;
  initialTime?: number;
  onProgress?: (currentTime: number, duration: number) => void;
  onSourceError?: (failure: VideoSourceError) => void;
  onSourcePlaying?: () => void;
  onSubtitleChange?: (subtitle: StreamSubtitle | undefined) => void;
  autoPlay?: boolean;
  className?: string;
}

export interface VideoSourceError { message: string; currentTime: number; playRequested: boolean }
export interface VideoPlayerHandle { getPosition: () => number; getPlayRequested: () => boolean; selectSubtitle: (track: StreamSubtitle) => void }

interface QualityLevel { index: number; height: number; bitrate: number }

const EMPTY_SUBTITLES: StreamSubtitle[] = [];
const EMPTY_CONVERTED_TRACKS: Record<string, string> = {};
const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return hours ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
};

const buttonClass = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/90 transition hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400';
const selectClass = 'w-full rounded-lg border border-white/15 bg-[#202831] px-3 py-2 text-sm text-white focus:border-teal-400 focus:outline-none';
const episodeActionClass = 'absolute right-3 top-3 z-30 inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/30 bg-black/80 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-teal-400 hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 sm:right-4 sm:top-4';

/** Keep optional segment timings scoped to the current source and actual duration. */
function useEpisodeTiming(native: IntroTiming | undefined, resolver: VideoPlayerProps['introResolver'], url: string, duration: number) {
  const [resolved, setResolved] = useState<{ key: string; value?: IntroTiming }>({ key: '' });
  const key = JSON.stringify([url, duration]);
  useEffect(() => {
    if (!resolver || !Number.isFinite(duration) || duration <= 0 || hasValidIntro(native, duration)) return;
    const controller = new AbortController();
    let active = true;
    void resolver(duration, controller.signal).then(value => {
      if (active) setResolved({ key, value: hasValidIntro(value, duration) ? value : undefined });
    }).catch(() => { /* Missing optional segment metadata never interrupts playback. */ });
    return () => { active = false; controller.abort(); };
  }, [duration, key, native, resolver]);
  return hasValidIntro(native, duration) ? native : resolved.key === key ? resolved.value : undefined;
}

export function VideoPlayer({ ref, source, poster, subtitles = EMPTY_SUBTITLES, intro, introResolver, ending, endingResolver, onNextEpisode, initialTime = 0, onProgress, onSourceError, onSourcePlaying, onSubtitleChange, autoPlay = false, className = '' }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captionTrackRef = useRef<HTMLTrackElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const progressCallbackRef = useRef(onProgress);
  const sourceErrorCallbackRef = useRef(onSourceError);
  const sourcePlayingCallbackRef = useRef(onSourcePlaying);
  const playRequestedRef = useRef(autoPlay);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSavedRef = useRef(0);
  const progressSnapshotRef = useRef<{ currentTime: number; duration: number } | null>(null);
  const startPositionRef = useRef(initialTime);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const currentIntro = useEpisodeTiming(intro, introResolver, source.url, duration);
  const currentEnding = useEpisodeTiming(ending, endingResolver, source.url, duration);
  const [hasEnded, setHasEnded] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [quality, setQuality] = useState(-1);
  const [activeHeight, setActiveHeight] = useState<number | undefined>();
  const [speed, setSpeed] = useState(1);
  const [captionPreferences] = useState(readCaptionPreferences);
  const [subtitleId, setSubtitleId] = useState(() => preferredSubtitleId(subtitles, captionPreferences.language));
  const [captionLanguage, setCaptionLanguage] = useState(captionPreferences.language);
  const selectedSubtitle = subtitles.find(track => track.id === subtitleId);
  const captionSelectionKey = JSON.stringify([source.url, selectedSubtitle?.id, selectedSubtitle?.url, selectedSubtitle?.format]);
  const [captionRetry, setCaptionRetry] = useState({ selection: '', count: 0 });
  const captionAttempt = captionRetry.selection === captionSelectionKey ? captionRetry.count : 0;
  const captionLoadKey = JSON.stringify([captionSelectionKey, captionAttempt]);
  const conversionSignature = JSON.stringify({ key: captionLoadKey, tracks: subtitles.filter(track => track.id === subtitleId && (track.format === 'srt' || track.format === 'ass')).map(({ id, url, label, format }) => ({ id, url, label, format })) });
  const [conversion, setConversion] = useState<{ signature: string; tracks: Record<string, string>; errors: Record<string, string> }>({ signature: '', tracks: {}, errors: {} });
  const convertedTracks = conversion.signature === conversionSignature ? conversion.tracks : EMPTY_CONVERTED_TRACKS;
  const conversionError = conversion.signature === conversionSignature ? conversion.errors[subtitleId] : undefined;
  const captionTrackUrl = selectedSubtitle && (selectedSubtitle.format === 'srt' || selectedSubtitle.format === 'ass' ? convertedTracks[selectedSubtitle.id] : selectedSubtitle.url);
  const [captionOffset, setCaptionOffset] = useState(captionPreferences.offset);
  const originalCueTimes = useRef(new WeakMap<TextTrackCue, { start: number; end: number }>());
  const [captionContent, setCaptionContent] = useState({ key: '', text: '' });
  const captionText = captionContent.key === captionLoadKey ? captionContent.text : '';
  const [captionSize, setCaptionSize] = useState(captionPreferences.size);
  const [captionBackground, setCaptionBackground] = useState(captionPreferences.background);
  const [captionFailure, setCaptionFailure] = useState<{ key: string; message: string } | null>(null);
  const captionError = captionFailure?.key === captionLoadKey ? captionFailure.message : null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { progressCallbackRef.current = onProgress; }, [onProgress]);
  useEffect(() => { sourceErrorCallbackRef.current = onSourceError; }, [onSourceError]);
  useEffect(() => { sourcePlayingCallbackRef.current = onSourcePlaying; }, [onSourcePlaying]);
  useEffect(() => { onSubtitleChange?.(selectedSubtitle); }, [onSubtitleChange, selectedSubtitle]);
  useEffect(() => {
    saveCaptionPreferences({ language: captionLanguage, size: captionSize, background: captionBackground, offset: captionOffset });
  }, [captionLanguage, captionSize, captionBackground, captionOffset]);
  useEffect(() => {
    const controller = new AbortController();
    const blobs: string[] = [];
    let active = true;
    const { tracks } = JSON.parse(conversionSignature) as { tracks: Array<{ id: string; url: string; label: string; format: 'srt' | 'ass' }> };
    const timer = setTimeout(() => controller.abort(), 12000);
    void Promise.all(tracks.map(async track => {
      try {
        const url = await loadConvertedSubtitle(track.url, track.format, controller.signal);
        if (!active) { URL.revokeObjectURL(url); return; }
        blobs.push(url);
        setConversion(value => ({ signature: conversionSignature, tracks: { ...(value.signature === conversionSignature ? value.tracks : {}), [track.id]: url }, errors: value.signature === conversionSignature ? value.errors : {} }));
      } catch {
        if (active) setConversion(value => ({ signature: conversionSignature, tracks: value.signature === conversionSignature ? value.tracks : {}, errors: { ...(value.signature === conversionSignature ? value.errors : {}), [track.id]: controller.signal.aborted ? `A faixa ${track.label} demorou para responder.` : `Não foi possível converter a faixa ${track.label}.` } }));
      }
    })).finally(() => clearTimeout(timer));
    return () => { active = false; controller.abort(); clearTimeout(timer); blobs.forEach(url => URL.revokeObjectURL(url)); };
  }, [conversionSignature]);
  useImperativeHandle(ref, () => ({
    getPosition: () => {
      const video = videoRef.current;
      return video && (video.readyState >= 1 || video.currentTime > 0) ? video.currentTime : startPositionRef.current;
    },
    getPlayRequested: () => playRequestedRef.current,
    selectSubtitle: track => { setSubtitleId(track.id); setCaptionLanguage(track.language); },
  }), []);

  const saveProgress = useCallback((force = false, video = videoRef.current) => {
    if (video && Number.isFinite(video.duration) && video.duration > 0 && video.currentTime > 0) {
      progressSnapshotRef.current = { currentTime: video.currentTime, duration: video.duration };
    }
    // Removing a video from the DOM may clear its metadata before passive cleanup.
    const progress = progressSnapshotRef.current;
    if (!progress) return;
    const now = Date.now();
    if (force || now - lastSavedRef.current >= 5000) {
      lastSavedRef.current = now;
      progressCallbackRef.current?.(progress.currentTime, progress.duration);
    }
  }, []);

  // Flush while the media element is still mounted and retains its exact position.
  useLayoutEffect(() => {
    const video = videoRef.current;
    return () => saveProgress(true, video);
  }, [saveProgress]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let destroyed = false;
    let networkRecoveries = 0;
    let mediaRecoveries = 0;
    let resumed = false;
    let metadataReceived = false;
    let failed = false;
    let lastPosition = 0;
    let lastAdvance = Date.now();
    const startedAt = Date.now();
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (message: string) => {
      if (failed || destroyed) return;
      failed = true;
      const failure = { message, currentTime: Number.isFinite(video.currentTime) && (metadataReceived || video.currentTime > 0) ? video.currentTime : startPositionRef.current, playRequested: playRequestedRef.current };
      setError(message);
      setBuffering(false);
      clearTimeout(recoveryTimer);
      hlsRef.current?.stopLoad();
      video.pause();
      sourceErrorCallbackRef.current?.(failure);
    };
    const playIfRequested = () => {
      if (autoPlay && !destroyed && !failed) {
        playRequestedRef.current = true;
        lastAdvance = Date.now();
        void video.play().catch(() => {
          playRequestedRef.current = false;
          setNotice('Clique em reproduzir para continuar nesta fonte.');
          setControlsVisible(true);
        });
      }
    };
    const metadata = () => {
      metadataReceived = true;
      setHasEnded(video.ended);
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      if (!resumed && startPositionRef.current > 0 && Number.isFinite(video.duration)) {
        resumed = true;
        video.currentTime = Math.min(startPositionRef.current, Math.max(0, video.duration - 1));
      }
      setBuffering(false);
    };
    const updateTime = () => {
      setHasEnded(video.ended);
      if (video.currentTime > lastPosition + 0.05) lastAdvance = Date.now();
      lastPosition = video.currentTime;
      setTime(video.currentTime); saveProgress();
    };
    const updateDuration = () => { if (Number.isFinite(video.duration)) setDuration(video.duration); };
    const waiting = () => setBuffering(true);
    const ready = () => setBuffering(false);
    const play = () => { playRequestedRef.current = true; lastAdvance = Date.now(); setPlaying(true); setError(null); setNotice(null); };
    const actuallyPlaying = () => { ready(); sourcePlayingCallbackRef.current?.(); };
    const pause = () => { if (!failed && !video.error) playRequestedRef.current = false; setPlaying(false); setControlsVisible(true); saveProgress(true); };
    const ended = () => { playRequestedRef.current = false; setHasEnded(true); setPlaying(false); setControlsVisible(true); saveProgress(true); };
    const volumeChanged = () => { setVolume(video.volume); setMuted(video.muted); };
    const rateChanged = () => setSpeed(video.playbackRate);
    const nativeError = () => fail('Não foi possível reproduzir esta fonte. Confira sua conexão ou escolha outra fonte disponível.');
    const events: Array<[keyof HTMLMediaElementEventMap, () => void]> = [
      ['loadedmetadata', metadata], ['durationchange', updateDuration], ['timeupdate', updateTime],
      ['waiting', waiting], ['seeking', () => { setHasEnded(false); lastAdvance = Date.now(); waiting(); }], ['playing', actuallyPlaying], ['canplay', ready], ['seeked', ready],
      ['play', play], ['pause', pause], ['ended', ended], ['volumechange', volumeChanged], ['ratechange', rateChanged], ['error', nativeError],
    ];
    events.forEach(([event, listener]) => video.addEventListener(event, listener));
    // A healthy manifest is not enough: bounded preparation/stall detection also
    // covers child playlists, unavailable fragments and a pending play promise.
    const watchdog = setInterval(() => {
      if (failed || destroyed) return;
      if (video.readyState < 1 && Date.now() - startedAt >= 15000) {
        fail('Esta fonte demorou para preparar o vídeo. Escolha outra fonte ou tente novamente.');
      } else if (playRequestedRef.current && !video.ended && Date.now() - lastAdvance >= 15000) {
        fail('Esta fonte parou de enviar vídeo por 15 segundos. Escolha outra fonte ou tente novamente.');
      }
    }, 500);

    if (source.type === 'hls' && Hls.isSupported()) {
      // The provider supplies external, language-verified WebVTT tracks.
      // Keep HLS subtitle controllers from disabling or clearing those native tracks.
      const loadPolicy = { default: { maxTimeToFirstByteMs: 6000, maxLoadTimeMs: 8000,
        timeoutRetry: { maxNumRetry: 1, retryDelayMs: 500, maxRetryDelayMs: 500 },
        errorRetry: { maxNumRetry: 1, retryDelayMs: 500, maxRetryDelayMs: 500 } } };
      const hls = new Hls({ enableWorker: true, startLevel: 0, maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 20 * 1024 * 1024, backBufferLength: 30,
        manifestLoadPolicy: loadPolicy, playlistLoadPolicy: loadPolicy, fragLoadPolicy: loadPolicy,
        subtitleTrackController: undefined, subtitleStreamController: undefined, timelineController: undefined });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setQualities(data.levels.map((level, index) => ({ index, height: level.height, bitrate: level.bitrate })));
        playIfRequested();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => setActiveHeight(hls.levels[data.level]?.height));
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal || destroyed || failed) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hls.levels.length > 0 && networkRecoveries < 1) {
          networkRecoveries += 1;
          setBuffering(true);
          clearTimeout(recoveryTimer);
          recoveryTimer = setTimeout(() => { if (!destroyed && !failed) hls.startLoad(); }, 500);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 1) {
          mediaRecoveries += 1;
          hls.recoverMediaError();
        } else {
          hls.stopLoad();
          fail('A reprodução foi interrompida após as tentativas de recuperação. Tente novamente ou escolha outra fonte.');
        }
      });
      hls.loadSource(source.url);
      hls.attachMedia(video);
    } else if (source.type === 'mp4' || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source.url;
      video.addEventListener('canplay', playIfRequested, { once: true });
    } else {
      fail('Este navegador não oferece suporte à reprodução HLS. Use um navegador atualizado ou escolha uma fonte MP4, quando disponível.');
    }

    return () => {
      destroyed = true;
      clearInterval(watchdog);
      clearTimeout(recoveryTimer);
      saveProgress(true, video);
      events.forEach(([event, listener]) => video.removeEventListener(event, listener));
      video.removeEventListener('canplay', playIfRequested);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [source.url, source.type, attempt, autoPlay, initialTime, saveProgress]);

  useEffect(() => {
    const flush = () => saveProgress(true);
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [saveProgress]);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const element = captionTrackRef.current;
    const selected = element?.track;
    const isCurrent = () => element === captionTrackRef.current;
    const shiftCues = () => {
      if (!isCurrent()) return;
      for (const cue of Array.from(selected?.cues || [])) {
        let original = originalCueTimes.current.get(cue);
        if (!original) { original = { start: cue.startTime, end: cue.endTime }; originalCueTimes.current.set(cue, original); }
        cue.startTime = Math.max(0, original.start + captionOffset);
        cue.endTime = Math.max(cue.startTime + 0.001, original.end + captionOffset);
      }
    };
    const showCues = () => {
      if (!isCurrent()) return;
      const cues = selected?.activeCues ? Array.from(selected.activeCues) : [];
      setCaptionContent({ key: captionLoadKey, text: cues.map(cue => typeof VTTCue !== 'undefined' && cue instanceof VTTCue ? cue.getCueAsHTML().textContent ?? '' : '').join('\n') });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loaded = () => {
      if (!isCurrent()) return;
      clearTimeout(timer);
      setCaptionFailure(value => value?.key === captionLoadKey ? null : value);
      shiftCues();
      showCues();
    };
    const failed = () => {
      if (!isCurrent()) return;
      clearTimeout(timer);
      setCaptionFailure({ key: captionLoadKey, message: `Não foi possível carregar a faixa ${element?.label || 'selecionada'}.` });
    };
    // Only a ready, selected element is mounted. A pending SRT conversion must
    // never create a <track> without src and poison a later successful load.
    element?.addEventListener('load', loaded);
    element?.addEventListener('error', failed);
    selected?.addEventListener('cuechange', showCues);
    Array.from(video.textTracks).forEach(track => {
      track.mode = track === selected ? 'hidden' : 'disabled';
    });
    if (element?.readyState === HTMLTrackElement.LOADED) loaded();
    else if (element?.readyState === HTMLTrackElement.ERROR) failed();
    else if (element) timer = setTimeout(failed, 12000);
    shiftCues();
    showCues();
    return () => {
      clearTimeout(timer);
      element?.removeEventListener('load', loaded);
      element?.removeEventListener('error', failed);
      selected?.removeEventListener('cuechange', showCues);
    };
  }, [captionLoadKey, captionTrackUrl, captionOffset]);

  const hideControls = useCallback(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.matches(':focus-visible') && focused.closest('button, input, select') && containerRef.current?.contains(focused)) return;
    setControlsVisible(false);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(controlsTimeoutRef.current);
    if (playing && !settingsOpen) controlsTimeoutRef.current = setTimeout(hideControls, 3000);
  }, [playing, settingsOpen, hideControls]);

  useEffect(() => {
    // Schedule inactivity only; state changes are caused by media and pointer events.
    if (playing && !settingsOpen) controlsTimeoutRef.current = setTimeout(hideControls, 3000);
    return () => clearTimeout(controlsTimeoutRef.current);
  }, [playing, settingsOpen, hideControls]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      playRequestedRef.current = true;
      void video.play().catch(() => { playRequestedRef.current = false; setNotice('O navegador não iniciou o vídeo. Tente novamente pelo botão de reprodução.'); setControlsVisible(true); });
    } else { playRequestedRef.current = false; video.pause(); }
  }, []);
  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (video && Number.isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.currentTime + seconds, video.duration));
  };
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) video.volume = 1;
    } else video.muted = true;
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (containerRef.current?.requestFullscreen) await containerRef.current.requestFullscreen();
      else setNotice('A tela cheia não está disponível neste navegador.');
    } catch { setNotice('O navegador não permitiu a tela cheia. Você pode continuar assistindo nesta janela.'); }
  };
  const canSkipIntro = hasValidIntro(currentIntro, duration) && time >= currentIntro.start && time < currentIntro.end;
  const canGoNext = !!onNextEpisode && (hasEnded || hasValidIntro(currentEnding, duration) && time >= currentEnding.start && time < currentEnding.end);
  const showEpisodeAction = !error && !notice && !captionError && !conversionError && !settingsOpen;
  const chosenQuality = qualities.find(level => level.index === quality);
  const qualityLabel = quality === -1 ? `Automática${activeHeight ? ` · ${activeHeight}p` : ''}` : chosenQuality?.height ? `${chosenQuality.height}p` : chosenQuality ? `${Math.round(chosenQuality.bitrate / 1000)} kbps` : 'Original';

  return (
    <div ref={containerRef} role="region" aria-label="Player de vídeo" tabIndex={0}
      className={`video-player relative aspect-video w-full overflow-hidden rounded-xl bg-black text-white shadow-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400 ${!controlsVisible && playing ? 'cursor-none' : ''} ${className}`}
      onPointerMove={revealControls} onPointerDown={revealControls} onFocus={revealControls}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) revealControls(); }}
      onKeyDown={event => {
        if (error) return;
        if ((event.target as HTMLElement).closest('button, input, select')) return;
        if (event.key === ' ' || event.key.toLowerCase() === 'k') { event.preventDefault(); togglePlay(); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); seek(-10); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); seek(10); }
        else if (event.key.toLowerCase() === 'f') { event.preventDefault(); void toggleFullscreen(); }
        else if (event.key.toLowerCase() === 'm') toggleMute();
        revealControls();
      }}>
      <video ref={videoRef} poster={poster} playsInline crossOrigin="anonymous" preload="metadata"
        className="h-full w-full object-contain" onClick={togglePlay} aria-label="Vídeo">
        {selectedSubtitle && captionTrackUrl && <track ref={captionTrackRef} key={captionLoadKey} id={selectedSubtitle.id} src={captionTrackUrl} srcLang={selectedSubtitle.language} label={selectedSubtitle.label} kind={selectedSubtitle.kind ?? 'subtitles'} />}
      </video>

      {buffering && !error && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15" role="status" aria-label="Carregando vídeo"><Loader2 className="h-10 w-10 animate-spin text-teal-400" /></div>}
      {!playing && !buffering && !error && <button type="button" aria-label="Reproduzir vídeo" className="absolute left-1/2 top-1/2 z-[22] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-teal-400 text-slate-950 shadow-lg transition hover:scale-105 focus-visible:outline focus-visible:outline-white" onClick={togglePlay}><Play className="ml-1 h-7 w-7 fill-current" /></button>}
      {!error && controlsVisible && <>
        <button type="button" className="absolute left-3 top-1/2 z-[22] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white sm:hidden" aria-label="Voltar 10 segundos" onClick={() => seek(-10)}><RotateCcw size={19} /></button>
        <button type="button" className="absolute right-3 top-1/2 z-[22] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white sm:hidden" aria-label="Avançar 10 segundos" onClick={() => seek(10)}><SkipForward size={19} /></button>
      </>}

      {error && <div role="alert" className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/85 p-6 text-center">
        <p className="max-w-lg text-sm text-white/90">{error}</p>
        <button type="button" className="rounded-lg bg-teal-400 px-5 py-2.5 font-semibold text-slate-950 hover:bg-teal-300" onClick={() => { startPositionRef.current = videoRef.current?.currentTime || startPositionRef.current; setError(null); setBuffering(true); setQualities([]); setQuality(-1); setAttempt(value => value + 1); }}>Tentar novamente</button>
      </div>}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-col items-start gap-2">
      {notice && <div role="status" className="pointer-events-auto flex w-full items-center justify-between gap-3 rounded-lg bg-black/85 px-3 py-2 text-xs text-white/90"><p>{notice}</p><button type="button" aria-label="Fechar mensagem" className="shrink-0 p-1 hover:text-teal-300" onClick={() => setNotice(null)}><X size={16} /></button></div>}
      {(captionError || conversionError) && <div role="alert" className="pointer-events-auto flex w-full flex-wrap items-center justify-between gap-2 rounded-lg bg-black/90 px-3 py-2 text-xs text-amber-200">
        <p>{captionError || conversionError}</p>
        {captionAttempt < 3 ? <button type="button" className="rounded border border-amber-200/40 px-2 py-1 font-medium hover:bg-white/10" onClick={() => setCaptionRetry({ selection: captionSelectionKey, count: captionAttempt + 1 })}>Tentar legenda novamente</button> : <p>Escolha outra faixa nas configurações.</p>}
      </div>}
      </div>

      {captionText && !captionError && !conversionError && <div aria-live="off" className="player-captions" data-controls-visible={controlsVisible}>
        <span className="player-caption-text" data-size={captionSize} data-background={captionBackground}>{captionText}</span>
      </div>}
      {canSkipIntro && !canGoNext && showEpisodeAction && <button type="button" className={episodeActionClass} onClick={() => {
        const video = videoRef.current;
        if (video && hasValidIntro(currentIntro, video.duration) && video.currentTime >= currentIntro.start && video.currentTime < currentIntro.end) video.currentTime = currentIntro.end;
      }}><SkipForward size={16} aria-hidden="true" />Pular abertura</button>}
      {canGoNext && showEpisodeAction && <button type="button" className={episodeActionClass} onClick={onNextEpisode}><SkipForward size={16} aria-hidden="true" />Próximo episódio</button>}

      {settingsOpen && <div className="absolute bottom-16 right-3 z-30 max-h-[calc(100%-5rem)] w-[min(320px,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-white/15 bg-[#10161f]/95 p-4 shadow-xl backdrop-blur-xl" aria-label="Configurações do vídeo">
        <div className="mb-4 flex items-center justify-between"><span className="font-semibold">Configurações</span><button type="button" className={buttonClass} aria-label="Fechar configurações" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div>
        <label className="mb-4 block space-y-2"><span className="text-xs font-medium text-white/60">Qualidade</span><select aria-label="Qualidade do vídeo" className={selectClass} value={quality} onChange={event => { const value = Number(event.target.value); setQuality(value); if (hlsRef.current) hlsRef.current.currentLevel = value; }}>
          <option value={-1}>{source.type === 'hls' ? 'Automática' : source.label ?? 'Original'}</option>
          {qualities.map(level => <option key={level.index} value={level.index}>{level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)} kbps`}</option>)}
        </select>{source.type === 'hls' && qualities.length === 0 && <span className="block text-xs text-white/40">A qualidade é gerenciada pelo navegador nesta fonte.</span>}</label>
        <label className="mb-4 block space-y-2"><span className="text-xs font-medium text-white/60">Velocidade</span><select aria-label="Velocidade de reprodução" className={selectClass} value={speed} onChange={event => { if (videoRef.current) videoRef.current.playbackRate = Number(event.target.value); }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value === 1 ? 'Normal (1×)' : `${value}×`}</option>)}</select></label>
        <label className="mb-4 block space-y-2"><span className="text-xs font-medium text-white/60">Legendas</span><select aria-label="Idioma das legendas" className={selectClass} value={subtitleId} onChange={event => { const selected = event.target.value; setSubtitleId(selected); setCaptionLanguage(selected === 'off' ? 'off' : subtitles.find(track => track.id === selected)?.language); }}><option value="off">Desativadas</option>{orderedSubtitles(subtitles).map(track => <option key={track.id} value={track.id}>{track.label} · {track.language}</option>)}</select></label>
        {selectedSubtitle && <>
          <label className="mb-4 block space-y-2"><span className="text-xs font-medium text-white/60">Tamanho da legenda</span><select aria-label="Tamanho da legenda" className={selectClass} value={captionSize} onChange={event => setCaptionSize(event.target.value as 'small' | 'medium' | 'large')}><option value="small">Pequena</option><option value="medium">Média</option><option value="large">Grande</option></select></label>
          <label className="mb-4 block space-y-2"><span className="text-xs font-medium text-white/60">Sincronização · {captionOffset > 0 ? '+' : ''}{captionOffset.toFixed(1)}s</span><input aria-label="Sincronização da legenda" className="w-full accent-teal-400" type="range" min={-10} max={10} step={0.1} value={captionOffset} onChange={event => setCaptionOffset(Number(event.target.value))} /><span className="block text-xs text-white/40">Valores positivos atrasam a legenda. ASS usa apenas texto, sem efeitos.</span></label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-teal-400" checked={captionBackground} onChange={event => setCaptionBackground(event.target.checked)} />Fundo preto da legenda</label>
        </>}
      </div>}

      <div className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/70 to-transparent px-3 pb-2 pt-10 transition-opacity sm:px-5 sm:pb-3 ${controlsVisible || !playing || settingsOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`} inert={error || (!controlsVisible && playing && !settingsOpen) ? true : undefined}>
        <label className="block"><span className="sr-only">Posição do vídeo</span><input aria-label="Posição do vídeo" aria-valuetext={`${formatTime(time)} de ${formatTime(duration)}`} type="range" min={0} max={duration || 1} step={0.1} value={Math.min(time, duration || 1)} disabled={!duration} onChange={event => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }} className="h-1.5 w-full cursor-pointer accent-teal-400" /></label>
        <div className="mt-1 flex items-center gap-1 sm:gap-2">
          <button type="button" className={buttonClass} aria-label={playing ? 'Pausar' : 'Reproduzir'} title={playing ? 'Pausar (K)' : 'Reproduzir (K)'} onClick={togglePlay}>{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
          <button type="button" className={`${buttonClass} hidden sm:flex`} aria-label="Voltar 10 segundos" title="Voltar 10 segundos" onClick={() => seek(-10)}><RotateCcw size={20} /><span className="sr-only">10 segundos</span></button>
          <button type="button" className={`${buttonClass} hidden sm:flex`} aria-label="Avançar 10 segundos" title="Avançar 10 segundos" onClick={() => seek(10)}><SkipForward size={20} /></button>
          <button type="button" className={buttonClass} aria-label={muted || volume === 0 ? 'Ativar som' : 'Silenciar'} title="Som (M)" onClick={toggleMute}>{muted || volume === 0 ? <VolumeX size={21} /> : <Volume2 size={21} />}</button>
          <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={muted ? 0 : volume} className="hidden w-20 cursor-pointer accent-teal-400 md:block" onChange={event => { if (videoRef.current) { videoRef.current.volume = Number(event.target.value); videoRef.current.muted = false; } }} />
          <span className="ml-1 whitespace-nowrap text-[11px] tabular-nums text-white/75 sm:text-xs">{formatTime(time)} <span className="text-white/35">/</span> {formatTime(duration)}</span>
          <div className="flex-1" />
          <span className="hidden text-[11px] text-white/60 lg:inline">{source.type === 'hls' ? qualityLabel : source.label ?? 'Original'}</span>
          {selectedSubtitle && <span className="hidden items-center gap-1 rounded border border-white/25 px-1.5 py-0.5 text-[10px] text-white/80 sm:flex"><Check size={10} />{selectedSubtitle.language}</span>}
          <button type="button" className={`${buttonClass} ${settingsOpen ? 'bg-white/15 text-teal-300' : ''}`} aria-label="Abrir configurações" aria-expanded={settingsOpen} title="Configurações" onClick={() => { setSettingsOpen(value => !value); setControlsVisible(true); }}><Settings size={20} /></button>
          <button type="button" className={buttonClass} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} title="Tela cheia (F)" onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}</button>
        </div>
      </div>
    </div>
  );
}
