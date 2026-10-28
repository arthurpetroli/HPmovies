'use strict';

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

/** Reuse an existing translator, or start the optional model installed in the local cache. */
async function startOptionalSubtitleTranslator() {
  const inactive = { stop: async () => {} };
  if (process.env.AUTOMATIC_SUBTITLES_ENABLED === 'false') return inactive;
  const port = process.env.HPMOVIES_TRANSLATOR_PORT || '5000';
  const expected = `http://127.0.0.1:${port}`;
  if (process.env.AUTOMATIC_SUBTITLES_URL && process.env.AUTOMATIC_SUBTITLES_URL.replace(/\/$/, '') !== expected) return inactive;
  try {
    const response = await fetch(`${expected}/health`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
    const health = await response.json();
    if (response.ok && health.status === 'OK') return inactive;
  } catch { /* A missing optional translator never prevents the source host from starting. */ }
  const root = process.env.HPMOVIES_TRANSLATOR_HOME || join(homedir(), '.cache/hpmovies/subtitle-translator');
  const python = join(root, 'venv/bin/python');
  if (!existsSync(python) || !existsSync(join(root, 'models/translate-en_pb-1_9/model/model.bin'))) {
    console.log('[legendas] Tradução opcional sem modelo local. Instale com npm run setup:translator.');
    return inactive;
  }
  const child = spawn(python, [join(__dirname, 'subtitle-translator.py')], { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', () => console.error('[legendas] Não foi possível iniciar o tradutor local.'));
  child.on('exit', code => { if (code && code !== 0) console.error('[legendas] Tradutor local encerrado; o vídeo continua disponível.'); });
  return { stop: async () => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  } };
}

module.exports = { startOptionalSubtitleTranslator };
