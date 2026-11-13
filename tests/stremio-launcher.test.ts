import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface Runtime {
  origin: string;
  stop(): Promise<void>;
  finished: Promise<{ code: number | null; signal: string | null }>;
}
const { startStremioAddon } = createRequire(import.meta.url)('../scripts/start-stremio-addon.cjs') as {
  startStremioAddon(options: { env: NodeJS.ProcessEnv; signal?: AbortSignal }): Promise<Runtime>;
};
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function fixture() {
  // Synthetic executable fixture. It never imports FMHY or contacts media hosts.
  const directory = await mkdtemp(path.join(tmpdir(), 'hpmovies-stremio-launcher-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'dist'));
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'fmhy-webstream', license: 'MIT' }));
  await writeFile(path.join(directory, 'LICENSE.txt'), 'Synthetic fixture, not upstream code.');
  await writeFile(path.join(directory, 'dist/index.js'), `
    const http = require('node:http');
    const server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', address: server.address().address }));
    });
    server.listen(Number(process.env.PORT), () => {});
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  return directory;
}

describe('local Stremio launcher contracts', () => {
  it('binds the child exclusively to IPv4 loopback and terminates the owned listener', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const root = await fixture();
    const port = await freePort();
    const runtime = await startStremioAddon({ env: { ...process.env, HPMOVIES_FMHY_DIR: root, HPMOVIES_STREMIO_PORT: String(port) } });
    cleanup.push(runtime.stop);
    const response = await fetch(`${runtime.origin}/ready`);
    expect(await response.json()).toEqual({ status: 'ok', address: '127.0.0.1' });
    await runtime.stop();
    await expect(runtime.finished).resolves.toMatchObject({ code: 0 });
    await expect(fetch(`${runtime.origin}/ready`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });

  it('refuses an occupied port without reusing or terminating the unrelated service', async () => {
    const root = await fixture();
    const owner = createHttpServer((_req, res) => res.end('existing-service'));
    await new Promise<void>((resolve, reject) => { owner.once('error', reject); owner.listen(0, '127.0.0.1', resolve); });
    cleanup.push(() => new Promise<void>((resolve, reject) => owner.close(error => error ? reject(error) : resolve())));
    const address = owner.address();
    if (!address || typeof address === 'string') throw new Error('Missing owner port');
    await expect(startStremioAddon({ env: { ...process.env, HPMOVIES_FMHY_DIR: root, HPMOVIES_STREMIO_PORT: String(address.port) } })).rejects.toThrow('ocupada');
    expect(owner.listening).toBe(true);
    expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe('existing-service');
  });

  it('refuses any additional HTTP listener outside the configured port', async () => {
    const guard = path.resolve('scripts/fmhy-loopback.cjs');
    const child = spawn(process.execPath, ['--require', guard, '-e', "require('node:http').createServer().listen(1)"], {
      env: { ...process.env, HPMOVIES_STREMIO_PORT: '2' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk.toString(); });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    expect(code).not.toBe(0);
    expect(error).toContain('fora do contrato local');
  });

  it('validates startup configuration and cancels a child during readiness', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const root = await fixture();
    await expect(startStremioAddon({ env: { HPMOVIES_FMHY_DIR: root, HPMOVIES_STREMIO_PORT: '7010junk' } })).rejects.toThrow('porta válida');
    const port = await freePort();
    const controller = new AbortController();
    controller.abort();
    await expect(startStremioAddon({ env: { ...process.env, HPMOVIES_FMHY_DIR: root, HPMOVIES_STREMIO_PORT: String(port) }, signal: controller.signal })).rejects.toThrow('cancelada');
    await expect(fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });
});
