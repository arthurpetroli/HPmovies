import { HiAnimeError } from 'aniwatch';
import { Hono } from 'hono';
import { ApiError } from '../config/apiError.js';
import type { ServerContext } from '../config/context.js';
import { cacheConfigSetter } from '../middleware/cache.js';
import { hianimeRouter } from './hianime.js';

/** Imported dynamically only after an explicitly enabled compatibility request. */
export const legacyRouter = new Hono<ServerContext>();
legacyRouter.use('/api/v2/hianime/*', cacheConfigSetter());
legacyRouter.route('/api/v2/hianime', hianimeRouter);
legacyRouter.notFound((c) => c.json({ error: 'NOT_FOUND', message: 'Rota não encontrada.' }, 404));
legacyRouter.onError((error) => {
  // Let the main app apply the standard envelope and security headers.
  if (error instanceof HiAnimeError) {
    throw new ApiError(503, 'ANIWATCH_UPSTREAM_UNAVAILABLE', 'O provedor externo Aniwatch/HiAnime está indisponível ou não respondeu. A API local continua ativa; não foi possível carregar o conteúdo legado.');
  }
  throw error;
});
