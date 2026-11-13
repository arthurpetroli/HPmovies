'use strict';

const path = require('node:path');
const { startSourceHost } = require('../src/aniwatch-apis/src/providers/tatakai-runtime/local-server.cjs');
const { startOptionalSubtitleTranslator } = require('./start-subtitle-translator.cjs');
const { startOptionalStremioAddon } = require('./start-optional-stremio.cjs');

/** Keep optional local services in the same lifecycle as npm run dev. */
function createSourceHostRuntime(options = {}) {
  const env = options.env || process.env;
  const signals = options.signals || process;
  const exit = options.exit || (code => process.exit(code));
  const logger = options.logger || console;
  const controller = new AbortController();
  const resources = [];
  let stopping = false;
  let stopPromise;
  let finishStartup;
  let exited = false;
  let exitCode = 0;
  const startupFinished = new Promise(resolve => { finishStartup = resolve; });
  const listeners = { SIGINT: () => { void stop(); }, SIGTERM: () => { void stop(); } };
  const finish = code => {
    if (exited) return;
    exited = true;
    for (const [event, listener] of Object.entries(listeners)) signals.removeListener(event, listener);
    exit(code);
  };
  const close = resource => {
    if (!resource.closing) resource.closing = Promise.resolve().then(() => resource.stop());
    void resource.closing.catch(() => {});
    return resource.closing;
  };
  const own = resource => {
    resources.push(resource);
    if (stopping) close(resource);
    return resource;
  };
  function stop(code = 0) {
    exitCode = Math.max(exitCode, code);
    stopping = true;
    controller.abort();
    if (stopPromise) return stopPromise;
    const forced = setTimeout(() => finish(1), options.shutdownTimeoutMs ?? 8000);
    forced.unref();
    for (const resource of [...resources].reverse()) close(resource);
    stopPromise = (async () => {
      await startupFinished;
      const results = await Promise.allSettled([...resources].reverse().map(close));
      if (results.some(result => result.status === 'rejected')) exitCode = 1;
      clearTimeout(forced);
      finish(exitCode);
    })();
    return stopPromise;
  }
  // Register before starting children so a signal during readiness cannot orphan them.
  for (const [event, listener] of Object.entries(listeners)) signals.on(event, listener);
  const ready = (async () => {
    let stage = 'tradutor';
    try {
      own(await (options.startTranslator || startOptionalSubtitleTranslator)());
      if (stopping) return;
      stage = 'addon Stremio local';
      own(await (options.startStremio || startOptionalStremioAddon)({ env, logger, signal: controller.signal }));
      if (stopping) return;
      stage = 'fontes';
      return own(await (options.startSources || startSourceHost)({
        port: Number(env.HPMOVIES_SOURCE_HOST_PORT || 8099),
        extensionsFile: env.HPMOVIES_EXTENSIONS_FILE || undefined,
      }));
    } catch (error) {
      if (stopping) return;
      logger.error(`[SourceHost] Não foi possível iniciar ${stage}. Confira a configuração e os arquivos locais.`);
      exitCode = 1;
      throw error;
    } finally { finishStartup(); }
  })();
  void ready.catch(() => stop(1));
  return { ready, stop };
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', process.env.DOTENV_CONFIG_PATH || '.env'), quiet: true });
  createSourceHostRuntime();
}

module.exports = { createSourceHostRuntime };
