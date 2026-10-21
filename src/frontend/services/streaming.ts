import type { AnimeStreamingProvider, Playback, StreamingAvailability } from '../../shared/providers';
import { requestData } from './http';

export const streamingService: AnimeStreamingProvider = {
  episodes: (animeId) => requestData(`/streaming/anime/${encodeURIComponent(animeId)}/episodes`,
    (value): value is StreamingAvailability => {
      const availability = value as StreamingAvailability | null;
      return !!availability && typeof availability.available === 'boolean' && Array.isArray(availability.episodes)
        && availability.episodes.every((episode) => !!episode && typeof episode.id === 'string' && typeof episode.title === 'string');
    }),
  playback: (episodeId) => requestData(`/streaming/episodes/${encodeURIComponent(episodeId)}`,
    (value): value is Playback => {
      const playback = value as Playback | null;
      return !!playback && typeof playback.episode?.id === 'string'
        && typeof playback.episode.title === 'string' && typeof playback.isDemo === 'boolean'
        && Array.isArray(playback.sources) && playback.sources.length > 0
        && playback.sources.every((source) => !!source && typeof source.url === 'string' && ['hls', 'mp4'].includes(source.type))
        && Array.isArray(playback.audioLanguages) && playback.audioLanguages.every((language) => typeof language === 'string')
        && Array.isArray(playback.subtitles) && playback.subtitles.every((track) =>
          !!track && typeof track.id === 'string' && typeof track.url === 'string' && typeof track.language === 'string'
          && typeof track.label === 'string');
    }),
};

export default streamingService;
