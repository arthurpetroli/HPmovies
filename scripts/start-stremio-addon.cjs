'use strict';

const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

/** Start only the operator-selected checkout, preserving its upstream license. */
async function startStremioAddon(options = {}) {
  const env = options.env || process.env;
  const root = path.resolve(projectRoot, env.HPMOVIES_FMHY_DIR || '.local/fmhywebstremio');
  const rawPort = env.HPMOVIES_STREMIO_PORT || '7010';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('HPMOVIES_STREMIO_PORT deve ser uma porta válida.');
  }
  if (!existsSync(path.join(root, 'package.json')) || !existsSync(path.join(root, 'LICENSE.txt')) || !existsSync(path.join(root, 'dist/index.js'))) {
    throw new Error('Addon local ausente ou sem build. Prepare .local/fmhywebstremio conforme docs/STREMIO-INTEGRATION.md.');
  }
  let packageInfo;
  try { packageInfo = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')); }
  catch { throw new Error('Não foi possível ler o pacote do addon local.'); }
  if (packageInfo.name !== 'fmhy-webstream' || packageInfo.license !== 'MIT') {
    throw new Error('O diretório configurado não contém o addon FMHY esperado.');
  }
  // Fail before spawning if another service owns this address. Never terminate
  // or silently reuse an unrelated service already running on the selected port.
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error('A porta do addon já está ocupada ou indisponível.')));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'fmhy-loopback.cjs'), path.join(root, 'dist/index.js')], {
    cwd: root,
    env: {
      ...env, PORT: String(port), HPMOVIES_STREMIO_PORT: String(port), NODE_ENV: 'development',
      EXTRACTABILITY_RELOAD_INTERVAL_MS: '0',
    },
    // Upstream errors can contain private media URLs. Report bounded lifecycle
    // status here instead of copying raw upstream output to the terminal/logs.
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let stopping = false;
  let exited = false;
  const finished = new Promise(resolve => {
    child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); });
    child.once('error', () => { exited = true; resolve({ code: 1, signal: null }); });
  });
  const spawned = new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(new Error('Não foi possível iniciar o processo do addon local.')));
  });
  const stop = async () => {
    if (stopping || exited) return;
    stopping = true;
    child.kill('SIGTERM');
    const forced = setTimeout(() => child.kill('SIGKILL'), 3000);
    forced.unref();
    await finished;
    clearTimeout(forced);
  };
  const abort = () => { void stop(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  void finished.finally(() => options.signal?.removeEventListener('abort', abort));
  try {
    await spawned;
    if (options.signal?.aborted) { await stop(); throw new Error('Inicialização do addon cancelada.'); }
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (exited) throw new Error('O addon encerrou antes de disponibilizar o serviço. Confira versão, build e dependências.');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/ready`, { redirect: 'error', signal: AbortSignal.timeout(750) });
        if (response.ok && (await response.json()).status === 'ok') {
          console.log(`[Stremio] Addon FMHY disponível em http://127.0.0.1:${port}/manifest.json`);
          console.log('[Stremio] O registro embarcado não comprova disponibilidade atual; cada solicitação verifica sua mídia.');
          return { origin: `http://127.0.0.1:${port}`, stop, finished };
        }
      } catch { /* Readiness can lag the process spawn. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('O addon local não ficou pronto dentro de 15 segundos.');
  } catch (error) { await stop(); throw error; }
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(projectRoot, process.env.DOTENV_CONFIG_PATH || '.env'), quiet: true });
  let runtime;
  let signal;
  const controller = new AbortController();
  const shutdown = received => {
    signal = received;
    controller.abort();
    if (runtime) void runtime.stop();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  startStremioAddon({ signal: controller.signal }).then(async started => {
    runtime = started;
    if (signal) await runtime.stop();
    const outcome = await runtime.finished;
    process.exitCode = signal ? 0 : outcome.code || (outcome.signal ? 1 : 0);
    if (process.exitCode) console.error('[Stremio] O processo do addon encerrou inesperadamente.');
  }).catch(error => {
    if (!signal) console.error(`[Stremio] ${error.message}`);
    process.exitCode = signal ? 0 : 1;
  });
}

module.exports = { startStremioAddon };
