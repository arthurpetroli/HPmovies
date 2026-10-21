'use strict';

const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createHostApp } = require('./vendor/host-server.cjs');

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;

async function readBounded(filePath, maximum, label) {
  const handle = await require('node:fs/promises').open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) {
      throw new Error(`${label} must be a regular file of at most ${maximum} bytes: ${filePath}`);
    }
    // Read no more than the admitted size, including when a file grows concurrently.
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maximum || bytesRead > stat.size) throw new Error(`${label} changed during reading: ${filePath}`);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function localPath(value, configDirectory, label) {
  if (typeof value !== 'string' || !value.trim() || /^[a-z][a-z\d+.-]*:/i.test(value)) {
    throw new Error(`${label} must name a local file`);
  }
  return path.resolve(configDirectory, value);
}

function assertManifest(manifest, namespaces, identifiers, runtime) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Extension manifest must be an object');
  const identifier = manifest.id;
  const namespace = manifest.apiServer?.namespace;
  if (typeof identifier !== 'string' || !/^[a-zA-Z\d][a-zA-Z\d._-]{0,127}$/.test(identifier)) throw new Error('Extension manifest has an invalid id');
  if (typeof namespace !== 'string' || !/^[a-zA-Z\d][a-zA-Z\d_-]{0,63}$/.test(namespace)) throw new Error(`Extension ${identifier} requires apiServer.namespace`);
  if (namespaces.has(namespace) || identifiers.has(identifier)) throw new Error(`Duplicate extension id or namespace: ${identifier}/${namespace}`);
  if (!['streaming-sources-v3', 'custom-source-v1'].includes(manifest.apiServer.contract)) throw new Error(`Unsupported API contract for ${identifier}`);
  if (Array.isArray(manifest.browserDomains) && manifest.browserDomains.length && runtime.browserMode !== 'disabled') {
    throw new Error(`Extension ${identifier} requires Electron browser helpers, which this Node host does not provide`);
  }
  if (manifest.capabilities !== undefined && (!Array.isArray(manifest.capabilities) || manifest.capabilities.some(value => typeof value !== 'string'))) throw new Error(`Invalid capabilities for ${identifier}`);
  if (manifest.apiServer.routes !== undefined && (!Array.isArray(manifest.apiServer.routes) || manifest.apiServer.routes.some(value => typeof value !== 'string'))) throw new Error(`Invalid API routes for ${identifier}`);
  identifiers.add(identifier);
  namespaces.add(namespace);
}

function runtimeOptions(entry) {
  if (entry.browserMode !== undefined && entry.browserMode !== 'disabled') throw new Error('browserMode only supports disabled in the local Node host');
  if (entry.mangaTimeoutMs !== undefined && (!Number.isInteger(entry.mangaTimeoutMs) || entry.mangaTimeoutMs < 1000 || entry.mangaTimeoutMs > 60000)) throw new Error('mangaTimeoutMs must be between 1000 and 60000');
  if (entry.providers !== undefined && (!Array.isArray(entry.providers) || !entry.providers.length || entry.providers.length > 150 || entry.providers.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(value)))) {
    throw new Error('providers must be an explicit nonempty list of provider names');
  }
  return { browserMode: entry.browserMode, providers: entry.providers ? [...new Set(entry.providers)] : undefined, mangaTimeoutMs: entry.mangaTimeoutMs };
}

