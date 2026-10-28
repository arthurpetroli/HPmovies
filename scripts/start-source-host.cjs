'use strict';

require('dotenv').config();
const { startSourceHost } = require('../src/aniwatch-apis/src/providers/tatakai-runtime/local-server.cjs');
const { startOptionalSubtitleTranslator } = require('./start-subtitle-translator.cjs');

async function start() {
  const translator = await startOptionalSubtitleTranslator();
  let host;
  try {
    host = await startSourceHost({
      port: Number(process.env.HPMOVIES_SOURCE_HOST_PORT || 8099),
      extensionsFile: process.env.HPMOVIES_EXTENSIONS_FILE || undefined,
    });
  } catch (error) { await translator.stop(); throw error; }
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const forced = setTimeout(() => process.exit(1), 5000);
    forced.unref();
    try { await host.stop(); }
    finally { await translator.stop(); clearTimeout(forced); }
    process.exitCode = 0;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

start().catch(error => {
  console.error(`[SourceHost] ${error.message}`);
  process.exitCode = 1;
});
