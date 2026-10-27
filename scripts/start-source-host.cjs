'use strict';

require('dotenv').config();
const { startSourceHost } = require('../src/aniwatch-apis/src/providers/tatakai-runtime/local-server.cjs');

startSourceHost({
  port: Number(process.env.HPMOVIES_SOURCE_HOST_PORT || 8099),
  extensionsFile: process.env.HPMOVIES_EXTENSIONS_FILE || undefined,
}).then(host => {
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const forced = setTimeout(() => process.exit(1), 5000);
    forced.unref();
    await host.stop();
    clearTimeout(forced);
    process.exitCode = 0;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}).catch(error => {
  console.error(`[SourceHost] ${error.message}`);
  process.exitCode = 1;
});
