import { Redis } from 'ioredis';
import { ApiError } from './apiError.js';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', expirySeconds: number): Promise<unknown>;
  quit(): Promise<unknown>;
}

interface CacheOptions {
  maxEntries?: number;
  now?: () => number;
  redisUrl?: string;
  redisClient?: RedisCacheClient;
}

/** Local caching works without Redis. TTL values are always seconds. */
export class AniwatchAPICache {
  private static instance: AniwatchAPICache | null = null;
  static enabled = true;
  static DEFAULT_CACHE_EXPIRY_SECONDS = 300;
  static CACHE_EXPIRY_HEADER_NAME = 'Aniwatch-Cache-Expiry';
  readonly enabled = true;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private client: RedisCacheClient | null;

  constructor(options: CacheOptions = {}) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 256));
    this.now = options.now ?? Date.now;
    this.client = options.redisClient ?? null;
    if (!this.client && options.redisUrl) {
      const redis = new Redis(options.redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        connectTimeout: 750,
        commandTimeout: 750,
        retryStrategy: () => null,
      });
      redis.on('error', () => undefined);
      void redis.connect().catch(() => undefined);
      this.client = redis;
    }
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new AniwatchAPICache({ redisUrl: process.env.ANIWATCH_API_REDIS_CONN_URL });
    }
    return this.instance;
  }

  async getOrSet<T>(
    dataGetter: () => Promise<T>,
    key: string,
    expirySeconds = AniwatchAPICache.DEFAULT_CACHE_EXPIRY_SECONDS,
  ): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.value as T;
    }
    this.entries.delete(key);
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    if (this.pending.size >= Math.min(this.maxEntries, 64)) {
      throw new ApiError(503, 'CATALOG_BUSY', 'Há muitas consultas em andamento. Aguarde um momento e tente novamente.');
    }

    const ttl = Number.isFinite(expirySeconds)
      ? Math.min(86400, Math.max(1, Math.floor(expirySeconds)))
      : AniwatchAPICache.DEFAULT_CACHE_EXPIRY_SECONDS;
    const task = this.load(dataGetter, key, ttl);
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      this.pending.delete(key);
    }
  }

  private async load<T>(dataGetter: () => Promise<T>, key: string, ttl: number): Promise<T> {
    if (this.client) {
      try {
        const raw = await this.client.get(key);
        if (raw !== null) {
          const value = JSON.parse(raw) as T;
          this.remember(key, value, ttl);
          return value;
        }
      } catch {
        // Redis outages and corrupt entries fall back to the upstream getter.
      }
    }
    const value = await dataGetter();
    this.remember(key, value, ttl);
    if (this.client) {
      try {
        await this.client.set(key, JSON.stringify(value), 'EX', ttl);
      } catch {
        // Memory remains available when optional Redis is down.
      }
    }
    return value;
  }

  private remember(key: string, value: unknown, ttl: number) {
    for (const [storedKey, entry] of this.entries) {
      if (entry.expiresAt <= this.now()) this.entries.delete(storedKey);
    }
    this.entries.set(key, { value, expiresAt: this.now() + ttl * 1000 });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
  }

  async closeConnection() {
    try {
      await this.client?.quit();
    } catch {
      // A disconnected optional client needs no recovery during shutdown.
    }
    this.client = null;
    this.entries.clear();
    if (AniwatchAPICache.instance === this) AniwatchAPICache.instance = null;
  }
}

export const cache = AniwatchAPICache.getInstance();
