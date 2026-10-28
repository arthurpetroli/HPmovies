import { createAdaptorServer, type HttpBindings } from '@hono/node-server';
import type { Server } from 'node:http';
import { open, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import apiApp from './app.js';
import { runtimeConfig } from './config/runtime.js';

interface ProductionApi {
  fetch(request: Request, env?: HttpBindings): Response | Promise<Response>;
}

interface ProductionOptions {
  frontendRoot: string;
  api?: ProductionApi;
}

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.vtt': 'text/vtt; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const privateDirectories = new Set(['backend', 'src', 'scripts', 'node_modules', 'docs']);
const apiPath = (path: string) => path === '/api' || path.startsWith('/api/') || path === '/health' || path.startsWith('/health/');
// These parameterized React routes may legitimately contain dots in episode or chapter IDs.
const parameterizedFrontendRoutes = [
  /^\/watch(?:\/.*)?$/,
  /^\/(?:anime|category|genre)\/[^/]+\/?$/,
  /^\/(?:manga|novel)\/[^/]+(?:\/read\/[^/]+)?\/?$/,
  /^\/sources\/manga\/[^/]+\/read\/[^/]+\/?$/,
];

function inside(root: string, path: string): boolean {
  const difference = relative(root, path);
  return difference !== '' && !isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`);
}

function publicPath(path: string): string | undefined {
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.includes('\\') || decoded.includes('%') || [...decoded].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return;
    const segments = decoded.split('/').filter(Boolean);
    if (segments.some(segment => segment.startsWith('.')) || privateDirectories.has(segments[0]) || segments[0] === 'api' || segments[0] === 'health') return;
    return decoded;
  } catch { return; }
}

async function publicFile(root: string, path: string) {
  const requested = resolve(root, `.${path}`);
  if (!inside(root, requested)) return false;
  let canonical: string;
  try { canonical = await realpath(requested); }
  catch { return; }
  if (!inside(root, canonical)) return false;
  if (publicPath(`/${relative(root, canonical).split(sep).join('/')}`) === undefined) return false;
  const contentType = mimeTypes[extname(canonical).toLowerCase()];
  if (!contentType) return false;
  const handle = await open(canonical, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) return;
    return { bytes: await handle.readFile(), contentType };
  } finally { await handle.close(); }
}

/** Only the compiled web directory is public; API requests retain their Node socket bindings. */
export function createProductionApp({ frontendRoot, api = apiApp }: ProductionOptions) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const staticHeaders = secureHeaders();
  let root: Promise<string> | undefined;
  app.use('*', (c, next) => apiPath(c.req.path) ? next() : staticHeaders(c, next));
  app.all('*', async c => {
    if (apiPath(c.req.path)) return api.fetch(c.req.raw, c.env);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      c.header('Allow', 'GET, HEAD');
      return c.json({ error: 'METHOD_NOT_ALLOWED', message: 'Use GET ou HEAD para abrir o site.' }, 405);
    }
    const path = publicPath(c.req.path);
    if (path === undefined) return c.notFound();
    const directory = await (root ??= realpath(resolve(frontendRoot)));
    let file = await publicFile(directory, path === '/' ? '/index.html' : path);
    if (file === false) return c.notFound();
    let index = path === '/' || path === '/index.html';
    if (!file && (!extname(path) || parameterizedFrontendRoutes.some(route => route.test(c.req.path)))
      && !path.startsWith('/assets/') && path !== '/assets'
      && c.req.header('Accept')?.split(',').some(value => /^text\/html(?:\s*;|$)/i.test(value.trim()))) {
      file = await publicFile(directory, '/index.html');
      index = true;
    }
    if (!file) return c.notFound();
    return new Response(c.req.method === 'HEAD' ? null : file.bytes, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.bytes.byteLength),
        'Cache-Control': index ? 'no-cache' : path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      },
    });
  });
  app.onError((_error, c) => c.json({ error: 'PRODUCTION_SERVER_ERROR', message: 'Não foi possível servir o site.' }, 500));
  return app;
}

/** Start the compiled site and API on one origin; ancillary services stay with the launcher. */
export async function startProductionServer({
  port = runtimeConfig.port,
  hostname = runtimeConfig.host,
  frontendRoot = resolve('dist/web'),
}: { port?: number; hostname?: string; frontendRoot?: string } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('A porta de produção deve estar entre 0 e 65535.');
  let directory: string;
  try {
    directory = await realpath(resolve(frontendRoot));
    const index = await realpath(resolve(directory, 'index.html'));
    if (!inside(directory, index) || publicPath(`/${relative(directory, index).split(sep).join('/')}`) === undefined
      || extname(index).toLowerCase() !== '.html' || !(await stat(index)).isFile()) throw new Error('Invalid public index');
  } catch {
    throw new Error('Frontend compilado indisponível. Execute npm run build antes de npm start.');
  }
  const app = createProductionApp({ frontendRoot: directory });
  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  await new Promise<void>((resolveReady, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolveReady(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, hostname);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('O servidor de produção não disponibilizou uma porta TCP.');
  const host = hostname.includes(':') ? `[${hostname}]` : hostname;
  let stopping: Promise<void> | undefined;
  return {
    server,
    origin: `http://${host}:${address.port}`,
    stop() {
      return stopping ??= new Promise<void>((resolveStopped, reject) => {
        const forced = setTimeout(() => { server.closeAllConnections(); resolveStopped(); }, 2000);
        forced.unref();
        server.close(error => {
          clearTimeout(forced);
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolveStopped();
        });
        server.closeIdleConnections();
      });
    },
  };
}
