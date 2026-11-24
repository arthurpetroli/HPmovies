import type { AnimeStreamingProvider, Playback, StreamingAvailability } from '../../shared/providers';
import { apiMediaUrl, requestData } from './http';
import { normalizedTitleHints } from '../../shared/titleHints';

function playbackQuery(titles?: string[], refresh = false) {
  const params = new URLSearchParams();
  normalizedTitleHints(titles).forEach(title => params.append('titles[]', title));
  if (refresh) params.set('refresh', '1');
  return params.size ? `?${params}` : '';
}

export function isPlayback(value: unknown): value is Playback {
  const playback = value as Playback | null;
  return !!playback && typeof playback.episode?.id === 'string'
    && typeof playback.episode.title === 'string' && typeof playback.isDemo === 'boolean'
    && Array.isArray(playback.sources) && playback.sources.length > 0
    && playback.sources.every((source) => !!source && typeof source.url === 'string' && ['hls', 'mp4'].includes(source.type))
    && Array.isArray(playback.audioLanguages) && playback.audioLanguages.every((language) => typeof language === 'string')
    && Array.isArray(playback.subtitles) && playback.subtitles.every((track) =>
      !!track && typeof track.id === 'string' && typeof track.url === 'string' && typeof track.language === 'string' && typeof track.label === 'string');
}

export function playbackMedia(playback: Playback): Playback {
  return { ...playback,
    sources: playback.sources.map(source => ({ ...source, url: apiMediaUrl(source.url), subtitles: source.subtitles?.map(track => ({ ...track, url: apiMediaUrl(track.url) })) })),
    subtitles: playback.subtitles.map(track => ({ ...track, url: apiMediaUrl(track.url) })),
  };
}

export const streamingService = {
  episodes: (animeId, titles) => requestData(`/streaming/anime/${encodeURIComponent(animeId)}/episodes${playbackQuery(titles)}`,
    (value): value is StreamingAvailability => {
      const availability = value as StreamingAvailability | null;
      return !!availability && typeof availability.available === 'boolean' && Array.isArray(availability.episodes)
        && availability.episodes.every((episode) => !!episode && typeof episode.id === 'string' && typeof episode.title === 'string');
    }, { timeoutMs: 65_000 }),
  playback: (episodeId: string, titles?: string[], refresh = false) => requestData(`/streaming/episodes/${encodeURIComponent(episodeId)}${playbackQuery(titles, refresh)}`,
    isPlayback, { timeoutMs: 65_000 }).then(playbackMedia),
} satisfies AnimeStreamingProvider;

export default streamingService;
