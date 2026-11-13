import 'dotenv/config';
import type { StremioAddonConfig, StremioProviderOptions } from '../providers/stremio.js';

/** Operator-only configuration; no endpoint accepts addon origins from the browser. */
export function configuredStremioAddons(raw = process.env.STREMIO_ADDONS_JSON || '[]'): StremioAddonConfig[] {
  if (raw.length > 32000) throw new Error('STREMIO_ADDONS_JSON excede o limite de configuração.');
  let result: unknown;
  try { result = JSON.parse(raw); } catch { throw new Error('STREMIO_ADDONS_JSON deve ser uma lista JSON de addons.'); }
  if (!Array.isArray(result)) throw new Error('STREMIO_ADDONS_JSON deve ser uma lista JSON de addons.');
  // The adapter validates every field before making a request.
  return result as StremioAddonConfig[];
}

/** Local addon access is opt-in and does not permit other private-network hosts. */
export function configuredStremioOptions(env: NodeJS.ProcessEnv = process.env): StremioProviderOptions {
  const local = env.STREMIO_ALLOW_LOOPBACK ?? 'false';
  if (!['true', 'false'].includes(local)) throw new Error('STREMIO_ALLOW_LOOPBACK deve ser true ou false.');
  const rawTimeout = env.STREMIO_TIMEOUT_MS ?? '35000';
  const timeoutMs = Number(rawTimeout);
  if (!/^\d+$/.test(rawTimeout) || !Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 45_000) {
    throw new Error('STREMIO_TIMEOUT_MS deve estar entre 250 e 45000 ms.');
  }
  return {
    addons: configuredStremioAddons(env.STREMIO_ADDONS_JSON || '[]'),
    allowLoopback: local === 'true', timeoutMs,
  };
}