/** Load only operator-selected, hash-pinned, self-contained CommonJS bundles. */
async function loadLocalRegistry(configFile) {
  const entries = new Map();
  const registry = { listLoaded: () => [...entries.keys()].sort(), lookup: id => entries.get(id) };
  if (!configFile) return { registry, cleanup: async () => {} };
  const configPath = path.resolve(configFile);
  const config = JSON.parse((await readBounded(configPath, MAX_CONFIG_BYTES, 'Source config')).toString('utf8'));
  if (config.version !== 1 || !Array.isArray(config.extensions) || config.extensions.length > 32) throw new Error('Source config requires version: 1 and up to 32 extensions');
  const configDirectory = path.dirname(configPath);
  const namespaces = new Set();
  const identifiers = new Set();
  const staged = [];
  // Validate every file before making any extension executable.
  for (const entry of config.extensions) {
    if (!entry || entry.trusted !== true || !/^[a-f\d]{64}$/i.test(entry.sha256 || '')) {
      throw new Error('Each local extension requires trusted: true and its bundle sha256');
    }
    const manifestPath = localPath(entry.manifestPath, configDirectory, 'manifestPath');
    const bundlePath = localPath(entry.bundlePath, configDirectory, 'bundlePath');
    const manifest = JSON.parse((await readBounded(manifestPath, MAX_MANIFEST_BYTES, 'Manifest')).toString('utf8'));
    const runtime = runtimeOptions(entry);
    assertManifest(manifest, namespaces, identifiers, runtime);
    const bundle = await readBounded(bundlePath, MAX_BUNDLE_BYTES, 'Bundle');
    const actualHash = createHash('sha256').update(bundle).digest('hex');
    if (actualHash !== entry.sha256.toLowerCase()) throw new Error(`Bundle sha256 mismatch: ${bundlePath}`);
    staged.push({ manifest, bundle, runtime });
  }
  const stagingDirectory = await mkdtemp(path.join(tmpdir(), 'hpmovies-sources-'));
  try {
    for (const { manifest, bundle, runtime } of staged) {
      const bundlePath = path.join(stagingDirectory, `${manifest.id}.cjs`);
      await writeFile(bundlePath, bundle, { mode: 0o600, flag: 'wx' });
      entries.set(manifest.id, { manifest, bundlePath, runtime });
    }
    return { registry, cleanup: () => rm(stagingDirectory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

function isLocalRequest(req) {
  try {
    const host = new URL(`http://${req.headers.host || ''}`);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return false;
    const origin = req.headers.origin;
    return !origin || ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname);
  } catch { return false; }
}

/** Start the upstream HTTP contract with an explicit local-file registry. */
async function startSourceHost({ port = 8099, extensionsFile, logger = console } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Source host port must be between 0 and 65535');
  // The portable bundle supports ordinary HTTP without the optional challenge
  // solver. This host never starts a browser or installs one on a source error.
  process.env.CF_BYPASS_ENABLED = 'false';
  process.env.CF_BYPASS_AUTO_INSTALL = 'false';
  const loaded = await loadLocalRegistry(extensionsFile);
  const app = createHostApp({ registry: loaded.registry, logger });
  const server = createServer((req, res) => {
    const reply = (status, error) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error })); };
    if (!isLocalRequest(req)) return reply(403, 'Only loopback requests are allowed');
    if (!['GET', 'OPTIONS'].includes(req.method)) return reply(405, 'Method not allowed');
    // The upstream reachability probe accepts arbitrary URLs. HPmovies does not expose it.
    if (new URL(req.url, 'http://127.0.0.1').pathname === '/api/v3/probe') return reply(404, 'Not found');
    Promise.resolve(app.handler(req, res)).catch(error => {
      logger.error?.(`[SourceHost] ${error.message}`);
      if (!res.headersSent) reply(502, 'Source host request failed');
      else res.end();
    });
  });
  server.requestTimeout = 90_000;
  server.headersTimeout = 10_000;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch (error) { app.invalidateBundles(); await loaded.cleanup(); throw error; }
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  logger.info?.(`[SourceHost] ${baseUrl} (${app.listNamespaces().length} explicit local extensions)`);
  return {
    baseUrl,
    listNamespaces: app.listNamespaces,
    async stop() {
      app.invalidateBundles();
      await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
      await loaded.cleanup();
    },
  };
}

module.exports = { startSourceHost, loadLocalRegistry };
