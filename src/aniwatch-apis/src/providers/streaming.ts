import type { AnimeStreamingProvider, Playback, StreamingAvailability } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { validateAnimeId } from './anilist.js';

/** Metadata providers do not grant distribution rights or provide anime media. */
export class LocalStreamingProvider implements AnimeStreamingProvider {
  async episodes(animeId: string): Promise<StreamingAvailability> {
    if (animeId === 'demo') {
      return { available: true, episodes: [{ id: 'demo', title: 'Big Buck Bunny · demonstração', number: 1 }] };
    }
    validateAnimeId(animeId);
    return {
      available: false,
      episodes: [],
      message: 'Este título possui informações no catálogo, mas ainda não tem uma fonte de reprodução autorizada conectada. Você pode testar o player com a demonstração Big Buck Bunny.',
    };
  }

  async playback(episodeId: string): Promise<Playback> {
    if (episodeId !== 'demo') {
      throw new ApiError(404, 'EPISODE_UNAVAILABLE', 'Não há uma fonte autorizada para reproduzir este episódio.');
    }
    return {
      episode: { id: 'demo', title: 'Big Buck Bunny · demonstração', number: 1 },
      sources: [
        { url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls', label: 'HLS adaptativo' },
        { url: 'https://video.blender.org/object-storage/web_videos/bf1f3fb5-b119-4f9f-9930-8e20e892b898-720.mp4', type: 'mp4', label: 'MP4 oficial · 720p', height: 720 },
      ],
      subtitles: [{ id: 'demo-pt-br', url: '/demo-pt-BR.vtt', label: 'Português (Brasil) · guia do player', language: 'pt-BR', kind: 'captions' }],
      audioLanguages: [],
      attribution: {
        label: 'Big Buck Bunny © 2008 Blender Foundation · HLS de teste por Mux / video-dev',
        url: 'https://peach.blender.org/about/',
        license: 'CC BY 3.0 — https://creativecommons.org/licenses/by/3.0/',
      },
      isDemo: true,
    };
  }
}
