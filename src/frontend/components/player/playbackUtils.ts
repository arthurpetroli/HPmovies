import type { Playback, StreamSource, StreamSubtitle } from '../../../shared/providers';

/** Match declared language codes; a display label never proves a translation exists. */
export function captionLanguageCode(language: string): string {
  const code = language.trim().toLowerCase().replace(/_/g, '-');
  return ({ por: 'pt', pob: 'pt-br', 'por-br': 'pt-br', 'por-pt': 'pt-pt' } as Record<string, string>)[code] ?? code;
}

export function portugueseCaptionRank(language: string): number {
  const code = captionLanguageCode(language);
  return code === 'pt-br' ? 0 : code === 'pt' ? 1 : code === 'pt-pt' ? 2 : code.startsWith('pt-') ? 3 : 4;
}

export function orderedSubtitles(tracks: StreamSubtitle[]): StreamSubtitle[] {
  return [...tracks].sort((left, right) => portugueseCaptionRank(left.language) - portugueseCaptionRank(right.language));
}

export function preferredSubtitleId(tracks: StreamSubtitle[], preferredLanguage?: string): string {
  if (preferredLanguage === 'off') return 'off';
  const language = preferredLanguage ? captionLanguageCode(preferredLanguage) : '';
  const matching = tracks.find(track => captionLanguageCode(track.language) === language);
  return matching?.id ?? orderedSubtitles(tracks).find(track => portugueseCaptionRank(track.language) < 4)?.id ?? 'off';
}

/** Unscoped episode tracks belong to the primary source, never an unrelated mirror. */
export function subtitlesForSource(playback: Playback, source: StreamSource): StreamSubtitle[] {
  return source.subtitles ?? (source.url === playback.sources[0]?.url ? playback.subtitles : []);
}

export function orderedPlaybackSources(playback: Playback): StreamSource[] {
  const rank = (source: StreamSource) => Math.min(4, ...subtitlesForSource(playback, source).map(track => portugueseCaptionRank(track.language)));
  return [...playback.sources].sort((left, right) => rank(left) - rank(right));
}

export function hasValidIntro(intro: { start: number; end: number } | undefined, duration: number): intro is { start: number; end: number } {
  return Boolean(intro && Number.isFinite(duration) && duration > 0 && Number.isFinite(intro.start) && Number.isFinite(intro.end) && intro.start >= 0 && intro.end > intro.start && intro.end <= duration);
}
