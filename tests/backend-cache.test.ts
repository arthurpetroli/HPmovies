import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import type { ServerContext } from '../src/aniwatch-apis/src/config/context';
import { cacheConfigSetter } from '../src/aniwatch-apis/src/middleware/cache';

describe('local API cache', () => {
  it('isolates keys, expires in seconds, and caches falsy values', async () => {
    let now = 0;
    const cache = new AniwatchAPICache({ now: () => now });
    const first = vi.fn(async () => 0);
    const second = vi.fn(async () => ['second']);
    expect(await cache.getOrSet(first, 'first', 60)).toBe(0);
    expect(await cache.getOrSet(second, 'second', 60)).toEqual(['second']);
    now = 59000;
    expect(await cache.getOrSet(first, 'first', 60)).toBe(0);
    expect(first).toHaveBeenCalledTimes(1);
    now = 60000;
    await cache.getOrSet(first, 'first', 60);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('deduplicates simultaneous lookups and retries failed upstream calls', async () => {
    const cache = new AniwatchAPICache();
    let resolve!: (value: string) => void;
    const getter = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const one = cache.getOrSet(getter, 'same');
    const two = cache.getOrSet(getter, 'same');
    resolve('catalog');
    expect(await Promise.all([one, two])).toEqual(['catalog', 'catalog']);
    expect(getter).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => { throw new Error('offline'); });
    await expect(cache.getOrSet(failing, 'failed')).rejects.toThrow('offline');
    await expect(cache.getOrSet(failing, 'failed')).rejects.toThrow('offline');
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used entry at the memory limit', async () => {
    const cache = new AniwatchAPICache({ maxEntries: 2 });
    const a = vi.fn(async () => 'a');
    const b = vi.fn(async () => 'b');
    await cache.getOrSet(a, 'a');
    await cache.getOrSet(b, 'b');
    await cache.getOrSet(a, 'a');
    await cache.getOrSet(async () => 'c', 'c');
    await cache.getOrSet(b, 'b');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('bounds simultaneous distinct upstream requests while still sharing an existing lookup', async () => {
    const cache = new AniwatchAPICache({ maxEntries: 1 });
    let resolve!: (value: string) => void;
    const getter = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const first = cache.getOrSet(getter, 'first');
    const duplicate = cache.getOrSet(getter, 'first');
    await expect(cache.getOrSet(async () => 'second', 'second')).rejects.toMatchObject({ status: 503, code: 'CATALOG_BUSY' });
    resolve('ready');
    expect(await Promise.all([first, duplicate])).toEqual(['ready', 'ready']);
    expect(await cache.getOrSet(async () => 'second', 'second')).toBe('second');
  });

  it('serves data and retains local caching when optional Redis is unavailable', async () => {
    const cache = new AniwatchAPICache({ redisClient: {
      get: async () => { throw new Error('redis offline'); },
      set: async () => { throw new Error('redis offline'); },
      quit: async () => undefined,
    } });
    const getter = vi.fn(async () => ({ title: 'Cowboy Bebop' }));
    expect(await cache.getOrSet(getter, 'anime:1')).toEqual({ title: 'Cowboy Bebop' });
    expect(await cache.getOrSet(getter, 'anime:1')).toEqual({ title: 'Cowboy Bebop' });
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it('keys legacy requests by full path and normalized query, with bounded seconds TTL', async () => {
    const app = new Hono<ServerContext>();
    app.use('*', cacheConfigSetter());
    app.get('*', (c) => c.json(c.get('CACHE_CONFIG')));
    const first = await (await app.request('/api/v2/hianime/search?page=2&q=naruto')).json();
    const same = await (await app.request('/api/v2/hianime/search?q=naruto&page=2')).json();
    const different = await (await app.request('/api/v2/hianime/home')).json();
    expect(first).toEqual(same);
    expect(first.key).not.toBe(different.key);
    expect(first.duration).toBe(300);
    const invalid = await (await app.request('/api/v2/hianime/home', { headers: { 'Aniwatch-Cache-Expiry': 'NaN' } })).json();
    expect(invalid.duration).toBe(300);
    const oversized = await (await app.request('/api/v2/hianime/home', { headers: { 'Aniwatch-Cache-Expiry': '60000' } })).json();
    expect(oversized.duration).toBe(3600);
  });
});
