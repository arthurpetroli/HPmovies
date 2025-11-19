import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import aniwatchService from '../services/aniwatch';

interface StreamingSource {
  url: string;
  quality: string;
  isM3U8: boolean;
}

export const WatchPage: React.FC = () => {
  const { episodeId } = useParams<{ episodeId: string }>();
  const navigate = useNavigate();
  const [sources, setSources] = useState<StreamingSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<StreamingSource | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (episodeId) {
      loadEpisodeSources(episodeId);
    }
  }, [episodeId]);

  const loadEpisodeSources = async (epId: string) => {
    try {
      setLoading(true);
      const response = await aniwatchService.getEpisodeSources(epId);
      const sourcesData = response.data?.sources || [];
      setSources(sourcesData);
      if (sourcesData.length > 0) {
        setSelectedSource(sourcesData[0]);
      }
    } catch (error) {
      console.error('Erro ao carregar fontes:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 pt-20 flex items-center justify-center">
        <div className="text-white text-2xl">Carregando player...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 pt-20">
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 text-pink-500 hover:text-pink-400 transition"
        >
          ← Voltar
        </button>

        <div className="bg-black rounded-lg overflow-hidden mb-6">
          {selectedSource ? (
            <video
              controls
              autoPlay
              className="w-full aspect-video"
              src={selectedSource.url}
            >
              <source src={selectedSource.url} type={selectedSource.isM3U8 ? 'application/x-mpegURL' : 'video/mp4'} />
              Seu navegador não suporta o elemento de vídeo.
            </video>
          ) : (
            <div className="w-full aspect-video flex items-center justify-center text-white">
              Nenhuma fonte disponível
            </div>
          )}
        </div>

        {sources.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-white font-semibold mb-3">Qualidade:</h3>
            <div className="flex flex-wrap gap-2">
              {sources.map((source, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedSource(source)}
                  className={`px-4 py-2 rounded-lg transition ${
                    selectedSource === source
                      ? 'bg-pink-500 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {source.quality}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};