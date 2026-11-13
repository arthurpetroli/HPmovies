import type { WatchProgress } from './library';
import { cinemaForEpisode, stremioWatchIdentity } from './watchCinemaContext';

function animeEpisodeNumber(progress: WatchProgress): number | undefined {
  const match = /^(?:toko|tatakai):[1-9]\d{0,8}:((?:0|[1-9]\d{0,5})(?:\.\d{1,3})?)$/.exec(progress.episodeId);
  const value = match ? Number(match[1]) : progress.episodeNumber;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100000 ? value : undefined;
}

export function progressEpisodeLabel(progress: WatchProgress): string | undefined {
  const identity = stremioWatchIdentity(progress.episodeId);
  if (identity?.type === 'movie') return 'Filme';
  if (identity?.type === 'series') return `Temporada ${identity.season} · Episódio ${identity.episode}`;
  const episode = animeEpisodeNumber(progress);
  return episode === undefined ? undefined : `Episódio ${episode}`;
}

export function progressDisplayTitle(progress: WatchProgress): string {
  const cinema = cinemaForEpisode(progress.episodeId, progress.cinema);
  if (cinema) return cinema.title;
  if (progress.anime) return progress.anime.title;
  const identity = stremioWatchIdentity(progress.episodeId);
  if (!identity) return progress.title;
  const generic = /^(?:Filme\s*[·:-]\s*tt\d+|Episódio\s+\d+\s*[·:-]\s*temporada\s+\d+|stremio:.*|tt\d+)$/i.test(progress.title.trim());
  return generic || !progress.title.trim() ? identity.type === 'movie' ? 'Filme' : 'Série' : progress.title;
}

export function historyWatchLocation(progress: WatchProgress) {
  const cinema = cinemaForEpisode(progress.episodeId, progress.cinema);
  const identity = stremioWatchIdentity(progress.episodeId);
  const params = new URLSearchParams();
  if (identity) {
    params.set('cinema', identity.type);
    const title = progressDisplayTitle(progress);
    if (title !== 'Filme' && title !== 'Série') params.set('title', title);
  }
  return { to: `/watch/${encodeURIComponent(progress.episodeId)}${params.size ? `?${params}` : ''}`,
    state: { anime: progress.anime, cinema, resume: true },
  };
}
