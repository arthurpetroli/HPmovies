'use strict';

const MANIFEST_ID = 'fmhy-webstream';
const inactive = () => ({ stop: async () => {} });

function selectedOrigin(env) {
  if (env.STREMIO_ALLOW_LOOPBACK !== 'true') return undefined;
  const raw = env.STREMIO_ADDONS_JSON || '[]';
  let addons;
  try {
    if (raw.length > 32000) throw new Error('INVALID_CONFIG');
    addons = JSON.parse(raw);
    if (!Array.isArray(addons)) throw new Error('INVALID_CONFIG');
  } catch { throw new Error('A configuração dos addons Stremio deve ser uma lista JSON válida.'); }
  const rawPort = env.HPMOVIES_STREMIO_PORT || '7010';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('HPMOVIES_STREMIO_PORT deve ser uma porta válida.');
  }
  const origin = `http://127.0.0.1:${port}`;
  return addons.some(addon => addon && addon.authorized === true && addon.manifestUrl === `${origin}/manifest.json`) ? origin : undefined;
}

async function json(response) {
  if (!response.ok || !response.body) throw new Error('INVALID_SERVICE');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 128 * 1024) throw new Error('INVALID_SERVICE');
      chunks.push(Buffer.from(part.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function existingService(origin, fetcher, signal) {
  let response;
  try {
    response = await fetcher(`${origin}/ready`, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(1000), ...(signal ? [signal] : [])]) });
  } catch {
    if (signal?.aborted) throw new Error('Inicialização do addon cancelada.');
    // The launcher checks the actual TCP port before spawning. A timeout is
    // never permission to terminate or replace the process listening there.
    return false;
  }
  try {
    const ready = await json(response);
    if (ready?.status !== 'ok') throw new Error('INVALID_SERVICE');
    const manifest = await json(await fetcher(`${origin}/manifest.json`, {
      redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(1000), ...(signal ? [signal] : [])]),
    }));
    if (manifest?.id !== MANIFEST_ID || !Array.isArray(manifest.resources)
      || !manifest.resources.some(resource => resource === 'stream' || resource?.name === 'stream')
      || !Array.isArray(manifest.types) || !['movie', 'series'].every(type => manifest.types.includes(type))) {
      throw new Error('INVALID_SERVICE');
    }
    return true;
  } catch {
    if (signal?.aborted) throw new Error('Inicialização do addon cancelada.');
    throw new Error('A porta do addon está ocupada por um serviço que não corresponde ao FMHY esperado.');
  }
}

function pause(delay, signal) {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Start the configured local FMHY dependency with the app; own only children created here. */
async function startOptionalStremioAddon(options = {}) {
  const env = options.env || process.env;
  const origin = selectedOrigin(env);
  if (!origin) return inactive();
  const signal = options.signal;
  if (signal?.aborted) throw new Error('Inicialização do addon cancelada.');
  const logger = options.logger || console;
  if (await existingService(origin, options.fetcher || fetch, signal)) {
    logger.info('[Stremio] Addon FMHY local já ativo; serviço reutilizado.');
    return { origin, owned: false, ...inactive() };
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  // Load the standalone launcher only after the app has selected its dotenv file.
  const launch = options.startAddon || require('./start-stremio-addon.cjs').startStremioAddon;
  let runtime;
  try {
    runtime = await launch({ env, signal: controller.signal });
    if (controller.signal.aborted) {
      await runtime.stop();
      throw new Error('Inicialização do addon cancelada.');
    }
  } catch (error) {
    signal?.removeEventListener('abort', abort);
    throw error;
  }
  // Retry only unexpected exits of an owned child, with a fixed total budget.
  // Invalid initial configuration fails immediately; no process is restarted forever.
  const delays = (options.restartDelaysMs || [500, 1000, 2000]).slice(0, 3);
  let stopPromise;
  const finished = (async () => {
    let attempts = 0;
    while (!controller.signal.aborted) {
      if (runtime) {
        try { await runtime.finished; } catch { /* Report a bounded lifecycle failure below. */ }
      }
      if (controller.signal.aborted) break;
      if (attempts >= delays.length) {
        logger.error('[Stremio] Addon local indisponível após as tentativas de reinício. Reinicie o aplicativo para tentar novamente.');
        return { code: 1, signal: null };
      }
      logger.error('[Stremio] O addon local encerrou inesperadamente. Tentando reiniciar o serviço.');
      await pause(delays[attempts++], controller.signal);
      if (controller.signal.aborted) break;
      try {
        runtime = await launch({ env, signal: controller.signal });
        if (controller.signal.aborted) await runtime.stop();
      } catch { runtime = undefined; }
    }
    return { code: 0, signal: null };
  })().finally(() => signal?.removeEventListener('abort', abort));

  return { origin, owned: true, finished, stop: () => {
    if (!stopPromise) {
      controller.abort();
      stopPromise = (async () => { await runtime?.stop(); await finished; })();
    }
    return stopPromise;
  } };
}

module.exports = { startOptionalStremioAddon };
