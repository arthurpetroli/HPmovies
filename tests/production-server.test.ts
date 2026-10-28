import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import type { HttpBindings } from '@hono/node-server';
import { createProductionApp, startProductionServer } from '../src/aniwatch-apis/src/production';

const directories: string[] = [];
const servers: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hpmovies-production-test-'));
  directories.push(directory);
  const frontendRoot = join(directory, 'web');
  await mkdir(join(frontendRoot, 'assets'), { recursive: true });
  await mkdir(join(frontendRoot, 'backend'), { recursive: true });
  await writeFile(join(frontendRoot, 'index.html'), '<!doctype html><title>Production fixture</title>');
  await writeFile(join(frontendRoot, 'assets', 'app-abcdefgh.js'), 'console.log("public fixture")');
  await writeFile(join(frontendRoot, 'assets', 'app-abcdefgh.css'), 'body{color:white}');
  await writeFile(join(frontendRoot, 'hpmovies.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(frontendRoot, 'demo.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFixture\n');
  await writeFile(join(frontendRoot, '.env'), 'FIXTURE_PRIVATE=not-public');
  await writeFile(join(frontendRoot, 'backend', 'server.js'), 'private backend fixture');
  await writeFile(join(frontendRoot, 'assets', '.secret.js'), 'private hidden fixture');
  await writeFile(join(frontendRoot, 'bundle.cjs'), 'private bundle fixture');
  await writeFile(join(directory, 'outside.js'), 'private outside fixture');
  await symlink(join(directory, 'outside.js'), join(frontendRoot, 'leak.js'));
  await symlink(directory, join(frontendRoot, 'escape'));
  await symlink(join(frontendRoot, 'assets', '.secret.js'), join(frontendRoot, 'hidden-alias.js'));
  await symlink(join(frontendRoot, 'backend', 'server.js'), join(frontendRoot, 'backend-alias.js'));
  await symlink(join(frontendRoot, 'backend'), join(frontendRoot, 'directory-alias'));
  return { directory, frontendRoot };
}

describe('production HTTP boundary', () => {
  it('serves compiled assets with their real MIME and keeps HTML revalidated', async () => {
    const { frontendRoot } = await fixture();
    const app = createProductionApp({ frontendRoot });
    const index = await app.request('/');
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(index.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await index.text()).toContain('Production fixture');
    for (const [path, mime] of [
      ['/assets/app-abcdefgh.js', 'text/javascript; charset=utf-8'],
      ['/assets/app-abcdefgh.css', 'text/css; charset=utf-8'],
      ['/hpmovies.svg', 'image/svg+xml'],
      ['/demo.vtt', 'text/vtt; charset=utf-8'],
    ]) {
      const result = await app.request(path);
      expect(result.status).toBe(200);
      expect(result.headers.get('content-type')).toBe(mime);
    }
    const head = await app.request('/assets/app-abcdefgh.js', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
    expect(await head.text()).toBe('');
  });

  it('falls back to the SPA only for HTML navigation, keeping missing assets and API routes distinct', async () => {
    const { frontendRoot } = await fixture();
    const app = createProductionApp({ frontendRoot });
    const navigation = await app.request('/anime/21?tab=episodes', { headers: { Accept: 'text/html,application/xhtml+xml' } });
    expect(navigation.status).toBe(200);
    expect(await navigation.text()).toContain('Production fixture');
    for (const path of ['/assets/missing.js', '/assets/missing', '/missing.json']) {
      expect((await app.request(path, { headers: { Accept: 'text/html' } })).status).toBe(404);
    }
    expect((await app.request('/anime/21', { headers: { Accept: 'application/json' } })).status).toBe(404);
    for (const path of ['/api', '/api/missing', '/health/missing']) {
      const result = await app.request(path, { headers: { Accept: 'text/html' } });
      expect(result.status).toBe(404);
      expect(await result.json()).toMatchObject({ error: 'NOT_FOUND' });
    }
  });

  it('preserves the raw API request, media headers, and Node socket environment', async () => {
    const { frontendRoot } = await fixture();
    const env = { incoming: { socket: { remoteAddress: '203.0.113.9' } } } as unknown as HttpBindings;
    const fetcher = vi.fn((request: Request, bindings?: HttpBindings) => new Response(JSON.stringify({
      path: new URL(request.url).pathname,
      query: new URL(request.url).search,
      range: request.headers.get('range'),
      client: bindings?.incoming.socket.remoteAddress,
    }), { status: 206, headers: { 'Content-Type': 'application/json', 'Content-Range': 'bytes 0-3/4', 'Cross-Origin-Resource-Policy': 'cross-origin' } }));
    const app = createProductionApp({ frontendRoot, api: { fetch: fetcher } });
    const result = await app.request('/api/streaming/media/fixture?quality=720', { headers: { Range: 'bytes=0-3' } }, env);
    expect(await result.json()).toEqual({ path: '/api/streaming/media/fixture', query: '?quality=720', range: 'bytes=0-3', client: '203.0.113.9' });
    expect(result.status).toBe(206);
    expect(result.headers.get('content-range')).toBe('bytes 0-3/4');
    expect(result.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(fetcher.mock.calls[0][1]).toBe(env);
  });

  it('opens parameterized React deep links whose episode, chapter, or filter contains a dot', async () => {
    const { frontendRoot } = await fixture();
    const app = createProductionApp({ frontendRoot });
    for (const path of [
      '/watch/tatakai%3A21%3A12.5',
      '/manga/work.1',
      '/manga/work.1/read/chapter.5',
      '/novel/work.1/read/chapter.5',
      '/sources/manga/source%3Awork.1/read/chapter.5',
      '/sources/manga/source%3Awork.1/read/path%2Fchapter.5',
      '/category/filter.1',
      '/genre/Sci.Fi',
    ]) {
      const result = await app.request(path, { headers: { Accept: 'text/html' } });
      expect(result.status, path).toBe(200);
      expect(result.headers.get('content-type'), path).toBe('text/html; charset=utf-8');
      expect(result.headers.get('cache-control'), path).toBe('no-cache');
      expect(await result.text(), path).toContain('Production fixture');
    }
    for (const path of ['/missing.js', '/assets/missing.js', '/arbitrary/route.js']) {
      expect((await app.request(path, { headers: { Accept: 'text/html' } })).status, path).toBe(404);
    }
  });

  it('does not expose hidden files, private directories, unsupported source files, traversal, or escaping symlinks', async () => {
    const { frontendRoot } = await fixture();
    const app = createProductionApp({ frontendRoot });
    for (const path of [
      '/.env', '/%2eenv', '/backend/server.js', '/src', '/scripts', '/node_modules',
      '/assets/.secret.js', '/bundle.cjs', '/leak.js', '/escape', '/escape/outside.js',
      '/hidden-alias.js', '/backend-alias.js', '/directory-alias/server.js',
      '/assets/%2e%2e%2f%2e%2e%2foutside.js', '/assets/%252e%252e%252foutside.js',
      '/assets/%00secret.js', '/assets/%5c..%5coutside.js', '/%61pi',
    ]) {
      const result = await app.request(path, { headers: { Accept: 'text/html' } });
      expect(result.status, path).toBe(404);
      expect(await result.text(), path).not.toContain('private');
    }
  });

  it('rejects writes to frontend routes without changing the API method', async () => {
    const { frontendRoot } = await fixture();
    const fetcher = vi.fn((request: Request) => Response.json({ method: request.method }));
    const app = createProductionApp({ frontendRoot, api: { fetch: fetcher } });
    const result = await app.request('/library', { method: 'POST' });
    expect(result.status).toBe(405);
    expect(result.headers.get('allow')).toBe('GET, HEAD');
    expect(fetcher).not.toHaveBeenCalled();
    expect(await (await app.request('/api/subtitles/automatic/fixture', { method: 'POST' })).json()).toEqual({ method: 'POST' });
  });

  it('starts on a real socket, rejects an occupied port, and releases the listener after idempotent stop', async () => {
    const { frontendRoot } = await fixture();
    const first = await startProductionServer({ port: 0, hostname: '127.0.0.1', frontendRoot });
    servers.push(first);
    expect(await (await fetch(`${first.origin}/health`)).json()).toMatchObject({ status: 'OK' });
    expect(await (await fetch(`${first.origin}/library`, { headers: { Accept: 'text/html' } })).text()).toContain('Production fixture');
    const port = Number(new URL(first.origin).port);
    await expect(startProductionServer({ port, hostname: '127.0.0.1', frontendRoot })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await Promise.all([first.stop(), first.stop()]);
    const restarted = await startProductionServer({ port, hostname: '127.0.0.1', frontendRoot });
    servers.push(restarted);
    expect((await fetch(`${restarted.origin}/`)).status).toBe(200);
  });

  it('rejects missing or externally linked frontend indexes before opening a listener', async () => {
    const { directory, frontendRoot } = await fixture();
    await expect(startProductionServer({ port: 0, frontendRoot: join(directory, 'missing') })).rejects.toThrow('npm run build');
    await rm(join(frontendRoot, 'index.html'));
    await symlink(join(directory, 'outside.js'), join(frontendRoot, 'index.html'));
    await expect(startProductionServer({ port: 0, frontendRoot })).rejects.toThrow('npm run build');
  });

  it('bounds shutdown even when a client leaves HTTP headers incomplete', async () => {
    const { frontendRoot } = await fixture();
    const instance = await startProductionServer({ port: 0, hostname: '127.0.0.1', frontendRoot });
    servers.push(instance);
    const socket = connect(Number(new URL(instance.origin).port), '127.0.0.1');
    socket.on('error', () => {});
    try {
      await new Promise<void>((resolveConnected, reject) => {
        socket.once('connect', resolveConnected);
        socket.once('error', reject);
      });
      socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
      const started = Date.now();
      await instance.stop();
      expect(Date.now() - started).toBeLessThan(3000);
      expect(instance.server.listening).toBe(false);
    } finally { socket.destroy(); }
  });
});
