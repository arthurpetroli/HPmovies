'use strict';

const http = require('node:http');

// The pinned FMHY entry calls listen(port) without a host. Limit its only HTTP
// listener to loopback without modifying the upstream server or its relay.
const configuredPort = Number(process.env.HPMOVIES_STREMIO_PORT);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
  throw new Error('Porta local Stremio inválida.');
}
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function listen(port, callback) {
  if (port !== configuredPort || arguments.length > 2 || callback !== undefined && typeof callback !== 'function') {
    throw new Error('O addon tentou abrir um listener HTTP fora do contrato local.');
  }
  return originalListen.call(this, configuredPort, '127.0.0.1', callback);
};
