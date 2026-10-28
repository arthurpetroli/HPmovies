import { API_BASE_URL } from './http';

export interface IntroTiming { start: number; end: number }

/** Optional timing lookup never blocks or fails video playback. */
async function episodeTiming(episodeId: string, duration: number, signal: AbortSignal, segment: 'intro' | 'ending'): Promise<IntroTiming | undefined> {
  if (!/^(?:toko|tatakai):[1-9]\d{0,8}:[1-9]\d{0,5}$/.test(episodeId) || !Number.isFinite(duration) || duration < 1 || duration > 86_400) return undefined;
  try {
    const length = Math.round(duration * 1000) / 1000;
    const response = await fetch(`${API_BASE_URL}/streaming/episodes/${encodeURIComponent(episodeId)}/${segment}?duration=${length}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    });
    if (!response.ok) return undefined;
    const payload = await response.json();
    const timing = payload?.data;
    return timing && typeof timing.start === 'number' && Number.isFinite(timing.start) && typeof timing.end === 'number' && Number.isFinite(timing.end)
      && timing.start >= 0 && timing.end > timing.start && timing.end <= duration ? { start: timing.start, end: timing.end } : undefined;
  } catch { return undefined; }
}

export const episodeIntro = (episodeId: string, duration: number, signal: AbortSignal) => episodeTiming(episodeId, duration, signal, 'intro');
export const episodeEnding = (episodeId: string, duration: number, signal: AbortSignal) => episodeTiming(episodeId, duration, signal, 'ending');
