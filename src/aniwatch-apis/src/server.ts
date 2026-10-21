import { serve } from '@hono/node-server';
import app from './app.js';
import { cache } from './config/cache.js';
import { runtimeConfig } from './config/runtime.js';

const port = runtimeConfig.port;
const hostname = runtimeConfig.host;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('A porta da API deve estar entre 1 e 65535.');
}

const server = serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(`HPmovies API local: http://${hostname}:${port}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    void cache.closeConnection().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;
