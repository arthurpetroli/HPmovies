import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  const episodeId = params['*'] || params.episodeId || '';

  const [servers, setServers] = useState<EpisodeServersByCategory>({ sub: [], dub: [], raw: [] });
  const [selectedCategory, setSelectedCategory] = useState<EpisodeCategory>('sub');
  const [selectedServer, setSelectedServer] = useState<EpisodeServer | null>(null);
  const [sources, setSources] = useState<StreamingSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<StreamingSource | null>(null);
  const [subtitles, setSubtitles] = useState<EpisodeSubtitle[]>([]);
  const [loadingServers, setLoadingServers] = useState(true);
  const [loadingSources, setLoadingSources] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('📺 WatchPage montado');
    console.log('📦 Params:', params);
    console.log('🎯 Episode ID:', episodeId);
    
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

    loadEpisodeServers(episodeId);
  }, [episodeId]);

  const loadEpisodeServers = async (epId: string) => {
    try {
      setLoadingServers(true);
      setError(null);
      
      console.log('🔍 Carregando servidores para:', epId);

      const response = await aniwatchService.getEpisodeServers(epId);
      
      console.log('📦 Resposta dos servidores:', response);

      if (!response || !response.success) {
        throw new Error('Resposta inválida da API');
      }

      const data = response.data;

      const normalized: EpisodeServersByCategory = {
        sub: Array.isArray(data.sub) ? data.sub : [],
        dub: Array.isArray(data.dub) ? data.dub : [],
        raw: Array.isArray(data.raw) ? data.raw : [],
      };

      console.log('✅ Servidores normalizados:', normalized);

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

      console.log('🎯 Categoria selecionada:', availableCategory);
      console.log('🖥️ Servidor selecionado:', firstServer);

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

      console.log('🎬 Carregando fontes:', { epId, serverName, category });

      const response = await aniwatchService.getEpisodeSources(
        epId,
        serverName,
        category
      );

      console.log('📦 Resposta das fontes:', response);

      if (!response || !response.success) {
        throw new Error('Resposta inválida da API');
      }

      const data = response.data;
      const sourcesData = Array.isArray(data.sources) ? data.sources : [];
      const subtitlesData = Array.isArray(data.subtitles) ? data.subtitles : [];

      console.log('🎥 Sources processadas:', sourcesData);
      console.log('📝 Subtitles processadas:', subtitlesData);

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
    console.log('🔄 Mudando fonte para:', source);
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
    <div className="min-h-screen bg-gray-900 pt-20">
      <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-6 pb-8">
        <button
          onClick={() => navigate(-1)}
          className="text-pink-500 hover:text-pink-400 transition flex items-center gap-2"
        >
          <span>←</span> Voltar
        </button>

        <div className="bg-gray-800 rounded-lg p-3 text-xs font-mono text-gray-400">
          <p>📺 Episode ID: {episodeId}</p>
          <p>🖥️ Servidores: {Object.values(servers).flat().length}</p>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded-lg">
            ⚠️ {error}
          </div>
        )}

        <div className="bg-black rounded-lg overflow-hidden relative">
          {loadingSources && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-2">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-pink-500 border-t-transparent" />
                <p className="text-white text-sm">Carregando vídeo...</p>
              </div>
            </div>
          )}

          {selectedSource ? (
            <VideoPlayer
              src={selectedSource.url}
              isM3U8={selectedSource.isM3U8}
              subtitles={subtitles}
              onError={handleVideoError}
            />
          ) : (
            <div className="w-full aspect-video flex items-center justify-center text-white bg-gray-800">
              <div className="text-center space-y-2">
                <p className="text-4xl">📺</p>
                <p className="text-lg">Selecione um servidor para começar</p>
                {error && <p className="text-sm text-red-400">Ou tente outro episódio</p>}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Categoria */}
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <h3 className="text-white font-semibold">Categoria de áudio</h3>
            <div className="flex flex-wrap gap-2">
              {(['sub', 'dub', 'raw'] as EpisodeCategory[]).map((category) => {
                const hasServers = servers[category]?.length > 0;
                return (
                  <button
                    key={category}
                    onClick={() => hasServers && handleCategoryChange(category)}
                    className={`px-4 py-2 rounded-lg transition ${
                      selectedCategory === category
                        ? 'bg-pink-500 text-white'
                        : hasServers
                        ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                    }`}
                    disabled={!hasServers}
                  >
                    {CATEGORY_LABELS[category]}
                    {hasServers && ` (${servers[category].length})`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Servidores */}
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <h3 className="text-white font-semibold">Servidores</h3>
            <div className="flex flex-wrap gap-2">
              {(servers[selectedCategory] || []).length > 0 ? (
                servers[selectedCategory].map((server) => (
                  <button
                    key={server.serverId}
                    onClick={() => handleServerChange(server)}
                    className={`px-4 py-2 rounded-lg transition ${
                      selectedServer?.serverId === server.serverId
                        ? 'bg-pink-500 text-white'
                        : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                    }`}
                  >
                    {server.serverName}
                  </button>
                ))
              ) : (
                <span className="text-gray-400 text-sm">Nenhum servidor disponível</span>
              )}
            </div>
          </div>

          {/* Qualidade */}
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <h3 className="text-white font-semibold">Qualidade</h3>
            {sources.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {sources.map((source, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSourceChange(source)}
                    className={`px-4 py-2 rounded-lg transition ${
                      selectedSource?.url === source.url
                        ? 'bg-pink-500 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {qualityLabel(source)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Selecione um servidor primeiro</p>
            )}
          </div>
        </div>

        {/* Legendas */}
        {subtitles.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-semibold mb-2">Legendas disponíveis</h3>
            <div className="flex flex-wrap gap-2 text-sm text-gray-200">
              {subtitles.map((subtitle, idx) => (
                <span key={idx} className="bg-gray-700 px-3 py-1 rounded">
                  {subtitle.lang || `Legenda ${idx + 1}`}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
