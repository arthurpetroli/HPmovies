'use strict';

const { stat } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startSourceHost } = require('../src/aniwatch-apis/src/providers/tatakai-runtime/local-server.cjs');
const { startOptionalSubtitleTranslator } = require('./start-subtitle-translator.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PRODUCTION_ENTRY = 'dist/backend/aniwatch-apis/src/production.js';

async function verifyBuild(root) {
  for (const relative of ['dist/web/index.html', PRODUCTION_ENTRY]) {
    if (!(await stat(path.join(root, relative))).isFile()) throw new Error('INVALID_BUILD');
  }
}

async function loadProduction(root) {
  const [production, cacheModule] = await Promise.all([
    import(pathToFileURL(path.join(root, PRODUCTION_ENTRY)).href),
    import(pathToFileURL(path.join(root, 'dist/backend/aniwatch-apis/src/config/cache.js')).href),
  ]);
  return { startProductionServer: production.startProductionServer, closeCache: () => cacheModule.cache.closeConnection() };
}

function failureMessage(stage, error) {
  if (stage === 'build') return '[produção] Build ausente ou incompleto. Execute npm run build antes de npm start.';
  if (error?.code === 'EADDRINUSE') return `[produção] A porta de ${stage} já está ocupada. Encerre a outra instância ou configure uma porta livre.`;
  if (error?.code === 'EACCES') return `[produção] Sem permissão para iniciar ${stage}. Confira as portas e os arquivos locais.`;
  // Error objects may contain private provider configuration. Keep startup logs bounded.
  return `[produção] Não foi possível iniciar ${stage}. Confira a configuração privada e os arquivos necessários.`;
}

/** Supervise only resources owned by this run, including an optional translator. */
function createProductionRuntime(options = {}) {
  const root = path.resolve(options.root || PROJECT_ROOT);
  const env = options.env || process.env;
  const logger = options.logger || console;
  const signals = options.signals || process;
  const exit = options.exit || (code => process.exit(code));
  const resources = [];
  let stopping = false;
  let exitCode = 0;
  let stopPromise;
  let exited = false;
  let finishStartup;
  const startupFinished = new Promise(resolve => { finishStartup = resolve; });

  const listeners = {
    SIGINT: () => { void stop(); },
    SIGTERM: () => { void stop(); },
    uncaughtException: () => {
      logger.error('[produção] Falha inesperada. Encerrando os serviços desta execução.');
      void stop(1);
    },
    unhandledRejection: () => {
      logger.error('[produção] Falha assíncrona inesperada. Encerrando os serviços desta execução.');
      void stop(1);
    },
  };
  const detach = () => {
    for (const [event, listener] of Object.entries(listeners)) signals.removeListener(event, listener);
  };
  const finish = code => {
    if (exited) return;
    exited = true;
    detach();
    exit(code);
  };
  const close = resource => {
    if (!resource.closing) resource.closing = Promise.resolve().then(resource.stop);
    // Handle rejection immediately, even if shutdown is waiting on startup.
    void resource.closing.catch(() => {});
    return resource.closing;
  };
  const own = resource => {
    const entry = { stop: () => resource.stop() };
    resources.push(entry);
    if (stopping) close(entry);
    return resource;
  };

  function stop(code = 0) {
    exitCode = Math.max(exitCode, code);
    stopping = true;
    if (stopPromise) return stopPromise;
    const forced = setTimeout(() => {
      logger.error('[produção] Prazo de encerramento excedido. Finalizando esta execução.');
      finish(1);
    }, options.shutdownTimeoutMs ?? 8000);
    // Start every available cleanup now; a slow host must not strand Python.
    for (const resource of [...resources].reverse()) close(resource);
    stopPromise = (async () => {
      await startupFinished;
      const results = await Promise.allSettled([...resources].reverse().map(close));
      if (results.some(result => result.status === 'rejected')) {
        exitCode = 1;
        logger.error('[produção] Um serviço não encerrou normalmente.');
      }
      clearTimeout(forced);
      finish(exitCode);
    })();
    return stopPromise;
  }

  // Register before the first await: signals during startup must not orphan a child.
  for (const [event, listener] of Object.entries(listeners)) signals.on(event, listener);
  const ready = (async () => {
    let stage = 'build';
    try {
      await (options.verifyBuild || (() => verifyBuild(root)))();
      if (stopping) return;
      stage = 'tradutor';
      own(await (options.startTranslator || startOptionalSubtitleTranslator)());
      if (stopping) return;
      stage = 'fontes';
      const sourcePort = Number(env.HPMOVIES_SOURCE_HOST_PORT || 8099);
      if (!Number.isInteger(sourcePort) || sourcePort < 1 || sourcePort > 65535) throw new Error('INVALID_SOURCE_PORT');
      own(await (options.startSources || startSourceHost)({
        port: sourcePort,
        extensionsFile: env.HPMOVIES_EXTENSIONS_FILE ? path.resolve(root, env.HPMOVIES_EXTENSIONS_FILE) : undefined,
        logger,
      }));
      if (stopping) return;
      stage = 'servidor';
      const production = await (options.loadProduction || (() => loadProduction(root)))();
      own({ stop: production.closeCache });
      if (stopping) return;
      const server = own(await production.startProductionServer({ frontendRoot: path.join(root, 'dist/web') }));
      if (stopping) return;
      logger.info(`[produção] HPmovies disponível em ${server.origin}`);
      return { origin: server.origin };
    } catch (error) {
      logger.error(failureMessage(stage, error));
      exitCode = 1;
      throw error;
    } finally {
      finishStartup();
    }
  })();
  void ready.catch(() => stop(1));
  return { ready, stop };
}

if (require.main === module) {
  process.env.NODE_ENV = 'production';
  process.env.DOTENV_CONFIG_PATH = path.resolve(PROJECT_ROOT, process.env.DOTENV_CONFIG_PATH || '.env');
  require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH });
  // Keep the API's dotenv/config imports on the same operator-selected file.
  createProductionRuntime();
}

module.exports = { createProductionRuntime };
