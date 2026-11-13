import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

interface Child {
  origin: string;
  stop(): Promise<void>;
  finished: Promise<{ code: number | null; signal: string | null }>;
}
interface Runtime {
  origin?: string;
  owned?: boolean;
  stop(): Promise<void>;
  finished?: Child['finished'];
}
interface Options {
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  startAddon?: (options: { env: NodeJS.ProcessEnv; signal: AbortSignal }) => Promise<Child>;
  logger?: { info(message: string): void; error(message: string): void };
  restartDelaysMs?: number[];
}
const { startOptionalStremioAddon } = createRequire(import.meta.url)('../scripts/start-optional-stremio.cjs') as {
  startOptionalStremioAddon(options: Options): Promise<Runtime>;
};
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

const config = (port = 7010): NodeJS.ProcessEnv => ({ STREMIO_ALLOW_LOOPBACK: 'true', HPMOVIES_STREMIO_PORT: String(port),
  STREMIO_ADDONS_JSON: JSON.stringify([{ id: 'operator-selected-name', authorized: true, manifestUrl: `http://127.0.0.1:${port}/manifest.json` }]),
});
const manifest = { id: 'fmhy-webstream', resources: ['stream'], types: ['movie', 'series'] };
const logger = () => ({ info: vi.fn(), error: vi.fn() });
const absent = () => vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Synthetic connection refused'));

function child(origin = 'http://127.0.0.1:7010') {
  let end!: (value: { code: number | null; signal: string | null }) => void;
  const finished = new Promise<{ code: number | null; signal: string | null }>(resolve => { end = resolve; });
  return { origin, finished, end, stop: vi.fn(async () => { end({ code: 0, signal: null }); }) };
}

async function existing(payload = manifest) {
  // Real loopback HTTP, synthetic readiness/manifest only; no media is consulted.
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/ready' ? { status: 'ok' } : payload));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  cleanup.push(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  return { server, port: address.port, origin: `http://127.0.0.1:${address.port}` };
}

