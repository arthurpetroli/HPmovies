import { AniwatchAPICache } from '../config/cache.js';
import { ApiError } from '../config/apiError.js';
import { runtimeConfig } from '../config/runtime.js';

export interface IntroInterval { start: number; end: number }
type SkipType = 'op' | 'ed';
interface Identity { malId: number; episodes?: number }
interface Options { fetcher?: typeof fetch; timeoutMs?: number; now?: () => number }
interface CachedIntro { value: IntroInterval | undefined; expires: number }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** AniSkip itself allows a 20-second duration mismatch; different cuts need stricter matching. */
function parseSkipResponse(input: unknown, duration: number, skipType: SkipType): IntroInterval | undefined {
  if (!finite(duration) || duration < 1 || duration > 86400 || !object(input) || input.found !== true
    || input.statusCode !== 200 || !Array.isArray(input.results) || input.results.length > 20) return undefined;
  const candidates = input.results.filter(object).filter(row => row.skipType === skipType).flatMap(row => {
    if (!finite(row.episodeLength) || row.episodeLength < 1 || Math.abs(row.episodeLength - duration) > 2 || !object(row.interval)) return [];
    const start = row.interval.startTime, end = row.interval.endTime;
    if (!finite(start) || !finite(end) || start < 0 || end <= start || end > duration || end > row.episodeLength) return [];
    return [{ start, end }];
  });
  // Multiple contradictory openings or endings are not resolved by guessing the first row.
  const distinct = new Map(candidates.map(interval => [`${interval.start}:${interval.end}`, interval]));
  return distinct.size === 1 ? distinct.values().next().value : undefined;
}

export function parseIntroSkipResponse(input: unknown, duration: number): IntroInterval | undefined {
  return parseSkipResponse(input, duration, 'op');
}

export function parseEndingSkipResponse(input: unknown, duration: number): IntroInterval | undefined {
  return parseSkipResponse(input, duration, 'ed');
}

/** Optional, fail-soft opening metadata fetched only after the actual video duration is known. */
export class IntroSkipProvider {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly identities: AniwatchAPICache;
  private readonly cached = new Map<string, CachedIntro>();
  private readonly pending = new Map<string, Promise<IntroInterval | undefined>>();
  private active = 0;

  constructor(options: Options = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.now = options.now ?? Date.now;
    this.identities = new AniwatchAPICache({ maxEntries: 128, now: this.now });
  }

  private async json(url: string, init: RequestInit = {}): Promise<unknown> {
    if (this.active >= 4) throw new Error('Opening lookup busy.');
    this.active++;
    const controller = new AbortController();
    let rejectAbort: (reason: Error) => void = () => undefined;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const timer = setTimeout(() => { controller.abort(); rejectAbort(new Error('Opening lookup timed out.')); }, this.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await Promise.race([this.fetcher(url, { ...init, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'HPmovies/2.0 (opening metadata)', ...init.headers } }), aborted]);
      if (response.status === 404 && url.startsWith('https://api.aniskip.com/v2/skip-times/')) {
        await response.body?.cancel();
        return undefined;
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('json') || Number(response.headers.get('content-length')) > 160_000) {
        await response.body?.cancel();
        throw new Error('Opening metadata unavailable.');
      }
      reader = response.body?.getReader();
      if (!reader) throw new Error('Opening metadata is empty.');
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 160_000) throw new Error('Opening metadata is too large.');
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      void reader?.cancel().catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer); controller.abort(); reader?.releaseLock(); this.active--;
    }
  }

  private identity(anilistId: number): Promise<Identity | undefined> {
    return this.identities.getOrSet(async () => {
      const payload = await this.json(runtimeConfig.anilistUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query OpeningIdentity($id: Int!) { Media(id: $id, type: ANIME) { id idMal type episodes } }', variables: { id: anilistId } }) });
      if (!object(payload) || Array.isArray(payload.errors) && payload.errors.length || !object(payload.data)) throw new Error('Invalid opening identity.');
      const media = payload.data.Media;
      if (media === null) return undefined;
      if (!object(media) || media.id !== anilistId || media.type !== 'ANIME') throw new Error('Opening identity does not match.');
      if (media.idMal === null) return undefined;
      if (!positiveInteger(media.idMal) || media.idMal > 999_999_999
        || media.episodes !== null && media.episodes !== undefined && (!positiveInteger(media.episodes) || media.episodes > 100_000)) throw new Error('Invalid opening identity.');
      return { malId: media.idMal, ...(positiveInteger(media.episodes) ? { episodes: media.episodes } : {}) };
    }, `opening:identity:${anilistId}`, 86400);
  }

  intro(episodeId: string, duration: number): Promise<IntroInterval | undefined> {
    return this.segment(episodeId, duration, 'op');
  }

  ending(episodeId: string, duration: number): Promise<IntroInterval | undefined> {
    return this.segment(episodeId, duration, 'ed');
  }

  private segment(episodeId: string, duration: number, skipType: SkipType): Promise<IntroInterval | undefined> {
    if (!finite(duration) || duration < 1 || duration > 86400) throw new ApiError(400, 'INVALID_VIDEO_DURATION', 'Informe uma duração de vídeo válida.');
    if (episodeId === 'demo' || episodeId.startsWith('stremio:')) return Promise.resolve(undefined);
    const match = /^(?:toko|tatakai):([1-9]\d{0,8}):([1-9]\d{0,5})$/.exec(episodeId);
    if (!match || Number(match[2]) > 100_000) throw new ApiError(400, 'INVALID_EPISODE_ID', 'Informe um episódio inteiro com identificação AniList válida.');
    const anilistId = Number(match[1]), episode = Number(match[2]);
    const key = `${skipType}:${anilistId}:${episode}:${duration.toFixed(3)}`;
    for (const [oldKey, entry] of this.cached) if (entry.expires <= this.now()) this.cached.delete(oldKey);
    const stored = this.cached.get(key); if (stored) return Promise.resolve(stored.value);
    const pending = this.pending.get(key); if (pending) return pending;
    if (this.pending.size >= 8) return Promise.resolve(undefined);
    const request = this.lookup(anilistId, episode, duration, skipType).catch(() => undefined).then(value => {
      while (this.cached.size >= 256) this.cached.delete(this.cached.keys().next().value!);
      this.cached.set(key, { value, expires: this.now() + (value ? 3600_000 : 300_000) });
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async lookup(anilistId: number, episode: number, duration: number, skipType: SkipType): Promise<IntroInterval | undefined> {
    const identity = await this.identity(anilistId);
    if (!identity || identity.episodes && episode > identity.episodes) return undefined;
    const url = new URL(`https://api.aniskip.com/v2/skip-times/${identity.malId}/${episode}`);
    url.searchParams.set('types[]', skipType);
    url.searchParams.set('episodeLength', duration.toString());
    return parseSkipResponse(await this.json(url.href), duration, skipType);
  }
}

export const introSkips = new IntroSkipProvider();
