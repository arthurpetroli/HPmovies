import type { MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

/** Uses the socket address; untrusted forwarding headers never create new quotas. */
export function apiLimit(limit: number, windowMs: number): MiddlewareHandler {
  const clients = new Map<string, { count: number; reset: number }>();
  return async (c, next) => {
    let key = 'local';
    try { key = getConnInfo(c).remote.address || key; } catch { /* Request-only tests have no socket. */ }
    const now = Date.now();
    for (const [client, value] of clients) if (value.reset <= now) clients.delete(client);
    let bucket = clients.get(key);
    if (!bucket) {
      if (clients.size >= 4096) return c.json({ error: 'API_BUSY', message: 'A API está ocupada. Aguarde um momento.' }, 503);
      bucket = { count: 0, reset: now + windowMs };
      clients.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
      return c.json({ error: 'RATE_LIMIT', message: 'Muitas consultas. Aguarde um momento e tente novamente.' }, 429);
    }
    return next();
  };
}