describe('optional local Stremio lifecycle (synthetic services)', () => {
  it.each([
    {}, { ...config(), STREMIO_ALLOW_LOOPBACK: 'false' }, { ...config(), STREMIO_ADDONS_JSON: '[]' },
    { ...config(), STREMIO_ADDONS_JSON: JSON.stringify([{ authorized: false, manifestUrl: 'http://127.0.0.1:7010/manifest.json' }]) },
    { ...config(), STREMIO_ADDONS_JSON: JSON.stringify([{ authorized: true, manifestUrl: 'http://127.0.0.1:7010/manifest.json?private=not-authorized' }]) },
    { ...config(), STREMIO_ADDONS_JSON: JSON.stringify([{ authorized: true, manifestUrl: 'http://localhost:7010/manifest.json' }]) },
    { ...config(), STREMIO_ADDONS_JSON: JSON.stringify([{ authorized: true, manifestUrl: 'http://user:secret@127.0.0.1:7010/manifest.json' }]) },
  ])('does nothing without the exact authorized loopback opt-in %#', async env => {
    const fetcher = absent(), startAddon = vi.fn();
    const runtime = await startOptionalStremioAddon({ env, fetcher, startAddon });
    await runtime.stop();
    expect(fetcher).not.toHaveBeenCalled();
    expect(startAddon).not.toHaveBeenCalled();
    expect(runtime.owned).toBeUndefined();
  });

  it('rejects invalid configuration and pre-aborted startup before contacting services', async () => {
    const fetcher = absent(), startAddon = vi.fn();
    await expect(startOptionalStremioAddon({ env: { ...config(), STREMIO_ADDONS_JSON: '{private' }, fetcher, startAddon })).rejects.toThrow('lista JSON válida');
    await expect(startOptionalStremioAddon({ env: { ...config(), HPMOVIES_STREMIO_PORT: '7010junk' }, fetcher, startAddon })).rejects.toThrow('porta válida');
    await expect(startOptionalStremioAddon({ env: config(), signal: AbortSignal.abort(), fetcher, startAddon })).rejects.toThrow('cancelada');
    expect(fetcher).not.toHaveBeenCalled();
    expect(startAddon).not.toHaveBeenCalled();
  });

  it('reuses an identified running FMHY without spawning or owning its lifetime', async () => {
    const service = await existing();
    const startAddon = vi.fn();
    const runtime = await startOptionalStremioAddon({ env: config(service.port), startAddon, logger: logger() });
    expect(runtime).toMatchObject({ origin: service.origin, owned: false });
    await runtime.stop();
    expect(startAddon).not.toHaveBeenCalled();
    expect(service.server.listening).toBe(true);
    expect((await (await fetch(`${service.origin}/ready`)).json()).status).toBe('ok');
  });

  it.each([
    { ...manifest, id: 'unrelated-service' },
    { ...manifest, resources: ['catalog'] },
    { ...manifest, types: ['movie'] },
  ])('rejects an occupied service with a different identity or contract %# without terminating it', async payload => {
    const service = await existing(payload);
    const startAddon = vi.fn();
    await expect(startOptionalStremioAddon({ env: { ...config(service.port), MANIFEST_ID: payload.id }, startAddon, logger: logger() })).rejects.toThrow('não corresponde');
    expect(startAddon).not.toHaveBeenCalled();
    expect(service.server.listening).toBe(true);
  });

  it('starts the configured child when absent and closes only its owned resource once', async () => {
    const owned = child(), startAddon = vi.fn(async () => owned);
    const runtime = await startOptionalStremioAddon({ env: config(), fetcher: absent(), startAddon, logger: logger() });
    cleanup.push(runtime.stop);
    expect(runtime).toMatchObject({ origin: owned.origin, owned: true });
    expect(startAddon).toHaveBeenCalledExactlyOnceWith({ env: config(), signal: expect.any(AbortSignal) });
    await Promise.all([runtime.stop(), runtime.stop()]);
    expect(owned.stop).toHaveBeenCalledOnce();
    await expect(runtime.finished).resolves.toEqual({ code: 0, signal: null });
  });

  it('propagates cancellation during initial startup and closes a late child', async () => {
    const controller = new AbortController();
    const owned = child();
    let finish!: (value: Child) => void;
    const pending = new Promise<Child>(resolve => { finish = resolve; });
    const startAddon = vi.fn(() => pending);
    const starting = startOptionalStremioAddon({ env: config(), signal: controller.signal, fetcher: absent(), startAddon, logger: logger() });
    await vi.waitFor(() => expect(startAddon).toHaveBeenCalledOnce());
    controller.abort();
    finish(owned);
    await expect(starting).rejects.toThrow('cancelada');
    expect(owned.stop).toHaveBeenCalledOnce();
    expect(startAddon.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('does not retry a failed initial startup or log a private failure', async () => {
    const privateError = new Error('https://private.invalid/?token=not-for-logs');
    const startAddon = vi.fn(async () => { throw privateError; }), logs = logger();
    await expect(startOptionalStremioAddon({ env: config(), fetcher: absent(), startAddon, logger: logs })).rejects.toBe(privateError);
    expect(startAddon).toHaveBeenCalledOnce();
    expect(logs.error).not.toHaveBeenCalled();
  });

  it('restarts an unexpectedly exited owned child and stops its replacement', async () => {
    const first = child(), replacement = child();
    const startAddon = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(replacement);
    const runtime = await startOptionalStremioAddon({ env: config(), fetcher: absent(), startAddon, logger: logger(), restartDelaysMs: [1] });
    cleanup.push(runtime.stop);
    first.end({ code: 1, signal: null });
    await vi.waitFor(() => expect(startAddon).toHaveBeenCalledTimes(2));
    await runtime.stop();
    expect(replacement.stop).toHaveBeenCalledOnce();
    await expect(runtime.finished).resolves.toMatchObject({ code: 0 });
  });

  it('bounds repeated crashes and restart failures without exposing child errors', async () => {
    const first = child(), logs = logger();
    const startAddon = vi.fn().mockResolvedValueOnce(first).mockRejectedValue(new Error('https://private.invalid/?token=not-for-logs'));
    const runtime = await startOptionalStremioAddon({ env: config(), fetcher: absent(), startAddon, logger: logs, restartDelaysMs: [1, 1] });
    cleanup.push(runtime.stop);
    first.end({ code: 1, signal: null });
    await expect(runtime.finished).resolves.toMatchObject({ code: 1 });
    expect(startAddon).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain('not-for-logs');
    expect(logs.error).toHaveBeenLastCalledWith(expect.stringContaining('após as tentativas'));
  });

  it('cancels a scheduled restart immediately on shutdown', async () => {
    const first = child(), logs = logger(), startAddon = vi.fn(async () => first);
    const runtime = await startOptionalStremioAddon({ env: config(), fetcher: absent(), startAddon, logger: logs, restartDelaysMs: [60_000] });
    cleanup.push(runtime.stop);
    first.end({ code: 1, signal: null });
    await vi.waitFor(() => expect(logs.error).toHaveBeenCalledOnce());
    await runtime.stop();
    expect(startAddon).toHaveBeenCalledOnce();
    await expect(runtime.finished).resolves.toMatchObject({ code: 0 });
  });
});
