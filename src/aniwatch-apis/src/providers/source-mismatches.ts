interface SourceIdentity {
  anilistId: number;
  episode: number;
  providerId: string;
  audioLanguage: string;
  type: string;
}

// A source-specific upstream mapping defect, not a general title or duration
// heuristic. Remove this entry after verifying the upstream mapping is fixed.
const knownSourceMismatches = [{
  anilistId: 101922,
  episode: 1,
  providerId: 'nebula',
  audioLanguage: 'en',
  type: 'hls',
  checkedAt: '2026-10-27',
  reason: 'The English Nebula source returns a 105-minute film (6307 seconds), not episode 1 of the requested TV series.',
}] as const;

export function isKnownSourceMismatch(identity: SourceIdentity): boolean {
  return knownSourceMismatches.some(rule => rule.anilistId === identity.anilistId
    && rule.episode === identity.episode && rule.providerId === identity.providerId
    && rule.audioLanguage === identity.audioLanguage && rule.type === identity.type);
}
