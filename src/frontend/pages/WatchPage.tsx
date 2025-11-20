import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import aniwatchService from '../services/aniwatch';

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
  const { episodeId } = useParams<{ episodeId: string }>();
  const navigate = useNavigate();

  const [servers, setServers] = useState<EpisodeServersByCategory>({ sub: [], dub: [], raw: [] });
  const [selectedCategory, setSelectedCategory] = useState<EpisodeCategory>('sub');
  const [selectedServer, setSelectedServer] = useState<EpisodeServer | null>(null);
  const [sources, setSources] = useState<StreamingSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<StreamingSource | null>(null);
  const [subtitles, setSubtitles] = useState<EpisodeSubtitle[]>([]);
  const [loadingServers, setLoadingServers] = useState(true);
  const [loadingSources, setLoadingSources] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!episodeId) {
      setError('Episódio não encontrado');
      setLoadingServers(false);
      setLoadingSources(false);
      return;
    }

    loadEpisodeServers(episodeId);
  }, [episodeId]);

  const loadEpisodeServers = async (epId: string) => {
    try {
      setLoadingServers(true);
      setError(null);

      const response = await aniwatchService.getEpisodeServers(epId);
      const normalized: EpisodeServersByCategory = {
        sub: response?.sub || [],
        dub: response?.dub || [],
        raw: response?.raw || [],
      };

      setServers(normalized);

      const defaultCategory: EpisodeCategory =
        (['sub', 'dub', 'raw'] as EpisodeCategory[]).find(
          (category) => normalized[category]?.length
        ) || 'sub';

      const defaultServer = normalized[defaultCategory]?.[0] || null;

      setSelectedCategory(defaultCategory);
      setSelectedServer(defaultServer);

      if (defaultServer) {
        await loadEpisodeSources(epId, defaultServer.serverName, defaultCategory);
      } else {
        setSources([]);
        setSelectedSource(null);
        setSubtitles([]);
        setLoadingSources(false);
      }
    } catch (err: any) {
      console.error('Erro ao carregar servidores:', err);
      setError('Não foi possível carregar os servidores deste episódio.');
      setSources([]);
      setSelectedSource(null);
      setSubtitles([]);
      setLoadingSources(false);
    } finally {
      setLoadingServers(false);
    }
  };

  const loadEpisodeSources = async (epId: string, serverName: string, category: EpisodeCategory) => {
    try {
      setLoadingSources(true);
      setError(null);

      const response = await aniwatchService.getEpisodeSources(epId, serverName, category);
      const sourcesData = response?.sources || [];
      setSources(sourcesData);
      setSelectedSource(sourcesData[0] || null);
      setSubtitles(response?.subtitles || []);
    } catch (err: any) {
      console.error('Erro ao carregar fontes:', err);
      setError('Não foi possível carregar a fonte de vídeo selecionada.');
      setSources([]);
      setSelectedSource(null);
      setSubtitles([]);
    } finally {
      setLoadingSources(false);
    }
  };

  const handleCategoryChange = (category: EpisodeCategory) => {
    setSelectedCategory(category);
    const availableServers = servers[category] || [];
    const server = availableServers[0] || null;
    setSelectedServer(server);

    if (episodeId && server) {
      loadEpisodeSources(episodeId, server.serverName, category);
    } else {
      setSources([]);
      setSelectedSource(null);
      setSubtitles([]);
      setLoadingSources(false);
    }
  };

  const handleServerChange = (server: EpisodeServer) => {
    setSelectedServer(server);
    if (episodeId) {
      loadEpisodeSources(episodeId, server.serverName, selectedCategory);
    }
  };

  const qualityLabel = (source: StreamingSource) => {
    if (source.quality) return source.quality;
    if (source.isM3U8) return 'HLS';
    return 'Link';
  };

  const isLoading = (loadingServers || loadingSources) && !selectedSource;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center">
        <div className="text-white text-2xl">Carregando player...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 pt-20">
      <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-6">
        <button
          onClick={() => navigate(-1)}
          className="text-pink-500 hover:text-pink-400 transition"
        >
          ← Voltar
        </button>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="bg-black rounded-lg overflow-hidden relative">
          {loadingSources && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-pink-500 border-t-transparent" />
            </div>
          )}

          {selectedSource ? (
            <video
              key={selectedSource.url}
              controls
              autoPlay
              className="w-full aspect-video"
              src={selectedSource.url}
            >
              <source
                src={selectedSource.url}
                type={selectedSource.isM3U8 ? 'application/x-mpegURL' : 'video/mp4'}
              />
              {subtitles.map((subtitle) => (
                <track
                  key={subtitle.url}
                  label={subtitle.lang || 'Subs'}
                  src={subtitle.url}
                  srcLang={subtitle.lang?.slice(0, 2).toLowerCase() || 'en'}
                  kind="subtitles"
                />
              ))}
              Seu navegador não suporta o elemento de vídeo.
            </video>
          ) : (
            <div className="w-full aspect-video flex items-center justify-center text-white">
              Nenhuma fonte disponível
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <h3 className="text-white font-semibold">Categoria de áudio</h3>
            <div className="flex flex-wrap gap-2">
              {(['sub', 'dub', 'raw'] as EpisodeCategory[]).map((category) => (
                <button
                  key={category}
                  onClick={() => handleCategoryChange(category)}
                  className={`px-4 py-2 rounded-lg transition ${
                    selectedCategory === category
                      ? 'bg-pink-500 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  disabled={!servers[category]?.length}
                >
                  {CATEGORY_LABELS[category]}
                  {!servers[category]?.length && ' (indisp.)'}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <h3 className="text-white font-semibold">Servidores</h3>
            <div className="flex flex-wrap gap-2">
              {(servers[selectedCategory] || []).map((server) => (
                <button
                  key={server.serverId}
                  onClick={() => handleServerChange(server)}
                  className={`px-4 py-2 rounded-lg transition border ${
                    selectedServer?.serverId === server.serverId
                      ? 'bg-pink-500 text-white border-pink-400'
                      : 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600'
                  }`}
                >
                  {server.serverName}
                </button>
              ))}

              {!servers[selectedCategory]?.length && (
                <span className="text-gray-400 text-sm">Nenhum servidor para esta categoria.</span>
              )}
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <h3 className="text-white font-semibold">Qualidade</h3>
            {sources.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {sources.map((source) => (
                  <button
                    key={source.url}
                    onClick={() => setSelectedSource(source)}
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
              <p className="text-gray-400 text-sm">Nenhuma qualidade disponível.</p>
            )}
          </div>
        </div>

        {subtitles.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-semibold mb-2">Legendas</h3>
            <div className="flex flex-wrap gap-2 text-sm text-gray-200">
              {subtitles.map((subtitle) => (
                <span key={subtitle.url} className="bg-gray-700 px-3 py-1 rounded">
                  {subtitle.lang || 'Legenda disponível'}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
