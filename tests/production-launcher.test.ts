import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { createProductionRuntime } = createRequire(import.meta.url)('../scripts/start-production.cjs');
const { startOptionalSubtitleTranslator } = createRequire(import.meta.url)('../scripts/start-subtitle-translator.cjs');
const directories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup(overrides: Record<string, unknown> = {}) {
  const signals = new EventEmitter();
  const exit = vi.fn();
  const logger = { info: vi.fn(), error: vi.fn() };
  const translator = { stop: vi.fn(async () => {}) };
  const sources = { stop: vi.fn(async () => {}) };
  const server = { origin: 'http://127.0.0.1:4000', stop: vi.fn(async () => {}) };
  const closeCache = vi.fn(async () => {});
  const verifyBuild = vi.fn(async () => {});
  const startTranslator = vi.fn(async () => translator);
  const startSources = vi.fn(async () => sources);
  const startProductionServer = vi.fn(async () => server);
  const loadProduction = vi.fn(async () => ({ startProductionServer, closeCache }));
  const runtime = createProductionRuntime({ signals, exit, logger, env: {}, verifyBuild, startTranslator, startSources, loadProduction, ...overrides });
  return { runtime, signals, exit, logger, translator, sources, server, closeCache, verifyBuild, startTranslator, startSources, loadProduction, startProductionServer };
}

describe('production lifecycle', () => {
  it('starts all owned services without Vite and closes them once on repeated signals', async () => {
    const context = setup();
    await expect(context.runtime.ready).resolves.toEqual({ origin: context.server.origin });
    expect(context.startSources).toHaveBeenCalledWith(expect.objectContaining({ port: 8099 }));
    expect(context.startProductionServer).toHaveBeenCalledWith({ frontendRoot: expect.stringMatching(/dist\/web$/) });
    context.signals.emit('SIGTERM');
    context.signals.emit('SIGINT');
    await context.runtime.stop();
    for (const close of [context.server.stop, context.sources.stop, context.translator.stop, context.closeCache]) expect(close).toHaveBeenCalledTimes(1);
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(context.signals.listenerCount('SIGTERM')).toBe(0);
  });

  it('fails preflight before starting helpers when compiled files are missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hpmovies-production-build-'));
    directories.push(root);
    const context = setup({ root, verifyBuild: undefined });
    await expect(context.runtime.ready).rejects.toMatchObject({ code: 'ENOENT' });
    await context.runtime.stop(1);
    expect(context.startTranslator).not.toHaveBeenCalled();
    expect(context.startSources).not.toHaveBeenCalled();
    expect(context.logger.error).toHaveBeenCalledWith(expect.stringContaining('npm run build'));
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('cleans existing helpers and cache when the HTTP port is occupied without logging private errors', async () => {
    const privateError = Object.assign(new Error('https://private.example/?token=do-not-log'), { code: 'EADDRINUSE' });
    const closeCache = vi.fn(async () => {});
    const context = setup({ loadProduction: async () => ({ closeCache, startProductionServer: async () => { throw privateError; } }) });
    await expect(context.runtime.ready).rejects.toBe(privateError);
    await context.runtime.stop(1);
    expect(context.sources.stop).toHaveBeenCalledOnce();
    expect(context.translator.stop).toHaveBeenCalledOnce();
    expect(closeCache).toHaveBeenCalledOnce();
    expect(context.logger.error).toHaveBeenCalledWith(expect.stringContaining('porta de servidor'));
    expect(JSON.stringify(context.logger.error.mock.calls)).not.toContain('do-not-log');
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('cleans a translator if the source host fails to start', async () => {
    const error = Object.assign(new Error('occupied'), { code: 'EADDRINUSE' });
    const context = setup({ startSources: async () => { throw error; } });
    await expect(context.runtime.ready).rejects.toBe(error);
    await context.runtime.stop(1);
    expect(context.translator.stop).toHaveBeenCalledOnce();
    expect(context.loadProduction).not.toHaveBeenCalled();
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('handles a signal during startup and closes a helper that becomes ready afterward', async () => {
    const pending = deferred<{ stop(): Promise<void> }>();
    const translator = { stop: vi.fn(async () => {}) };
    const context = setup({ startTranslator: () => pending.promise });
    await vi.waitFor(() => expect(context.verifyBuild).toHaveBeenCalledOnce());
    context.signals.emit('SIGTERM');
    pending.resolve(translator);
    await expect(context.runtime.ready).resolves.toBeUndefined();
    await context.runtime.stop();
    expect(translator.stop).toHaveBeenCalledOnce();
    expect(context.startSources).not.toHaveBeenCalled();
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('closes available services while another helper is still starting', async () => {
    const pending = deferred<{ stop(): Promise<void> }>();
    const lateSource = { stop: vi.fn(async () => {}) };
    const sourceStarted = vi.fn();
    const context = setup({ startSources: () => { sourceStarted(); return pending.promise; } });
    await vi.waitFor(() => expect(sourceStarted).toHaveBeenCalledOnce());
    context.signals.emit('SIGINT');
    await vi.waitFor(() => expect(context.translator.stop).toHaveBeenCalledOnce());
    pending.resolve(lateSource);
    await context.runtime.ready;
    await context.runtime.stop();
    expect(lateSource.stop).toHaveBeenCalledOnce();
    expect(context.loadProduction).not.toHaveBeenCalled();
  });

  it('does not wait on a stuck host before stopping the optional translator and enforces the global deadline', async () => {
    vi.useFakeTimers();
    const stuck = deferred<void>();
    const source = { stop: vi.fn(() => stuck.promise) };
    const context = setup({ startSources: async () => source, shutdownTimeoutMs: 8000 });
    await context.runtime.ready;
    const stop = context.runtime.stop();
    await vi.advanceTimersByTimeAsync(8000);
    expect(context.translator.stop).toHaveBeenCalledOnce();
    expect(context.server.stop).toHaveBeenCalledOnce();
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(1);
    stuck.resolve();
    await stop;
    expect(context.exit).toHaveBeenCalledOnce();
  });

  it('reuses a real existing translator and keeps it available after this runtime stops', async () => {
    const existing = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK' }));
    });
    await new Promise<void>(resolve => existing.listen(0, '127.0.0.1', resolve));
    const address = existing.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const origin = `http://127.0.0.1:${address.port}`;
    vi.stubEnv('AUTOMATIC_SUBTITLES_ENABLED', 'true');
    vi.stubEnv('HPMOVIES_TRANSLATOR_PORT', String(address.port));
    vi.stubEnv('AUTOMATIC_SUBTITLES_URL', origin);
    try {
      const context = setup({ startTranslator: startOptionalSubtitleTranslator });
      await context.runtime.ready;
      await context.runtime.stop();
      expect(await (await fetch(`${origin}/health`)).json()).toEqual({ status: 'OK' });
      expect(context.sources.stop).toHaveBeenCalledOnce();
      expect(context.exit).toHaveBeenCalledExactlyOnceWith(0);
    } finally {
      await new Promise<void>(resolve => { existing.close(() => resolve()); existing.closeAllConnections(); });
    }
  });
});
