import type { CinemaTitle, CinemaType } from '../../shared/cinema';
import { cinemaService } from './cinema';
import { compactCinema } from './library';

interface CachedMetadata { value?: CinemaTitle; expires: number }
const cache = new Map<string, CachedMetadata>();
const pending = new Map<string, Promise<CinemaTitle | undefined>>();
const queue: Array<() => void> = [];
let active = 0;

function startNext() {
  while (active < 4 && queue.length) queue.shift()!();
}

/** Repair legacy history lazily, with bounded concurrency, caching and no playback requests. */
export function historyCinemaMetadata(type: CinemaType, id: string): Promise<CinemaTitle | undefined> {
  const key = `${type}:${id}`;
  const remembered = cache.get(key);
  if (remembered && remembered.expires > Date.now()) return Promise.resolve(remembered.value);
  const current = pending.get(key);
  if (current) return current;
  if (pending.size >= 250) return Promise.resolve(undefined);
  const request = new Promise<CinemaTitle | undefined>(resolve => {
    queue.push(() => {
      active++;
      void cinemaService.details(type, id).then(details => details.id === id && details.type === type ? compactCinema(details) : undefined).catch(() => undefined).then(value => {
        cache.delete(key);
        cache.set(key, { value, expires: Date.now() + (value ? 5 * 60_000 : 60_000) });
        while (cache.size > 50) cache.delete(cache.keys().next().value!);
        resolve(value);
      }).finally(() => { active--; pending.delete(key); startNext(); });
    });
  });
  pending.set(key, request);
  startNext();
  return request;
}
