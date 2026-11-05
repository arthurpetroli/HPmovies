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

/** Labels qualify a declared language; they never establish the language itself. */
function subtitleCoverageRank(track: StreamSubtitle): number {
  const label = track.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const limited = /(?:^|[([]|\s[-·]\s|\.)\s*(?:forced|forcad[ao]s?|signs(?:\s*(?:&|and|\+|\/)\s*songs)?|songs|dubtitles?)\s*(?:$|[)\]]|\.|·)/.test(label);
  return (limited ? 2 : 0) + (track.machineTranslated ? 1 : 0);
}

function subtitleRank(track: StreamSubtitle): number {
  const languageRank = portugueseCaptionRank(track.language);
  return languageRank < 4 ? languageRank + subtitleCoverageRank(track) * 4 : 16;
}

export function orderedSubtitles(tracks: StreamSubtitle[]): StreamSubtitle[] {
  return [...tracks].sort((left, right) => subtitleRank(left) - subtitleRank(right));
}

export function preferredSubtitleId(tracks: StreamSubtitle[], preferredLanguage?: string): string {
  if (preferredLanguage === 'off') return 'off';
  const language = preferredLanguage ? captionLanguageCode(preferredLanguage) : '';
  const ordered = orderedSubtitles(tracks);
  const matching = ordered.find(track => captionLanguageCode(track.language) === language);
  const portuguese = ordered.find(track => portugueseCaptionRank(track.language) < 4);
  if (matching && !(portugueseCaptionRank(language) < 4 && portuguese
    && subtitleCoverageRank(matching) > subtitleCoverageRank(portuguese))) return matching.id;
  return portuguese?.id ?? 'off';
}

/** Unscoped episode tracks belong to the primary source, never an unrelated mirror. */
export function subtitlesForSource(playback: Playback, source: StreamSource): StreamSubtitle[] {
  return source.subtitles ?? (source.url === playback.sources[0]?.url ? playback.subtitles : []);
}

export function orderedPlaybackSources(playback: Playback): StreamSource[] {
  const rank = (source: StreamSource) => Math.min(16, ...subtitlesForSource(playback, source).map(subtitleRank));
  return [...playback.sources].sort((left, right) => rank(left) - rank(right)
    || Number(right.audioLanguage === 'ja') - Number(left.audioLanguage === 'ja'));
}

export function hasValidIntro(intro: { start: number; end: number } | undefined, duration: number): intro is { start: number; end: number } {
  return Boolean(intro && Number.isFinite(duration) && duration > 0 && Number.isFinite(intro.start) && Number.isFinite(intro.end) && intro.start >= 0 && intro.end > intro.start && intro.end <= duration);
}
