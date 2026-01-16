import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { 
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, 
  Settings, SkipForward, RotateCcw, Loader2, FastForward, Check, ChevronLeft, ChevronRight
} from 'lucide-react';
import aniwatchService from '../../services/aniwatch';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  isM3U8?: boolean;
  className?: string;
  autoPlay?: boolean;
  subtitles?: { lang?: string; url: string; label?: string }[];
}

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

// Parser de VTT simples
const parseVTT = (vttText: string): SubtitleCue[] => {
  const cues: SubtitleCue[] = [];
  const lines = vttText.replace(/\r\n/g, '\n').split('\n');
  
  let i = 0;
  // Pula o header WEBVTT
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();
    
    if (line.includes('-->')) {
      const timeParts = line.split('-->');
      if (timeParts.length === 2) {
        const start = parseTimestamp(timeParts[0].trim());
        const end = parseTimestamp(timeParts[1].trim().split(' ')[0]);
        
        let text = '';
        i++;
        while (i < lines.length && lines[i].trim() !== '') {
          if (text) text += '\n';
          text += lines[i].trim();
          i++;
        }
        
        if (text && !isNaN(start) && !isNaN(end)) {
          cues.push({ start, end, text });
        }
      }
    }
    i++;
  }
  
  return cues;
};

// Converte timestamp VTT para segundos
const parseTimestamp = (timestamp: string): number => {
  const parts = timestamp.split(':');
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds.replace(',', '.'));
  } else if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return parseInt(minutes) * 60 + parseFloat(seconds.replace(',', '.'));
  }
  return 0;
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ 
  src, 
  poster, 
  isM3U8 = true,
  className = "",
  autoPlay = false,
  subtitles = []
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Estados do Player
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  
  // Estados de Configuração
  const [showSettings, setShowSettings] = useState(false);
  const [settingsView, setSettingsView] = useState<'main' | 'quality' | 'subtitles'>('main');
  const [qualities, setQualities] = useState<{height: number, level: number}[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1);
  const [currentSubtitle, setCurrentSubtitle] = useState<number>(0);
  
  // Estados de Legendas Customizadas
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [currentCueText, setCurrentCueText] = useState<string>('');

  // Formata o tempo (ex: 24:05)
  const formatTime = (time: number) => {
    if (isNaN(time)) return "00:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  // Gera URL do Proxy
  const getProxyUrl = (url: string) => {
    if (!url || url.includes('/proxy-stream') || !url.startsWith('http')) return url;
    return aniwatchService.getProxyUrl(url);
  };

  // Carrega e faz parsing do arquivo de legenda
  useEffect(() => {
    if (currentSubtitle === -1 || !subtitles[currentSubtitle]) {
      setSubtitleCues([]);
      setCurrentCueText('');
      return;
    }

    const loadSubtitle = async () => {
      try {
        const subtitleUrl = getProxyUrl(subtitles[currentSubtitle].url);
        const response = await fetch(subtitleUrl);
        const text = await response.text();
        const cues = parseVTT(text);
        setSubtitleCues(cues);
      } catch (error) {
        console.error('Erro ao carregar legenda:', error);
        setSubtitleCues([]);
      }
    };

    loadSubtitle();
  }, [currentSubtitle, subtitles]);

  // Atualiza a legenda atual baseado no tempo do vídeo
  useEffect(() => {
    if (subtitleCues.length === 0) {
      setCurrentCueText('');
      return;
    }

    const activeCue = subtitleCues.find(
      cue => currentTime >= cue.start && currentTime <= cue.end
    );

    setCurrentCueText(activeCue?.text || '');
  }, [currentTime, subtitleCues]);

  // Inicialização do HLS
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const videoSrc = isM3U8 ? getProxyUrl(src) : src;

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      setIsBuffering(false);
    };

    const handleWaiting = () => setIsBuffering(true);
    const handlePlaying = () => setIsBuffering(false);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    if (Hls.isSupported() && isM3U8) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        xhrSetup: function (xhr, url) {
          xhr.withCredentials = false;
        }
      });
      hlsRef.current = hls;

      hls.loadSource(videoSrc);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        const availableQualities = data.levels.map((l, index) => ({
          height: l.height,
          level: index
        }));
        setQualities(availableQualities);
        if (autoPlay) {
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {
              setIsPlaying(false);
            });
          }
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error("HLS Error:", data);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoSrc;
      if (autoPlay) video.play().catch(() => {});
    } else {
      video.src = src;
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    }; 
  }, [src, isM3U8]);

  // Reseta estado de legendas quando a lista muda
  useEffect(() => {
    if (subtitles.length > 0) {
      setCurrentSubtitle(0);
    } else {
      setCurrentSubtitle(-1);
    }
  }, [subtitles]);

  // Controle de Play/Pause
  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused || videoRef.current.ended) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  }, []);

  // Controle de Volume
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      setIsMuted(newVolume === 0);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      videoRef.current.muted = newMuted;
      if (!newMuted && volume === 0) {
        setVolume(0.5);
        videoRef.current.volume = 0.5;
      }
    }
  };

  // Controle de Progresso
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const current = videoRef.current.currentTime;
      setCurrentTime(current);
      
      if (current > 60 && current < 180) {
        setShowSkipIntro(true);
      } else {
        setShowSkipIntro(false);
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const skipIntro = () => {
    if (videoRef.current) {
      videoRef.current.currentTime += 85;
    }
  };

  // Tela Cheia
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Auto-hide controles
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

  // Mudança de Qualidade
  const changeQuality = (level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
      setCurrentQuality(level);
      setSettingsView('main');
    }
  };

  // Mudança de Legenda
  const changeSubtitle = (index: number) => {
    setCurrentSubtitle(index);
    setSettingsView('main');
  };

  // Atalhos de Teclado
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      
      switch(e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'arrowright':
          if (videoRef.current) videoRef.current.currentTime += 5;
          break;
        case 'arrowleft':
          if (videoRef.current) videoRef.current.currentTime -= 5;
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay]);

  // Renderiza o texto da legenda com suporte a quebras de linha
  const renderSubtitleText = (text: string) => {
    // Remove tags HTML/VTT como <i>, <b>, etc mas mantém o texto
    const cleanText = text
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ');
    
    return cleanText.split('\n').map((line, index) => (
      <span key={index}>
        {line}
        {index < cleanText.split('\n').length - 1 && <br />}
      </span>
    ));
  };

  return (
    <div 
      ref={containerRef}
      className={`relative group bg-black overflow-hidden aspect-video ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* Vídeo */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        poster={poster}
        crossOrigin="anonymous"
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Legenda Customizada - Funciona igual em todos os navegadores */}
      {currentCueText && (
        <div 
          className="absolute left-0 right-0 flex justify-center pointer-events-none px-4 transition-all duration-300"
          style={{
            bottom: showControls ? '80px' : '40px'
          }}
        >
          <div 
            className="text-center max-w-[90%]"
            style={{
              color: '#ffffff',
              fontFamily: "'Trebuchet MS', 'Arial', sans-serif",
              fontSize: isFullscreen ? '2.8em' : '1.6em',
              fontWeight: 600,
              lineHeight: 1.4,
              textShadow: `
                -2px -2px 0 #000,
                2px -2px 0 #000,
                -2px 2px 0 #000,
                2px 2px 0 #000,
                -1px -1px 0 #000,
                1px -1px 0 #000,
                -1px 1px 0 #000,
                1px 1px 0 #000,
                0 0 8px rgba(0, 0, 0, 0.9),
                0 3px 6px rgba(0, 0, 0, 0.8)
              `,
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale'
            }}
          >
            {renderSubtitleText(currentCueText)}
          </div>
        </div>
      )}

      {/* Loading Spinner */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
          <Loader2 className="w-12 h-12 text-[#ffbade] animate-spin" />
        </div>
      )}

      {/* Botão Skip Intro */}
      {showSkipIntro && (
        <button 
          onClick={skipIntro}
          className="absolute bottom-20 left-4 bg-black/60 hover:bg-[#ffbade] hover:text-black text-white px-4 py-2 rounded-md text-sm font-bold transition-colors flex items-center gap-2 z-20 backdrop-blur-sm border border-white/10"
        >
          <FastForward size={16} /> SKIP INTRO
        </button>
      )}

      {/* Overlay de Controles */}
      <div className={`absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent transition-opacity duration-300 flex flex-col justify-end px-4 pb-4 ${showControls ? 'opacity-100' : 'opacity-0'} pointer-events-none`}>
        
        {/* Barra de Progresso */}
        <div className="relative w-full h-1.5 bg-gray-600 rounded-full mb-4 cursor-pointer group/progress pointer-events-auto">
          <div 
            className="absolute h-full bg-[#ffbade] rounded-full" 
            style={{ width: `${(currentTime / duration) * 100}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="absolute w-full h-full opacity-0 cursor-pointer z-10"
          />
        </div>

        {/* Botões de Controle */}
        <div className="flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-4">
            <button onClick={togglePlay} className="text-white hover:text-[#ffbade] transition-colors">
              {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>

            <div className="flex items-center gap-2 group/volume">
              <button onClick={toggleMute} className="text-white hover:text-[#ffbade] transition-colors">
                {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <div className="w-0 group-hover/volume:w-20 transition-all duration-300 overflow-hidden">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-[#ffbade]"
                />
              </div>
            </div>

            <span className="text-white text-sm font-medium">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button className="text-white hover:text-[#ffbade] transition-colors" title="Retroceder 10s" onClick={() => { if(videoRef.current) videoRef.current.currentTime -= 10 }}>
              <RotateCcw size={20} />
            </button>
            <button className="text-white hover:text-[#ffbade] transition-colors" title="Avançar 10s" onClick={() => { if(videoRef.current) videoRef.current.currentTime += 10 }}>
              <SkipForward size={20} />
            </button>
            
            {/* Menu de Configurações */}
            <div className="relative">
              <button 
                className={`text-white hover:text-[#ffbade] transition-colors ${showSettings ? 'text-[#ffbade] rotate-45' : ''}`}
                onClick={() => { setShowSettings(!showSettings); setSettingsView('main'); }}
              >
                <Settings size={20} />
              </button>

              {showSettings && (
                <div className="absolute bottom-10 right-0 bg-[#201f31]/95 backdrop-blur-md border border-gray-700 rounded-lg p-2 w-48 shadow-xl z-50 text-sm">
                  {settingsView === 'main' && (
                    <div className="flex flex-col gap-1">
                      <button onClick={() => setSettingsView('quality')} className="flex items-center justify-between px-3 py-2 hover:bg-white/10 rounded text-left">
                        <span>Qualidade</span>
                        <span className="text-[#ffbade] text-xs">{currentQuality === -1 ? 'Auto' : `${qualities.find(q => q.level === currentQuality)?.height}p`} <ChevronRight size={14} className="inline"/></span>
                      </button>
                      <button onClick={() => setSettingsView('subtitles')} className="flex items-center justify-between px-3 py-2 hover:bg-white/10 rounded text-left">
                        <span>Legendas</span>
                        <span className="text-[#ffbade] text-xs">{currentSubtitle === -1 ? 'Off' : (subtitles[currentSubtitle]?.label || 'On')} <ChevronRight size={14} className="inline"/></span>
                      </button>
                    </div>
                  )}

                  {settingsView === 'quality' && (
                    <div className="flex flex-col gap-1 max-h-60 overflow-y-auto custom-scrollbar">
                      <button onClick={() => setSettingsView('main')} className="flex items-center gap-2 px-2 py-1 text-gray-400 hover:text-white mb-1 border-b border-gray-700 pb-2">
                        <ChevronLeft size={14} /> Voltar
                      </button>
                      <button onClick={() => changeQuality(-1)} className="flex items-center justify-between px-3 py-2 hover:bg-white/10 rounded text-left">
                        <span>Auto</span>
                        {currentQuality === -1 && <Check size={14} className="text-[#ffbade]" />}
                      </button>
                      {qualities.map((q) => (
                        <button key={q.level} onClick={() => changeQuality(q.level)} className="flex items-center justify-between px-3 py-2 hover:bg-white/10 rounded text-left">
                          <span>{q.height}p</span>
                          {currentQuality === q.level && <Check size={14} className="text-[#ffbade]" />}
                        </button>
                      ))}
                    </div>
                  )}

                  {settingsView === 'subtitles' && (
                    <div className="flex flex-col gap-1 max-h-60 overflow-y-auto custom-scrollbar">
                      <button onClick={() => setSettingsView('main')} className="flex items-center gap-2 px-2 py-1 text-gray-400 hover:text-white mb-1 border-b border-gray-700 pb-2">
                        <ChevronLeft size={14} /> Voltar
                      </button>
                      <button onClick={() => changeSubtitle(-1)} className="flex items-center justify-between px-3 py-2 hover:bg-white/10 rounded text-left">
                        <span>Desativado</span>
                        {currentSubtitle === -1 && <Check size={14} className="text-[#ffbade]" />}
                      </button>
                      {subtitles.map((sub, idx) => (
                        <button key={idx} onClick={() => changeSubtitle(idx)} className="flex items-center justify-between px-3 py-2 hover:bg-white/10 rounded text-left">
                          <span>{sub.label || sub.lang || `Legenda ${idx + 1}`}</span>
                          {currentSubtitle === idx && <Check size={14} className="text-[#ffbade]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <button onClick={toggleFullscreen} className="text-white hover:text-[#ffbade] transition-colors">
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Botão Play Central (se pausado) */}
      {!isPlaying && !isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-[#ffbade]/90 p-4 rounded-full shadow-lg backdrop-blur-sm animate-pulse">
            <Play size={48} className="text-black ml-1" fill="currentColor" />
          </div>
        </div>
      )}
    </div>
  );
};