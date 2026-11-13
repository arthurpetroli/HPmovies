import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const { createSourceHostRuntime } = createRequire(import.meta.url)('../scripts/start-source-host.cjs');
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

function setup(overrides: Record<string, unknown> = {}) {
  const signals = new EventEmitter();
  const exit = vi.fn();
  const logger = { info: vi.fn(), error: vi.fn() };
  const translator = { stop: vi.fn(async () => {}) };
  const stremio = { stop: vi.fn(async () => {}) };
  const sources = { stop: vi.fn(async () => {}) };
  const startTranslator = vi.fn(async () => translator);
  const startStremio = vi.fn(async () => stremio);
  const startSources = vi.fn(async () => sources);
  const env = { HPMOVIES_SOURCE_HOST_PORT: '8099' };
  const runtime = createSourceHostRuntime({ env, signals, exit, logger, startTranslator, startStremio, startSources, ...overrides });
  return { runtime, env, signals, exit, logger, translator, stremio, sources, startTranslator, startStremio, startSources };
}

afterEach(() => vi.useRealTimers());

describe('development source host lifecycle (injected services, no media)', () => {
  it('includes the optional addon in normal startup and closes every owned helper once', async () => {
    const context = setup();
    await context.runtime.ready;
    expect(context.startStremio).toHaveBeenCalledWith({ env: context.env, logger: context.logger, signal: expect.any(AbortSignal) });
    expect(context.startSources).toHaveBeenCalledWith({ port: 8099, extensionsFile: undefined });
    context.signals.emit('SIGINT');
    context.signals.emit('SIGTERM');
    await context.runtime.stop();
    for (const resource of [context.translator, context.stremio, context.sources]) expect(resource.stop).toHaveBeenCalledOnce();
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(context.signals.listenerCount('SIGTERM')).toBe(0);
  });

  it('cleans the translator and addon if the source host cannot start', async () => {
    const error = new Error('Synthetic source failure');
    const context = setup({ startSources: async () => { throw error; } });
    await expect(context.runtime.ready).rejects.toBe(error);
    await context.runtime.stop(1);
    expect(context.translator.stop).toHaveBeenCalledOnce();
    expect(context.stremio.stop).toHaveBeenCalledOnce();
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('aborts addon startup on a signal and cleans a resource returned afterward', async () => {
    const pending = deferred<{ stop(): Promise<void> }>();
    const lateAddon = { stop: vi.fn(async () => {}) };
    let signal: AbortSignal | undefined;
    const context = setup({ startStremio: (options: { signal: AbortSignal }) => { signal = options.signal; return pending.promise; } });
    await vi.waitFor(() => expect(signal).toBeDefined());
    context.signals.emit('SIGTERM');
    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(context.translator.stop).toHaveBeenCalledOnce());
    pending.resolve(lateAddon);
    await context.runtime.ready;
    await context.runtime.stop();
    expect(lateAddon.stop).toHaveBeenCalledOnce();
    expect(context.startSources).not.toHaveBeenCalled();
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('does not report a cancellation during addon readiness as an application failure', async () => {
    const started = vi.fn();
    const context = setup({ startStremio: ({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      started();
      signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
    }) });
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    context.signals.emit('SIGINT');
    await context.runtime.ready;
    await context.runtime.stop();
    expect(context.logger.error).not.toHaveBeenCalled();
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('keeps private addon failures out of startup logs and closes earlier helpers', async () => {
    const error = new Error('https://private.example/?token=do-not-log');
    const context = setup({ startStremio: async () => { throw error; } });
    await expect(context.runtime.ready).rejects.toBe(error);
    await context.runtime.stop(1);
    expect(context.translator.stop).toHaveBeenCalledOnce();
    expect(context.startSources).not.toHaveBeenCalled();
    expect(context.logger.error).toHaveBeenCalledWith(expect.stringContaining('addon Stremio local'));
    expect(JSON.stringify(context.logger.error.mock.calls)).not.toContain('do-not-log');
  });

  it('closes the addon even when a source host is stuck during shutdown', async () => {
    vi.useFakeTimers();
    const stuck = deferred<void>();
    const context = setup({ startSources: async () => ({ stop: () => stuck.promise }), shutdownTimeoutMs: 8000 });
    await context.runtime.ready;
    const stopped = context.runtime.stop();
    await vi.advanceTimersByTimeAsync(8000);
    expect(context.stremio.stop).toHaveBeenCalledOnce();
    expect(context.translator.stop).toHaveBeenCalledOnce();
    expect(context.exit).toHaveBeenCalledExactlyOnceWith(1);
    stuck.resolve();
    await stopped;
    expect(context.exit).toHaveBeenCalledOnce();
  });
});
