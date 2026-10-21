import type { StreamSubtitle } from '../../../shared/providers';

/** Only an explicit Brazilian Portuguese language tag qualifies as PT-BR. */
export function preferredSubtitleId(tracks: StreamSubtitle[]): string {
  return tracks.find(track => track.language.trim().toLowerCase().replace(/_/g, '-') === 'pt-br')?.id ?? 'off';
}

export function hasValidIntro(intro: { start: number; end: number } | undefined, duration: number): intro is { start: number; end: number } {
  return Boolean(intro && Number.isFinite(duration) && duration > 0 && Number.isFinite(intro.start) && Number.isFinite(intro.end) && intro.start >= 0 && intro.end > intro.start && intro.end <= duration);
}
