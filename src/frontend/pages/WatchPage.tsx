import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, Share2, Flag, List, Search } from 'lucide-react';
import aniwatchService from '../services/aniwatch';
import { VideoPlayer } from '../components/player/VideoPlayer';

type EpisodeCategory = 'sub' | 'dub' | 'raw';

interface EpisodeServer {
  serverId: number;
  serverName: string;
}

interface StreamingSource {
  url: string;
  quality?: string;
  isM3U8?: boolean;
}

interface EpisodeSubtitle {
  lang?: string;
  url: string;
  label?: string;
  kind?: string;
}

interface EpisodeServersByCategory {
  sub: EpisodeServer[];
  dub: EpisodeServer[];
  raw: EpisodeServer[];
}

const CATEGORY_LABELS: Record<EpisodeCategory, string> = {
  sub: 'Legendado',
  dub: 'Dublado',
  raw: 'Raw',
};

export const WatchPage: React.FC = () => {
  const params = useParams();
  const navigate = useNavigate();

  // O episodeId vem da URL, pode ter múltiplos segmentos (ex: steinsgate-3/ep=230)
  // Vamos reconstruir corretamente
  const rawEpisodeId = params['*'] || params.episodeId || '';
  const episodeId = decodeURIComponent(rawEpisodeId);

  const [servers, setServers] = useState<EpisodeServersByCategory>({ sub: [], dub: [], raw: [] });
  const [selectedCategory, setSelectedCategory] = useState<EpisodeCategory>('sub');
  const [selectedServer, setSelectedServer] = useState<EpisodeServer | null>(null);
  const [sources, setSources] = useState<StreamingSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<StreamingSource | null>(null);
  const [subtitles, setSubtitles] = useState<EpisodeSubtitle[]>([]);
  const [episodeList, setEpisodeList] = useState<any[]>([]);
  const [loadingServers, setLoadingServers] = useState(true);
  const [loadingSources, setLoadingSources] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!episodeId) {
      setError('ID do episódio não foi fornecido');
      setLoadingServers(false);
      return;
    }

    // Validar formato do episodeId (deve conter ?ep=)
    if (!episodeId.includes('?ep=')) {
      console.error('⚠️ episodeId em formato incorreto:', episodeId);
      setError(`Formato de episódio inválido: ${episodeId}`);
      setLoadingServers(false);
      return;
    }

    // Limpar estados anteriores ao mudar de episódio para evitar conflitos
    setSources([]);
    setSelectedSource(null);
    setSubtitles([]);
    setServers({ sub: [], dub: [], raw: [] });
    setError(null);

    loadEpisodeServers(episodeId);
    loadAnimeEpisodes(episodeId);
  }, [episodeId]);

  const loadAnimeEpisodes = async (epId: string) => {
    try {
      // Extrai o ID do anime da string do episódio (ex: "one-piece-100?ep=2142" -> "one-piece-100")
      const animeId = epId.split('?')[0];
      if (!animeId) return;

      const response = await aniwatchService.getAnimeEpisodes(animeId);
      const eps = response?.data?.episodes || response?.episodes || [];
      setEpisodeList(eps);
    } catch (err) {
      console.error('Erro ao carregar lista de episódios:', err);
    }
  };

  const loadEpisodeServers = async (epId: string) => {
    try {
      setLoadingServers(true);
      setError(null);
      
      const response = await aniwatchService.getEpisodeServers(epId);
      
      if (!response || (!response.success && response.status !== 200)) {
        throw new Error('Resposta inválida da API');
      }

      const data = response.data;

      const normalized: EpisodeServersByCategory = {
        sub: Array.isArray(data.sub) ? data.sub : [],
        dub: Array.isArray(data.dub) ? data.dub : [],
        raw: Array.isArray(data.raw) ? data.raw : [],
      };

      setServers(normalized);

      // Encontrar primeira categoria com servidores disponíveis
      const availableCategory = (['sub', 'dub', 'raw'] as EpisodeCategory[]).find(
        (cat) => normalized[cat] && normalized[cat].length > 0
      );

      if (!availableCategory) {
        setError('Nenhum servidor disponível para este episódio');
        setLoadingServers(false);
        return;
      }

      const firstServer = normalized[availableCategory][0];

      setSelectedCategory(availableCategory);
      setSelectedServer(firstServer);

      // Carregar fontes automaticamente
      await loadEpisodeSources(epId, firstServer.serverName, availableCategory);

    } catch (err: any) {
      console.error('❌ Erro ao carregar servidores:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Erro ao carregar servidores';
      setError(`Erro: ${errorMessage}`);
    } finally {
      setLoadingServers(false);
    }
  };

  const loadEpisodeSources = async (
    epId: string,
    serverName: string,
    category: EpisodeCategory
  ) => {
    try {
      setLoadingSources(true);
      setError(null);

      const response = await aniwatchService.getEpisodeSources(
        epId,
        serverName,
        category
      );

      if (!response || (!response.success && response.status !== 200)) {
        throw new Error('Resposta inválida da API');
      }

      const data = response.data;
      const sourcesData = Array.isArray(data.sources) ? data.sources : [];

      const rawTracks = Array.isArray(data.tracks) ? data.tracks : (Array.isArray(data.subtitles) ? data.subtitles : []);
      const subtitlesData = rawTracks.filter((track: any) => 
        track.kind !== 'thumbnails' && 
        track.label !== 'thumbnails' && 
        track.lang !== 'thumbnails'
      );

      if (sourcesData.length === 0) {
        setError('Nenhuma fonte de vídeo disponível para este servidor. Tente outro servidor.');
        setSources([]);
        setSelectedSource(null);
      } else {
        setSources(sourcesData);
        setSelectedSource(sourcesData[0]);
        setSubtitles(subtitlesData);
      }

    } catch (err: any) {
      console.error('❌ Erro ao carregar fontes:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Erro desconhecido';
      setError(`Não foi possível carregar o vídeo: ${errorMessage}`);
      setSources([]);
      setSelectedSource(null);
      setSubtitles([]);
    } finally {
      setLoadingSources(false);
    }
  };

  const handleCategoryChange = (category: EpisodeCategory) => {
    const availableServers = servers[category] || [];
    
    if (availableServers.length === 0) {
      setError('Nenhum servidor disponível para esta categoria');
      return;
    }

    setSelectedCategory(category);
    const server = availableServers[0];
    setSelectedServer(server);

    if (episodeId && server) {
      loadEpisodeSources(episodeId, server.serverName, category);
    }
  };

  const handleServerChange = (server: EpisodeServer) => {
    setSelectedServer(server);
    if (episodeId) {
      loadEpisodeSources(episodeId, server.serverName, selectedCategory);
    }
  };

  const handleSourceChange = (source: StreamingSource) => {
    setSelectedSource(source);
  };

  const qualityLabel = (source: StreamingSource) => {
    if (source.quality) return source.quality;
    if (source.isM3U8) return 'Auto (HLS)';
    return 'Padrão';
  };

  const handleVideoError = () => {
    setError('Erro ao reproduzir o vídeo. Tente outro servidor ou qualidade.');
  };

  if (loadingServers) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent" />
          <p className="text-white text-lg">Carregando player...</p>
          <p className="text-gray-400 text-sm font-mono">Episode: {episodeId}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-gray-300 font-sans pb-10">
      {/* Espaçamento para Navbar fixa */}
      <div className="h-16"></div>

      <div className="container mx-auto px-2 md:px-4 py-6">
        
        {/* Layout Principal: Player (Esq) + Lista (Dir) */}
        <div className="flex flex-col lg:flex-row gap-6">
          
          {/* Coluna Esquerda: Player e Controles */}
          <div className="w-full lg:w-3/4 flex flex-col gap-4">
            
            {/* Player Container */}
            <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-xl border border-gray-800">
              {loadingSources && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
                  <div className="flex flex-col items-center gap-3">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#ffbade] border-t-transparent" />
                    <p className="text-[#ffbade] font-medium animate-pulse">Carregando stream...</p>
                  </div>
                </div>
              )}

              {error ? (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-center p-6">
                  <div>
                    <p className="text-red-500 text-xl mb-2">⚠️ {error}</p>
                    <div className="flex gap-4 justify-center">
                        <button onClick={() => window.location.reload()} className="text-white underline hover:text-[#ffbade]">Recarregar página</button>
                        <button onClick={() => loadEpisodeServers(episodeId)} className="bg-[#ffbade] text-black px-4 py-2 rounded font-bold hover:bg-white transition">Tentar Novamente</button>
                    </div>
                  </div>
                </div>
              ) : selectedSource ? (
                <VideoPlayer
                  src={selectedSource.url}
                  isM3U8={selectedSource.isM3U8}
                  autoPlay={true}
                  subtitles={subtitles}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500">
                  Selecione um servidor
                </div>
              )}
            </div>

            {/* Controles e Informações do Servidor */}
            <div className="bg-[#201f31] p-4 rounded-lg border border-gray-800">
              <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center mb-4 border-b border-gray-700 pb-4">
                <div className="text-sm text-gray-400">
                  Você está assistindo <span className="text-[#ffbade] font-bold">Episódio {episodeId.split('ep=')[1]}</span>
                </div>
                <div className="flex gap-3 text-xs font-medium">
                  <button className="flex items-center gap-1 hover:text-white transition"><MessageSquare size={14}/> Comentários</button>
                  <button className="flex items-center gap-1 hover:text-white transition"><Share2 size={14}/> Compartilhar</button>
                  <button className="flex items-center gap-1 hover:text-white transition"><Flag size={14}/> Reportar</button>
                </div>
              </div>

              {/* Seleção de Categoria (Sub/Dub) */}
              <div className="flex flex-wrap gap-2 mb-4">
                {(['sub', 'dub', 'raw'] as EpisodeCategory[]).map((category) => {
                  const count = servers[category]?.length || 0;
                  if (count === 0) return null;
                  return (
                    <button
                      key={category}
                      onClick={() => handleCategoryChange(category)}
                      className={`px-4 py-1.5 rounded text-sm font-bold uppercase transition-colors ${
                        selectedCategory === category
                          ? 'bg-[#ffbade] text-black'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {CATEGORY_LABELS[category]} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Lista de Servidores */}
              <div className="space-y-2">
                <div className="text-xs text-[#ffbade] uppercase font-bold mb-2">Servidores:</div>
                <div className="flex flex-wrap gap-2">
                  {(servers[selectedCategory] || []).map((server) => (
                    <button
                      key={server.serverId}
                      onClick={() => handleServerChange(server)}
                      className={`px-3 py-2 rounded text-xs font-medium transition-all ${
                        selectedServer?.serverId === server.serverId
                          ? 'bg-gray-600 text-[#ffbade] border border-[#ffbade]'
                          : 'bg-gray-800 text-gray-400 hover:text-white border border-transparent hover:border-gray-600'
                      }`}
                    >
                      {server.serverName}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Coluna Direita: Lista de Episódios (Sidebar) */}
          <div className="w-full lg:w-1/4">
            <div className="bg-[#201f31] rounded-lg border border-gray-800 overflow-hidden flex flex-col h-[600px] sticky top-20">
              <div className="p-3 bg-[#2a2c31] border-b border-gray-700 flex justify-between items-center">
                <span className="font-bold text-white text-sm">Lista de Episódios</span>
                <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded">{episodeList.length}</span>
              </div>
              
              {/* Busca na lista (Visual) */}
              <div className="p-2 border-b border-gray-700">
                <div className="relative">
                  <input type="text" placeholder="Número..." className="w-full bg-gray-800 text-white text-xs px-3 py-1.5 rounded outline-none focus:ring-1 focus:ring-[#ffbade]" />
                  <Search size={12} className="absolute right-2 top-2 text-gray-500" />
                </div>
              </div>

              <div className="overflow-y-auto flex-1 p-1 space-y-1 custom-scrollbar">
                {episodeList.map((ep) => {
                  const isActive = episodeId === ep.episodeId;
                  return (
                    <button
                      key={ep.episodeId}
                      onClick={() => navigate(`/watch/${encodeURIComponent(ep.episodeId)}`)}
                      className={`w-full text-left px-3 py-2 rounded flex items-center gap-3 transition-colors ${
                        isActive 
                          ? 'bg-[#2a2c31] border-l-4 border-[#ffbade]' 
                          : 'hover:bg-gray-700 border-l-4 border-transparent'
                      }`}
                    >
                      <span className={`text-sm font-mono ${isActive ? 'text-[#ffbade]' : 'text-gray-400'}`}>
                        {ep.number}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs truncate ${isActive ? 'text-white font-medium' : 'text-gray-300'}`}>
                          {ep.title || `Episódio ${ep.number}`}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {episodeList.length === 0 && (
                  <div className="text-center py-10 text-gray-500 text-xs">Carregando lista...</div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
